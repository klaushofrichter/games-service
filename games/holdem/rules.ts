// Fixed-limit Texas Hold'em. Hole cards and the deck never leave the host except to their owner;
// the board shows shared cards, bets and the pot, and reveals hands only at showdown.
import { count, defineGame, list, mostAward, type GameAward, type GameContext, type GameEvent } from "../../packages/sdk/src/index.ts";
import { bestHand, compareScores, newDeck, rankOf, shuffle, suitOf, type Card } from "../../packages/sdk/src/cards.ts";

export const STREETS = ["preflop", "flop", "turn", "river"] as const;

export interface Winner {
  seat: number;
  amount: number;
  hand: string | null;
}

export interface State {
  phase: "betting" | "handOver";
  street: number;
  hand: number;
  hands: number;
  smallBet: number;
  turnMs: number;
  nextMs: number;
  seats: number[]; // seated players, in seat order (clockwise)
  names: Record<number, string>;
  stacks: Record<number, number>;
  dealer: number;
  deck: Card[];
  holes: Record<number, Card[]>;
  board: Card[];
  dealt: number[]; // players in this hand
  inHand: number[]; // dealt and not folded
  allIn: Record<number, boolean>;
  contrib: Record<number, number>; // put into the pot this hand
  roundBet: Record<number, number>; // put in on this street
  currentBet: number;
  bets: number; // bets and raises on this street (capped at 4)
  needToAct: number[];
  toAct: number | null;
  lastAction: { seat: number; action: string; amount: number } | null;
  result: { winners: Winner[]; shown: Record<number, Card[]>; byFold: boolean } | null;
  over: boolean;
  /** Counted during the game for the statistics window (D-136). */
  stats: Record<number, SeatStats>;
}

export interface SeatStats {
  peak: number; // most points held at once
  biggestPot: number; // the most won in one hand
  handsWon: number;
  raises: number; // bets and raises
  folds: number;
  allIns: number;
  bestHand: { score: number[]; name: string } | null; // the best hand shown at a showdown
}
const noStats = (points: number): SeatStats => ({ peak: points, biggestPot: 0, handsWon: 0, raises: 0, folds: 0, allIns: 0, bestHand: null });

const sum = (r: Record<number, number>) => Object.values(r).reduce((a, b) => a + b, 0);
const betSize = (s: State) => (s.street < 2 ? s.smallBet : s.smallBet * 2);
export const pot = (s: State) => sum(s.contrib);

/** Next seat clockwise after `from` that satisfies `ok`. */
function nextSeat(s: State, from: number, ok: (seat: number) => boolean): number | null {
  const order = s.seats;
  const start = order.indexOf(from);
  for (let k = 1; k <= order.length; k++) {
    const seat = order[(start + k + order.length) % order.length];
    if (ok(seat)) return seat;
  }
  return null;
}

function pay(s: State, seat: number, amount: number): number {
  const paid = Math.min(amount, s.stacks[seat]);
  s.stacks[seat] -= paid;
  s.roundBet[seat] = (s.roundBet[seat] ?? 0) + paid;
  s.contrib[seat] = (s.contrib[seat] ?? 0) + paid;
  if (s.stacks[seat] === 0 && !s.allIn[seat]) {
    s.allIn[seat] = true;
    if (paid > 0 && s.stats[seat]) s.stats[seat].allIns++;
  }
  return paid;
}

const clone = (s: State): State => ({
  ...s,
  stacks: { ...s.stacks },
  holes: { ...s.holes },
  allIn: { ...s.allIn },
  contrib: { ...s.contrib },
  roundBet: { ...s.roundBet },
  board: [...s.board],
  deck: [...s.deck],
  dealt: [...s.dealt],
  inHand: [...s.inHand],
  needToAct: [...s.needToAct],
  stats: Object.fromEntries(Object.entries(s.stats ?? {}).map(([k, v]) => [k, { ...v }])),
});

