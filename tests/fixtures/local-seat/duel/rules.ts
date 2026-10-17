// Test game for localSeat (D-128): nothing to play, it only records where everyone sat at the start.
import { defineGame } from "@game-table/sdk";

export default defineGame<{ seats: Record<number, string> }>({
  setup: (ctx) => ({ seats: Object.fromEntries(ctx.seats.map((s) => [s.seat, `${s.name}@${s.edge}`])) }),
  onIntent: () => ({ reject: "nothing to do" }),
  view: (s) => s,
  boardView: (s) => s,
  isOver: () => null,
});
