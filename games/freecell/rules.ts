// FreeCell (D-308): a solitaire for one player, played on the board. Every deal can be solved: a deal the solver
// finds no way through is passed over for the next number. The rules of the cards are in engine.ts.
import { count, defineGame, type GameAward, type GameContext, type GameEvent, type StepDescription, type StepInfo } from "../../packages/sdk/src/index.ts";
import {
  CELLS, COLUMNS, HOME, anyMove, apply, autoMoves, bestTarget, cardName, cardsHome, deal, isCell, isColumn, refusal, runLength, solve, solved, unapply,
  type Move, type Position,
} from "./engine.ts";

/** Positions the solver may look at: for a new deal (then the next number is tried), and for a hint. */
const DEAL_BUDGET = 20000;
const HINT_BUDGET = 30000;
const MAX_DEAL = 999999;

/** A move the player made, with what followed by itself, as needed to take it back. */
interface Done {
  m: Move;
  /** The first card moved (for a move to the foundations: the card). */
  card: number;
  /** The moves home that followed by themselves, and their cards. */
  auto: Move[];
  autoCards: number[];
}

interface State {
  seat: number;
  name: string;
  /** The deal's number; the same number is the same deal. */
  deal: number;
  /** Deal numbers passed over because no way through them was found. */
  passed: number;
  pos: Position;
  history: Done[];
  /** The player's own moves, undos, hints and restarts so far. */
  moves: number;
  undos: number;
  hints: number;
  restarts: number;
  /** The hint on show, until the next move. */
  hint: Move | null;
  /** A hint was asked for and no way to win was found from here. */
  noWay: boolean;
  /** A way to win from here (single cards, moves that happen by themselves included), while the player follows it. */
  plan: Move[] | null;
  /** Game time (ms) of the first and the latest move. */
  firstAt: number | null;
  lastAt: number;
  /** Most free cells in use at once, and most cards that went home after one move. */
  mostCells: number;
  bestSweep: number;
  over: null | "won" | "gaveUp";
}

const place = (p: number) => (p === HOME ? "the foundations" : isCell(p) ? `free cell ${p - COLUMNS + 1}` : `column ${p + 1}`);
const cellsUsed = (p: Position) => p.cells.filter((c) => c !== null).length;
const sameMove = (a: Move, b: Move) => a.from === b.from && a.to === b.to && a.n === b.n;

function firstCard(p: Position, m: Move): number {
  if (isCell(m.from)) return p.cells[m.from - COLUMNS] as number;
  const col = p.cols[m.from]!;
  return col[col.length - m.n]!;
}

/** The deal with this number, or the next one that can be solved. */
function solvable(from: number): { n: number; passed: number; plan: Move[] } {
  for (let passed = 0; ; passed++) {
    const n = ((from - 1 + passed) % MAX_DEAL) + 1;
    const plan = solve(deal(n), DEAL_BUDGET);
    if (plan) return { n, passed, plan };
  }
}

function fresh(state: Pick<State, "seat" | "name" | "deal" | "passed">, plan: Move[]): State {
  // (the first cards never go home by themselves before the player's first move: the plan starts with them if any)
  return {
    ...state,
    pos: deal(state.deal),
    history: [],
    moves: 0,
    undos: 0,
    hints: 0,
    restarts: 0,
    hint: null,
    noWay: false,
    plan,
    firstAt: null,
    lastAt: 0,
    mostCells: 0,
    bestSweep: 0,
    over: null,
  };
}

/** Make a move that is allowed, with what follows by itself. */
function play(state: State, m: Move, ctx: GameContext): { state: State; events: GameEvent[] } {
  const card = firstCard(state.pos, m);
  const after = autoMoves(apply(state.pos, m));
  // The plan goes on if this was its next move (what follows by itself is in it, in the same order).
  const plan = state.plan && state.plan[0] && sameMove(state.plan[0], m) ? state.plan.slice(1 + after.moves.length) : null;
  const now = ctx.now();
  const next: State = {
    ...state,
    pos: after.position,
    history: [...state.history, { m, card, auto: after.moves, autoCards: after.cards }],
    moves: state.moves + 1,
    hint: null,
    noWay: false,
    plan,
    firstAt: state.firstAt ?? now,
    lastAt: now,
    mostCells: Math.max(state.mostCells, cellsUsed(after.position)),
    bestSweep: Math.max(state.bestSweep, after.cards.length + (m.to === HOME ? 1 : 0)),
    over: solved(after.position) ? "won" : null,
  };
  const events: GameEvent[] = [{ name: "moved", data: { from: m.from, to: m.to, n: m.n, card } }];
  after.moves.forEach((a, i) => events.push({ name: "home", data: { from: a.from, card: after.cards[i] } }));
  if (next.over) events.push({ name: "won" });
  return { state: next, events };
}

function seconds(state: State): number {
  return state.firstAt === null ? 0 : Math.max(0, Math.round((state.lastAt - state.firstAt) / 1000));
}

