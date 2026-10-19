// Roulette rules. Everyone bets at the same time during a betting window; the wheel then spins
// (one seeded random draw), bets are settled, and after a short result display the next round starts.
import { count, defineGame, list, mostAward, type GameAward, type GameContext } from "../../packages/sdk/src/index.ts";
import { betKey, colorOf, returnFor, validBet, type Bet, type BetType, type Color } from "./wheel.ts";

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
  /** Per seat, for the statistics window (D-150). */
  stats: Record<number, SeatStats>;
  over: boolean;
}

/** What a player did over the game, counted as each spin is settled (D-150). */
export interface SeatStats {
  /** Bets placed, by type (a top-up on a spot counts once). */
  byType: Partial<Record<BetType, number>>;
  /** Single-number bets that hit. */
  hits: number;
  /** Bets on zero. */
  zero: number;
  /** Points put on the table over the game. */
  staked: number;
  /** Spins the player bet on, and those that came out ahead. */
  played: number;
  won: number;
  /** The current and longest run of spins won in a row. */
  streak: number;
  bestStreak: number;
  /** The biggest gain on one spin. */
  biggest: number;
  /** Spins sat out without a bet. */
  sitOut: number;
}
const noStats = (): SeatStats => ({ byType: {}, hits: 0, zero: 0, staked: 0, played: 0, won: 0, streak: 0, bestStreak: 0, biggest: 0, sitOut: 0 });

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
  const stats = { ...s.stats };
  for (const seat of s.active) {
    const bets = s.bets[seat] ?? [];
    const staked = total(bets);
    const returned = bets.reduce((a, b) => a + returnFor(b, number), 0);
    balances[seat] += returned;
    results[seat] = { staked, returned, net: returned - staked };
    if (returned - staked > 0 && (!biggestWin || returned - staked > biggestWin.amount)) biggestWin = { seat, amount: returned - staked };
    stats[seat] = tally(stats[seat] ?? noStats(), bets, number, returned - staked);
  }
  ctx.setTimer("next", s.resultMs);
  const next: State = { ...s, phase: "result", balances, last: { round: s.round, number, color: colorOf(number), results }, history: [...s.history, number], biggestWin, stats };
  return { state: next, events: [{ name: "betsClosed" }, { name: "wheelSpun", data: { number, color: colorOf(number) } }, { name: "settled", data: results }] };
}

/** One spin added to a player's statistics. */
function tally(st: SeatStats, bets: Bet[], number: number, net: number): SeatStats {
  if (!bets.length) return { ...st, sitOut: st.sitOut + 1 };
  const byType = { ...st.byType };
  for (const b of bets) byType[b.type] = (byType[b.type] ?? 0) + 1;
  const streak = net > 0 ? st.streak + 1 : 0;
  return {
    byType,
    hits: st.hits + bets.filter((b) => b.type === "straight" && b.target === number).length,
    zero: st.zero + bets.filter((b) => b.type === "straight" && b.target === 0).length,
    staked: st.staked + total(bets),
    played: st.played + 1,
    won: st.won + (net > 0 ? 1 : 0),
    streak,
    bestStreak: Math.max(st.bestStreak, streak),
    biggest: Math.max(st.biggest, net),
    sitOut: st.sitOut,
  };
}

