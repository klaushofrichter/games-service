// The move list of a finished game (D-120): every record of its log as a row a person or an LLM can read, with player
// moves numbered from 1. Built from the log alone; with the game's rules installed, the log is also replayed so the game's
// own `describe` can say what each step meant and the state before and after any step can be shown.
import type { GameDefinition, GameEvent, Intent, StepDescription, StepInfo } from "../../../packages/sdk/src/index.ts";
import type { Manifest } from "../../../packages/protocol/src/index.ts";
import { GameRuntime, VirtualClock, type AiMoveMeta, type LogRecord } from "./runtime.ts";

export type RowKind = "start" | "move" | "timer" | "seatJoined" | "seatLeft" | "disconnected" | "reconnected" | "pause" | "resume" | "error" | "snapshot" | "gap" | "end";

export interface MoveRow {
  /** Player moves (intents, refused ones too) are numbered from 1; every other row has null. */
  n: number | null;
  /** The record's line in game-NNN.jsonl, from 1 (the start record). A gap row has the line of the record after it. */
  line: number;
  kind: RowKind;
  /** The record's time (epoch ms in a played game, virtual ms in a simulation) and the time since the start. */
  at: number;
  t: number;
  seat?: number | null;
  player?: string | null;
  by?: "human" | "ai" | "board";
  intent?: Intent;
  accepted?: boolean;
  reason?: string;
  error?: string;
  ai?: AiMoveMeta;
  /** Number of events the step announced. */
  events?: number;
  /** The game's description, or the platform's generic line. */
  text: string;
  columns?: StepDescription["columns"];
  details?: StepDescription["details"];
  steps?: (NonNullable<StepDescription["steps"]>[number] & { player?: string | null })[];
  /** "rejected", "error", "fallback" (the AI's quick move), "auto" (moves the rules made), "described" (by the game). */
  flags: string[];
}

export interface MoveList {
  rows: MoveRow[];
  /** Number of player moves (the highest `n`). */
  moves: number;
  /** The game's `describe` wrote the rows (its rules were installed in the same version). */
  described: boolean;
  /** Why the rules could not be used, if they could not. */
  note?: string;
}

/** No record for this long, and no pause to explain it: the list shows a gap row. */
export const GAP_MS = 2 * 60_000;

type Game = { manifest: Manifest; def: GameDefinition<any> };
type InputRecord = Extract<LogRecord, { t: "intent" | "timer" | "seatJoined" | "seatLeft" }>;
const isInput = (r: LogRecord): r is InputRecord => r.t === "intent" || r.t === "timer" || r.t === "seatJoined" || r.t === "seatLeft";

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

