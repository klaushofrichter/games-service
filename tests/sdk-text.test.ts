// Message helpers games use for their end-of-game texts (D-086).
import { describe, expect, it } from "vitest";
import { count, list } from "../packages/sdk/src/index.ts";
import game from "../games/coin-flip/rules.ts";

describe("message helpers", () => {
  it("spells small counts and matches the noun to the number", () => {
    expect(count(1, "correct guess", "correct guesses")).toBe("one correct guess");
    expect(count(3, "correct guess", "correct guesses")).toBe("three correct guesses");
    expect(count(0, "point")).toBe("no points");
    expect(count(12, "hand")).toBe("12 hands");
    expect(count(1, "hand")).toBe("one hand");
  });

  it("joins names with commas and a final 'and'", () => {
    expect(list(["Ann"])).toBe("Ann");
    expect(list(["Ann", "Bob"])).toBe("Ann and Bob");
    expect(list(["Ann", "Bob", "Cleo"])).toBe("Ann, Bob and Cleo");
  });

  it("Coin Flip's result reads naturally", () => {
    const over = (scores: Record<number, number>) =>
      game.isOver!({ done: true, active: [0, 1], scores, names: { 0: "Klaus", 1: "Mia (AI)" }, rounds: 3, history: [], picks: {}, lastGuesses: {} } as any)!.text;
    expect(over({ 0: 1, 1: 0 })).toBe("Klaus wins with one correct guess.");
    expect(over({ 0: 2, 1: 2 })).toBe("Klaus and Mia (AI) tie with two correct guesses each.");
    expect(over({ 0: 0, 1: 0 })).toBe("Nobody guessed right.");
  });
});
