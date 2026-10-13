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
  type StepResult,
} from "../../../packages/sdk/src/index.ts";
import type { GameSummary, Manifest } from "../../../packages/protocol/src/index.ts";

export type LogRecord =
  | { t: "start"; at: number; gameId: string; version: string; seed: number; settings: Record<string, unknown>; seats: SeatInfo[]; aiOptions: Record<number, Record<string, unknown>>; simulation: boolean }
  | { t: "intent"; at: number; seat: number; by: "human" | "ai" | "board"; intent: Intent; accepted: boolean; reason?: string; events?: GameEvent[] }
  | { t: "timer"; at: number; id: string; events?: GameEvent[] }
  | { t: "seatJoined"; at: number; seat: SeatInfo; events?: GameEvent[] }
  | { t: "seatLeft"; at: number; seat: number; ended: boolean; events?: GameEvent[] }
  | { t: "end"; at: number; reason: "finished" | "terminated" | "seatLeft"; summary: GameSummary | null; stateHash: string };

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

export class GameRuntime {
  state: unknown;
  readonly log: LogRecord[] = [];
  summary: GameSummary | null = null;
  over = false;
  private rng: () => number;
  private timers = new Map<string, unknown>();
  private deadlines = new Map<string, number>();
  /** While paused: remaining time of each timer, re-armed on resume. */
  private paused: Map<string, number> | null = null;
  private listeners: Listener[] = [];

  readonly manifest: Manifest;
  readonly def: GameDefinition<any>;
  readonly seed: number;
  readonly settings: Record<string, unknown>;
  seats: SeatInfo[];
  readonly clock: Clock;
  readonly opts: { simulation?: boolean; aiOptions?: Record<number, Record<string, unknown>>; replay?: boolean };

  constructor(
    manifest: Manifest,
    def: GameDefinition<any>,
    seed: number,
    settings: Record<string, unknown>,
    seats: SeatInfo[],
    clock: Clock = realClock,
    opts: { simulation?: boolean; aiOptions?: Record<number, Record<string, unknown>>; replay?: boolean } = {},
  ) {
    this.manifest = manifest;
    this.def = def;
    this.seed = seed;
    this.settings = settings;
    this.seats = seats;
    this.clock = clock;
    this.opts = opts;
    this.rng = createRng(seed);
    this.record({ t: "start", at: clock.now(), gameId: manifest.id, version: manifest.version, seed, settings, seats, aiOptions: opts.aiOptions ?? {}, simulation: !!opts.simulation });
    this.state = def.setup(this.ctx(), settings);
  }

  onChange(l: Listener) {
    this.listeners.push(l);
  }

  ctx(): GameContext {
    return {
      random: () => this.rng(),
      randomInt: (min, max) => min + Math.floor(this.rng() * (max - min + 1)),
      setTimer: (id, ms) => this.setTimer(id, ms),
      clearTimer: (id) => this.clearTimer(id),
      seats: this.seats,
    };
  }

  private record(r: LogRecord) {
    this.log.push(r);
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

  /** Stop the clock: pending timers keep their remaining time. Timer firings are logged, so replay is unaffected. */
  pause() {
    if (this.paused || this.over) return;
    const now = this.clock.now();
    const left = new Map<string, number>();
    for (const [id, deadline] of this.deadlines) left.set(id, Math.max(0, deadline - now));
    this.clearAllTimers();
    this.paused = left;
  }

  resume() {
    if (!this.paused) return;
    const left = this.paused;
    this.paused = null;
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
    const summary = this.def.isOver(this.state);
    if (summary) {
      // The step's own events (the last flip, the winning move) still go out with the game-over (D-092).
      this.finish("finished", summary, events);
      return;
    }
    for (const l of this.listeners) l("changed", events);
  }

