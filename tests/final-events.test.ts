// The step that ends a game still delivers its events (D-092): the last coin flip, the winning move.
import { describe, expect, it } from "vitest";
import { loadGame, start } from "./harness.ts";

describe("game over", () => {
  it("passes the final step's events to listeners with the game-over", async () => {
    const { rt } = start(await loadGame("coin-flip"), 2, { rounds: 1, roundSeconds: 0 });
    const seen: { kind: string; names: string[] }[] = [];
    rt.onChange((kind, events) => seen.push({ kind, names: events.map((e) => e.name) }));
    rt.submit(0, { name: "guess", payload: "heads" }, "human");
    rt.submit(1, { name: "guess", payload: "tails" }, "human");
    expect(rt.over).toBe(true);
    expect(seen.at(-1)).toEqual({ kind: "over", names: ["guessed", "coinFlipped"] });
  });
});
