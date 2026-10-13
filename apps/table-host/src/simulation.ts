// Headless AI-only simulation: runs games with virtual time and packages one log zip per run.
import { createRng, type SeatInfo } from "../../../packages/sdk/src/index.ts";
import { allowedPlayerCounts, seatEdges, type SeatLayout } from "../../../packages/protocol/src/index.ts";
import { settingsWithDefaults, type InstalledGame } from "./games.ts";
import { GameRuntime, VirtualClock, type LogRecord } from "./runtime.ts";
import { aiDefaults, logId, TableError } from "./table.ts";
import type { LogStore } from "./logs.ts";

export interface SimulationRequest {
  players: number;
  games: number;
  seed: number;
  settings?: Record<string, unknown>;
  /** AI options for every seat, or a list with one entry per seat (e.g. to compare play styles). */
  aiOptions?: Record<string, unknown> | Record<string, unknown>[];
}

export interface SimulationResult {
  logId: string;
  games: { summary: unknown; steps: number; reason: string; aiOptions: Record<number, Record<string, unknown>> }[];
}

const MAX_STEPS = 100_000;

export async function runSimulation(game: InstalledGame, req: SimulationRequest, logs: LogStore, tableName: string): Promise<SimulationResult> {
  const m = game.manifest;
  if (!m.simulation.supported || !m.ai.supported || !game.def.ai) throw new TableError(409, `${m.name} does not support AI-only simulation`);
  const players = Math.round(req.players);
  const counts = allowedPlayerCounts(m);
  if (!counts.includes(players)) throw new TableError(400, `${m.name} needs ${counts.join(", ")} players`);
  const games = Math.max(1, Math.min(1000, Math.round(req.games || 1)));
  let settings: Record<string, unknown>;
  try {
    settings = settingsWithDefaults(m, req.settings);
  } catch (e) {
    throw new TableError(400, (e as Error).message);
  }

  const master = createRng(req.seed >>> 0);
  const startedAt = new Date().toISOString();
  const logsOut: LogRecord[][] = [];
  const results: SimulationResult["games"] = [];

  // Simulations run on the table's only thread: hand it back every few milliseconds, so the board,
  // decks, timers and liveness pings of a real game keep running during a long simulation.
  let slice = Date.now();
  const breathe = async () => {
    if (Date.now() - slice < 15) return;
    await new Promise((r) => setImmediate(r));
    slice = Date.now();
  };

  // The same seats and AI options for every game of the run.
  const layout = (m.seatLayouts.find((l) => l >= players) ?? 8) as SeatLayout;
  const edges = seatEdges(layout);
  const seats: SeatInfo[] = Array.from({ length: players }, (_, i) => ({ seat: i, playerId: `ai_${i + 1}`, name: `AI ${i + 1}`, kind: "ai", edge: edges[i] }));
  const aiOptions: Record<number, Record<string, unknown>> = {};
  for (const s of seats) {
    const given = Array.isArray(req.aiOptions) ? (req.aiOptions[s.seat] ?? {}) : (req.aiOptions ?? {});
    aiOptions[s.seat] = aiDefaults(m, given);
  }

  for (let g = 0; g < games; g++) {
    const clock = new VirtualClock();
    const gameSeed = Math.floor(master() * 2 ** 31);
    const rt = new GameRuntime(m, game.def, gameSeed, settings, seats, clock, { simulation: true, aiOptions });
    const aiRngs = seats.map((s) => createRng(gameSeed ^ (s.seat + 1) * 0x9e3779b1));
    let steps = 0;
    while (!rt.over && steps < MAX_STEPS) {
      if ((steps & 63) === 0) await breathe();
      let acted = false;
      for (const s of seats) {
        if (rt.over) break;
        const intent = rt.aiIntent(s.seat, aiRngs[s.seat]);
        if (intent) {
          // A rejected AI move counts as no move, so a confused AI cannot spin forever; time moves on instead.
          if (rt.submit(s.seat, intent, "ai").ok) acted = true;
          steps++;
        }
      }
      if (!acted && !rt.over) {
        if (!clock.advance()) rt.finish("terminated", { text: "Simulation stalled: no AI move and no timer pending.", highlights: {} });
        steps++;
      }
    }
    if (!rt.over) rt.finish("terminated", { text: `Simulation stopped after ${MAX_STEPS} steps.`, highlights: {} });
    const end = rt.log.at(-1) as Extract<LogRecord, { t: "end" }>;
    logsOut.push(rt.log);
    results.push({ summary: rt.summary, steps, reason: end.reason, aiOptions });
  }

  const id = logId(`${m.id}-sim`);
  await logs.save({ id, tableName, gameId: m.id, gameVersion: m.version, simulation: true, startedAt, endedAt: new Date().toISOString(), games, format: "gametable-log/1" }, logsOut);
  return { logId: id, games: results };
}
