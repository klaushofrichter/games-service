// Pachisi (a Ludo-style race). The track is the 40-cell rim of an 11 × 11 grid. Each player owns
// one side: they enter the track just after their side's midpoint, go once around, and turn into
// their 4-cell home column at that midpoint. Progress per token: -1 = in base, 0–39 = on the track,
// 40–43 = home column, 44 = finished.
import { defineGame, type GameContext, type SeatInfo } from "../../packages/sdk/src/index.ts";

export const TRACK = 40;
export const FINISH = 44;
export const startCell = (side: number) => side * 10 + 6;
/** Absolute track cell for a token on the track, or null in base / home column. */
export const cellOf = (side: number, p: number) => (p >= 0 && p < TRACK ? (startCell(side) + p) % TRACK : null);
export const SAFE = new Set([6, 16, 26, 36]);

interface Player {
  seat: number;
  name: string;
  side: number; // 0 top, 1 right, 2 bottom, 3 left (clockwise)
  tokens: number[];
  captures: number;
  captured: number;
}

export interface State {
  phase: "roll" | "move";
  order: number[]; // seats in clockwise side order
  turn: number; // seat whose turn it is
  die: number | null;
  sixes: number;
  players: Record<number, Player>;
  turnMs: number;
  turns: number;
  lastMove: { seat: number; token: number; from: number; to: number; captured: { seat: number; token: number }[] } | null;
  winner: number | null;
  over: boolean;
}

/**
 * Give each seat a side of the board, matching where they sit (south seats get the bottom first). Two players always
 * get opposite sides (D-107): on neighbouring sides one player's start lies just ahead of the other's, which is unfair.
 * Of the two opposite pairings (top/bottom, left/right) and who gets which end, the one closest to where they sit wins.
 */
export function assignSides(seats: SeatInfo[]): Record<number, number> {
  const prefs: Record<string, number[]> = { south: [2, 1, 3, 0], north: [0, 3, 1, 2], east: [1, 0, 2, 3], west: [3, 2, 0, 1] };
  if (seats.length === 2) {
    const [a, b] = [...seats].sort((x, y) => x.seat - y.seat);
    const rank = (s: SeatInfo, side: number) => (prefs[s.edge ?? "south"] ?? prefs.south).indexOf(side);
    let best = [2, 0];
    let cost = Infinity;
    for (const side of [2, 0, 1, 3]) {
      const c = rank(a, side) + rank(b, (side + 2) % 4);
      if (c < cost) [best, cost] = [[side, (side + 2) % 4], c];
    }
    return { [a.seat]: best[0], [b.seat]: best[1] };
  }
  const used = new Set<number>();
  const out: Record<number, number> = {};
  for (const s of [...seats].sort((a, b) => a.seat - b.seat)) {
    const side = (prefs[s.edge ?? "south"] ?? prefs.south).find((x) => !used.has(x))!;
    used.add(side);
    out[s.seat] = side;
  }
  return out;
}

export function legalMoves(s: State, seat: number, die: number): number[] {
  const p = s.players[seat];
  if (!p) return [];
  return p.tokens.flatMap((pos, i) => {
    if (pos === -1) return die === 6 ? [i] : [];
    if (pos === FINISH) return [];
    return pos + die <= FINISH ? [i] : [];
  });
}

function nextTurn(s: State, ctx: GameContext, again = false): State {
  const idx = s.order.indexOf(s.turn);
  const turn = again ? s.turn : s.order[(idx + 1) % s.order.length];
  return startTurn({ ...s, turn, sixes: again ? s.sixes : 0, turns: again ? s.turns : s.turns + 1 }, ctx);
}

function startTurn(s: State, ctx: GameContext): State {
  if (s.turnMs > 0) ctx.setTimer("turn", s.turnMs);
  return { ...s, phase: "roll", die: null };
}

