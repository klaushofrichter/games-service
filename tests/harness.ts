// Rules-level harness: run a game's rules directly with virtual time, without a host.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { manifestSchema, seatEdges, type Manifest, type SeatLayout } from "../packages/protocol/src/index.ts";
import type { GameDefinition, SeatInfo } from "../packages/sdk/src/index.ts";
import { GameRuntime, replay, VirtualClock } from "../apps/table-host/src/runtime.ts";
import { settingsWithDefaults } from "../apps/table-host/src/games.ts";

export async function loadGame(id: string): Promise<{ manifest: Manifest; def: GameDefinition<any> }> {
  const dir = join(import.meta.dirname, "..", "games", id);
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")));
  const def = (await import(join(dir, "rules.ts"))).default;
  return { manifest, def };
}

export function seats(n: number, kind: "human" | "ai" = "human", layout?: SeatLayout): SeatInfo[] {
  const edges = seatEdges(layout ?? ((n <= 2 ? 2 : n <= 4 ? 4 : n <= 6 ? 6 : 8) as SeatLayout));
  return Array.from({ length: n }, (_, i) => ({ seat: i, playerId: `p${i}`, name: ["Ann", "Ben", "Cleo", "Dev", "Eli", "Fay", "Gus", "Hal"][i], kind, edge: edges[i] }));
}

export function start(game: { manifest: Manifest; def: GameDefinition<any> }, n: number, settings: Record<string, unknown> = {}, seed = 1, aiOptions: Record<number, Record<string, unknown>> = {}) {
  const clock = new VirtualClock();
  const rt = new GameRuntime(game.manifest, game.def, seed, settingsWithDefaults(game.manifest, settings), seats(n), clock, { aiOptions });
  return { rt, clock, state: () => rt.state as any };
}

export function expectReplay(game: { manifest: Manifest; def: GameDefinition<any> }, rt: GameRuntime) {
  const end = rt.log.at(-1) as { t: string; stateHash?: string };
  if (end.t !== "end") throw new Error("game did not end");
  return replay(game.manifest, game.def, rt.log) === end.stateHash;
}
