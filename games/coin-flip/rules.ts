import { count, defineGame, list, type GameContext, type StepDescription, type StepInfo } from "../../packages/sdk/src/index.ts";

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
  /** What each seat picked in the last flipped round (null: no pick in time), shown on the board (D-091). */
  lastGuesses: Record<number, Guess | null>;
  /** Every pick per seat, for the statistics at the end. */
  picks: Record<number, (Guess | null)[]>;
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
  const lastGuesses = Object.fromEntries(state.active.map((seat) => [seat, state.guesses[seat] ?? null]));
  const picks = { ...state.picks };
  for (const seat of state.active) picks[seat] = [...(picks[seat] ?? []), state.guesses[seat] ?? null];
  const next: State = { ...state, scores, lastGuesses, picks, lastFlip: result, history: [...state.history, result], round: state.round + 1 };
  const events = [{ name: "coinFlipped", data: { result, round: state.round } }];
  if (next.round > next.rounds) return { state: { ...next, done: true }, events };
  return { state: startRound(next, ctx), events };
}

/** A seat's picks so far: how often heads and tails, and the heads share in whole percent (null before any pick). */
function stats(state: State, seat: number) {
  const p = state.picks[seat] ?? [];
  const heads = p.filter((g) => g === "heads").length;
  const tails = p.filter((g) => g === "tails").length;
  return { heads, tails, headsPct: heads + tails ? Math.round((100 * heads) / (heads + tails)) : null };
}

function allGuessed(state: State) {
  return state.active.length > 0 && state.active.every((s) => state.guesses[s] !== undefined);
}

/**
 * The Game Viewer's line for a step (D-120). A flip happens in the step that completes the round: the last guess, a
 * player leaving, or the round timer. It shows as an automatic sub-step: nobody chose the coin.
 */
function describeStep(step: StepInfo<State>): StepDescription | null {
  const { before, after } = step;
  const flipped = after.history.length > before.history.length;
  const round = Math.min(before.round, before.rounds);
  const flip = (): NonNullable<StepDescription["steps"]>[number] => {
    const right = before.active.filter((s) => after.lastGuesses[s] === after.lastFlip).map((s) => after.names[s]);
    const missed = before.active.filter((s) => after.lastGuesses[s] === null).map((s) => after.names[s]);
    return {
      text: `Coin: ${after.lastFlip} · ${right.length ? `${list(right)} ${right.length === 1 ? "scores" : "score"}` : "nobody scores"}${missed.length ? ` · no guess from ${list(missed)}` : ""}`,
      auto: true,
    };
  };
  const scores = (seat: number | null) => (seat === null ? null : (after.scores[seat] ?? 0));
  const picks = () => ({ picks: Object.fromEntries(before.active.map((s) => [after.names[s], after.lastGuesses[s] ?? "none"])) });
  if (step.kind === "intent") {
    const g = String(step.intent?.payload ?? "");
    return {
      text: step.accepted ? `guesses ${g}` : `tries to guess ${g || "nothing"}`,
      columns: { round, guess: step.accepted ? g : null, coin: flipped ? after.lastFlip : null, score: scores(step.seat) },
      ...(flipped ? { steps: [flip()], details: picks() } : {}),
    };
  }
  if (step.kind === "timer" && flipped) {
    return {
      text: `Time is up in round ${round}`,
      columns: { round, guess: null, coin: after.lastFlip, score: null },
      steps: [flip()],
      details: picks(),
    };
  }
  if (step.kind === "seatLeft" && flipped) return { text: `${step.names[step.seat!] ?? "A player"} left; everyone else had guessed`, columns: { round, coin: after.lastFlip }, steps: [flip()] };
  return null;
}

export default defineGame<State>({
  setup(ctx, settings) {
    const seats = ctx.seats.map((s) => s.seat);
    const state: State = {
      round: 1,
      rounds: Number(settings.rounds ?? 3),
      // Seconds since D-090; logs from before it carry roundMs, and replay must still read them.
      roundMs: settings.roundSeconds !== undefined ? Number(settings.roundSeconds) * 1000 : Number(settings.roundMs ?? 15000),
      active: seats,
      guesses: {},
      scores: Object.fromEntries(seats.map((s) => [s, 0])),
      names: Object.fromEntries(ctx.seats.map((s) => [s.seat, s.name])),
      lastFlip: null,
      history: [],
      done: false,
      lastGuesses: {},
      picks: {},
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
      roundMs: state.roundMs,
      myGuess: state.guesses[seat] ?? null,
      myScore: state.scores[seat] ?? 0,
      lastFlip: state.lastFlip,
      myLastGuess: state.lastGuesses[seat] ?? null,
      flipped: state.history.length,
      done: state.done,
    };
  },

  boardView(state) {
    return {
      round: Math.min(state.round, state.rounds),
      rounds: state.rounds,
      roundMs: state.roundMs,
      flipped: state.history.length, // rounds flipped so far
      seats: state.active.map((s) => ({
        seat: s,
        name: state.names[s],
        score: state.scores[s] ?? 0,
        hasGuessed: state.guesses[s] !== undefined, // never which way, until the flip
        lastGuess: state.lastGuesses[s] ?? null,
        ...stats(state, s),
      })),
      lastFlip: state.lastFlip,
      done: state.done,
    };
  },

  isOver(state) {
    if (!state.done) return null;
    const best = Math.max(...state.active.map((s) => state.scores[s] ?? 0), 0);
    const winners = state.active.filter((s) => (state.scores[s] ?? 0) === best).map((s) => state.names[s]);
    return {
      text:
        best === 0 ? "Nobody guessed right."
        : winners.length === 1 ? `${winners[0]} wins with ${count(best, "correct guess", "correct guesses")}.`
        : `${list(winners)} tie with ${count(best, "correct guess", "correct guesses")} each.`,
      highlights: { winners, rounds: state.rounds, flips: state.history, scores: state.scores },
      table: {
        columns: ["Player", "Correct", "Heads", "Tails", "Heads %"],
        rows: state.active.map((s) => {
          const st = stats(state, s);
          return [state.names[s], state.scores[s] ?? 0, st.heads, st.tails, st.headsPct === null ? "–" : `${st.headsPct}%`];
        }),
      },
    };
  },

  describe: describeStep,

  ai(view, _seat, ctx) {
    const v = view as { myGuess: string | null; done: boolean };
    if (v.done || v.myGuess) return null;
    return { name: "guess", payload: ctx.random() < 0.5 ? "heads" : "tails" };
  },
});
