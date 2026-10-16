// Test game for players lost during a game (D-119). Seats score points for their team (seat % 2 with four seats, each
// seat its own team with two). "teams": the game can't go on without a full team, so the table waits for a player
// whose phone is away (canContinueWithout), and removing one ends the game with that reason. "free": it goes on
// without them, and onSeatLeft ends it with its own reason below two players.
import { defineGame, type Intent } from "@game-table/sdk";

interface State {
  mode: "teams" | "free";
  target: number;
  seats: number[];
  team: Record<number, number>;
  score: Record<number, number>;
  winner: number | null;
}

const FULL_TEAM = "Partners can't go on without a full team.";

export default defineGame<State>({
  setup(ctx, settings) {
    const seats = ctx.seats.map((s) => s.seat);
    const team: Record<number, number> = {};
    for (const s of seats) team[s] = seats.length >= 4 ? s % 2 : s;
    const score: Record<number, number> = {};
    for (const t of new Set(Object.values(team))) score[t] = 0;
    return { mode: settings.mode === "free" ? "free" : "teams", target: Number(settings.target), seats, team, score, winner: null };
  },
  onIntent(state, seat, intent) {
    if (state.winner !== null) return { reject: "the game is over" };
    if (intent.name !== "point") return { reject: "unknown intent" };
    if (!state.seats.includes(seat)) return { reject: "not playing" };
    const t = state.team[seat];
    const score = { ...state.score, [t]: state.score[t] + 1 };
    return { state: { ...state, score, winner: score[t] >= state.target ? t : null }, events: [{ name: "point", data: { seat, team: t } }] };
  },
  view(state) {
    return state;
  },
  boardView(state) {
    return state;
  },
  isOver(state) {
    return state.winner === null ? null : { text: `Team ${state.winner} wins.`, highlights: { team: state.winner } };
  },
  canContinueWithout(state) {
    return state.mode === "teams" ? { wait: FULL_TEAM } : true;
  },
  onSeatLeft(state, seat) {
    const seats = state.seats.filter((s) => s !== seat);
    if (seats.length < 2) return { end: { text: "Partners needs at least two players.", highlights: { left: seat } } };
    return { state: { ...state, seats } };
  },
  ai(_view, _seat, _ctx, options): Intent | null {
    return options.behaviour === "play" ? { name: "point" } : null;
  },
});
