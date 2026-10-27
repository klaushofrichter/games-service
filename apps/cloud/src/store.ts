// The service's persistent state (D-114): one SQLite database (node:sqlite, no native dependency) in DATA_DIR, plus
// uploaded game logs as files beside it. The server keeps its working set in memory as before and writes every change
// through to this store; at start it loads everything back. Without DATA_DIR (tests, local development) the store is
// an in-memory database and logs stay in memory, which is exactly the old behaviour.
//
// Layout of DATA_DIR (the PVC games-cloud-data, mounted at /data in the cluster):
//   state.db (+ -wal, -shm)       the live database (WAL mode)
//   snapshots/state.db            a consistent copy (VACUUM INTO), written at start, hourly and at shutdown
//   snapshots/state.prev.db       the snapshot as this process found it at start, before writing its own
//   logs/<id>.zip                 uploaded game logs
//   RESTORE_FROM_SNAPSHOT         optional marker: at the next start, replace state.db with the snapshot; containing
//                                 the word "previous", with snapshots/state.prev.db instead
//
// A file-level backup (Velero) can copy state.db while it is being written, so a restore must be able to start from the
// snapshot: if state.db is missing, fails to open or fails SQLite's quick_check, the snapshot replaces it (the damaged
// file is kept beside it). The marker file forces that, for a restore runbook that wants the snapshot regardless.
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statfsSync, statSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Damaged or replaced databases kept beside state.db after a recovery: the newest few, never an unbounded pile. */
const KEEP_ASIDE = 3;

/** Collections of JSON records; each record is a small object keyed by a string. */
export type Kind = "table" | "log" | "invite" | "download" | "session" | "repo" | "code" | "setting";

export interface StoreOptions {
  /** DATA_DIR; unset = in memory only. */
  dataDir?: string;
  /** How often to write the snapshot (default hourly; 0 = only at shutdown and start). */
  snapshotMs?: number;
  log?: (msg: string) => void;
}

const SCHEMA = 1;

export class Store {
  readonly persistent: boolean;
  readonly dataDir: string | null;
  /** What happened at open, for the start-up log and the tests: "new", "opened", "snapshot", "corrupt-fresh". */
  readonly opened: { how: "memory" | "new" | "opened" | "snapshot" | "corrupt-fresh"; detail?: string };
  private db: DatabaseSync;
  private timer: NodeJS.Timeout | null = null;
  private log: (msg: string) => void;
  private stmts: {
    put: ReturnType<DatabaseSync["prepare"]>;
    del: ReturnType<DatabaseSync["prepare"]>;
    all: ReturnType<DatabaseSync["prepare"]>;
  };

