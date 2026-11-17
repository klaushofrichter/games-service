// Test game Keeper (D-302): nothing to play. Its rules see no game data; an intent hands them what they need.
import { defineGame } from "@game-table/sdk";

export default defineGame<{ told: unknown[] }>({
  setup: () => ({ told: [] }),
  onIntent: (s, _seat, intent) => (intent.name === "tell" ? { state: { told: [...s.told, intent.payload] } } : { reject: "nothing to do" }),
  view: (s) => s,
  boardView: (s) => s,
  isOver: () => null,
});