  finish(reason: "finished" | "terminated" | "seatLeft", summary: GameSummary | null, events: GameEvent[] = []) {
    if (this.over) return;
    this.over = true;
    this.summary = summary;
    this.clearAllTimers();
    this.record({ t: "end", at: this.clock.now(), reason, summary, stateHash: stateHash(this.state) });
    for (const l of this.listeners) l("over", events);
  }

  submit(seat: number, intent: Intent, by: "human" | "ai" | "board"): { ok: true } | { ok: false; reason: string } {
    if (this.over) return { ok: false, reason: "game is over" };
    const r = this.def.onIntent(this.state, seat, intent, this.ctx());
    if (isReject(r)) {
      this.record({ t: "intent", at: this.clock.now(), seat, by, intent, accepted: false, reason: r.reject });
      return { ok: false, reason: r.reject };
    }
    const events = this.apply(r);
    this.record({ t: "intent", at: this.clock.now(), seat, by, intent, accepted: true, events });
    this.afterStep(events);
    return { ok: true };
  }

  fireTimer(id: string) {
    if (this.over || !this.def.onTimer) return;
    const events = this.apply(this.def.onTimer(this.state, id, this.ctx()));
    this.record({ t: "timer", at: this.clock.now(), id, events });
    this.afterStep(events);
  }

  seatJoined(seat: SeatInfo) {
    if (this.over) return;
    this.seats = [...this.seats.filter((s) => s.seat !== seat.seat), seat].sort((a, b) => a.seat - b.seat);
    const events = this.def.onSeatJoined ? this.apply(this.def.onSeatJoined(this.state, seat, this.ctx())) : [];
    this.record({ t: "seatJoined", at: this.clock.now(), seat, events });
    this.afterStep(events);
  }

  /** Returns true if the game ended because of it. */
  seatLeft(seat: number): boolean {
    if (this.over) return true;
    this.seats = this.seats.filter((s) => s.seat !== seat);
    const r = this.def.onSeatLeft ? this.def.onSeatLeft(this.state, seat, this.ctx()) : "end";
    if (r === "end") {
      this.record({ t: "seatLeft", at: this.clock.now(), seat, ended: true });
      this.finish("seatLeft", { text: "The game ended because a player left.", highlights: { leftSeat: seat } });
      return true;
    }
    const events = this.apply(r);
    this.record({ t: "seatLeft", at: this.clock.now(), seat, ended: false, events });
    this.afterStep(events);
    return this.over;
  }

  view(seat: number) {
    return this.def.view(this.state, seat);
  }

  boardView() {
    return this.def.boardView(this.state);
  }

  /** Pending timers as absolute deadlines (clock time), for countdowns on board and decks. */
  timerDeadlines(): Record<string, number> {
    return Object.fromEntries(this.deadlines);
  }

  aiIntent(seat: number, aiRng: () => number): Intent | null {
    if (!this.def.ai || this.over) return null;
    const ctx = { random: aiRng, randomInt: (min: number, max: number) => min + Math.floor(aiRng() * (max - min + 1)) };
    return this.def.ai(this.view(seat), seat, ctx, this.opts.aiOptions?.[seat] ?? {});
  }
}

/** Rebuild a game from its log and return the final state hash. */
export function replay(manifest: Manifest, def: GameDefinition<any>, log: LogRecord[]): string {
  const start = log[0];
  if (!start || start.t !== "start") throw new Error("log must begin with a start record");
  const rt = new GameRuntime(manifest, def, start.seed, start.settings, start.seats, new VirtualClock(), { replay: true, aiOptions: start.aiOptions });
  for (const r of log.slice(1)) {
    switch (r.t) {
      case "intent":
        rt.submit(r.seat, r.intent, r.by); // rejected ones too: a rule may draw randomness before rejecting
        break;
      case "timer":
        rt.fireTimer(r.id);
        break;
      case "seatJoined":
        rt.seatJoined(r.seat);
        break;
      case "seatLeft":
        rt.seatLeft(r.seat);
        break;
      case "end":
        return stateHash(rt.state);
    }
  }
  return stateHash(rt.state);
}
