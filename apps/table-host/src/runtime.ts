// Runs one game: owns its state, RNG, timers and log. Every input that can change state is logged,
// so `replay()` reproduces the game exactly from the log.
import { createHash } from "node:crypto";
import {
  createRng,
  isReject,
  type GameContext,
  type GameDefinition,
  type GameEvent,
  type Intent,
  type SeatInfo,
  type SeatLeftEnd,
  type StepResult,
} from "../../../packages/sdk/src/index.ts";
import type { GameSummary, Manifest } from "../../../packages/protocol/src/index.ts";

export type LogRecord =
  | { t: "start"; at: number; gameId: string; version: string; seed: number; settings: Record<string, unknown>; seats: SeatInfo[]; aiOptions: Record<number, Record<string, unknown>>; simulation: boolean }
  // Inputs carry `gt`, the game time the rules saw as ctx.now() (D-126); replay hands it back. Older logs lack it.
  | { t: "intent"; at: number; gt?: number; seat: number; by: "human" | "ai" | "board"; intent: Intent; accepted: boolean; reason?: string; events?: GameEvent[]; ai?: AiMoveMeta; error?: LoggedError }
  | { t: "timer"; at: number; gt?: number; id: string; early?: boolean; events?: GameEvent[]; error?: LoggedError }
  | { t: "seatJoined"; at: number; gt?: number; seat: SeatInfo; events?: GameEvent[]; error?: LoggedError }
  | { t: "seatLeft"; at: number; gt?: number; seat: number; ended: boolean; events?: GameEvent[]; error?: LoggedError }
  // Not inputs: replay skips them (D-116). An error outside the input steps (a view, the end check); a copy of the state.
  | { t: "error"; at: number; where: string; seat?: number; error: LoggedError }
  | { t: "snapshot"; at: number; inputs: number; state: unknown }
  // Not inputs either (D-119): a player's phone went away or came back; `waiting`: the game can't go on without them.
  | { t: "disconnected"; at: number; seat: number; waiting?: string }
  // An AI player took over the seat of a player who was away (D-144), with its options; not an input either: its moves
  // are logged as intents like any AI player's.
  | { t: "aiTakeover"; at: number; seat: number; name: string; aiOptions: Record<string, unknown> }
  | { t: "reconnected"; at: number; seat: number }
  // Not inputs either (D-120): the game stood still. `reason` "cloud" (the service connection was lost), "ai" (an AI
  // player ran over its time, `seat`) or "player" (waiting for a player who went away, D-119); resume `reason` "cloud",
  // "ai" (it answered), "playNow" (its quick move) or "player" (everyone is back).
  | { t: "pause"; at: number; reason: PauseReason; seat?: number }
  | { t: "resume"; at: number; reason: ResumeReason }
  // "interrupted": the table stopped during the game; the log was closed at its next start (no summary, and a hash
  // only if the game could be replayed then).
  | { t: "end"; at: number; reason: EndReason; summary: GameSummary | null; stateHash: string | null };

export type EndReason = "finished" | "terminated" | "seatLeft" | "interrupted";
export type PauseReason = "cloud" | "ai" | "player";
export type ResumeReason = "cloud" | "ai" | "playNow" | "player";

/** An exception thrown by the game's code, as recorded in its log (D-116). */
export interface LoggedError {
  message: string;
  stack?: string;
}

export function loggedError(e: unknown): LoggedError {
  const err = e as { message?: unknown; stack?: unknown } | null;
  const message = typeof err?.message === "string" ? err.message : String(e);
  const stack = typeof err?.stack === "string" ? err.stack.split("\n").slice(0, 20).join("\n") : undefined;
  return stack ? { message, stack } : { message };
}

/** At most this many `error` records per game; a view that throws on every update would otherwise fill the log. */
const MAX_ERROR_RECORDS = 20;

/**
 * How an AI move came about (D-112), for analysis and training data; replay never looks at it. `ms`: thinking time;
 * `fallback`: the game's quick move after "Play now" (or a failed AI); `worker`: the AI ran in a worker thread.
 */