function startHand(prev: State, ctx: GameContext): { state: State; events: GameEvent[] } {
  const s = clone(prev);
  const players = s.seats.filter((x) => s.stacks[x] > 0);
  if (players.length < 2 || s.hand >= s.hands) return { state: { ...s, over: true, phase: "handOver", toAct: null }, events: [{ name: "gameOver" }] };
  s.hand += 1;
  s.dealer = s.hand === 1 ? players[0] : nextSeat(s, s.dealer, (x) => s.stacks[x] > 0)!;
  s.deck = shuffle(newDeck(), ctx.random);
  s.dealt = players;
  s.inHand = [...players];
  s.holes = {};
  s.board = [];
  s.allIn = {};
  s.contrib = {};
  s.roundBet = {};
  s.street = 0;
  s.result = null;
  s.lastAction = null;
  s.phase = "betting";
  // Deal two cards each, starting left of the dealer.
  let seat = s.dealer;
  for (let round = 0; round < 2; round++) {
    for (let k = 0; k < players.length; k++) {
      seat = nextSeat(s, seat, (x) => players.includes(x))!;
      (s.holes[seat] ??= []).push(s.deck.shift()!);
    }
  }
  const headsUp = players.length === 2;
  const sb = headsUp ? s.dealer : nextSeat(s, s.dealer, (x) => players.includes(x))!;
  const bb = nextSeat(s, sb, (x) => players.includes(x))!;
  pay(s, sb, Math.floor(s.smallBet / 2));
  pay(s, bb, s.smallBet);
  s.currentBet = s.smallBet;
  s.bets = 1;
  s.needToAct = players.filter((x) => !s.allIn[x]);
  const started = { name: "handStarted", data: { hand: s.hand, dealer: s.dealer, sb, bb } };
  // Blinds can put everyone (or all but one, already matched) all-in: deal the board and show down.
  const open = s.needToAct.filter((x) => (s.roundBet[x] ?? 0) < s.currentBet || s.needToAct.length > 1);
  if (!open.length) {
    const r = finishHand(s, ctx, false);
    return { state: r.state, events: [started, ...r.events] };
  }
  s.toAct = nextSeat(s, bb, (x) => s.needToAct.includes(x));
  if (s.turnMs > 0) ctx.setTimer("turn", s.turnMs);
  return { state: s, events: [started] };
}

function awardPots(s: State): Winner[] {
  // Side pots: one layer per distinct contribution level.
  const levels = [...new Set(Object.values(s.contrib))].filter((x) => x > 0).sort((a, b) => a - b);
  const won: Record<number, number> = {};
  const hands: Record<number, ReturnType<typeof bestHand>> = {};
  for (const x of s.inHand) hands[x] = bestHand([...s.holes[x], ...s.board]);
  for (const x of s.inHand) {
    const st = s.stats[x];
    if (st && (!st.bestHand || compareScores(hands[x].score, st.bestHand.score) > 0)) st.bestHand = { score: hands[x].score, name: hands[x].name };
  }
  let prev = 0;
  let lastWinners: number[] = [];
  for (const level of levels) {
    let amount = 0;
    for (const c of Object.values(s.contrib)) amount += Math.max(0, Math.min(c, level) - prev);
    const eligible = s.inHand.filter((x) => (s.contrib[x] ?? 0) >= level);
    let winners = lastWinners;
    if (eligible.length) {
      const best = eligible.reduce((b, x) => (compareScores(hands[x].score, hands[b].score) > 0 ? x : b), eligible[0]);
      winners = eligible.filter((x) => compareScores(hands[x].score, hands[best].score) === 0);
    }
    // Split evenly; odd chips go to the first winner left of the dealer.
    const n = s.seats.length;
    const leftOfDealer = (x: number) => (s.seats.indexOf(x) - s.seats.indexOf(s.dealer) - 1 + 2 * n) % n;
    const ordered = [...winners].sort((a, b) => leftOfDealer(a) - leftOfDealer(b));
    const share = Math.floor(amount / winners.length);
    ordered.forEach((w, i) => (won[w] = (won[w] ?? 0) + share + (i < amount - share * winners.length ? 1 : 0)));
    lastWinners = winners;
    prev = level;
  }
  for (const [seat, amount] of Object.entries(won)) s.stacks[Number(seat)] += amount;
  return Object.entries(won).map(([seat, amount]) => ({ seat: Number(seat), amount, hand: hands[Number(seat)]?.name ?? null }));
}

