// Loads installed game packages from a directory: <dir>/<id>/manifest.json + rules.ts|rules.js
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { manifestSchema, type Manifest } from "../../../packages/protocol/src/index.ts";
import type { GameDefinition } from "../../../packages/sdk/src/index.ts";

export interface InstalledGame {
  manifest: Manifest;
  def: GameDefinition<any>;
  dir: string;
}

export async function loadGames(dir: string): Promise<Map<string, InstalledGame>> {
  const games = new Map<string, InstalledGame>();
  for (const entry of await readdir(dir)) {
    const gameDir = join(dir, entry);
    if (!(await stat(gameDir)).isDirectory()) continue;
    try {
      const manifest = manifestSchema.parse(JSON.parse(await readFile(join(gameDir, "manifest.json"), "utf8")));
      // The folder name is the id: two packages can't claim the same game, whatever order the disk lists them in.
      if (manifest.id !== entry) throw new Error(`manifest id "${manifest.id}" must match the folder name`);
      const rulesFile = (await readdir(gameDir)).find((f) => f === "rules.ts" || f === "rules.js");
      if (!rulesFile) throw new Error("no rules.ts or rules.js");
      // Phase 1a: rules run in-process. Phase 1 later: isolated worker sandbox (see architecture doc).
      const mod = await import(pathToFileURL(join(gameDir, rulesFile)).href);
      games.set(manifest.id, { manifest, def: mod.default, dir: gameDir });
    } catch (err) {
      console.error(`[games] skipping ${entry}: ${(err as Error).message}`);
    }
  }
  return games;
}

export function settingsWithDefaults(manifest: Manifest, given: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of manifest.settings) {
    let v = given[s.key] ?? s.default;
    if (s.type === "int" || s.type === "number") {
      let n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`setting ${s.key} must be a number`);
      if (s.type === "int") n = Math.round(n);
      if (s.min !== undefined && n < s.min) throw new Error(`setting ${s.key} must be ≥ ${s.min}`);
      if (s.max !== undefined && n > s.max) throw new Error(`setting ${s.key} must be ≤ ${s.max}`);
      v = n;
    } else if (s.type === "enum" && s.values && !s.values.includes(String(v))) {
      throw new Error(`setting ${s.key} must be one of ${s.values.join(", ")}`);
    }
    out[s.key] = v;
  }
  return out;
}