function doRoll(s: State, seat: number, ctx: GameContext) {
  const die = ctx.randomInt(1, 6);
  const sixes = die === 6 ? s.sixes + 1 : 0;
  const events = [{ name: "rolled", data: { seat, die } }];
  if (sixes === 3) {
    // Three sixes in a row forfeit the turn.
    return { state: nextTurn({ ...s, die }, ctx), events: [...events, { name: "threeSixes", data: { seat } }] };
  }
  const legal = legalMoves(s, seat, die);
  if (!legal.length) return { state: nextTurn({ ...s, die, sixes }, ctx), events: [...events, { name: "noMove", data: { seat } }] };
  if (s.turnMs > 0) ctx.setTimer("turn", s.turnMs);
  return { state: { ...s, phase: "move" as const, die, sixes }, events };
}

function doMove(s: State, seat: number, token: number, ctx: GameContext) {
  const die = s.die!;
  const me = s.players[seat];
  const from = me.tokens[token];
  const to = from === -1 ? 0 : from + die;
  const players: Record<number, Player> = Object.fromEntries(Object.entries(s.players).map(([k, v]) => [k, { ...v, tokens: [...v.tokens] }]));
  players[seat].tokens[token] = to;
  const captured: { seat: number; token: number }[] = [];
  const cell = cellOf(me.side, to);
  if (cell !== null && !SAFE.has(cell)) {
    for (const other of Object.values(players)) {
      if (other.seat === seat) continue;
      other.tokens.forEach((pos, i) => {
        if (cellOf(other.side, pos) === cell) {
          other.tokens[i] = -1;
          other.captured++;
          captured.push({ seat: other.seat, token: i });
        }
      });
    }
    players[seat].captures += captured.length;
  }
  const lastMove = { seat, token, from, to, captured };
  const events = [{ name: "moved", data: lastMove }];
  let next: State = { ...s, players, lastMove };
  if (players[seat].tokens.every((x) => x === FINISH)) {
    ctx.clearTimer("turn");
    return { state: { ...next, winner: seat, over: true }, events: [...events, { name: "won", data: { seat } }] };
  }
  next = nextTurn(next, ctx, die === 6);
  return { state: next, events };
}