function finishHand(s: State, ctx: GameContext, byFold: boolean): { state: State; events: GameEvent[] } {
  ctx.clearTimer("turn");
  let winners: Winner[];
  const shown: Record<number, Card[]> = {};
  if (byFold) {
    const w = s.inHand[0];
    const amount = pot(s);
    s.stacks[w] += amount;
    winners = [{ seat: w, amount, hand: null }];
  } else {
    while (s.board.length < 5) s.board.push(s.deck.shift()!);
    winners = awardPots(s);
    for (const x of s.inHand) shown[x] = s.holes[x];
  }
  s.result = { winners, shown, byFold };
  for (const w of winners) {
    const st = s.stats[w.seat];
    if (!st) continue;
    st.handsWon++;
    st.biggestPot = Math.max(st.biggestPot, w.amount);
  }
  for (const x of s.seats) if (s.stats[x]) s.stats[x].peak = Math.max(s.stats[x].peak, s.stacks[x]);
  s.phase = "handOver";
  s.toAct = null;
  s.needToAct = [];
  ctx.setTimer("next", s.nextMs);
  return { state: s, events: [{ name: byFold ? "wonByFold" : "showdown", data: { winners, board: s.board } }] };
}

/** After an action: end the hand, move to the next street, or pass the turn. */
function advance(s: State, ctx: GameContext, events: GameEvent[]): { state: State; events: GameEvent[] } {
  if (s.inHand.length === 1) {
    const r = finishHand(s, ctx, true);
    return { state: r.state, events: [...events, ...r.events] };
  }
  s.needToAct = s.needToAct.filter((x) => s.inHand.includes(x) && !s.allIn[x]);
  if (s.needToAct.length) {
    s.toAct = nextSeat(s, s.toAct ?? s.dealer, (x) => s.needToAct.includes(x));
    if (s.turnMs > 0) ctx.setTimer("turn", s.turnMs);
    return { state: s, events };
  }
  // Street complete.
  const canStillBet = s.inHand.filter((x) => !s.allIn[x]).length;
  if (s.street === 3 || canStillBet <= 1) {
    const r = finishHand(s, ctx, false);
    return { state: r.state, events: [...events, ...r.events] };
  }
  s.street += 1;
  s.board.push(...s.deck.splice(0, s.street === 1 ? 3 : 1));
  s.roundBet = {};
  s.currentBet = 0;
  s.bets = 0;
  s.needToAct = s.inHand.filter((x) => !s.allIn[x]);
  s.toAct = nextSeat(s, s.dealer, (x) => s.needToAct.includes(x));
  if (s.turnMs > 0) ctx.setTimer("turn", s.turnMs);
  return { state: s, events: [...events, { name: "street", data: { street: STREETS[s.street], board: s.board } }] };
}

export function legalActions(s: State, seat: number) {
  if (s.phase !== "betting" || s.toAct !== seat) return null;
  const toCall = s.currentBet - (s.roundBet[seat] ?? 0);
  const stack = s.stacks[seat];
  const canRaise = s.bets < 4 && stack > toCall;
  return {
    fold: toCall > 0,
    check: toCall === 0,
    call: toCall > 0 ? Math.min(toCall, stack) : null,
    raise: canRaise ? Math.min(toCall + betSize(s), stack) : null,
    raiseKind: s.currentBet === 0 ? "bet" : "raise",
  };
}

