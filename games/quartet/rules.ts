import { defineGame } from "../../packages/sdk/src/index.ts";

interface State {
  order: number[];
  names: Record<number, string>;
  turn: number; // index into order
  passes: number;
  laps: number;
}

export default defineGame<State>({
  setup(ctx, settings) {
    return {
      order: ctx.seats.map((s) => s.seat),
      names: Object.fromEntries(ctx.seats.map((s) => [s.seat, s.name])),
      turn: 0,
      passes: 0,
      laps: Number(settings.laps ?? 2),
    };
  },
  onIntent(state, seat, intent) {
    if (intent.name !== "pass") return { reject: `unknown intent ${intent.name}` };
    if (state.order[state.turn] !== seat) return { reject: "not your turn" };
    const next = { ...state, passes: state.passes + 1, turn: (state.turn + 1) % state.order.length };
    return { state: next, events: [{ name: "tokenPassed", data: { from: seat, to: next.order[next.turn] } }] };
  },
  onSeatLeft() {
    return "end";
  },
  view(state, seat) {
    return { myTurn: state.order[state.turn] === seat, passes: state.passes, total: state.laps * state.order.length };
  },
  boardView(state) {
    return { holder: state.order[state.turn], holderName: state.names[state.order[state.turn]], passes: state.passes, total: state.laps * state.order.length };
  },
  isOver(state) {
    if (state.passes < state.laps * state.order.length) return null;
    return { text: `The token went around ${state.laps} times.`, highlights: { passes: state.passes } };
  },
});