function clock(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** What can go where right now: "from:n" → the places those cards may go, for the board's drag and drop. */
function legalMoves(p: Position): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  const targets = (from: number, n: number) => {
    const to: number[] = [];
    for (let t = 0; t <= HOME; t++) if (t !== from && refusal(p, { from, to: t, n }) === null) to.push(t);
    if (to.length) out[`${from}:${n}`] = to;
  };
  for (let c = 0; c < COLUMNS; c++) for (let n = 1; n <= runLength(p.cols[c]!); n++) targets(c, n);
  for (let c = 0; c < CELLS; c++) if (p.cells[c] !== null) targets(COLUMNS + c, 1);
  return out;
}

function publicView(state: State) {
  return {
    seat: state.seat,
    name: state.name,
    deal: state.deal,
    passed: state.passed,
    cols: state.pos.cols,
    cells: state.pos.cells,
    home: state.pos.home,
    moves: state.moves,
    undos: state.undos,
    hints: state.hints,
    hint: state.hint,
    noWay: state.noWay,
    legal: state.over ? {} : legalMoves(state.pos),
    canUndo: state.history.length > 0 && !state.over,
    /** Nothing can be moved: only Undo, Start again or Give up are left. */
    stuck: !state.over && !anyMove(state.pos),
    firstAt: state.firstAt,
    lastAt: state.lastAt,
    over: state.over,
  };
}

function awards(state: State): GameAward[] {
  const won = state.over === "won";
  const s = seconds(state);
  const home = cardsHome(state.pos);
  const seats = [state.seat];
  const all: (GameAward | false)[] = [
    won && { id: "solved", icon: "🏆", title: "Solved", blurb: "All 52 cards on the foundations.", seats, value: `deal ${state.deal}` },
    won && state.undos === 0 && state.restarts === 0 && { id: "no-undo", icon: "🎯", title: "No Second Thoughts", blurb: "Solved without taking a move back.", seats },
    won && state.hints === 0 && { id: "no-hint", icon: "🧠", title: "On Your Own", blurb: "Solved without a hint.", seats },
    won && state.hints === 0 && state.undos === 0 && state.restarts === 0 && { id: "purist", icon: "💎", title: "Purist", blurb: "No hints, no undo, no restart.", seats },
    won && s <= 180 && { id: "lightning", icon: "⚡", title: "Lightning", blurb: "Solved within three minutes.", seats, value: clock(s) },
    won && s > 180 && s <= 300 && { id: "brisk", icon: "🏃", title: "Brisk", blurb: "Solved within five minutes.", seats, value: clock(s) },
    won && s >= 1200 && { id: "marathon", icon: "🐢", title: "Marathon", blurb: "Took twenty minutes or more, and got there.", seats, value: clock(s) },
    won && state.moves <= 85 && { id: "economist", icon: "📐", title: "Economist", blurb: "Solved in 85 moves or fewer.", seats, value: count(state.moves, "move") },
    won && state.moves > 85 && state.moves <= 100 && { id: "tidy", icon: "🧹", title: "Tidy", blurb: "Solved in 100 moves or fewer.", seats, value: count(state.moves, "move") },
    won && state.mostCells <= 2 && { id: "cell-miser", icon: "🔒", title: "Cell Miser", blurb: "Never more than two free cells in use.", seats },
    won && state.mostCells === CELLS && { id: "tightrope", icon: "🎪", title: "Tightrope", blurb: "Had all four free cells full, and still solved it.", seats },
    won && state.bestSweep >= 20 && { id: "clean-sweep", icon: "🌊", title: "Clean Sweep", blurb: "Twenty or more cards went home after one move.", seats, value: count(state.bestSweep, "card") },
    won && state.undos >= 10 && { id: "second-thoughts", icon: "↩️", title: "Second Thoughts", blurb: "Took back ten moves or more on the way.", seats, value: count(state.undos, "undo") },
    won && state.restarts > 0 && { id: "fresh-start", icon: "🔁", title: "Fresh Start", blurb: "Started the deal again, and solved it.", seats },
    won && state.hints >= 5 && { id: "good-advice", icon: "💡", title: "Good Advice", blurb: "Asked for five hints or more.", seats, value: count(state.hints, "hint") },
    !won && home >= 26 && { id: "so-close", icon: "🥈", title: "So Close", blurb: "Half the cards or more were home.", seats, value: `${home} of 52` },
  ];
  return all.filter((a): a is GameAward => !!a);
}