  constructor(o: StoreOptions = {}) {
    this.log = o.log ?? ((m) => console.log(`[cloud] ${m}`));
    this.dataDir = o.dataDir || null;
    this.persistent = !!this.dataDir;
    if (!this.dataDir) {
      this.db = new DatabaseSync(":memory:");
      this.opened = { how: "memory" };
    } else {
      const r = openWithRecovery(this.dataDir, this.log);
      this.db = r.db;
      this.opened = r.opened;
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (kind, key)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    this.db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema', ?)").run(String(SCHEMA));
    this.stmts = {
      put: this.db.prepare("INSERT INTO records (kind, key, value) VALUES (?, ?, ?) ON CONFLICT (kind, key) DO UPDATE SET value = excluded.value"),
      del: this.db.prepare("DELETE FROM records WHERE kind = ? AND key = ?"),
      all: this.db.prepare("SELECT key, value FROM records WHERE kind = ?"),
    };
    if (this.persistent) {
      mkdirSync(join(this.dataDir!, "logs"), { recursive: true });
      this.pruneAside();
      // Keep the snapshot this start found, before writing a new one. After a Velero restore that is the consistent
      // copy from the backup; if the service started once before anyone set RESTORE_FROM_SNAPSHOT, the new startup
      // snapshot is a copy of the restored (possibly torn) state.db, and "previous" in the marker still reaches the
      // good one (the cluster review of D-115).
      const snapDir = join(this.dataDir!, "snapshots");
      if (existsSync(join(snapDir, "state.db"))) copyFileSync(join(snapDir, "state.db"), join(snapDir, "state.prev.db"));
      this.snapshot(); // a fresh, consistent copy right away, so a backup taken in the next hour has one
      const every = o.snapshotMs ?? 3600_000;
      if (every > 0) {
        this.timer = setInterval(() => this.snapshot(), every);
        this.timer.unref();
      }
    }
  }

  put(kind: Kind, key: string, value: unknown) {
    this.stmts.put.run(kind, key, JSON.stringify(value));
  }

  delete(kind: Kind, key: string) {
    this.stmts.del.run(kind, key);
  }

  all<T>(kind: Kind): { key: string; value: T }[] {
    const out: { key: string; value: T }[] = [];
    for (const row of this.stmts.all.all(kind) as { key: string; value: string }[]) {
      try {
        out.push({ key: row.key, value: JSON.parse(row.value) as T });
      } catch {
        this.log(`WARNING: skipping an unreadable ${kind} record`);
      }
    }
    return out;
  }

  // ----- game logs: files on disk when persistent; the caller keeps them in memory otherwise -----

  private logPath(id: string) {
    if (!/^[\w-]+$/.test(id)) throw new Error("bad log id");
    return join(this.dataDir!, "logs", `${id}.zip`);
  }

  // Asynchronous: a log is up to 50 MB, and the other tables' heartbeats and signaling must not wait for the disk.
  async writeLog(id: string, data: Buffer) {
    const p = this.logPath(id);
    await writeFile(`${p}.tmp`, data);
    await rename(`${p}.tmp`, p);
  }

  async readLog(id: string): Promise<Buffer | null> {
    try {
      return await readFile(this.logPath(id));
    } catch {
      return null;
    }
  }

  hasLog(id: string) {
    return existsSync(this.logPath(id));
  }

  deleteLog(id: string) {
    rmSync(this.logPath(id), { force: true });
  }

  /** Log files on disk that no record mentions (left by a restore from an older snapshot, or a crash mid-upload). */
  removeOrphanLogs(known: Set<string>) {
    if (!this.persistent) return 0;
    let n = 0;
    for (const f of readdirSync(join(this.dataDir!, "logs"))) {
      const id = f.replace(/\.zip(\.tmp)?$/, "");
      if (f.endsWith(".tmp") || !known.has(id)) {
        rmSync(join(this.dataDir!, "logs", f), { force: true });
        n++;
      }
    }
    return n;
  }

  /** Size and free space of the volume DATA_DIR is on (the PVC), or null in memory. */
  volume(): { total: number; free: number } | null {
    if (!this.persistent) return null;
    try {
      const s = statfsSync(this.dataDir!);
      return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
    } catch {
      return null;
    }
  }

  /** What the service's own files take on the volume, by part, in bytes. */
  usage(): { database: number; snapshot: number; logs: number; aside: number } | null {
    if (!this.persistent) return null;
    const size = (p: string) => {
      try {
        return statSync(p).size;
      } catch {
        return 0;
      }
    };
    const dir = this.dataDir!;
    let logs = 0;
    for (const f of readdirSync(join(dir, "logs"))) logs += size(join(dir, "logs", f));
    let aside = 0;
    for (const f of readdirSync(dir)) if (/^state\.db\.(damaged|replaced)-/.test(f)) aside += size(join(dir, f));
    return {
      database: ["", "-wal", "-shm"].reduce((a, x) => a + size(join(dir, `state.db${x}`)), 0),
      snapshot: size(join(dir, "snapshots", "state.db")),
      logs,
      aside,
    };
  }

  /** Keep the newest few damaged or replaced databases from recoveries (each with its -wal and -shm), delete older ones. */
  private pruneAside() {
    const dir = this.dataDir!;
    const stamps = [...new Set(readdirSync(dir).map((f) => f.match(/^(state\.db\.(?:damaged|replaced)-[^.]*?)(?:-wal|-shm)?$/)?.[1]).filter((x): x is string => !!x))];
    const byAge = stamps.sort((a, b) => a.slice(a.indexOf("-") + 1).localeCompare(b.slice(b.indexOf("-") + 1))).reverse();
    for (const old of byAge.slice(KEEP_ASIDE)) for (const x of ["", "-wal", "-shm"]) rmSync(join(dir, old + x), { force: true });
  }

  /** Write snapshots/state.db: a consistent copy, through a temporary file so a reader never sees half of one. */
  snapshot() {
    if (!this.persistent) return;
    const dir = join(this.dataDir!, "snapshots");
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, "state.db.tmp");
    rmSync(tmp, { force: true });
    try {
      this.db.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
      renameSync(tmp, join(dir, "state.db"));
    } catch (e) {
      rmSync(tmp, { force: true });
      this.log(`WARNING: snapshot failed: ${(e as Error).message}`);
    }
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.db.isOpen) return;
    this.snapshot();
    this.db.close();
  }
}

