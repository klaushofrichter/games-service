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

export type StepResult<S> = { state: S; events?: GameEvent[] } | { reject: string };

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
  /** A seat left for good. Return "end" to end the game. */
  onSeatLeft?(state: S, seat: number, ctx: GameContext): StepResult<S> | "end";
  /** AI player: pick an intent from this seat's view, or null to wait. */
  ai?(view: unknown, seat: number, ctx: Pick<GameContext, "random" | "randomInt">, options: Record<string, unknown>): Intent | null;
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

export function isReject<S>(r: StepResult<S>): r is { reject: string } {
  return "reject" in r;
}
