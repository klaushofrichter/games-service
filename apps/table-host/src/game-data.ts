// Game data (D-302): what a game keeps on this table between games, such as favourite presets. One JSON file per game
// in <dataDir>/game-data/, on the table's own computer: it needs no cloud service, is never uploaded, and belongs to
// the table, not to a player or an access code. A game's board and its players' phones read and write it through
// `ctx.store`; its rules never see it (they stay deterministic and replayable), so what the rules need comes to them
// as an intent. The file also keeps the game's display choices (`prefs`, D-088), which used to be lost at a restart.
// JSON only, small: text and numbers, no audio or images.
import { mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * What a game may keep: 64 entries and 256 KB in all, under keys like `favourites` or `configs.v2`; one entry up to
 * 48 KB, so that it fits one message to a board or phone (64 KB, D-202), also over a remote player's connection.
 */
export const GAME_DATA_LIMITS = { keys: 64, bytes: 256 * 1024, entry: 48 * 1024 };
const KEY = /^[A-Za-z][\w.-]{0,63}$/;
const GAME_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** The export file's format, and the files' own. */
export const GAME_DATA_FORMAT = 1;

export class GameDataError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface GameRef {
  id: string;
  name: string;
  version: string;
}

/** A game's file, and its export. */
export interface GameDataFile {
  format: number;
  gameId: string;
  /** The game's name and version when it last wrote: for the list, and for a game that is no longer installed. */
  gameName: string;
  gameVersion: string;
  updatedAt: string;
  data: Record<string, unknown>;
  prefs: Record<string, unknown>;
  /** The game's settings as last used on this table (D-325): the next game begins with them. */
  settings?: Record<string, unknown>;
  /** In an export only: when, and from which table. */
  exportedAt?: string;
  tableName?: string;
}

export interface GameDataEntry {
  gameId: string;
  gameName: string;
  gameVersion: string;
  updatedAt: string;
  entries: number;
  prefs: number;
  bytes: number;
}

const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const size = (v: unknown) => Buffer.byteLength(JSON.stringify(v) ?? "", "utf8");

export class GameData {
  private dir: string | null;
  private files = new Map<string, GameDataFile>();
  /** One write at a time per game, the newest last. */
  private writes = new Map<string, Promise<void>>();
  /** Games with a write waiting its turn: it will write the newest state, so further changes need no write of their own. */
  private queued = new Set<string>();

  /** `dir` null keeps everything in memory (simulations and tests that need no files). */
  constructor(dir: string | null = null) {
    this.dir = dir;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      const id = f.slice(0, -5);
      if (!GAME_ID.test(id)) continue;
      try {
        this.files.set(id, this.checked(JSON.parse(readFileSync(join(dir, f), "utf8")), id));
      } catch (err) {
        // A file that can't be read is set aside, not lost and not in the way: the game starts without data.
        const aside = `${f}.broken-${Date.now()}`;
        try {
          renameSync(join(dir, f), join(dir, aside));
        } catch {}
        console.error(`[table-host] game data of ${id} could not be read (${(err as Error).message}); kept as ${aside}`);
      }
    }
  }

  /** A file's content as this table keeps it, or an error that says what is wrong with it. */
  private checked(raw: unknown, id?: string): GameDataFile {
    if (!plain(raw) || (raw.format === undefined && raw.gameId === undefined)) throw new GameDataError(400, "this is not a game data file");
    if (raw.format !== GAME_DATA_FORMAT) throw new GameDataError(400, `this game data file has format ${String(raw.format)}; this table reads format ${GAME_DATA_FORMAT}`);
    const gameId = String(raw.gameId ?? "");
    if (!GAME_ID.test(gameId)) throw new GameDataError(400, "the game data file names no game");
    if (id !== undefined && gameId !== id) throw new GameDataError(400, `the file is for ${gameId}, not ${id}`);
    const data = plain(raw.data) ? raw.data : {};
    const prefs = plain(raw.prefs) ? raw.prefs : {};
    // (the settings are checked against the game's manifest when they are used; here only their size)
    const settings = plain(raw.settings) && size(raw.settings) <= 4096 ? raw.settings : {};
    for (const [k, v] of Object.entries(data)) {
      if (!KEY.test(k)) throw new GameDataError(400, `bad key "${k.slice(0, 40)}"`);
      if (v === null || size(v) > GAME_DATA_LIMITS.entry) throw new GameDataError(413, `the entry "${k}" is empty or larger than ${GAME_DATA_LIMITS.entry / 1024} KB`);
    }
    this.assertRoom(data);
    // the table's own rules for display choices (setPrefs): a file must not bring in what the board could not set
    if (Object.keys(prefs).length > 20 || size(prefs) > 4096) throw new GameDataError(413, "the display choices are limited to 20 keys and 4 KB");
    for (const k of Object.keys(prefs)) if (!/^[A-Za-z][\w-]{0,39}$/.test(k)) throw new GameDataError(400, `bad display choice "${k.slice(0, 40)}"`);
    const date = new Date(String(raw.updatedAt ?? ""));
    return {
      format: GAME_DATA_FORMAT,
      gameId,
      gameName: String(raw.gameName ?? gameId).slice(0, 80),
      gameVersion: String(raw.gameVersion ?? "").slice(0, 40),
      updatedAt: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
      data: JSON.parse(JSON.stringify(data)),
      prefs: JSON.parse(JSON.stringify(prefs)),
      ...(Object.keys(settings).length ? { settings: JSON.parse(JSON.stringify(settings)) } : {}),
    };
  }

  private assertRoom(data: Record<string, unknown>) {
    if (Object.keys(data).length > GAME_DATA_LIMITS.keys) throw new GameDataError(413, `a game keeps at most ${GAME_DATA_LIMITS.keys} entries`);
    if (size(data) > GAME_DATA_LIMITS.bytes) throw new GameDataError(413, `a game keeps at most ${GAME_DATA_LIMITS.bytes / 1024} KB`);
  }

  private fileFor(game: GameRef): GameDataFile {
    let f = this.files.get(game.id);
    if (!f) this.files.set(game.id, (f = { format: GAME_DATA_FORMAT, gameId: game.id, gameName: game.name, gameVersion: game.version, updatedAt: "", data: {}, prefs: {} }));
    return f;
  }

  private touch(f: GameDataFile, game: GameRef) {
    f.gameName = game.name;
    f.gameVersion = game.version;
    f.updatedAt = new Date().toISOString();
    this.save(f.gameId);
  }

  /** Write the game's file (or remove it when nothing is left), after any write of it still under way. */
  private save(id: string) {
    if (!this.dir || this.queued.has(id)) return;
    const dir = this.dir;
    const file = join(dir, `${id}.json`);
    this.queued.add(id);
    const next = (this.writes.get(id) ?? Promise.resolve()).then(async () => {
      this.queued.delete(id); // what changes from here on gets a write of its own
      const f = this.files.get(id);
      try {
        if (!f) return await rm(file, { force: true });
        await mkdir(dir, { recursive: true });
        // Whole or not at all: a table switched off in the middle keeps the previous file.
        const tmp = `${file}.${process.pid}.tmp`;
        await writeFile(tmp, JSON.stringify(f, null, 2));
        await rename(tmp, file);
      } catch (err) {
        console.error(`[table-host] game data of ${id} could not be saved: ${(err as Error).message}`);
      }
    });
    this.writes.set(id, next);
    void next.then(() => this.writes.get(id) === next && this.writes.delete(id));
  }

  /** Everything on disk (for a clean stop, and for tests). */
  async flush() {
    await Promise.all([...this.writes.values()]);
  }

  /** The game's entries; a copy. */
  data(gameId: string): Record<string, unknown> {
    return JSON.parse(JSON.stringify(this.files.get(gameId)?.data ?? {}));
  }

  /** The keys of the game's entries. */
  keys(gameId: string): string[] {
    return Object.keys(this.files.get(gameId)?.data ?? {});
  }

  /** One entry as kept, or null: not a copy, to send or to read only (`set` replaces entries, it never changes one). */
  get(gameId: string, key: string): unknown {
    const data = this.files.get(gameId)?.data;
    return data && Object.hasOwn(data, key) ? data[key] : null;
  }

  /** Set one entry; `null` (or undefined) removes it. Returns the value as kept. */
  set(game: GameRef, key: unknown, value: unknown): unknown {
    if (typeof key !== "string" || !KEY.test(key)) throw new GameDataError(400, "a key is a letter, then up to 63 letters, digits, dots, dashes or underscores");
    const f = this.fileFor(game);
    const next = { ...f.data };
    if (value === null || value === undefined) {
      if (!(key in next)) return null;
      delete next[key];
    } else {
      let json: string | undefined;
      try {
        json = JSON.stringify(value);
      } catch {}
      if (json === undefined) throw new GameDataError(400, "game data is JSON: text, numbers, lists and objects");
      if (Buffer.byteLength(json, "utf8") > GAME_DATA_LIMITS.entry) throw new GameDataError(413, `one entry is at most ${GAME_DATA_LIMITS.entry / 1024} KB; split it over several keys`);
      next[key] = JSON.parse(json);
      this.assertRoom(next);
    }
    f.data = next;
    this.touch(f, game);
    return next[key] ?? null;
  }

  /** Every game's display choices, for the table at its start. */
  allPrefs(): [string, Record<string, unknown>][] {
    return [...this.files.values()].filter((f) => Object.keys(f.prefs).length).map((f) => [f.gameId, JSON.parse(JSON.stringify(f.prefs))]);
  }

  /** Keep a game's display choices (the table has checked them). */
  setPrefs(game: GameRef, prefs: Record<string, unknown>) {
    const f = this.fileFor(game);
    f.prefs = JSON.parse(JSON.stringify(prefs));
    this.touch(f, game);
  }

  /** A game's settings as last used on this table (D-325), or none. */
  settings(gameId: string): Record<string, unknown> {
    return JSON.parse(JSON.stringify(this.files.get(gameId)?.settings ?? {}));
  }

  /** Keep a game's settings for its next game (the table has checked them against the manifest). */
  setSettings(game: GameRef, settings: Record<string, unknown>) {
    const f = this.fileFor(game);
    if (JSON.stringify(f.settings ?? {}) === JSON.stringify(settings)) return;
    f.settings = JSON.parse(JSON.stringify(settings));
    this.touch(f, game);
  }

  /** Games that keep something here, by name. */
  list(): GameDataEntry[] {
    return [...this.files.values()]
      .filter((f) => Object.keys(f.data).length || Object.keys(f.prefs).length || Object.keys(f.settings ?? {}).length)
      .map((f) => ({ gameId: f.gameId, gameName: f.gameName, gameVersion: f.gameVersion, updatedAt: f.updatedAt, entries: Object.keys(f.data).length, prefs: Object.keys(f.prefs).length, bytes: size(f.data) + size(f.prefs) }))
      .sort((a, b) => a.gameName.localeCompare(b.gameName));
  }

  /** A game's data as a file to keep elsewhere, or null if it keeps nothing. */
  export(gameId: string, tableName: string): GameDataFile | null {
    const f = this.files.get(gameId);
    if (!f || !(Object.keys(f.data).length || Object.keys(f.prefs).length || Object.keys(f.settings ?? {}).length)) return null;
    return { ...JSON.parse(JSON.stringify(f)), exportedAt: new Date().toISOString(), tableName };
  }

  /** What an export file holds, checked but not taken in: the board asks before it replaces anything. */
  inspect(raw: unknown): GameDataFile {
    return this.checked(raw);
  }

  /** Take in an export file: it replaces everything the table keeps for that game. */
  import(raw: unknown): GameDataFile {
    const f = this.checked(raw);
    this.files.set(f.gameId, f);
    this.save(f.gameId);
    return f;
  }

  /** Forget everything the table keeps for a game. */
  delete(gameId: string): boolean {
    if (!this.files.delete(gameId)) return false;
    this.save(gameId);
    return true;
  }
}