function act(prev: State, seat: number, action: string, ctx: GameContext) {
  const legal = legalActions(prev, seat);
  if (!legal) return { reject: prev.phase !== "betting" ? "wait for the next hand" : `it is ${prev.names[prev.toAct!]}'s turn` };
  const s = clone(prev);
  const toCall = s.currentBet - (s.roundBet[seat] ?? 0);
  let amount = 0;
  switch (action) {
    case "fold":
      if (!legal.fold) return { reject: "nothing to call, you can check" };
      s.inHand = s.inHand.filter((x) => x !== seat);
      if (s.stats[seat]) s.stats[seat].folds++;
      break;
    case "check":
      if (!legal.check) return { reject: `${toCall} to call` };
      break;
    case "call":
      if (legal.call === null) return { reject: "nothing to call" };
      amount = pay(s, seat, toCall);
      break;
    case "raise":
    case "bet": {
      if (legal.raise === null) return { reject: s.bets >= 4 ? "betting is capped this round" : "not enough points to raise" };
      amount = pay(s, seat, toCall + betSize(s));
      if (s.stats[seat]) s.stats[seat].raises++;
      const now = s.roundBet[seat];
      if (now > s.currentBet) {
        const increase = now - s.currentBet;
        s.currentBet = now;
        if (increase * 2 >= betSize(s)) {
          // A full raise (or an all-in of at least half a bet): it counts toward the cap and
          // everyone else still in the hand must answer it.
          s.bets += 1;
          s.needToAct = s.inHand.filter((x) => x !== seat && !s.allIn[x]);
        } else {
          // A short all-in is treated as a call: players who already acted only have to match it.
          s.needToAct = s.inHand.filter((x) => x !== seat && !s.allIn[x] && (s.roundBet[x] ?? 0) < now);
        }
      }
      break;
    }
    default:
      return { reject: `unknown action ${action}` };
  }
  s.needToAct = s.needToAct.filter((x) => x !== seat);
  s.toAct = seat;
  s.lastAction = { seat, action: action === "raise" && prev.currentBet === 0 ? "bet" : action, amount };
  return advance(s, ctx, [{ name: "action", data: s.lastAction }]);
}

// Pre-flop strength from the two hole cards (0–1), a light version of common starting-hand charts.
function preflopStrength(cards: Card[]) {
  const [a, b] = cards.map(rankOf).sort((x, y) => y - x);
  let v = a === b ? 0.5 + a / 28 : (a + b) / 40;
  if (suitOf(cards[0]) === suitOf(cards[1])) v += 0.05;
  if (a - b === 1) v += 0.04;
  return Math.min(1, v);
}

export function handStrength(cards: Card[], board: Card[]) {
  if (board.length === 0) return preflopStrength(cards);
  const h = bestHand([...cards, ...board]);
  const cat = h.score[0];
  return [0.15 + h.score[1] / 60, 0.45, 0.65, 0.78, 0.85, 0.88, 0.93, 0.97, 1][cat];
}