/** The longest run of one colour in the spins, and where it ended. */
function longestRun(history: number[], color: Color) {
  let best = 0, run = 0;
  for (const n of history) {
    run = colorOf(n) === color ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** Facts about the wheel itself over the game (D-150): runs, zeros, the number that came up most. */
function spinFacts(history: number[]) {
  const freq = new Map<number, number>();
  for (const n of history) freq.set(n, (freq.get(n) ?? 0) + 1);
  const most = Math.max(0, ...freq.values());
  const hottest = [...freq].filter(([, c]) => c === most).map(([n]) => n).sort((a, b) => a - b);
  return {
    spins: history.length,
    longestRed: longestRun(history, "red"),
    longestBlack: longestRun(history, "black"),
    zeros: freq.get(0) ?? 0,
    reds: history.filter((n) => colorOf(n) === "red").length,
    blacks: history.filter((n) => colorOf(n) === "black").length,
    hottest: most >= 2 ? { numbers: hottest, times: most } : null,
    neverHit: 37 - freq.size,
  };
}

function factsText(f: ReturnType<typeof spinFacts>) {
  if (!f.spins) return "";
  const parts = [`${f.reds} red, ${f.blacks} black`];
  if (f.longestRed >= 2) parts.push(`longest red streak ${f.longestRed}`);
  if (f.longestBlack >= 2) parts.push(`longest black streak ${f.longestBlack}`);
  parts.push(f.zeros ? `zero came up ${f.zeros === 1 ? "once" : `${f.zeros} times`}` : "no zero");
  if (f.hottest) parts.push(`hottest number ${list(f.hottest.numbers.map(String))} (${f.hottest.times}×)`);
  return ` Over ${count(f.spins, "spin")}: ${parts.join(", ")}.`;
}

/** The statistics window's awards (D-150); one that nobody or everybody would get is left out by the SDK and host. */
function awardsOf(s: State): GameAward[] {
  const st = (seat: number) => s.stats[seat] ?? noStats();
  const by = (f: (x: SeatStats) => number) => s.active.map((seat) => ({ seat, score: f(st(seat)) }));
  const t = (type: BetType) => (x: SeatStats) => x.byType[type] ?? 0;
  const bets = (n: number) => count(n, "bet");
  return [
    mostAward({ id: "high-roller", icon: "💎", title: "High Roller", blurb: "Put the most points on the table." }, by((x) => x.staked), (n) => `${n} points staked`),
    mostAward({ id: "big-win", icon: "💰", title: "Jackpot", blurb: "Won the most on a single spin." }, by((x) => x.biggest), (n) => `+${n} on one spin`),
    mostAward({ id: "bullseye", icon: "🎯", title: "Bullseye", blurb: "Hit a single number the most." }, by((x) => x.hits), (n) => count(n, "hit")),
    mostAward({ id: "hot-hand", icon: "🔥", title: "Hot Hand", blurb: "Won the most spins in a row." }, by((x) => x.bestStreak), (n) => `${n} in a row`),
    mostAward({ id: "lucky", icon: "🍀", title: "Lucky Charm", blurb: "Came out ahead on the most spins." }, by((x) => x.won), (n) => count(n, "spin")),
    mostAward({ id: "number-cruncher", icon: "🔢", title: "Number Cruncher", blurb: "Bet on single numbers the most." }, by(t("straight")), bets),
    mostAward({ id: "zero-hero", icon: "🟢", title: "Zero Hero", blurb: "Trusted the zero the most." }, by((x) => x.zero), bets),
    mostAward({ id: "odd-man", icon: "🦄", title: "Odd Man", blurb: "Bet on odd the most." }, by(t("odd")), bets),
    mostAward({ id: "even-steven", icon: "⚖️", title: "Even Steven", blurb: "Bet on even the most." }, by(t("even")), bets),
    mostAward({ id: "seeing-red", icon: "🌹", title: "Seeing Red", blurb: "Bet on red the most." }, by(t("red")), bets),
    mostAward({ id: "night-owl", icon: "🦉", title: "Night Owl", blurb: "Bet on black the most." }, by(t("black")), bets),
    mostAward({ id: "low-rider", icon: "🐢", title: "Low Rider", blurb: "Bet on 1 to 18 the most." }, by(t("low")), bets),
    mostAward({ id: "high-flyer", icon: "🦅", title: "High Flyer", blurb: "Bet on 19 to 36 the most." }, by(t("high")), bets),
    mostAward({ id: "by-the-dozen", icon: "🥚", title: "By the Dozen", blurb: "Bet on dozens and columns the most." }, by((x) => t("dozen")(x) + t("column")(x)), bets),
    mostAward({ id: "wallflower", icon: "🪴", title: "Wallflower", blurb: "Sat out the most spins." }, by((x) => x.sitOut), (n) => count(n, "spin")),
  ].filter((a): a is GameAward => a !== null);
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
      stats: {},
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

  // Another player took over the seat (D-159): the balance and bets stay, the name changes.
  onSeatChanged(s, seat) {
    return { state: { ...s, names: { ...s.names, [seat.seat]: seat.name } } };
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
    const facts = spinFacts(s.history);
    const st = (seat: number) => s.stats?.[seat] ?? noStats();
    return {
      text: (winners.length === 1 ? `${winners[0]} wins with ${count(best, "point")}.` : `${list(winners)} tie with ${count(best, "point")}.`) + factsText(facts),
      table: {
        columns: ["Player", "Points", "Net", "Bets", "Spins won", "Biggest win", "Best streak"],
        rows: ranked.map((x) => {
          const t = st(x);
          const placed = Object.values(t.byType).reduce((a, b) => a + (b ?? 0), 0);
          const net = s.balances[x] - s.startPoints;
          return [s.names[x], s.balances[x], `${net > 0 ? "+" : ""}${net}`, placed, `${t.won} of ${t.played}`, t.biggest ? `+${t.biggest}` : "–", t.bestStreak];
        }),
      },
      awards: awardsOf(s),
      highlights: {
        facts,
        winners,
        balances: Object.fromEntries(s.active.map((x) => [s.names[x], s.balances[x]])),
        net,
        spins: s.history,
        biggestWin: s.biggestWin ? { name: s.names[s.biggestWin.seat], amount: s.biggestWin.amount } : null,
      },
    };
  },

  // Every AI has a pet outside bet and a lucky number, from its seat, so players differ (and the awards with them).
  ai(view, seat, ctx, options) {
    const v = view as { phase: string; canBet: boolean; myBets: Bet[]; balance: number; minBet: number; maxBet: number; round: number; myDone: boolean };
    if (v.phase !== "betting" || v.myDone) return null;
    const style = String(options.style ?? "conservative");
    const target = style === "conservative" ? 1 : style === "aggressive" ? 3 : 1 + ctx.randomInt(0, 3);
    if (!v.canBet || v.myBets.length >= target) return { name: "done" };
    const pct = style === "conservative" ? 0.03 : style === "aggressive" ? 0.12 : 0.02 + ctx.random() * 0.2;
    const amount = Math.max(v.minBet, Math.min(v.maxBet, v.balance, Math.round((v.balance * pct) / v.minBet) * v.minBet));
    if (amount > v.balance) return { name: "done" };
    const outside: BetType[] = ["red", "black", "odd", "even", "low", "high"];
    const pet = outside[seat % outside.length];
    const lucky = (seat * 7 + 11) % 37;
    const outsideBet = () => ({ name: "placeBet", payload: { type: ctx.random() < 0.5 ? pet : outside[ctx.randomInt(0, 5)], amount } });
    const numberBet = (stake: number) => ({ name: "placeBet", payload: { type: "straight", target: ctx.random() < 0.4 ? lucky : ctx.randomInt(0, 36), amount: stake } });
    const groupBet = () => ({ name: "placeBet", payload: { type: ctx.random() < 0.5 ? "dozen" : "column", target: ctx.randomInt(1, 3), amount } });
    const r = ctx.random();
    if (style === "conservative") {
      // Mostly even money, now and then a dozen or a small flutter on a number.
      if (r < 0.12) return numberBet(v.minBet);
      if (r < 0.3) return groupBet();
      return outsideBet();
    }
    if (r < 0.4) return numberBet(amount);
    if (r < 0.7) return groupBet();
    return outsideBet();
  },
});
