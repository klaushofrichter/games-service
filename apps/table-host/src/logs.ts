// Game log packaging: one zip per session with run.json plus one JSONL file per game.
import { mkdir, readdir, readFile, writeFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import JSZip from "jszip";
import type { LogRecord } from "./runtime.ts";

export interface RunMeta {
  id: string;
  tableName: string;
  gameId: string;
  gameVersion: string;
  simulation: boolean;
  startedAt: string;
  endedAt: string;
  games: number;
  format: "gametable-log/1";
  /** Extra games only (D-097): "owner/name@ref commit (bundle <hash>)", so a log names the exact code it ran. */
  gameSource?: string;
}

export class LogStore {
  readonly dir: string;
  retentionDays: number;
  constructor(dir: string, retentionDays = 90) {
    this.dir = dir;
    this.retentionDays = retentionDays;
  }

  async save(meta: RunMeta, games: LogRecord[][]): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const zip = new JSZip();
    zip.file("run.json", JSON.stringify(meta, null, 2));
    games.forEach((records, i) => {
      zip.file(`game-${String(i + 1).padStart(3, "0")}.jsonl`, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    });
    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const file = join(this.dir, `${meta.id}.zip`);
    await writeFile(file, buf);
    return file;
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
      if (now - Date.parse(l.modified) > limit) await unlink(join(this.dir, `${l.id}.zip`)).catch(() => {});
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