export default defineGame<State>({
  setup(ctx, settings) {
    const seats = ctx.seats.map((x) => x.seat).sort((a, b) => a - b);
    const start = Number(settings.startPoints ?? 500);
    const s = {
      phase: "betting",
      street: 0,
      hand: 0,
      hands: Number(settings.hands ?? 20),
      smallBet: Number(settings.smallBet ?? 10),
      turnMs: Number(settings.turnSeconds ?? 30) * 1000,
      nextMs: Number(settings.showdownSeconds ?? 8) * 1000,
      seats,
      names: Object.fromEntries(ctx.seats.map((x) => [x.seat, x.name])),
      stacks: Object.fromEntries(seats.map((x) => [x, start])),
      dealer: seats[seats.length - 1],
      deck: [],
      holes: {},
      board: [],
      dealt: [],
      inHand: [],
      allIn: {},
      contrib: {},
      roundBet: {},
      currentBet: 0,
      bets: 0,
      needToAct: [],
      toAct: null,
      lastAction: null,
      result: null,
      over: false,
      stats: Object.fromEntries(seats.map((x) => [x, noStats(start)])),
    } as State;
    return startHand(s, ctx).state;
  },

  onIntent(s, seat, intent, ctx) {
    if (s.over) return { reject: "the game is over" };
    if (!s.seats.includes(seat)) return { reject: "you are not at this table" };
    return act(s, seat, intent.name, ctx);
  },

  onTimer(s, id, ctx) {
    if (s.over) return { state: s };
    if (id === "next" && s.phase === "handOver") return startHand(s, ctx);
    if (id === "turn" && s.phase === "betting" && s.toAct !== null) {
      const legal = legalActions(s, s.toAct)!;
      const r = act(s, s.toAct, legal.check ? "check" : "fold", ctx);
      return "reject" in r ? { state: s } : r;
    }
    return { state: s };
  },

  onSeatLeft(prev, seat, ctx) {
    if (!prev.seats.includes(seat)) return { state: prev };
    const s = clone(prev);
    // Seats in order after the leaver, worked out before the leaver is removed.
    const after = [...prev.seats.slice(prev.seats.indexOf(seat) + 1), ...prev.seats.slice(0, prev.seats.indexOf(seat))];
    s.seats = s.seats.filter((x) => x !== seat);
    if (prev.dealer === seat) {
      // The button stays where it was: the seat before the leaver now holds it, so the next hand moves on normally.
      s.dealer = after.at(-1) ?? s.seats[0];
    }
    s.inHand = s.inHand.filter((x) => x !== seat);
    s.needToAct = s.needToAct.filter((x) => x !== seat);
    const withChips = s.seats.filter((x) => s.stacks[x] > 0 || s.inHand.includes(x));
    if (withChips.length < 2 && s.phase === "betting" && s.inHand.length === 1) {
      const r = finishHand(s, ctx, true);
      return { state: { ...r.state, over: true }, events: r.events };
    }
    if (withChips.length < 2) return { state: { ...s, over: true }, events: [{ name: "gameOver" }] };
    if (s.phase === "betting") {
      const left = [{ name: "playerLeft", data: { seat } }];
      const open = s.needToAct.filter((x) => s.inHand.includes(x) && !s.allIn[x]);
      if (s.inHand.length === 1 || !open.length) return advance(s, ctx, left);
      if (prev.toAct === seat) {
        // The turn passes to the next player after the leaver who still has to act.
        s.needToAct = open;
        s.toAct = after.find((x) => open.includes(x)) ?? open[0];
        if (s.turnMs > 0) ctx.setTimer("turn", s.turnMs);
      }
      return { state: s, events: left };
    }
    return { state: s, events: [{ name: "playerLeft", data: { seat } }] };
  },

  view(s, seat) {
    return {
      ...publicView(s),
      myCards: s.holes[seat] ?? [],
      myTurn: s.toAct === seat && s.phase === "betting",
      legal: legalActions(s, seat),
      strength: s.holes[seat] && s.inHand.includes(seat) ? bestHandName(s.holes[seat], s.board) : null,
    };
  },

  boardView(s) {
    return publicView(s);
  },

  isOver(s) {
    if (!s.over) return null;
    const ranked = [...s.seats].sort((a, b) => s.stacks[b] - s.stacks[a]); // players who left do not win
    const best = s.stacks[ranked[0]];
    const winners = ranked.filter((x) => s.stacks[x] === best).map((x) => s.names[x]);
    return {
      text: winners.length === 1 ? `${winners[0]} wins with ${count(best, "point")} after ${count(s.hand, "hand")}.` : `${list(winners)} tie with ${count(best, "point")}.`,
      highlights: { winners, hands: s.hand, stacks: Object.fromEntries(s.seats.map((k) => [s.names[k], s.stacks[k]])) },
      table: {
        columns: ["Player", "Points", "Peak", "Hands won", "Biggest pot", "Bets & raises", "Folds", "Best hand"],
        rows: ranked.map((x) => {
          const st = s.stats[x] ?? noStats(0);
          return [s.names[x], s.stacks[x], st.peak, st.handsWon, st.biggestPot, st.raises, st.folds, st.bestHand?.name ?? "–"];
        }),
      },
      awards: awardsOf(s),
    };
  },

  ai(view, _seat, ctx, options) {
    const v = view as ReturnType<typeof publicView> & { myCards: Card[]; myTurn: boolean; legal: ReturnType<typeof legalActions> };
    if (!v.myTurn || !v.legal) return null;
    const loose = options.style === "loose";
    const st = handStrength(v.myCards, v.board) + (loose ? 0.1 : 0) + (ctx.random() - 0.5) * 0.1;
    const l = v.legal;
    if (l.raise !== null && (st > (loose ? 0.62 : 0.72) || (loose && ctx.random() < 0.08))) return { name: "raise" };
    if (l.check) return { name: "check" };
    const price = (l.call ?? 0) / Math.max(1, v.pot + (l.call ?? 0));
    if (st > (loose ? 0.3 : 0.42) || price < 0.12) return { name: "call" };
    return { name: "fold" };
  },
});

