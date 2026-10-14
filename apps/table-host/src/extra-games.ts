// Extra games on the table (D-097): the cloud tells the table which bundles it gets (one per extra-game repository an
// admin ticked for it); the table downloads each over its own authenticated link, checks the hash, unpacks it into
// <dataDir>/extra-games/<hash>/ and hands the games to the lobby. Nothing changes during a game (the table defers it).
// Remote players need nothing extra: their board and deck come from this table.
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { decodeBundle } from "../../../packages/protocol/src/bundle.ts";
import { loadGames, type InstalledGame } from "./games.ts";
import type { Table } from "./table.ts";

/** One bundle the cloud says this table should have. */
export interface BundleRef {
  repo: string; // repository id in the console
  source: string; // owner/name@ref
  hash: string;
  commit: string;
  games: { id: string; name: string; version: string }[];
}

const HASH_RE = /^[0-9a-f]{64}$/;

export class ExtraGames {
  readonly dir: string;
  private table: Table;
  private download: (hash: string) => Promise<Buffer>;
  /** Bundles loaded in this process, by hash. Node caches modules by path, so a hash folder is loaded once. */
  private loaded = new Map<string, Map<string, InstalledGame>>();
  private lastKey: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  /** The last error per repository, for the log and the tests. */
  readonly errors = new Map<string, string>();
  /** Hashes of the bundles the table should have; others are deleted once no game can be using them. */
  private wanted = new Set<string>();

  constructor(table: Table, dataDir: string, download: (hash: string) => Promise<Buffer>) {
    this.table = table;
    this.dir = join(dataDir, "extra-games");
    this.download = download;
    // A change that waited for a running game: its old bundles can go now.
    table.on("extraGamesApplied", () => void this.queue.then(() => this.prune(this.wanted)).catch(() => {}));
  }

  private get listFile() {
    return join(this.dir, "installed.json");
  }

  /** At start: offer what was installed last time, before the cloud has answered (it corrects this at once). */
  async restore() {
    try {
      const refs = JSON.parse(await readFile(this.listFile, "utf8")) as BundleRef[];
      if (Array.isArray(refs)) await this.apply(refs.filter((r) => HASH_RE.test(r.hash)), false);
    } catch {
      // Nothing installed yet.
    }
  }

  /** Bring the table to exactly these bundles. Calls are queued; a list equal to the last one is a no-op. */
  sync(refs: BundleRef[]): Promise<void> {
    const key = refs.map((r) => r.hash).sort().join(",");
    if (key === this.lastKey) return this.queue;
    this.lastKey = key;
    this.queue = this.queue.then(() => this.apply(refs, true)).catch((e) => console.error(`[extra-games] ${(e as Error).message}`));
    return this.queue;
  }

  private async apply(refs: BundleRef[], fetchMissing: boolean) {
    await mkdir(this.dir, { recursive: true });
    const games = new Map<string, InstalledGame>();
    const kept: BundleRef[] = [];
    for (const ref of refs) {
      if (!HASH_RE.test(ref.hash)) continue;
      try {
        const bundleGames = await this.ensure(ref, fetchMissing);
        if (!bundleGames) continue;
        for (const [id, g] of bundleGames) {
          if (games.has(id)) {
            console.error(`[extra-games] "${id}" is in more than one repository; ${games.get(id)!.source?.repo} wins over ${ref.source}`);
            continue;
          }
          games.set(id, g);
        }
        kept.push(ref);
        this.errors.delete(ref.repo);
      } catch (e) {
        // A bad download keeps nothing from this bundle; the next heartbeat tries again.
        this.errors.set(ref.repo, (e as Error).message);
        this.lastKey = null;
        console.error(`[extra-games] ${ref.source}: ${(e as Error).message}`);
      }
    }
    this.wanted = new Set(kept.map((r) => r.hash));
    const now = this.table.setExtraGames(games);
    if (fetchMissing) await writeFile(this.listFile, JSON.stringify(kept, null, 2));
    console.log(`[extra-games] ${games.size ? [...games.keys()].join(", ") : "none"}${now ? "" : " (after the running game)"}`);
    // Bundles nobody lists any more are deleted, except while a game may still be using them.
    if (now) await this.prune(this.wanted);
  }

  /** The games of one bundle: from this process, from disk, or downloaded now. */
  private async ensure(ref: BundleRef, fetchMissing: boolean): Promise<Map<string, InstalledGame> | null> {
    const cached = this.loaded.get(ref.hash);
    if (cached) return cached;
    const root = join(this.dir, ref.hash);
    let present = true;
    try {
      await readFile(join(root, ".complete"));
    } catch {
      present = false;
    }
    if (!present) {
      if (!fetchMissing) return null;
      const payload = await this.download(ref.hash);
      const b = decodeBundle(payload, ref.hash);
      // Unpack next to the final folder, then rename: a half-written bundle is never loaded.
      const tmp = join(this.dir, `.tmp-${randomBytes(6).toString("hex")}`);
      try {
        for (const [path, data] of Object.entries(b.files)) {
          await mkdir(dirname(join(tmp, path)), { recursive: true });
          await writeFile(join(tmp, path), data);
        }
        // Rules are ES modules whatever their extension; no package.json above the data folder may say otherwise.
        await writeFile(join(tmp, "package.json"), JSON.stringify({ type: "module", private: true }));
        await writeFile(join(tmp, ".complete"), JSON.stringify({ source: ref.source, commit: b.commit, games: b.games }));
        await rm(root, { recursive: true, force: true });
        await rename(tmp, root);
      } catch (e) {
        await rm(tmp, { recursive: true, force: true });
        throw e;
      }
    }
    const games = await loadGames(join(root, "games"), { repo: ref.source, commit: ref.commit, hash: ref.hash });
    if (!games.size) throw new Error("the bundle has no game that loads on this table (see the log above)");
    this.loaded.set(ref.hash, games);
    return games;
  }

  private async prune(keep: Set<string>) {
    for (const entry of await readdir(this.dir).catch(() => [] as string[])) {
      if ((HASH_RE.test(entry) && !keep.has(entry)) || entry.startsWith(".tmp-")) {
        await rm(join(this.dir, entry), { recursive: true, force: true });
        this.loaded.delete(entry);
      }
    }
  }
}
