// Fuzzing the game rules: AI players drive each game forward while a "chaos" player fires random and
// malformed intents at every step. Invariants, for every game and many seeds:
//   - the rules never throw, whatever the intent
//   - a rejected intent changes nothing (rules are pure; a mutation before rejecting would corrupt state)
//   - every seat's view and the board view can always be built and serialised
//   - the game still finishes, and the log (rejected intents included) replays to the same state
import { describe, expect, it } from "vitest";
import { createRng } from "../packages/sdk/src/index.ts";
import { stateHash } from "../apps/table-host/src/runtime.ts";
import { expectReplay, loadGame, start } from "./harness.ts";

const GAMES: { id: string; players: number[]; settings: Record<string, unknown> }[] = [
  { id: "roulette", players: [1, 3, 6], settings: { rounds: 3 } },
  { id: "pachisi", players: [2, 4], settings: { tokens: 2 } },
  { id: "holdem", players: [2, 4, 6], settings: {} },
  { id: "coin-flip", players: [1, 5], settings: { rounds: 3 } },
];

const deep = (n: number): unknown => (n === 0 ? 1 : { a: deep(n - 1) });
const NASTY: unknown[] = [
  undefined, null, 0, -1, 1.5, 1e12, -1e12, NaN, Infinity, "", "x", "0", "heads", true, false, [], [1, 2],
  {}, { amount: -5 }, { amount: "100" }, { amount: 1e15 }, { target: null }, { bet: { kind: "straight", n: 99 } },
  { token: -1 }, { token: 99 }, { token: "1" }, deep(40), Object.create(null),
];
const NAMES = [
  "", "x", "__proto__", "constructor", "toString", "hasOwnProperty",
  "placeBet", "clearBets", "done", "roll", "move", "fold", "check", "call", "raise", "bet", "guess",
];
const BET_TYPES = ["straight", "red", "black", "odd", "even", "low", "high", "dozen", "column", "split", "", "__proto__"];

/** Mutate a real payload: keep its shape, swap fields for nasty values, add odd keys. */
function mutate(payload: unknown, rnd: () => number, pick: <T>(xs: T[]) => T): unknown {
  if (payload === null || typeof payload !== "object") return rnd() < 0.5 ? pick(NASTY) : payload;
  const out: Record<string, unknown> = { ...(payload as object) };
  for (const k of Object.keys(out)) {
    if (rnd() < 0.5) out[k] = k === "type" && rnd() < 0.7 ? pick(BET_TYPES) : pick(NASTY);
  }
  if (rnd() < 0.2) out[pick(["target", "amount", "token", "extra", "__proto__"])] = pick(NASTY);
  return out;
}

/** Game-specific invariants that must hold after any accepted move. */
function checkInvariants(id: string, state: any, where: string) {
  const isNum = (x: unknown) => typeof x === "number" && Number.isFinite(x);
  const walk = (v: unknown, path: string) => {
    if (typeof v === "number") expect(Number.isFinite(v), `${where}: ${path} is ${v}`).toBe(true);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(state, "state"); // no NaN or Infinity anywhere, e.g. from a "100" or 1e15 amount
  const chips = JSON.stringify(state).match(/"(chips|stack|balance|bank)":-\d/);
  expect(chips, `${where}: negative ${chips?.[1]}`).toBeNull();
  void isNum;
}

describe("rules fuzzing", () => {
  for (const g of GAMES) {
    for (const n of g.players) {
      it(`${g.id} with ${n} player(s) survives random and malformed intents`, async () => {
        const game = await loadGame(g.id);
        const stats = { tried: 0, accepted: 0 };
        for (let seed = 1; seed <= 12; seed++) {
          const chaos = createRng(seed * 7919);
          const pick = <T,>(xs: T[]) => xs[Math.floor(chaos() * xs.length)];
          const { rt, clock } = start(game, n, g.settings, seed);
          const aiRng = createRng(seed);
          const seen: { name: string; payload?: unknown }[] = []; // real AI moves, mutated below
          let steps = 0;
          while (!rt.over && steps++ < 4000) {
            // 1. chaos: a random intent from a random seat
            const seat = Math.floor(chaos() * n);
            const real = seen.length && chaos() < 0.7 ? pick(seen) : null;
            const raw = real ? { name: real.name, payload: mutate(real.payload, chaos, pick) } : { name: pick(NAMES), payload: pick(NASTY) };
            // as it arrives from a deck: through JSON (NaN becomes null, prototypes are plain, undefined drops out)
            const intent = JSON.parse(JSON.stringify(raw));
            const before = stateHash(rt.state);
            let r: { ok: boolean } | undefined;
            expect(() => (r = rt.submit(seat, intent as any, "human")), `${g.id} seed ${seed}: ${JSON.stringify(intent)}`).not.toThrow();
            stats.tried++;
            if (r?.ok) stats.accepted++;
            if (r && !r.ok) expect(stateHash(rt.state), `${g.id} seed ${seed}: rejected ${JSON.stringify(intent)} changed the state`).toBe(before);
            if (r?.ok) checkInvariants(g.id, rt.state, `${g.id} seed ${seed} after ${JSON.stringify(intent)}`);
            // 2. views stay buildable for everyone
            for (let s = 0; s < n; s++) expect(() => JSON.stringify(rt.view(s))).not.toThrow();
            expect(() => JSON.stringify(game.def.boardView(rt.state))).not.toThrow();
            // 3. progress: every AI seat proposes a move; otherwise time moves on
            let moved = false;
            for (let s = 0; s < n && !rt.over; s++) {
              const intent = rt.aiIntent(s, aiRng);
              if (!intent) continue;
              if (seen.length < 50) seen.push(intent);
              if (rt.submit(s, intent, "ai").ok) moved = true;
            }
            if (!moved && !rt.over && !clock.advance()) break;
          }
          expect(rt.over, `${g.id} seed ${seed} did not finish`).toBe(true);
          checkInvariants(g.id, rt.state, `${g.id} seed ${seed} at the end`);
          expect(expectReplay(game, rt), `${g.id} seed ${seed} replay`).toBe(true);
        }
        expect(stats.tried).toBeGreaterThan(30);
      }, 60_000);
    }
  }
});