function bestHandName(cards: Card[], board: Card[]) {
  return board.length ? bestHand([...cards, ...board]).name : null;
}

function publicView(s: State) {
  return {
    phase: s.phase,
    street: STREETS[s.street],
    hand: s.hand,
    hands: s.hands,
    smallBet: s.smallBet,
    dealer: s.dealer,
    board: s.board,
    pot: pot(s),
    toAct: s.toAct,
    currentBet: s.currentBet,
    players: s.seats.map((seat) => ({
      seat,
      name: s.names[seat],
      stack: s.stacks[seat],
      bet: s.roundBet[seat] ?? 0,
      dealt: s.dealt.includes(seat),
      folded: s.dealt.includes(seat) && !s.inHand.includes(seat),
      allIn: !!s.allIn[seat],
    })),
    lastAction: s.lastAction,
    result: s.result,
    over: s.over,
  };
}

/** The statistics window's awards (D-136): who stood out; an award nobody or everybody would get is left out. */
function awardsOf(s: State): GameAward[] {
  const by = (f: (st: SeatStats) => number) => s.seats.map((seat) => ({ seat, score: f(s.stats[seat] ?? noStats(0)) }));
  const shown = s.seats.filter((x) => s.stats[x]?.bestHand);
  let best: GameAward | null = null;
  if (shown.length >= 1) {
    const top = shown.reduce((b, x) => (compareScores(s.stats[x].bestHand!.score, s.stats[b].bestHand!.score) > 0 ? x : b), shown[0]);
    const holders = shown.filter((x) => compareScores(s.stats[x].bestHand!.score, s.stats[top].bestHand!.score) === 0);
    if (holders.length < s.seats.length) best = { id: "best-of-all", icon: "🃏", title: "Best of All", blurb: "Showed the best hand of the game.", seats: holders, value: s.stats[top].bestHand!.name };
  }
  return [
    best,
    mostAward({ id: "rich", icon: "💰", title: "Rich", blurb: "Held the most points at any one time." }, by((st) => st.peak), (n) => `${n} points at the peak`),
    mostAward({ id: "best-pot", icon: "🏺", title: "The Best Pot", blurb: "Won the biggest pot of the game." }, by((st) => st.biggestPot), (n) => `${n} points`),
    mostAward({ id: "shark", icon: "🦈", title: "The Shark", blurb: "Won the most hands." }, by((st) => st.handsWon), (n) => count(n, "hand")),
    mostAward({ id: "firestarter", icon: "🔥", title: "Firestarter", blurb: "Bet and raised the most." }, by((st) => st.raises), (n) => count(n, "bet or raise", "bets and raises")),
    mostAward({ id: "careful", icon: "🐢", title: "Careful", blurb: "Folded the most." }, by((st) => st.folds), (n) => count(n, "fold")),
    mostAward({ id: "all-in", icon: "🎲", title: "All In", blurb: "Went all in the most." }, by((st) => st.allIns), (n) => count(n, "time")),
  ].filter((a): a is GameAward => a !== null);
}