export interface AiMoveMeta {
  ms: number;
  fallback?: boolean;
  worker?: boolean;
  error?: string;
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

/** Virtual clock for headless simulations: timers fire when advance() is called. */
export class VirtualClock implements Clock {
  private t = 0;
  private queue: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 1;
  now() {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number) {
    const id = this.nextId++;
    this.queue.push({ at: this.t + ms, fn, id });
    this.queue.sort((a, b) => a.at - b.at || a.id - b.id);
    return id;
  }
  clearTimeout(handle: unknown) {
    this.queue = this.queue.filter((q) => q.id !== handle);
  }
  /** Fire the next timer; returns false if none is pending. */
  advance(): boolean {
    const next = this.queue.shift();
    if (!next) return false;
    this.t = next.at;
    next.fn();
    return true;
  }
}

export function stateHash(state: unknown): string {
  return createHash("sha256").update(JSON.stringify(state)).digest("hex").slice(0, 16);
}

type Listener = (kind: "changed" | "over", events: GameEvent[]) => void;

export interface RuntimeOptions {
  simulation?: boolean;
  aiOptions?: Record<number, Record<string, unknown>>;
  replay?: boolean;
  /** Add a `snapshot` record with the whole state after every N inputs (D-116); 0 or unset: none. */
  snapshotEvery?: number;
}

export class GameRuntime {
  state: unknown;
  readonly log: LogRecord[] = [];
  summary: GameSummary | null = null;
  over = false;
  private rng: () => number;
  private timers = new Map<string, unknown>();
  private deadlines = new Map<string, number>();
  /** Game time (D-126): the clock when the game started, the time spent paused, and since when it is paused. */
  private startedAt: number;
  private pausedMs = 0;
  private pausedSince: number | null = null;
  /** The game time of the input being handled: what ctx.now() says during it and what its record carries. */
  private stepGt: number | null = null;
  /** In replay: the game time of the input being fed, from its record. */
  private replayGt = 0;
  /** While paused: remaining time of each timer, re-armed on resume. */
  private paused: Map<string, number> | null = null;
  private listeners: Listener[] = [];
  private recordListeners: ((r: LogRecord) => void)[] = [];
  /** Inputs that changed the game (accepted intents, timers, seats), for snapshots and the log's counts. */
  inputs = 0;
  /** Exceptions thrown by the game's code in this game, recorded or not. */
  errors = 0;
  private errorRecords = 0;

  readonly manifest: Manifest;
  readonly def: GameDefinition<any>;
  readonly seed: number;
  readonly settings: Record<string, unknown>;
  seats: SeatInfo[];
  readonly clock: Clock;
  readonly opts: RuntimeOptions;

  constructor(
    manifest: Manifest,
    def: GameDefinition<any>,
    seed: number,
    settings: Record<string, unknown>,
    seats: SeatInfo[],
    clock: Clock = realClock,
    opts: RuntimeOptions = {},
  ) {
    this.manifest = manifest;
    this.def = def;
    this.seed = seed;
    this.settings = settings;
    this.seats = seats;
    this.clock = clock;
    this.opts = opts;
    this.rng = createRng(seed);
    this.startedAt = clock.now();
    this.record({ t: "start", at: clock.now(), gameId: manifest.id, version: manifest.version, seed, settings, seats, aiOptions: opts.aiOptions ?? {}, simulation: !!opts.simulation });
    this.state = def.setup(this.ctx(), settings);
  }

  onChange(l: Listener) {
    this.listeners.push(l);
  }

  ctx(): GameContext {
    return {
      ...rngCtx(this.rng),
      setTimer: (id, ms) => this.setTimer(id, ms),
      clearTimer: (id) => this.clearTimer(id),
      now: () => this.stepGt ?? this.gameTime(),
      seats: this.seats,
    };
  }

  /**
   * Milliseconds of game time since the start (D-126): the table's clock with the time spent paused left out, so a
   * pause (cloud, a slow AI, a player away) costs nobody. In replay, the value the input was logged with.
   */
  gameTime(): number {
    if (this.opts.replay) return this.replayGt;
    const now = this.clock.now();
    return Math.max(0, now - this.startedAt - this.pausedMs - (this.pausedSince === null ? 0 : now - this.pausedSince));
  }

  /** Start an input step: fix its game time, so the rules and the log see the same value. */
  private beginStep(): number {
    this.stepGt = this.gameTime();
    return this.stepGt;
  }

  /** For replay: the game time of the next input, from its record (0 for logs from before D-126). */
  setReplayTime(gt: number | undefined) {
    this.replayGt = typeof gt === "number" && Number.isFinite(gt) ? gt : 0;
  }

  /** Every record as it is logged (D-116): the table writes them to disk as the game goes. */
  onRecord(l: (r: LogRecord) => void) {
    this.recordListeners.push(l);
  }

  private record(r: LogRecord) {
    this.log.push(r);
    for (const l of this.recordListeners) l(r);
  }

