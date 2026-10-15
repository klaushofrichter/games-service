// The service's persistent state (D-113): one SQLite database (node:sqlite, no native dependency) in DATA_DIR, plus
// uploaded game logs as files beside it. The server keeps its working set in memory as before and writes every change
// through to this store; at start it loads everything back. Without DATA_DIR (tests, local development) the store is
// an in-memory database and logs stay in memory, which is exactly the old behaviour.
//
// Layout of DATA_DIR (the PVC games-cloud-data, mounted at /data in the cluster):
//   state.db (+ -wal, -shm)       the live database (WAL mode)
//   snapshots/state.db            a consistent copy (VACUUM INTO), written hourly and at shutdown
//   logs/<id>.zip                 uploaded game logs
//   RESTORE_FROM_SNAPSHOT         optional marker: at the next start, replace state.db with the snapshot
//
// A file-level backup (Velero) can copy state.db while it is being written, so a restore must be able to start from the
// snapshot: if state.db is missing, fails to open or fails SQLite's quick_check, the snapshot replaces it (the damaged
// file is kept beside it). The marker file forces that, for a restore runbook that wants the snapshot regardless.
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

  /** Several changes as one transaction (all or nothing). */
  batch(fn: () => void) {
    this.db.exec("BEGIN");
    try {
      fn();
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  // ----- game logs: files on disk when persistent; the caller keeps them in memory otherwise -----

  private logPath(id: string) {
    if (!/^[\w-]+$/.test(id)) throw new Error("bad log id");
    return join(this.dataDir!, "logs", `${id}.zip`);
  }

  writeLog(id: string, data: Buffer) {
    const p = this.logPath(id);
    writeFileSync(`${p}.tmp`, data);
    renameSync(`${p}.tmp`, p);
  }

  readLog(id: string): Buffer | null {
    try {
      return readFileSync(this.logPath(id));
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
  const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
  const when = () => (existsSync(snap) ? new Date(statSync(snap).mtimeMs).toISOString() : "");
  /** Move the live files aside (never delete what might be the only copy) and put the snapshot in their place. */
  const fromSnapshot = (why: string) => {
    const aside = `${main}.${why}-${stamp()}`;
    for (const suffix of ["", "-wal", "-shm"]) if (existsSync(main + suffix)) renameSync(main + suffix, aside + suffix);
    copyFileSync(snap, main);
  };

  if (existsSync(marker)) {
    rmSync(marker, { force: true });
    if (existsSync(snap)) {
      fromSnapshot("replaced");
      log(`RESTORE_FROM_SNAPSHOT: started from the snapshot of ${when()}; the previous state.db was kept beside it`);
      return { db: openChecked(main), opened: { how: "snapshot", detail: "marker" } };
    }
    log("RESTORE_FROM_SNAPSHOT is set but there is no snapshot; starting from state.db");
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
    const aside = `${main}.damaged-${stamp()}`;
    for (const suffix of ["", "-wal", "-shm"]) if (existsSync(main + suffix)) renameSync(main + suffix, aside + suffix);
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
