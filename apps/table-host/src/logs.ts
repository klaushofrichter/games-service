// Game logs on the table (D-008, D-116): a game's records are written to a running file as it is played; when it
// ends (or, if the table stopped, at the next start) they are packed into one zip with run.json, a README and the final
// state, and queued for upload until the service has them. Simulations are packed at the end of the run.
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import JSZip from "jszip";
import type { LogRecord } from "./runtime.ts";

/** What a log says about itself (run.json). Format 2 (D-116) adds everything after `gameSource`. */
export interface RunMeta {
  id: string;
  tableName: string;
  gameId: string;
  gameVersion: string;
  simulation: boolean;
  startedAt: string;
  endedAt: string;
  games: number;
  format: "gametable-log/1" | "gametable-log/2";
  /** Extra games only (D-097): "owner/name@ref commit (bundle <hash>)", so a log names the exact code it ran. */
  gameSource?: string;
  kind?: "game" | "simulation";
  tableId?: string | null;
  gameName?: string;
  platform?: { version: string; protocol: number };
  timeZone?: string;
  durationMs?: number;
  settings?: Record<string, unknown>;
  players?: PlayerMeta[];
  seed?: number;
  /** Developer settings that were on (D-118), e.g. a game started without a player at the table. */
  developer?: { allowNoLocalPlayer?: boolean };
  endReason?: string;
  endReasons?: Record<string, number>;
  result?: string | null;
  counts?: LogCounts;
  verify?: VerifySummary;
}

export interface PlayerMeta {
  seat: number;
  name: string;
  kind: "human" | "ai";
  location: "local" | "remote" | null;
  aiOptions?: Record<string, unknown>;
}

export interface LogCounts {
  intents: number;
  rejected: number;
  timers: number;
  errors: number;
}

export interface VerifySummary {
  checked: number;
  ok: number;
  failed: number[];
  skipped?: string;
}

/** The README in every zip: the log format, for a person or an LLM who has only the zip. */
const README = readFileSync(join(import.meta.dirname, "log-format.md"), "utf8");

/** Fsync the running file at most this often: a power cut loses at most about a second of the game. */
const SYNC_MS = 1000;

/** A game's log as it is being played: one JSON line per record, in `running/<id>/`. */
export class RunningLog {
  readonly id: string;
  readonly dir: string;
  private fd: number | null;
  private dirty = false;
  private syncTimer: NodeJS.Timeout | null = null;

  constructor(dir: string, id: string, meta: RunMeta) {
    this.id = id;
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "run.json"), JSON.stringify(meta, null, 2));
    this.fd = openSync(join(dir, "game-001.jsonl"), "a");
  }

  append(r: LogRecord) {
    if (this.fd === null) return;
    writeSync(this.fd, JSON.stringify(r) + "\n");
    this.dirty = true;
    if (!this.syncTimer) {
      this.syncTimer = setTimeout(() => this.sync(), SYNC_MS);
      this.syncTimer.unref();
    }
  }

  private sync() {
    this.syncTimer = null;
    if (this.fd === null || !this.dirty) return;
    this.dirty = false;
    try {
      fsyncSync(this.fd);
    } catch {
      // the next write tries again
    }
  }

  close() {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = null;
    this.sync();
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
  }
}

/** Records from a running file: a line cut short by a power cut or a crash is dropped. */
function parseLines(text: string): LogRecord[] {
  const out: LogRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // the last line, half written
    }
  }
  return out;
}

export class LogStore {
  readonly dir: string;
  retentionDays: number;
  constructor(dir: string, retentionDays = 90) {
    this.dir = dir;
    this.retentionDays = retentionDays;
  }

  private get runningDir() {
    return join(this.dir, "running");
  }

  private get outboxDir() {
    return join(this.dir, "outbox");
  }

  /**
   * Pack a log: run.json, the README, each game's records and, where given, its final state. It is queued for the
   * service at once (D-116); the queue entry goes when the service has it, or with the log at the end of retention.
   */
  async save(meta: RunMeta, games: LogRecord[][], states: unknown[] = []): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const zip = new JSZip();
    zip.file("README.md", README);
    zip.file("run.json", JSON.stringify(meta, null, 2));
    games.forEach((records, i) => {
      const n = String(i + 1).padStart(3, "0");
      zip.file(`game-${n}.jsonl`, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
      if (states[i] !== undefined) zip.file(`game-${n}.state.json`, JSON.stringify(states[i], null, 1));
    });
    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const file = join(this.dir, `${meta.id}.zip`);
    await writeFile(`${file}.tmp`, buf);
    await rename(`${file}.tmp`, file);
    await mkdir(this.outboxDir, { recursive: true });
    await writeFile(join(this.outboxDir, meta.id), "");
    return file;
  }