  /** An exception outside the input steps, e.g. in a view (D-116). Recorded for the first few, counted always. */
  private recordError(where: string, e: unknown, seat?: number) {
    this.errors++;
    if (this.errorRecords >= MAX_ERROR_RECORDS || this.opts.replay) return;
    this.errorRecords++;
    this.record({ t: "error", at: this.clock.now(), where, ...(seat === undefined ? {} : { seat }), error: loggedError(e) });
  }

  /**
   * Run the game's code for an input. If it throws, the input is logged with the error, so a replay meets the same
   * exception at the same point (D-116), and the exception goes on to the caller.
   */
  private guarded<T>(step: () => T, failed: (error: LoggedError) => LogRecord): T {
    try {
      return step();
    } catch (e) {
      this.errors++;
      this.record(failed(loggedError(e)));
      throw e;
    }
  }

  /** After an input that changed the game: a snapshot every N inputs, if asked for. */
  private inputDone() {
    this.inputs++;
    const every = this.opts.snapshotEvery ?? 0;
    if (every > 0 && !this.opts.replay && this.inputs % every === 0) this.record({ t: "snapshot", at: this.clock.now(), inputs: this.inputs, state: this.state });
  }

  private setTimer(id: string, ms: number) {
    if (this.opts.replay) return; // timer firings come from the log during replay
    if (this.paused) {
      this.paused.set(id, ms); // set while paused (e.g. a player left): armed on resume
      return;
    }
    this.clearTimer(id);
    const h = this.clock.setTimeout(() => {
      this.timers.delete(id);
      this.deadlines.delete(id);
      this.fireTimer(id);
    }, ms);
    this.timers.set(id, h);
    this.deadlines.set(id, this.clock.now() + ms);
  }

  /**
   * Stop the clock: pending timers keep their remaining time. Timer firings are logged, so replay is unaffected. With a
   * reason the pause is logged (D-120), also when the game was already paused for another reason.
   */
  pause(reason?: PauseReason, seat?: number) {
    if (this.over) return;
    if (reason && !this.opts.replay) this.record({ t: "pause", at: this.clock.now(), reason, ...(seat === undefined ? {} : { seat }) });
    if (this.paused) return;
    const now = this.clock.now();
    this.pausedSince = now;
    const left = new Map<string, number>();
    for (const [id, deadline] of this.deadlines) left.set(id, Math.max(0, deadline - now));
    this.clearAllTimers();
    this.paused = left;
  }

  resume(reason?: ResumeReason) {
    if (!this.paused) return;
    if (reason && !this.opts.replay && !this.over) this.record({ t: "resume", at: this.clock.now(), reason });
    const left = this.paused;
    this.paused = null;
    if (this.pausedSince !== null) this.pausedMs += Math.max(0, this.clock.now() - this.pausedSince);
    this.pausedSince = null;
    for (const [id, ms] of left) this.setTimer(id, ms);
  }

  private clearTimer(id: string) {
    this.paused?.delete(id);
    const h = this.timers.get(id);
    if (h !== undefined) this.clock.clearTimeout(h);
    this.timers.delete(id);
    this.deadlines.delete(id);
  }

  clearAllTimers() {
    for (const id of [...this.timers.keys()]) this.clearTimer(id);
  }

  private apply(r: StepResult<unknown>): GameEvent[] {
    if (isReject(r)) return [];
    this.state = r.state;
    return r.events ?? [];
  }

  private afterStep(events: GameEvent[]) {
    if (this.over) return;
    let summary: GameSummary | null;
    try {
      summary = this.def.isOver(this.state);
    } catch (e) {
      this.recordError("isOver", e);
      throw e;
    }
    if (summary) {
      // The step's own events (the last flip, the winning move) still go out with the game-over (D-092).
      this.finish("finished", summary, events);
      return;
    }
    for (const l of this.listeners) l("changed", events);
  }

  finish(reason: Exclude<EndReason, "interrupted">, summary: GameSummary | null, events: GameEvent[] = []) {
    if (this.over) return;
    this.over = true;
    this.summary = summary;
    this.clearAllTimers();
    this.record({ t: "end", at: this.clock.now(), reason, summary, stateHash: stateHash(this.state) });
    for (const l of this.listeners) l("over", events);
  }

  submit(seat: number, intent: Intent, by: "human" | "ai" | "board", ai?: AiMoveMeta): { ok: true } | { ok: false; reason: string } {
    if (this.over) return { ok: false, reason: "game is over" };
    const gt = this.beginStep();
    const meta = ai ? { ai } : {};
    const r = this.guarded(
      () => this.def.onIntent(this.state, seat, intent, this.ctx()),
      (error) => ({ t: "intent", at: this.clock.now(), gt, seat, by, intent, accepted: false, ...meta, error }),
    );
    if (isReject(r)) {
      this.record({ t: "intent", at: this.clock.now(), gt, seat, by, intent, accepted: false, reason: r.reject, ...meta });
      return { ok: false, reason: r.reject };
    }
    const events = this.apply(r);
    this.record({ t: "intent", at: this.clock.now(), gt, seat, by, intent, accepted: true, events, ...meta });
    this.inputDone();
    this.afterStep(events);
    return { ok: true };
  }