function describeStep(step: StepInfo<State>): StepDescription | null {
  if (step.kind !== "intent") return null;
  const { before, after } = step;
  const columns = { home: cardsHome(after.pos), moves: after.moves };
  const name = step.intent?.name ?? "";
  if (!step.accepted) return { text: `tries: ${name}`, columns };
  if (name === "move" || name === "tap") {
    const done = after.history[after.history.length - 1];
    if (!done || after.history.length <= before.history.length) return { text: name, columns };
    const what = done.m.n > 1 ? `${done.m.n} cards from ${cardName(done.card)}` : cardName(done.card);
    return {
      text: `moves ${what} from ${place(done.m.from)} to ${place(done.m.to)}`,
      columns,
      ...(done.autoCards.length ? { steps: [{ text: `${done.autoCards.map(cardName).join(", ")} to the foundations`, auto: true }] } : {}),
    };
  }
  const text: Record<string, string> = { undo: "takes a move back", restart: "starts the deal again", hint: after.hint ? `asks for a hint: ${cardName(firstCard(after.pos, after.hint))} to ${place(after.hint.to)}` : "asks for a hint: no way found from here", giveUp: "gives up" };
  return { text: text[name] ?? name, columns };
}

export default defineGame<State>({
  setup(ctx) {
    const found = solvable(ctx.randomInt(1, MAX_DEAL));
    const seat = ctx.seats[0]!;
    return fresh({ seat: seat.seat, name: seat.name, deal: found.n, passed: found.passed }, found.plan);
  },

  onIntent(state, seat, intent, ctx) {
    if (seat !== state.seat) return { reject: "This is not your game" };
    if (state.over) return { reject: "The game is over" };
    const data = (intent.payload && typeof intent.payload === "object" ? intent.payload : {}) as Record<string, unknown>;
    const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : NaN);
    switch (intent.name) {
      case "move": {
        const m = { from: int(data.from), to: int(data.to), n: data.n === undefined ? 1 : int(data.n) };
        if ([m.from, m.to, m.n].some(Number.isNaN)) return { reject: "That is not a move" };
        const why = refusal(state.pos, m);
        return why ? { reject: why } : play(state, m, ctx);
      }
      case "tap": {
        // A tap on a card: it goes where it fits best, with the cards on it if it is in a run.
        const from = int(data.from);
        if (!(isColumn(from) || isCell(from))) return { reject: "That is not a card" };
        const n = isColumn(from) ? (data.n === undefined ? 1 : int(data.n)) : 1;
        if (Number.isNaN(n) || n < 1 || (isColumn(from) && n > runLength(state.pos.cols[from]!))) return { reject: "Those cards can't move together" };
        const m = bestTarget(state.pos, from, n);
        return m ? play(state, m, ctx) : { reject: "There is no place for it right now" };
      }
      case "undo": {
        const last = state.history[state.history.length - 1];
        if (!last) return { reject: "There is nothing to take back" };
        let pos = state.pos;
        for (let i = last.auto.length - 1; i >= 0; i--) pos = unapply(pos, last.auto[i]!, last.autoCards[i]!);
        pos = unapply(pos, last.m, last.card);
        return {
          state: { ...state, pos, history: state.history.slice(0, -1), undos: state.undos + 1, hint: null, noWay: false, plan: null, lastAt: ctx.now() },
          events: [{ name: "undone", data: { from: last.m.from, to: last.m.to, n: last.m.n, card: last.card, home: last.autoCards } }],
        };
      }
      case "restart": {
        if (!state.history.length) return { reject: "The deal is as it was dealt" };
        return {
          state: { ...state, pos: deal(state.deal), history: [], restarts: state.restarts + 1, hint: null, noWay: false, plan: null, lastAt: ctx.now() },
          events: [{ name: "restarted" }],
        };
      }
      case "hint": {
        const plan = state.plan?.length ? state.plan : solve(state.pos, HINT_BUDGET);
        if (!plan || !plan.length) return { state: { ...state, hint: null, noWay: true, plan: null }, events: [{ name: "noWay" }] };
        return { state: { ...state, hint: plan[0]!, noWay: false, plan, hints: state.hints + 1 }, events: [{ name: "hint", data: plan[0] }] };
      }
      case "giveUp":
        return { state: { ...state, over: "gaveUp", hint: null, lastAt: ctx.now() }, events: [{ name: "gaveUp" }] };
      default:
        return { reject: "FreeCell does not know that move" };
    }
  },

  // Everything lies open; the phone shows only that the game is on the board.
  view(state) {
    return publicView(state);
  },
  boardView(state) {
    return publicView(state);
  },

  onSeatChanged(state, seat) {
    return { state: seat.seat === state.seat ? { ...state, name: seat.name } : state };
  },

  isOver(state) {
    if (!state.over) return null;
    const won = state.over === "won";
    const s = seconds(state);
    const home = cardsHome(state.pos);
    return {
      text: won
        ? `${state.name} solves deal ${state.deal} in ${count(state.moves, "move")} and ${clock(s)}.`
        : `${state.name} gives up deal ${state.deal} with ${home} of 52 cards home.`,
      highlights: { winners: won ? [state.name] : [], deal: state.deal, won, moves: state.moves, seconds: s, undos: state.undos, hints: state.hints, cardsHome: home },
      table: {
        columns: ["Player", "Result", "Cards home", "Moves", "Undos", "Hints", "Time"],
        rows: [[state.name, won ? "Solved" : "Gave up", home, state.moves, state.undos, state.hints, clock(s)]],
      },
      awards: awards(state),
    };
  },

  describe: describeStep,
});
