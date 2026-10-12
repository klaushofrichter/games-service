import { defineGame, type GameContext } from "../../packages/sdk/src/index.ts";

type Guess = "heads" | "tails";

interface State {
  round: number;
  rounds: number;
  roundMs: number;
  active: number[]; // seats taking part
  guesses: Record<number, Guess>;
  scores: Record<number, number>;
  names: Record<number, string>;
  lastFlip: Guess | null;
  history: Guess[];
  done: boolean;
}

function startRound(state: State, ctx: GameContext): State {
  if (state.roundMs > 0) ctx.setTimer("round", state.roundMs);
  return { ...state, guesses: {} };
}

function flip(state: State, ctx: GameContext) {
  ctx.clearTimer("round");
  const result: Guess = ctx.random() < 0.5 ? "heads" : "tails";
  const scores = { ...state.scores };
  for (const seat of state.active) if (state.guesses[seat] === result) scores[seat] = (scores[seat] ?? 0) + 1;
  const next: State = { ...state, scores, lastFlip: result, history: [...state.history, result], round: state.round + 1 };
  const events = [{ name: "coinFlipped", data: { result, round: state.round } }];
  if (next.round > next.rounds) return { state: { ...next, done: true }, events };
  return { state: startRound(next, ctx), events };
}

function allGuessed(state: State) {
  return state.active.length > 0 && state.active.every((s) => state.guesses[s] !== undefined);
}

export default defineGame<State>({
  setup(ctx, settings) {
    const seats = ctx.seats.map((s) => s.seat);
    const state: State = {
      round: 1,
      rounds: Number(settings.rounds ?? 3),
      roundMs: Number(settings.roundMs ?? 15000),
      active: seats,
      guesses: {},
      scores: Object.fromEntries(seats.map((s) => [s, 0])),
      names: Object.fromEntries(ctx.seats.map((s) => [s.seat, s.name])),
      lastFlip: null,
      history: [],
      done: false,
    };
    return startRound(state, ctx);
  },

  onIntent(state, seat, intent, ctx) {
    if (state.done) return { reject: "game over" };
    if (intent.name !== "guess") return { reject: `unknown intent ${intent.name}` };
    if (!state.active.includes(seat)) return { reject: "not playing" };
    const g = intent.payload;
    if (g !== "heads" && g !== "tails") return { reject: "guess must be heads or tails" };
    if (state.guesses[seat]) return { reject: "already guessed this round" };
    const next = { ...state, guesses: { ...state.guesses, [seat]: g as Guess } };
    const events = [{ name: "guessed", data: { seat } }];
    if (allGuessed(next)) {
      const r = flip(next, ctx);
      return { state: r.state, events: [...events, ...r.events] };
    }
    return { state: next, events };
  },

  onTimer(state, id, ctx) {
    if (id !== "round" || state.done) return { state };
    return flip(state, ctx);
  },

  onSeatJoined(state, seat) {
    if (state.active.includes(seat.seat)) return { state };
    return {
      state: {
        ...state,
        active: [...state.active, seat.seat],
        scores: { ...state.scores, [seat.seat]: state.scores[seat.seat] ?? 0 },
        names: { ...state.names, [seat.seat]: seat.name },
      },
    };
  },

  onSeatLeft(state, seat, ctx) {
    const active = state.active.filter((s) => s !== seat);
    const guesses = { ...state.guesses };
    delete guesses[seat];
    const next = { ...state, active, guesses };
    if (active.length === 0) return "end";
    if (allGuessed(next)) return flip(next, ctx);
    return { state: next };
  },

  view(state, seat) {
    return {
      round: Math.min(state.round, state.rounds),
      rounds: state.rounds,
      myGuess: state.guesses[seat] ?? null,
      myScore: state.scores[seat] ?? 0,
      lastFlip: state.lastFlip,
      done: state.done,
    };
  },

  boardView(state) {
    return {
      round: Math.min(state.round, state.rounds),
      rounds: state.rounds,
      seats: state.active.map((s) => ({ seat: s, name: state.names[s], score: state.scores[s] ?? 0, hasGuessed: state.guesses[s] !== undefined })),
      lastFlip: state.lastFlip,
      done: state.done,
    };
  },

  isOver(state) {
    if (!state.done) return null;
    const best = Math.max(...state.active.map((s) => state.scores[s] ?? 0), 0);
    const winners = state.active.filter((s) => (state.scores[s] ?? 0) === best).map((s) => state.names[s]);
    return {
      text: winners.length === 1 ? `${winners[0]} wins with ${best} correct guesses.` : `Tie between ${winners.join(", ")} with ${best} each.`,
      highlights: { winners, rounds: state.rounds, flips: state.history, scores: state.scores },
    };
  },

  ai(view, _seat, ctx) {
    const v = view as { myGuess: string | null; done: boolean };
    if (v.done || v.myGuess) return null;
    return { name: "guess", payload: ctx.random() < 0.5 ? "heads" : "tails" };
  },
});