/** The move an automatic player (AI or timeout) makes. */
export function chooseMove(s: State, seat: number, legal: number[], level: string, random: () => number): number {
  if (level === "beginner") return legal[Math.floor(random() * legal.length)];
  const me = s.players[seat];
  let best = legal[0];
  let bestScore = -Infinity;
  for (const i of legal) {
    const from = me.tokens[i];
    const to = from === -1 ? 0 : from + s.die!;
    const cell = cellOf(me.side, to);
    let score = to / 10;
    if (to === FINISH) score += 100;
    if (from === -1) score += 60;
    if (from < TRACK && to >= TRACK) score += 40;
    if (cell !== null && SAFE.has(cell)) score += 15;
    if (cell !== null && !SAFE.has(cell)) {
      for (const o of Object.values(s.players)) if (o.seat !== seat && o.tokens.some((pos) => cellOf(o.side, pos) === cell)) score += 80;
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

const where = (p: number) => (p === -1 ? "base" : p === FINISH ? "home" : p >= TRACK ? `home column ${p - TRACK + 1}` : `step ${p + 1}`);

const publicPlayers = (s: State) => Object.values(s.players).map((p) => ({ seat: p.seat, name: p.name, side: p.side, tokens: p.tokens }));

export default defineGame<State>({
  setup(ctx, settings) {
    const n = Number(settings.tokens ?? 4);
    const sides = assignSides(ctx.seats);
    const players: Record<number, Player> = {};
    for (const s of ctx.seats) players[s.seat] = { seat: s.seat, name: s.name, side: sides[s.seat], tokens: Array(n).fill(-1), captures: 0, captured: 0 };
    const order = ctx.seats.map((s) => s.seat).sort((a, b) => players[a].side - players[b].side);
    // The player who sits at the bottom of the board (usually the first south seat) starts.
    const first = order.reduce((a, b) => (players[b].side === 2 ? b : a), order[0]);
    const s: State = { phase: "roll", order, turn: first, die: null, sixes: 0, players, turnMs: Number(settings.turnSeconds ?? 30) * 1000, turns: 1, lastMove: null, winner: null, over: false };
    return startTurn(s, ctx);
  },

  onIntent(s, seat, intent, ctx) {
    if (s.over) return { reject: "the game is over" };
    if (seat !== s.turn) return { reject: `it is ${s.players[s.turn].name}'s turn` };
    if (intent.name === "roll") {
      if (s.phase !== "roll") return { reject: "choose a token to move first" };
      return doRoll(s, seat, ctx);
    }
    if (intent.name === "move") {
      if (s.phase !== "move") return { reject: "roll the die first" };
      const token = Number((intent.payload as { token?: number })?.token);
      if (!legalMoves(s, seat, s.die!).includes(token)) return { reject: "that token cannot move" };
      return doMove(s, seat, token, ctx);
    }
    return { reject: `unknown action ${intent.name}` };
  },

  // A player who takes too long gets an automatic roll and the best move.
  onTimer(s, id, ctx) {
    if (id !== "turn" || s.over) return { state: s };
    if (s.phase === "roll") return doRoll(s, s.turn, ctx);
    const legal = legalMoves(s, s.turn, s.die!);
    return doMove(s, s.turn, chooseMove(s, s.turn, legal, "average", ctx.random), ctx);
  },

  onSeatLeft(s, seat, ctx) {
    if (!s.players[seat]) return { state: s };
    const order = s.order.filter((x) => x !== seat);
    if (order.length < 2) {
      const winner = order[0];
      ctx.clearTimer("turn");
      return { state: { ...s, order, winner: winner ?? null, over: true }, events: [{ name: "won", data: { seat: winner, byDefault: true } }] };
    }
    const players = { ...s.players };
    delete players[seat];
    let next: State = { ...s, order, players };
    if (s.turn === seat) {
      const idx = s.order.indexOf(seat);
      next = startTurn({ ...next, turn: s.order[(idx + 1) % s.order.length], sixes: 0 }, ctx);
    }
    return { state: next, events: [{ name: "playerLeft", data: { seat } }] };
  },

  view(s, seat) {
    const me = s.players[seat];
    const myTurn = s.turn === seat && !s.over;
    return {
      phase: s.phase,
      turnName: s.players[s.turn]?.name,
      myTurn,
      die: s.die,
      legal: myTurn && s.phase === "move" ? legalMoves(s, seat, s.die!) : [],
      tokens: me?.tokens ?? [],
      where: (me?.tokens ?? []).map(where),
      winner: s.winner === null ? null : s.players[s.winner]?.name ?? null,
      over: s.over,
      players: publicPlayers(s),
    };
  },

  boardView(s) {
    return {
      phase: s.phase,
      turn: s.turn,
      die: s.die,
      players: publicPlayers(s),
      lastMove: s.lastMove,
      winner: s.winner,
      over: s.over,
    };
  },

  isOver(s) {
    if (!s.over) return null;
    const w = s.winner === null ? null : s.players[s.winner];
    return {
      text: w ? `${w.name} brings every token home and wins.` : "The game ended without a winner.",
      highlights: {
        winner: w?.name ?? null,
        turns: s.turns,
        players: Object.values(s.players).map((p) => ({ name: p.name, home: p.tokens.filter((x) => x === FINISH).length, captures: p.captures, captured: p.captured })),
      },
    };
  },

  // Pachisi has no hidden information, so the seat view carries the whole board and the AI can use
  // the same heuristic as the turn timer.
  ai(view, seat, ctx, options) {
    const v = view as { myTurn: boolean; phase: string; legal: number[]; die: number; players: Player[] };
    if (!v.myTurn) return null;
    if (v.phase === "roll") return { name: "roll" };
    if (!v.legal.length) return null;
    const s = { die: v.die, players: Object.fromEntries(v.players.map((p) => [p.seat, p])) } as unknown as State;
    return { name: "move", payload: { token: chooseMove(s, seat, v.legal, String(options.level ?? "average"), ctx.random) } };
  },
});
