// Loads installed game packages from a directory: <dir>/<id>/manifest.json + rules.ts|rules.js
import { readdir, readFile, stat } from "node:fs/promises";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { manifestSchema, type Manifest } from "../../../packages/protocol/src/index.ts";
import type { GameDefinition } from "../../../packages/sdk/src/index.ts";

export interface InstalledGame {
  manifest: Manifest;
  def: GameDefinition<any>;
  dir: string;
  /** The rules module (rules.ts or rules.js); an AI in a worker thread loads it there (D-112). */
  rulesFile?: string;
  /** Where an extra game came from (D-097): "owner/name@ref", its commit and bundle hash. Absent for built-in games. */
  source?: { repo: string; commit: string; hash: string };
  /** The game ships rules for players: how-to-play.md in its folder (D-099). */
  howToPlay?: boolean;
}

/** The rules file a game may ship (D-099): Markdown, with images from the game's assets/ folder. */
export const HOW_TO_PLAY = "how-to-play.md";

/**
 * Games outside this repository import the SDK by name: `@game-table/sdk` (and `@game-table/sdk/cards`), never by a
 * relative path into games-service. This hook points those names at this host's own SDK, so a game repository needs
 * no copy of it. Registered once per process; built-in games may use either form.
 */
const SDK_DIR = fileURLToPath(new URL("../../../packages/sdk/src/", import.meta.url));
const SDK_SPECIFIERS: Record<string, string> = {
  "@game-table/sdk": join(SDK_DIR, "index.ts"),
  "@game-table/sdk/cards": join(SDK_DIR, "cards.ts"),
};
let hooked = false;
/** Also called by the AI worker thread (D-112): hooks registered with registerHooks apply to their own thread only. */
export function registerSdkHook() {
  if (hooked) return;
  hooked = true;
  registerHooks({
    resolve(specifier, context, next) {
      const file = SDK_SPECIFIERS[specifier];
      return file ? { url: pathToFileURL(file).href, shortCircuit: true } : next(specifier, context);
    },
  });
}

export async function loadGames(dir: string, source?: InstalledGame["source"]): Promise<Map<string, InstalledGame>> {
  registerSdkHook();
  const games = new Map<string, InstalledGame>();
  for (const entry of await readdir(dir)) {
    const gameDir = join(dir, entry);
    if (!(await stat(gameDir)).isDirectory()) continue;
    try {
      const manifest = manifestSchema.parse(JSON.parse(await readFile(join(gameDir, "manifest.json"), "utf8")));
      // The folder name is the id: two packages can't claim the same game, whatever order the disk lists them in.
      if (manifest.id !== entry) throw new Error(`manifest id "${manifest.id}" must match the folder name`);
      const files = await readdir(gameDir);
      const rulesFile = files.find((f) => f === "rules.ts" || f === "rules.js");
      if (!rulesFile) throw new Error("no rules.ts or rules.js");
      // Phase 1a: rules run in-process. Phase 1 later: isolated worker sandbox (see architecture doc).
      const mod = await import(pathToFileURL(join(gameDir, rulesFile)).href);
      if (!mod.default || typeof mod.default.setup !== "function") throw new Error("rules must export default defineGame({...})");
      const howToPlay = files.includes(HOW_TO_PLAY);
      games.set(manifest.id, { manifest, def: mod.default, dir: gameDir, rulesFile: join(gameDir, rulesFile), howToPlay, ...(source ? { source } : {}) });
    } catch (err) {
      console.error(`[games] skipping ${entry}: ${(err as Error).message}`);
    }
  }
  return games;
}

/** The log field naming where an extra game's code came from; nothing for built-in games. */
export function sourceMeta(g: InstalledGame): { gameSource?: string } {
  return g.source ? { gameSource: `${g.source.repo} ${g.source.commit} (bundle ${g.source.hash.slice(0, 12)})` } : {};
}

export function settingsWithDefaults(manifest: Manifest, given: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of manifest.settings) {
    let v = given[s.key] ?? s.default;
    // Refusals name the setting as players see it (its label), not its key (D-146).
    const name = s.label ?? `setting ${s.key}`;
    if (s.type === "int" || s.type === "number") {
      let n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
      if (s.type === "int") n = Math.round(n);
      if (s.min !== undefined && n < s.min) throw new Error(`${name} must be ${s.min} or more`);
      if (s.max !== undefined && n > s.max) throw new Error(`${name} must be ${s.max} or less`);
      v = n;
    } else if (s.type === "enum" && s.values && !s.values.includes(String(v))) {
      throw new Error(`${name} must be one of ${s.values.join(", ")}`);
    }
    out[s.key] = v;
  }
  // A setting that doesn't apply with the others' values keeps its default (D-245).
  for (const s of manifest.settings) {
    if (!s.when) continue;
    const on = Object.entries(s.when).every(([k, want]) => ([] as unknown[]).concat(want).map(String).includes(String(out[k])));
    if (!on) out[s.key] = s.default;
  }
  return out;
}
