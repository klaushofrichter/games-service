// Headless AI-only simulation: runs games with virtual time and packages one log zip per run.
import { createRng, type SeatInfo } from "../../../packages/sdk/src/index.ts";
import { allowedPlayerCounts, seatEdges, type SeatLayout } from "../../../packages/protocol/src/index.ts";
import { settingsWithDefaults, type InstalledGame } from "./games.ts";
import { GameRuntime, VirtualClock, type AiMoveMeta, type LogRecord } from "./runtime.ts";
import { AiWorker, aiMove, isPromise, usesWorker } from "./ai.ts";
import type { Intent } from "../../../packages/sdk/src/index.ts";
import { aiDefaults, logId, TableError } from "./table.ts";
import type { LogStore } from "./logs.ts";
import { baseMeta, countRecords, verifyGame, verifySummary } from "./game-log.ts";

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
  /** How many games ended each way, e.g. { finished: 9, terminated: 1 } (D-116). */
  endReasons: Record<string, number>;
  /** Every game replayed to the state it ended in. */
  verified: boolean;
}

export interface SimulationOptions {
  tableId?: string | null;
  /** A snapshot of the state every N inputs in the log (D-116). */
  snapshotEvery?: number;
}

const MAX_STEPS = 100_000;

export async function runSimulation(game: InstalledGame, req: SimulationRequest, logs: LogStore, tableName: string, opts: SimulationOptions = {}): Promise<SimulationResult> {
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
  const startedAt = Date.now();
  const logsOut: LogRecord[][] = [];
  const states: unknown[] = [];
  const verified: ReturnType<typeof verifyGame>[] = [];
  let errors = 0;
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

  // AI players that answer later (D-112) are awaited; with nobody to tap "Play now", the game's quick move is played
  // when one runs out of time. AIs in worker threads get one thread per seat for the whole run.
  const budget = m.ai.timeoutSeconds * 1000;
  const workers = usesWorker(game) ? seats.map(() => new AiWorker(game.rulesFile!)) : null;
  try {
    for (let g = 0; g < games; g++) {
      const clock = new VirtualClock();
      const gameSeed = Math.floor(master() * 2 ** 31);
      const rt = new GameRuntime(m, game.def, gameSeed, settings, seats, clock, { simulation: true, aiOptions, snapshotEvery: opts.snapshotEvery });
      const aiRngs = seats.map((s) => createRng(gameSeed ^ (s.seat + 1) * 0x9e3779b1));
      let steps = 0;
      while (!rt.over && steps < MAX_STEPS) {
        if ((steps & 63) === 0) await breathe();
        let acted = false;
        for (const s of seats) {
          if (rt.over) break;
          const { intent, meta } = await simulatedMove(rt, s.seat, aiRngs[s.seat], workers?.[s.seat] ?? null);
          if (intent) {
            // A rejected AI move counts as no move, so a confused AI cannot spin forever; time moves on instead.
            if (rt.submit(s.seat, intent, "ai", meta).ok) acted = true;
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
      states.push(rt.state);
      errors += rt.errors;
      verified.push(verifyGame(game, rt.log)); // D-116: every simulated game replays to its end, or the log says so
      results.push({ summary: rt.summary, steps, reason: end.reason, aiOptions });
    }
  } finally {
    for (const w of workers ?? []) w.terminate();
  }

  /** One AI move: at once for a synchronous AI; awaited for one that answers later, with the fallback when time is up. */
  async function simulatedMove(rt: GameRuntime, seat: number, rng: () => number, worker: AiWorker | null): Promise<{ intent: Intent | null; meta?: AiMoveMeta }> {
    const controller = new AbortController();
    const started = Date.now();
    const answer = aiMove(game, rt, seat, rng, controller.signal, started + budget, worker);
    if (!isPromise<Intent | null>(answer)) return { intent: answer };
    const extra = worker ? { worker: true } : {};
    if (!game.def.aiFallback) return { intent: await answer, meta: { ms: Date.now() - started, ...extra } };
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), budget)));
    try {
      const r = await Promise.race([answer, late]);
      if (r !== "late") return { intent: r, meta: { ms: Date.now() - started, ...extra } };
      controller.abort();
      worker?.cancel();
      answer.catch(() => {}); // cancelled
      return { intent: rt.aiFallbackIntent(seat, rng), meta: { ms: Date.now() - started, fallback: true, ...extra } };
    } finally {
      clearTimeout(timer);
    }
  }

  const id = logId(`${m.id}-sim`);
  const endReasons: Record<string, number> = {};
  for (const r of results) endReasons[r.reason] = (endReasons[r.reason] ?? 0) + 1;
  const logCounts = { intents: 0, rejected: 0, timers: 0, errors: 0 };
  for (const l of logsOut) countRecords(l, logCounts);
  logCounts.errors = Math.max(logCounts.errors, errors);
  const verify = verifySummary(verified);
  const playerMeta = seats.map((s) => ({ seat: s.seat, name: s.name, kind: "ai" as const, location: null, aiOptions: aiOptions[s.seat] }));
  const endedAt = Date.now();
  await logs.save(
    {
      ...baseMeta({ id, game, tableName, tableId: opts.tableId ?? null, simulation: true, startedAt, settings, players: playerMeta, games, seed: req.seed >>> 0 }),
      endedAt: new Date(endedAt).toISOString(),
      durationMs: endedAt - startedAt,
      endReasons,
      result: `${results.length} games: ${Object.entries(endReasons).map(([k, n]) => `${n} ${k}`).join(", ")}`,
      counts: logCounts,
      verify,
    },
    logsOut,
    states,
  );
  return { logId: id, games: results, endReasons, verified: verify.ok === verify.checked };
}
