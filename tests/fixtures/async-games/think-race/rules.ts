// Test game for AI players that take their time (D-112). Anyone adds 1 or 2 to a shared count at any time; whoever
// reaches the target wins. The AI waits `thinkMs` (and stops when its signal is aborted), then adds 1. `behaviour`:
// "fail" throws, "hang" never answers unless aborted, "sync" answers at once without a promise.
// Aborted AI moves are counted on globalThis.__thinkRaceAborts, so tests can see stale moves being stopped.
import { defineGame, type Intent } from "@game-table/sdk";

interface State {
  count: number;
  target: number;
  winner: number | null;
  adds: number[];
}

const g = globalThis as { __thinkRaceAborts?: number };

export default defineGame<State>({
  setup(ctx, settings) {
    return { count: 0, target: Number(settings.target), winner: null, adds: ctx.seats.map(() => 0) };
  },
  onIntent(state, seat, intent) {
    if (state.winner !== null) return { reject: "the race is over" };
    if (intent.name !== "add") return { reject: "unknown intent" };
    const n = (intent.payload as { n?: number } | undefined)?.n;
    if (n !== 1 && n !== 2) return { reject: "add 1 or 2" };
    const count = state.count + n;
    const adds = [...state.adds];
    adds[seat] = (adds[seat] ?? 0) + 1;
    return { state: { ...state, count, adds, winner: count >= state.target ? seat : null }, events: [{ name: "added", data: { seat, n } }] };
  },
  view(state) {
    return state;
  },
  boardView(state) {
    return state;
  },
  isOver(state) {
    return state.winner === null ? null : { text: `Seat ${state.winner} reached ${state.target}.`, highlights: { winner: state.winner } };
  },
  ai(_view, _seat, ctx, options): Intent | null | Promise<Intent | null> {
    const add: Intent = { name: "add", payload: { n: 1 } };
    if (options.behaviour === "sync") return add;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(t);
        g.__thinkRaceAborts = (g.__thinkRaceAborts ?? 0) + 1;
        reject(new Error("aborted"));
      };
      const t =
        options.behaviour === "hang"
          ? undefined
          : setTimeout(() => {
              ctx.signal.removeEventListener("abort", onAbort);
              if (options.behaviour === "fail") reject(new Error("the test AI failed on purpose"));
              else resolve(add);
            }, Number(options.thinkMs));
      ctx.signal.addEventListener("abort", onAbort, { once: true });
    });
  },
  aiFallback() {
    return { name: "add", payload: { n: 2 } };
  },
});
