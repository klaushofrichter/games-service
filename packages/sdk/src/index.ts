// Game SDK: what a game author writes against.
// Rules are pure: given the same state, inputs and RNG stream they produce the same result,
// so a game can be replayed from its log.
import type { GameSummary, Manifest } from "../../protocol/src/index.ts";

export type { GameSummary, Manifest };

export interface SeatInfo {
  seat: number;
  playerId: string;
  name: string;
  kind: "human" | "ai";
  /** Board edge the seat is on; games use it to orient a player's area. */
  edge?: "north" | "east" | "south" | "west";
}

export interface Intent {
  name: string;
  payload?: unknown;
}

export interface GameEvent {
  name: string;
  data?: unknown;
}

export interface GameContext {
  /** Deterministic random number in [0, 1), drawn from the logged seed. */
  random(): number;
  /** Integer in [min, max]. */
  randomInt(min: number, max: number): number;
  /** Ask the host to call onTimer(id) after ms (virtual time in headless simulations). */
  setTimer(id: string, ms: number): void;
  clearTimer(id: string): void;
  seats: SeatInfo[];
}

/**
 * What an AI player gets besides its view (D-112). `signal` is aborted when the game has moved on (the AI is asked
 * again with the new view), paused or ended; `deadline` is the time (ms since the epoch) by which the table expects
 * the move. An AI may answer later than that: the game then pauses until it answers or the players tap "Play now".
 */
export interface AiContext {
  random(): number;
  randomInt(min: number, max: number): number;
  signal: AbortSignal;
  deadline: number;
}

export type StepResult<S> = { state: S; events?: GameEvent[] } | { reject: string };

/** onSeatLeft's way of ending the game with its own reason (D-119). */
export interface SeatLeftEnd {
  end: { text: string; highlights?: Record<string, unknown> };
}

export interface GameDefinition<S = unknown> {
  setup(ctx: GameContext, settings: Record<string, unknown>): S;
  onIntent(state: S, seat: number, intent: Intent, ctx: GameContext): StepResult<S>;
  /** What one seat may see. Never include other seats' private data. */
  view(state: S, seat: number): unknown;
  /** What the public board shows. */
  boardView(state: S): unknown;
  /** Return a summary once the game is over, otherwise null. */
  isOver(state: S): GameSummary | null;
  onTimer?(state: S, id: string, ctx: GameContext): StepResult<S>;
  onSeatJoined?(state: S, seat: SeatInfo, ctx: GameContext): StepResult<S>;
  /**
   * A seat left for good. Return "end" to end the game, or `{ end: { text } }` to end it with the game's own reason
   * (D-119), e.g. "Team North–South was broken." Otherwise the new state.
   */
  onSeatLeft?(state: S, seat: number, ctx: GameContext): StepResult<S> | "end" | SeatLeftEnd;
  /**
   * Can the game go on without this seat (D-119)? Asked when its player's phone goes away and before the player is
   * removed. `true`: go on (a disconnected player then leaves after the waiting time, and onSeatLeft follows).
   * `{ wait: text }`: the game needs this player: while they are away the game pauses, their seat is held, and the
   * board says the text and offers to end the game; removing them ends it with the text. Must not change the state
   * (it is a question, asked again during replay). Without it, games go on.
   */
  canContinueWithout?(state: S, seat: number): true | { wait: string };
  /**
   * AI player: pick an intent from this seat's view, or null to wait. May answer later (a promise), for a search or
   * a call to a language model (D-112); the table keeps running meanwhile. With `ai.worker` in the manifest it runs
   * in a worker thread, where it gets the view and options only, as plain data.
   */
  ai?(view: unknown, seat: number, ctx: AiContext, options: Record<string, unknown>): Intent | null | Promise<Intent | null>;
  /**
   * A quick move for an AI player that is out of time, when the players tap "Play now" (D-112). Synchronous and
   * fast. Without it, "Play now" asks the AI again.
   */
  aiFallback?(view: unknown, seat: number, ctx: Pick<GameContext, "random" | "randomInt">, options: Record<string, unknown>): Intent | null;
}

export function defineGame<S>(def: GameDefinition<S>): GameDefinition<S> {
  return def;
}

/** mulberry32: small, fast, seedable PRNG. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/**
 * A count for messages: small numbers in words, the noun matching the number.
 * count(1, "correct guess", "correct guesses") → "one correct guess"; count(12, "hand") → "12 hands".
 */
export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${Number.isInteger(n) && n >= 0 && n < WORDS.length ? WORDS[n] : n} ${n === 1 ? singular : plural}`;
}

/** Names for messages: "Ann", "Ann and Bob", "Ann, Bob and Cleo". */
export function list(names: string[]): string {
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function isReject<S>(r: StepResult<S>): r is { reject: string } {
  return "reject" in r;
}