/** Open state.db, falling back to the snapshot when it is missing, damaged, or a restore asked for the snapshot. */
function openWithRecovery(dir: string, log: (m: string) => void): { db: DatabaseSync; opened: Store["opened"] } {
  mkdirSync(join(dir, "snapshots"), { recursive: true });
  const main = join(dir, "state.db");
  const snap = join(dir, "snapshots", "state.db");
  const marker = join(dir, "RESTORE_FROM_SNAPSHOT");
  const prev = join(dir, "snapshots", "state.prev.db");
  const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
  const when = () => (existsSync(snap) ? new Date(statSync(snap).mtimeMs).toISOString() : "");
  /** Move the live files aside (never delete what might be the only copy); returns where they went. */
  const moveAside = (why: string) => {
    const aside = `${main}.${why}-${stamp()}`;
    for (const suffix of ["", "-wal", "-shm"]) if (existsSync(main + suffix)) renameSync(main + suffix, aside + suffix);
    return aside;
  };
  /** Move the live files aside and put a snapshot in their place. */
  const fromSnapshot = (why: string, source = snap) => {
    moveAside(why);
    copyFileSync(source, main);
  };

  if (existsSync(marker)) {
    const wantPrev = /previous/i.test(readFileSync(marker, "utf8"));
    rmSync(marker, { force: true });
    const source = wantPrev ? prev : snap;
    if (existsSync(source)) {
      const at = new Date(statSync(source).mtimeMs).toISOString();
      fromSnapshot("replaced", source);
      log(`RESTORE_FROM_SNAPSHOT: started from ${wantPrev ? "snapshots/state.prev.db" : "the snapshot"} of ${at}; the previous state.db was kept beside it`);
      return { db: openChecked(main), opened: { how: "snapshot", detail: wantPrev ? "marker-previous" : "marker" } };
    }
    log(`RESTORE_FROM_SNAPSHOT is set but there is no ${wantPrev ? "snapshots/state.prev.db" : "snapshot"}; starting from state.db`);
  }

  if (!existsSync(main)) {
    if (existsSync(snap)) {
      // A leftover -wal from another database must not be replayed into the snapshot.
      for (const suffix of ["-wal", "-shm"]) rmSync(main + suffix, { force: true });
      copyFileSync(snap, main);
      log(`state.db is missing: started from the snapshot of ${when()}`);
      return { db: openChecked(main), opened: { how: "snapshot", detail: "missing" } };
    }
    return { db: openChecked(main), opened: { how: "new" } };
  }

  try {
    return { db: openChecked(main), opened: { how: "opened" } };
  } catch (e) {
    const reason = (e as Error).message;
    if (existsSync(snap)) {
      fromSnapshot("damaged");
      log(`ERROR: state.db is damaged (${reason}); started from the snapshot of ${when()}. The damaged file is kept beside it`);
      return { db: openChecked(main), opened: { how: "snapshot", detail: reason } };
    }
    // No snapshot to fall back on: start empty rather than not at all (tables pair again), and keep the damaged file.
    const aside = moveAside("damaged");
    log(`ERROR: state.db is damaged (${reason}) and there is no snapshot; starting with an empty state. The damaged file is ${aside}`);
    return { db: openChecked(main), opened: { how: "corrupt-fresh", detail: reason } };
  }
}

function openChecked(path: string) {
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 2000;");
    const r = db.prepare("PRAGMA quick_check").get() as { quick_check?: string } | undefined;
    if (r?.quick_check !== "ok") throw new Error(`quick_check: ${r?.quick_check ?? "no answer"}`);
    return db;
  } catch (e) {
    try {
      db.close();
    } catch {}
    throw e;
  }
}