  fireTimer(id: string, early = false) {
    if (this.over || !this.def.onTimer) return;
    const gt = this.beginStep();
    const flag = early ? { early: true } : {};
    const events = this.guarded(
      () => this.apply(this.def.onTimer!(this.state, id, this.ctx())),
      (error) => ({ t: "timer", at: this.clock.now(), gt, id, ...flag, error }),
    );
    this.record({ t: "timer", at: this.clock.now(), gt, id, ...flag, events });
    this.inputDone();
    this.afterStep(events);
  }

  seatJoined(seat: SeatInfo) {
    if (this.over) return;
    const gt = this.beginStep();
    this.seats = [...this.seats.filter((s) => s.seat !== seat.seat), seat].sort((a, b) => a.seat - b.seat);
    const events = this.guarded(
      () => (this.def.onSeatJoined ? this.apply(this.def.onSeatJoined(this.state, seat, this.ctx())) : []),
      (error) => ({ t: "seatJoined", at: this.clock.now(), gt, seat, error }),
    );
    this.record({ t: "seatJoined", at: this.clock.now(), gt, seat, events });
    this.inputDone();
    this.afterStep(events);
  }

  /**
   * Can the game go on without this seat (D-119)? true when the game doesn't say otherwise, or when its answer throws
   * (recorded): a broken question must not hold a table.
   */
  canContinueWithout(seat: number): true | { wait: string } {
    if (this.over || !this.def.canContinueWithout) return true;
    try {
      const r = this.def.canContinueWithout(this.state, seat);
      if (r && typeof r === "object" && typeof (r as { wait?: unknown }).wait === "string") return { wait: (r as { wait: string }).wait.slice(0, 300) };
      return true;
    } catch (e) {
      this.recordError("canContinueWithout", e, seat);
      return true;
    }
  }

  /** A player's phone went away or came back (D-119): for the log only, replay skips these. */
  noteConnection(seat: number, connected: boolean, waiting?: string) {
    if (this.over) return;
    this.record(connected ? { t: "reconnected", at: this.clock.now(), seat } : { t: "disconnected", at: this.clock.now(), seat, ...(waiting ? { waiting } : {}) });
  }

  /** An AI player plays this seat from now on (D-144): its options, and a log record. */
  aiTakeover(seat: number, name: string, aiOptions: Record<string, unknown>) {
    if (this.over) return;
    (this.opts as { aiOptions?: Record<number, Record<string, unknown>> }).aiOptions = { ...(this.opts.aiOptions ?? {}), [seat]: aiOptions };
    this.record({ t: "aiTakeover", at: this.clock.now(), seat, name, aiOptions });
  }

  /** Returns true if the game ended because of it. */
  seatLeft(seat: number): boolean {
    if (this.over) return true;
    const gt = this.beginStep();
    // A game that can't go on without this seat ends with its own reason (D-119). Asked before the seat goes, so a
    // replay asks the same question of the same state.
    const needed = this.canContinueWithout(seat);
    if (needed !== true) {
      this.seats = this.seats.filter((s) => s.seat !== seat);
      this.record({ t: "seatLeft", at: this.clock.now(), gt, seat, ended: true });
      this.inputDone();
      this.finish("seatLeft", { text: needed.wait, highlights: { leftSeat: seat } });
      return true;
    }
    this.seats = this.seats.filter((s) => s.seat !== seat);
    const r = this.guarded<StepResult<unknown> | "end" | SeatLeftEnd>(
      () => (this.def.onSeatLeft ? this.def.onSeatLeft(this.state, seat, this.ctx()) : "end"),
      (error) => ({ t: "seatLeft", at: this.clock.now(), gt, seat, ended: false, error }),
    );
    if (r === "end" || (r && typeof r === "object" && "end" in r)) {
      const own = typeof r === "object" && typeof r.end?.text === "string" ? r.end : null;
      this.record({ t: "seatLeft", at: this.clock.now(), gt, seat, ended: true });
      this.inputDone();
      this.finish("seatLeft", { text: own ? own.text : "The game ended because a player left.", highlights: { leftSeat: seat, ...(own?.highlights ?? {}) } });
      return true;
    }
    const events = this.apply(r);
    this.record({ t: "seatLeft", at: this.clock.now(), gt, seat, ended: false, events });
    this.inputDone();
    this.afterStep(events);
    return this.over;
  }

