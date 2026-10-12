// Roulette rules. Everyone bets at the same time during a betting window; the wheel then spins
// (one seeded random draw), bets are settled, and after a short result display the next round starts.
import { defineGame, type GameContext, type Intent } from "../../packages/sdk/src/index.ts";
import { betKey, colorOf, PAYOUT, returnFor, validBet, type Bet, type BetType, type Color } from "./wheel.ts";

export interface SeatResult {
  staked: number;
  returned: number;
  net: number;
}

export interface State {
  phase: "betting" | "result";
  round: number;
  rounds: number;
  minBet: number;
  maxBet: number;
  bettingMs: number;
  resultMs: number;
  startPoints: number;
  active: number[];
  names: Record<number, string>;
  balances: Record<number, number>;
  bets: Record<number, Bet[]>;
  done: Record<number, boolean>;
  last: { round: number; number: number; color: Color; results: Record<number, SeatResult> } | null;
  history: number[];
  biggestWin: { seat: number; amount: number } | null;
  over: boolean;
}

const total = (bets: Bet[] = []) => bets.reduce((a, b) => a + b.amount, 0);

/** Seats that can still act this round: they have bets or enough points to place one. */
function canPlay(s: State, seat: number) {
  return s.active.includes(seat) && (s.balances[seat] >= s.minBet || (s.bets[seat]?.length ?? 0) > 0);
}

function openBetting(s: State, ctx: GameContext): State {
  ctx.setTimer("betting", s.bettingMs);
  return { ...s, phase: "betting", bets: {}, done: {} };
}

function allDone(s: State) {
  const playing = s.active.filter((seat) => canPlay(s, seat));
  return playing.length > 0 && playing.every((seat) => s.done[seat]);
}

function spin(s: State, ctx: GameContext) {
  ctx.clearTimer("betting");
  const number = ctx.randomInt(0, 36);
  const balances = { ...s.balances };
  const results: Record<number, SeatResult> = {};
  let biggestWin = s.biggestWin;
  for (const seat of s.active) {
    const bets = s.bets[seat] ?? [];
    const staked = total(bets);
    const returned = bets.reduce((a, b) => a + returnFor(b, number), 0);
    balances[seat] += returned;
    results[seat] = { staked, returned, net: returned - staked };
    if (returned - staked > 0 && (!biggestWin || returned - staked > biggestWin.amount)) biggestWin = { seat, amount: returned - staked };
  }
  ctx.setTimer("next", s.resultMs);
  const next: State = { ...s, phase: "result", balances, last: { round: s.round, number, color: colorOf(number), results }, history: [...s.history, number], biggestWin };
  return { state: next, events: [{ name: "betsClosed" }, { name: "wheelSpun", data: { number, color: colorOf(number) } }, { name: "settled", data: results }] };
}

function nextRound(s: State, ctx: GameContext) {
  const anyoneCanBet = s.active.some((seat) => s.balances[seat] >= s.minBet);
  if (s.round >= s.rounds || !anyoneCanBet) return { state: { ...s, over: true }, events: [{ name: "gameOver" }] };
  return { state: openBetting({ ...s, round: s.round + 1 }, ctx), events: [{ name: "bettingOpen", data: { round: s.round + 1 } }] };
}