/** A payload in a few characters: `{"card":54}` → `card 54`, `"heads"` → `heads`. */
export function compact(v: unknown, max = 60): string {
  if (v === undefined || v === null) return "";
  let s: string;
  if (typeof v === "string") s = v;
  else if (typeof v === "object" && !Array.isArray(v))
    s = Object.entries(v as Record<string, unknown>)
      .filter(([k]) => k !== "version")
      .map(([k, x]) => `${k} ${typeof x === "object" ? JSON.stringify(x) : String(x)}`)
      .join(", ");
  else s = JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const minutes = (ms: number) => (ms >= 3_600_000 ? `${Math.floor(ms / 3_600_000)} h ${Math.round((ms % 3_600_000) / 60_000)} min` : `${Math.round(ms / 60_000)} min`);

function genericText(r: LogRecord, names: Record<number, string>): string {
  switch (r.t) {
    case "start":
      return `Game started: ${r.gameId} ${r.version}, ${r.seats.map((s) => `${s.name} (seat ${s.seat}${s.kind === "ai" ? ", AI" : ""})`).join(", ")}`;
    case "intent": {
      // {"marble": 2} for the intent "marble" reads "marble 2", not "marble marble 2".
      const p = r.intent.payload as Record<string, unknown> | undefined;
      const keys = p && typeof p === "object" && !Array.isArray(p) ? Object.keys(p).filter((k) => k !== "version") : [];
      const args = keys.length === 1 && keys[0] === r.intent.name ? compact(p![keys[0]]) : compact(r.intent.payload);
      const what = `${r.intent.name}${args ? ` ${args}` : ""}`;
      if (r.error) return `${what} · the rules threw: ${r.error.message}`;
      return r.accepted ? what : `${what} · refused: ${r.reason ?? "?"}`;
    }
    case "timer":
      return r.error ? `timer ${r.id} · the rules threw: ${r.error.message}` : `timer ${r.id}${r.events?.length ? ` · ${r.events.map((e) => e.name).join(", ")}` : ""}`;
    case "seatJoined":
      return `${r.seat.name} took seat ${r.seat.seat}`;
    case "seatLeft":
      return `${names[r.seat] ?? `seat ${r.seat}`} left${r.ended ? " · the game ended" : ""}`;
    case "disconnected":
      return `${names[r.seat] ?? `seat ${r.seat}`}'s phone went away${r.waiting ? ` · the game waits: ${r.waiting}` : ""}`;
    case "reconnected":
      return `${names[r.seat] ?? `seat ${r.seat}`}'s phone is back`;
    case "pause":
      return r.reason === "cloud" ? "Game paused: the connection to the service was lost"
        : r.reason === "player" ? "Game paused: waiting for a player to come back"
        : `Game paused: waiting for ${names[r.seat ?? -1] ?? "an AI player"}, over its time`;
    case "resume":
      return r.reason === "cloud" ? "Game resumed: the service is back"
        : r.reason === "player" ? "Game resumed: everyone is back"
        : r.reason === "playNow" ? "Game resumed: Play now (the AI's quick move)" : "Game resumed: the AI answered";
    case "error":
      return `Error in ${r.where}${r.seat === undefined ? "" : ` (seat ${r.seat})`}: ${r.error.message}`;
    case "snapshot":
      return `Snapshot of the state after ${r.inputs} inputs`;
    case "end":
      return `Game ended (${r.reason})${r.summary?.text ? `: ${r.summary.text}` : ""}`;
  }
}

/** The seat a record belongs to, for the player column. */
function seatOf(r: LogRecord): number | null {
  if (r.t === "intent" || r.t === "seatLeft" || r.t === "disconnected" || r.t === "reconnected") return r.seat;
  if (r.t === "seatJoined") return r.seat.seat;
  if (r.t === "pause" || r.t === "error") return r.seat ?? null;
  return null;
}

const KIND: Record<LogRecord["t"], RowKind> = {
  start: "start",
  intent: "move",
  timer: "timer",
  seatJoined: "seatJoined",
  seatLeft: "seatLeft",
  disconnected: "disconnected",
  reconnected: "reconnected",
  pause: "pause",
  resume: "resume",
  error: "error",
  snapshot: "snapshot",
  end: "end",
};

/** Replays a log input by input, keeping the state before and after each one. */
class Stepper {
  readonly rt: GameRuntime;
  constructor(game: Game, start: Extract<LogRecord, { t: "start" }>) {
    this.rt = new GameRuntime(game.manifest, game.def, start.seed, start.settings, start.seats, new VirtualClock(), { replay: true, aiOptions: start.aiOptions });
  }
  /** Feed one input as the table did; an exception the game threw then, it throws again now (D-116). */
  feed(r: InputRecord) {
    try {
      if (r.t === "intent") this.rt.submit(r.seat, r.intent, r.by);
      else if (r.t === "timer") this.rt.fireTimer(r.id);
      else if (r.t === "seatJoined") this.rt.seatJoined(r.seat);
      else this.rt.seatLeft(r.seat);
    } catch {
      // the same exception as in the game
    }
  }
}

/**
 * Build the move list of one game's log. With `game` (its rules, in the version the log was written with) the log is
 * replayed and the game's `describe` writes the text; otherwise every row gets the platform's generic line.
 */
export function buildMoves(log: LogRecord[], game?: Game): MoveList {
  const start = log[0];
  if (!start || start.t !== "start") return { rows: [], moves: 0, described: false, note: "the log does not begin with a start record" };
  let note: string | undefined;
  let usable = game;
  if (game && game.manifest.version !== start.version) {
    note = `the log is from ${start.gameId} ${start.version}; the rules here are ${game.manifest.version}`;
    usable = undefined;
  }
  const describe = usable?.def.describe;
  let stepper: Stepper | null = null;
  if (usable) {
    try {
      stepper = new Stepper(usable, start);
    } catch (e) {
      note = `the rules could not start this game: ${(e as Error).message}`;
    }
  }
  const names: Record<number, string> = Object.fromEntries(start.seats.map((s) => [s.seat, s.name]));
  const rows: MoveRow[] = [];
  let n = 0;
  let prevAt = start.at;
  let paused = false;
  let described = false;
  log.forEach((r, i) => {
    const line = i + 1;
    if (r.t === "seatJoined") names[r.seat.seat] = r.seat.name;
    // A long silence nobody explained (D-120): the table slept, a phone was put away, or the game stood still.
    if (!start.simulation && i > 0 && r.at - prevAt >= GAP_MS && !paused) {
      rows.push({ n: null, line, kind: "gap", at: prevAt, t: prevAt - start.at, text: `No activity for ${minutes(r.at - prevAt)}`, flags: [] });
    }
    prevAt = r.at;
    if (r.t === "pause") paused = true;
    if (r.t === "resume") paused = false;
    const seat = seatOf(r);
    const row: MoveRow = { n: r.t === "intent" ? ++n : null, line, kind: KIND[r.t], at: r.at, t: r.at - start.at, text: genericText(r, names), flags: [] };
    if (seat !== null) {
      row.seat = seat;
      row.player = names[seat] ?? null;
    }
    if (r.t === "intent") {
      row.by = r.by;
      row.intent = r.intent;
      row.accepted = r.accepted;
      if (r.reason) row.reason = r.reason;
      if (r.ai) row.ai = r.ai;
      if (!r.accepted && !r.error) row.flags.push("rejected");
      if (r.ai?.fallback) row.flags.push("fallback");
    }
    if (r.t === "timer") row.flags.push("auto");
    if ("error" in r && r.error) {
      row.error = typeof r.error === "object" ? r.error.message : String(r.error);
      row.flags.push("error");
    }
    if ("events" in r && r.events) row.events = r.events.length;
    if (isInput(r) && stepper) {
      const before = describe ? clone(stepper.rt.state) : undefined;
      stepper.feed(r);
      if (describe) {
        const info: StepInfo<unknown> = {
          kind: r.t,
          seat: r.t === "timer" ? null : r.t === "seatJoined" ? r.seat.seat : r.seat,
          ...(r.t === "intent" ? { intent: r.intent, by: r.by } : {}),
          ...(r.t === "timer" ? { timer: r.id } : {}),
          accepted: r.t === "intent" ? r.accepted : !r.error,
          ...(r.t === "intent" && r.reason ? { reason: r.reason } : {}),
          events: (r.events ?? []) as GameEvent[],
          before,
          after: stepper.rt.state,
          names: { ...names },
        };
        try {
          const d = describe(info);
          if (d && typeof d.text === "string") {
            described = true;
            row.flags.push("described");
            row.text = r.t === "intent" && !r.accepted && !r.error && !d.text.includes(r.reason ?? "\u0000") ? `${d.text} · refused: ${r.reason}` : d.text;
            if (d.columns) row.columns = d.columns;
            if (d.details) row.details = d.details;
            if (d.steps?.length) {
              row.steps = d.steps.map((s) => (s.seat === undefined || s.seat === null ? { ...s } : { ...s, player: names[s.seat] ?? null }));
              if (d.steps.some((s) => s.auto) && !row.flags.includes("auto")) row.flags.push("auto");
            }
          }
        } catch (e) {
          row.details = { ...(row.details ?? {}), "describe failed": (e as Error).message };
        }
      }
    }
    rows.push(row);
  });
  return { rows, moves: n, described, ...(note ? { note } : {}) };
}

/**
 * The state before and after the record on `line` (1-based), rebuilt by replay; null for records that change nothing
 * (the state then is the same before and after).
 */
export function stateAt(log: LogRecord[], game: Game, line: number): { before: unknown; after: unknown } {
  const start = log[0];
  if (!start || start.t !== "start") throw new Error("the log does not begin with a start record");
  const stepper = new Stepper(game, start);
  // Line L is log[L - 1]: feed every input before it.
  for (let i = 1; i < line - 1 && i < log.length; i++) {
    const r = log[i];
    if (isInput(r)) stepper.feed(r);
  }
  const before = clone(stepper.rt.state);
  const r = log[line - 1];
  if (r && line > 1 && isInput(r)) stepper.feed(r);
  return { before, after: stepper.rt.state };
}

export interface MoveQuery {
  offset?: number;
  limit?: number;
  /** Only rows of this seat. */
  seat?: number;
  /** Only player moves (no timers, pauses, …). */
  movesOnly?: boolean;
  /** Only rows with a problem: refused moves, errors, AI fallbacks, gaps. */
  problems?: boolean;
  /** Start the page at the row of this move number. */
  move?: number;
  /** Text search in the row's text and player. */
  q?: string;
}

const PROBLEM = new Set(["rejected", "error", "fallback"]);
/** Rows that are a problem by themselves: silence, a pause, an error, a phone that went away. */
export const PROBLEM_KINDS = new Set<RowKind>(["gap", "pause", "error", "disconnected"]);

/** One page of a move list, filtered. `offset` is into the filtered rows. */
export function pageMoves(list: MoveList, q: MoveQuery = {}) {
  const limit = Math.max(1, Math.min(200, Math.round(q.limit ?? 25)));
  const needle = q.q?.trim().toLowerCase();
  const rows = list.rows.filter(
    (r) =>
      (q.seat === undefined || r.seat === q.seat) &&
      (!q.movesOnly || r.kind === "move") &&
      (!q.problems || r.flags.some((f) => PROBLEM.has(f)) || PROBLEM_KINDS.has(r.kind)) &&
      (!needle || r.text.toLowerCase().includes(needle) || (r.player ?? "").toLowerCase().includes(needle)),
  );
  let offset = Math.max(0, Math.round(q.offset ?? 0));
  if (q.move !== undefined) {
    const at = rows.findIndex((r) => r.n !== null && r.n >= q.move!);
    if (at >= 0) offset = Math.floor(at / limit) * limit;
  }
  return { total: rows.length, offset, limit, moves: list.moves, rows: rows.slice(offset, offset + limit) };
}

/**
 * The move list packed into a finished game's zip (D-120): described by the game when its rules are given, generic
 * otherwise. Never fails the packing: if the list cannot be built, the zip goes without it.
 */
export function movesFor(game: Game | undefined, log: LogRecord[]): MoveRow[] | undefined {
  try {
    return buildMoves(log, game).rows;
  } catch (e) {
    console.error(`[moves] could not build the move list: ${(e as Error).message}`);
    return undefined;
  }
}