  view(seat: number) {
    try {
      return this.def.view(this.state, seat);
    } catch (e) {
      this.recordError("view", e, seat);
      throw e;
    }
  }

  boardView() {
    try {
      return this.def.boardView(this.state);
    } catch (e) {
      this.recordError("boardView", e);
      throw e;
    }
  }

  /**
   * Fire a pending timer now instead of at its deadline (D-136): the board's "Next hand" and the like. Logged as a
   * timer firing with `early: true`, so replay fires it at the same point. False if the timer is not pending.
   */
  skipTimer(id: string): boolean {
    if (this.over || this.paused || !this.timers.has(id)) return false;
    this.clearTimer(id);
    this.fireTimer(id, true);
    return true;
  }

  /** Pending timers as absolute deadlines (clock time), for countdowns on board and decks. */
  timerDeadlines(): Record<string, number> {
    return Object.fromEntries(this.deadlines);
  }

  /** This seat's AI move, for callers that need it at once (tests, simulations of synchronous AIs). */
  aiIntent(seat: number, aiRng: () => number): Intent | null {
    const r = this.aiDecide(seat, aiRng);
    if (r instanceof Promise) throw new Error(`${this.manifest.id}'s AI answers asynchronously; use aiDecide`);
    return r;
  }

  /**
   * Ask the game's AI for this seat's move, in this thread. It may answer with a promise (D-112); `signal` tells it the
   * game moved on, `deadline` when the table expects the move.
   */
  aiDecide(seat: number, aiRng: () => number, signal: AbortSignal = NEVER, deadline = Number.MAX_SAFE_INTEGER): Intent | null | Promise<Intent | null> {
    if (!this.def.ai || this.over) return null;
    return this.def.ai(this.view(seat), seat, { ...rngCtx(aiRng), signal, deadline }, this.aiOptions(seat));
  }

  /** The game's quick move for an AI out of time (D-112), or null if the game has none. */
  aiFallbackIntent(seat: number, aiRng: () => number): Intent | null {
    if (!this.def.aiFallback || this.over) return null;
    return this.def.aiFallback(this.view(seat), seat, rngCtx(aiRng), this.aiOptions(seat));
  }

  aiOptions(seat: number): Record<string, unknown> {
    return this.opts.aiOptions?.[seat] ?? {};
  }
}

const NEVER = new AbortController().signal;
const rngCtx = (rng: () => number) => ({ random: rng, randomInt: (min: number, max: number) => min + Math.floor(rng() * (max - min + 1)) });

/** Rebuild a game from its log and return the final state hash. */
export function replay(manifest: Manifest, def: GameDefinition<any>, log: LogRecord[]): string {
  return replayLog(manifest, def, log).hash;
}

/**
 * Rebuild a game from its log: its state and that state's hash. Inputs the game threw on (D-116) are fed again and
 * throw again; that is part of the game, so replay goes on. Error and snapshot records are not inputs.
 */
export function replayLog(manifest: Manifest, def: GameDefinition<any>, log: LogRecord[]): { state: unknown; hash: string } {
  const start = log[0];
  if (!start || start.t !== "start") throw new Error("log must begin with a start record");
  const rt = new GameRuntime(manifest, def, start.seed, start.settings, start.seats, new VirtualClock(), { replay: true, aiOptions: start.aiOptions });
  for (const r of log.slice(1)) {
    if (r.t === "end") break;
    feedInput(rt, r);
  }
  return { state: rt.state, hash: stateHash(rt.state) };
}

/**
 * Feed one logged record to a replaying runtime as the table did; records that are not inputs are skipped. An exception
 * the game threw when it was played, it throws again now (D-116): that is part of the game, so it is swallowed here.
 */
export function feedInput(rt: GameRuntime, r: LogRecord) {
  try {
    if (r.t === "intent" || r.t === "timer" || r.t === "seatJoined" || r.t === "seatLeft") rt.setReplayTime(r.gt);
    if (r.t === "intent") rt.submit(r.seat, r.intent, r.by); // rejected ones too: a rule may draw randomness before rejecting
    else if (r.t === "timer") rt.fireTimer(r.id);
    else if (r.t === "seatJoined") rt.seatJoined(r.seat);
    else if (r.t === "seatLeft") rt.seatLeft(r.seat);
  } catch {
    // the same exception the game threw when it was played
  }
}