export default defineGame<State>({
  setup(ctx, settings) {
    const seats = ctx.seats.map((x) => x.seat);
    const start = Number(settings.startPoints ?? 1000);
    const s: State = {
      phase: "betting",
      round: 1,
      rounds: Number(settings.rounds ?? 10),
      minBet: Number(settings.minBet ?? 10),
      maxBet: Math.max(Number(settings.maxBet ?? 1000), Number(settings.minBet ?? 10)),
      bettingMs: Number(settings.bettingSeconds ?? 25) * 1000,
      resultMs: Number(settings.resultSeconds ?? 7) * 1000,
      startPoints: start,
      active: seats,
      names: Object.fromEntries(ctx.seats.map((x) => [x.seat, x.name])),
      balances: Object.fromEntries(seats.map((x) => [x, start])),
      bets: {},
      done: {},
      last: null,
      history: [],
      biggestWin: null,
      over: false,
    };
    return openBetting(s, ctx);
  },

  onIntent(s, seat, intent, ctx) {
    if (s.over) return { reject: "the game is over" };
    if (!s.active.includes(seat)) return { reject: "you are not at this table" };
    if (s.phase !== "betting") return { reject: "no more bets" };
    const p = (intent.payload ?? {}) as { type?: BetType; target?: number; amount?: number };
    const mine = s.bets[seat] ?? [];

    switch (intent.name) {
      case "placeBet": {
        if (s.done[seat]) return { reject: "you already finished betting this round" };
        const err = validBet(p.type, p.target);
        if (err) return { reject: err };
        const amount = Number(p.amount);
        if (!Number.isInteger(amount) || amount < s.minBet) return { reject: `minimum bet is ${s.minBet}` };
        if (amount > s.balances[seat]) return { reject: "not enough points" };
        const key = betKey({ type: p.type!, target: p.target });
        const existing = mine.find((b) => betKey(b) === key);
        if ((existing?.amount ?? 0) + amount > s.maxBet) return { reject: `maximum ${s.maxBet} per spot` };
        const bets = existing
          ? mine.map((b) => (b === existing ? { ...b, amount: b.amount + amount } : b))
          : [...mine, { type: p.type!, ...(p.target === undefined || p.target === null ? {} : { target: p.target }), amount }];
        const next = { ...s, bets: { ...s.bets, [seat]: bets }, balances: { ...s.balances, [seat]: s.balances[seat] - amount } };
        return { state: next, events: [{ name: "betPlaced", data: { seat, type: p.type, target: p.target, amount } }] };
      }
      case "clearBets": {
        if (s.done[seat]) return { reject: "you already finished betting this round" };
        if (!mine.length) return { reject: "no bets to clear" };
        const next = { ...s, bets: { ...s.bets, [seat]: [] }, balances: { ...s.balances, [seat]: s.balances[seat] + total(mine) } };
        return { state: next, events: [{ name: "betsCleared", data: { seat } }] };
      }
      case "done": {
        if (s.done[seat]) return { reject: "already done" };
        const next = { ...s, done: { ...s.done, [seat]: true } };
        if (allDone(next)) {
          const r = spin(next, ctx);
          return { state: r.state, events: [{ name: "playerDone", data: { seat } }, ...r.events] };
        }
        return { state: next, events: [{ name: "playerDone", data: { seat } }] };
      }
      default:
        return { reject: `unknown action ${intent.name}` };
    }
  },

  onTimer(s, id, ctx) {
    if (s.over) return { state: s };
    if (id === "betting" && s.phase === "betting") return spin(s, ctx);
    if (id === "next" && s.phase === "result") return nextRound(s, ctx);
    return { state: s };
  },

  onSeatJoined(s, seat) {
    if (s.active.includes(seat.seat)) return { state: s };
    return {
      state: {
        ...s,
        active: [...s.active, seat.seat],
        names: { ...s.names, [seat.seat]: seat.name },
        balances: { ...s.balances, [seat.seat]: s.startPoints },
      },
      events: [{ name: "playerJoined", data: { seat: seat.seat } }],
    };
  },

  onSeatLeft(s, seat, ctx) {
    const active = s.active.filter((x) => x !== seat);
    if (!active.length) return "end";
    const bets = { ...s.bets };
    delete bets[seat];
    const next = { ...s, active, bets };
    if (s.phase === "betting" && allDone(next)) return spin(next, ctx);
    return { state: next, events: [{ name: "playerLeft", data: { seat } }] };
  },

  view(s, seat) {
    const mine = s.bets[seat] ?? [];
    return {
      phase: s.phase,
      round: s.round,
      rounds: s.rounds,
      minBet: s.minBet,
      maxBet: s.maxBet,
      balance: s.balances[seat] ?? 0,
      staked: total(mine),
      myBets: mine,
      myDone: !!s.done[seat],
      canBet: s.phase === "betting" && !s.done[seat] && (s.balances[seat] ?? 0) >= s.minBet,
      last: s.last ? { round: s.last.round, number: s.last.number, color: s.last.color, mine: s.last.results[seat] ?? null } : null,
      history: s.history.slice(-12),
      over: s.over,
    };
  },

  // Chips on a roulette table are public, so the board shows everyone's bets.
  boardView(s) {
    return {
      phase: s.phase,
      round: s.round,
      rounds: s.rounds,
      seats: s.active.map((seat) => ({ seat, name: s.names[seat], balance: s.balances[seat], staked: total(s.bets[seat]), done: !!s.done[seat] })),
      bets: s.active.flatMap((seat) => (s.bets[seat] ?? []).map((b) => ({ seat, ...b }))),
      last: s.last,
      history: s.history.slice(-12),
      over: s.over,
    };
  },

  isOver(s) {
    if (!s.over) return null;
    const ranked = [...s.active].sort((a, b) => s.balances[b] - s.balances[a]);
    const best = s.balances[ranked[0]];
    const winners = ranked.filter((x) => s.balances[x] === best).map((x) => s.names[x]);
    const net = Object.fromEntries(s.active.map((x) => [s.names[x], s.balances[x] - s.startPoints]));
    return {
      text: winners.length === 1 ? `${winners[0]} wins with ${best} points.` : `${winners.join(" and ")} tie with ${best} points.`,
      highlights: {
        winners,
        balances: Object.fromEntries(s.active.map((x) => [s.names[x], s.balances[x]])),
        net,
        spins: s.history,
        biggestWin: s.biggestWin ? { name: s.names[s.biggestWin.seat], amount: s.biggestWin.amount } : null,
      },
    };
  },

  ai(view, _seat, ctx, options) {
    const v = view as { phase: string; canBet: boolean; myBets: Bet[]; balance: number; minBet: number; maxBet: number; round: number; myDone: boolean };
    if (v.phase !== "betting" || v.myDone) return null;
    const style = String(options.style ?? "conservative");
    const target = style === "conservative" ? 1 : style === "aggressive" ? 3 : 1 + ctx.randomInt(0, 3);
    if (!v.canBet || v.myBets.length >= target) return { name: "done" };
    const pct = style === "conservative" ? 0.03 : style === "aggressive" ? 0.12 : 0.02 + ctx.random() * 0.2;
    const amount = Math.max(v.minBet, Math.min(v.maxBet, v.balance, Math.round((v.balance * pct) / v.minBet) * v.minBet));
    if (amount > v.balance) return { name: "done" };
    const outside: BetType[] = ["red", "black", "odd", "even", "low", "high"];
    const pick = (): Intent => {
      if (style === "conservative") return { name: "placeBet", payload: { type: outside[ctx.randomInt(0, 5)], amount } };
      const r = ctx.random();
      if (r < 0.35) return { name: "placeBet", payload: { type: "straight", target: ctx.randomInt(0, 36), amount } };
      if (r < 0.7) return { name: "placeBet", payload: { type: ctx.random() < 0.5 ? "dozen" : "column", target: ctx.randomInt(1, 3), amount } };
      return { name: "placeBet", payload: { type: outside[ctx.randomInt(0, 5)], amount } };
    };
    return pick();
  },
});

export { PAYOUT };