  /** Start writing a game's log to disk as it is played. */
  begin(meta: RunMeta): RunningLog {
    return new RunningLog(join(this.runningDir, meta.id), meta.id, meta);
  }

  /** The game ended: pack its log and remove the running file. */
  async finish(running: RunningLog, meta: RunMeta, records: LogRecord[], state: unknown): Promise<string> {
    running.close();
    const file = await this.save(meta, [records], [state]);
    if (running.dir) await rm(running.dir, { recursive: true, force: true });
    return file;
  }

  /** Games the table stopped in the middle of: what their running files hold. */
  async interrupted(): Promise<{ dir: string; meta: RunMeta; records: LogRecord[] }[]> {
    let names: string[];
    try {
      names = await readdir(this.runningDir);
    } catch {
      return [];
    }
    const out = [];
    for (const name of names) {
      const dir = join(this.runningDir, name);
      try {
        const meta = JSON.parse(await readFile(join(dir, "run.json"), "utf8")) as RunMeta;
        const records = parseLines(await readFile(join(dir, "game-001.jsonl"), "utf8"));
        out.push({ dir, meta, records });
      } catch {
        // nothing usable (stopped before the first record was written): drop it
        await rm(dir, { recursive: true, force: true });
      }
    }
    return out;
  }

  /** Pack an interrupted game's log under its own id and remove its running file. */
  async saveInterrupted(dir: string, meta: RunMeta, records: LogRecord[], state: unknown): Promise<string> {
    const file = await this.save(meta, [records], [state]);
    await rm(dir, { recursive: true, force: true });
    return file;
  }

  /** Logs not yet confirmed by the service, oldest first. */
  async pendingUploads(): Promise<string[]> {
    try {
      return (await readdir(this.outboxDir)).sort();
    } catch {
      return [];
    }
  }

  async uploaded(id: string) {
    await unlink(join(this.outboxDir, id)).catch(() => {});
  }

  private get savesDir() {
    return join(this.dir, "..", "saves");
  }

  /** A saved game: its log replays to the saved state; kept for the same retention period. */
  async saveGame(id: string, save: unknown) {
    await mkdir(this.savesDir, { recursive: true });
    await writeFile(join(this.savesDir, `${id}.json`), JSON.stringify(save));
  }

  async listSaves(): Promise<{ id: string; gameId: string; savedAt: string; players: unknown }[]> {
    await mkdir(this.savesDir, { recursive: true });
    const out = [];
    for (const f of (await readdir(this.savesDir)).filter((f) => f.endsWith(".json"))) {
      const s = JSON.parse(await readFile(join(this.savesDir, f), "utf8"));
      out.push({ id: s.id, gameId: s.gameId, savedAt: s.savedAt, players: s.players });
    }
    return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  async list(): Promise<{ id: string; bytes: number; modified: string }[]> {
    await mkdir(this.dir, { recursive: true });
    const out = [];
    for (const f of (await readdir(this.dir)).filter((f) => f.endsWith(".zip"))) {
      // Retention pruning may delete a log between readdir and stat: a log that is gone is simply not listed.
      const s = await stat(join(this.dir, f)).catch((e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
      if (s) out.push({ id: f.slice(0, -4), bytes: s.size, modified: s.mtime.toISOString() });
    }
    return out.sort((a, b) => b.modified.localeCompare(a.modified));
  }

  async read(id: string): Promise<Buffer | null> {
    if (!/^[A-Za-z0-9-]+$/.test(id)) return null;
    try {
      return await readFile(join(this.dir, `${id}.zip`));
    } catch {
      return null;
    }
  }

  /** Delete logs and saved games older than the retention period (synced from the cloud service). */
  async prune(now = Date.now()) {
    const limit = this.retentionDays * 86400_000;
    for (const l of await this.list()) {
      if (now - Date.parse(l.modified) > limit) {
        await unlink(join(this.dir, `${l.id}.zip`)).catch(() => {});
        await this.uploaded(l.id); // nothing left to upload
      }
    }
    await mkdir(this.savesDir, { recursive: true });
    for (const f of (await readdir(this.savesDir)).filter((f) => f.endsWith(".json"))) {
      const file = join(this.savesDir, f);
      if (now - (await stat(file)).mtimeMs > limit) await unlink(file).catch(() => {});
    }
  }

  static async unzip(buf: Buffer): Promise<{ meta: RunMeta; games: LogRecord[][] }> {
    const zip = await JSZip.loadAsync(buf);
    const meta = JSON.parse(await zip.file("run.json")!.async("string")) as RunMeta;
    const names = Object.keys(zip.files).filter((n) => n.endsWith(".jsonl")).sort();
    const games: LogRecord[][] = [];
    for (const n of names) {
      const text = await zip.file(n)!.async("string");
      games.push(text.trim().split("\n").map((l) => JSON.parse(l)));
    }
    return { meta, games };
  }
}
