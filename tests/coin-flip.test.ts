// Coin Flip 0.2 (D-090, D-091): what the board may show when, statistics, and old logs still replaying.
import { beforeAll, describe, expect, it } from "vitest";
import { expectReplay, loadGame, start } from "./harness.ts";

let game: Awaited<ReturnType<typeof loadGame>>;
beforeAll(async () => {
  game = await loadGame("coin-flip");
});
const guess = (rt: any, seat: number, g: string) => expect(rt.submit(seat, { name: "guess", payload: g }, "human")).toEqual({ ok: true });

describe("Coin Flip", () => {
  it("never shows a pick on the board before the coin flips, then shows everyone's", () => {
    const { rt } = start(game, 3, { rounds: 2, roundSeconds: 0 });
    guess(rt, 0, "heads");
    guess(rt, 1, "tails");
    const before = game.def.boardView!(rt.state) as any;
    expect(JSON.stringify(before)).not.toMatch(/:"(heads|tails)"/); // no pick as a value anywhere, only that they guessed
    expect(before.seats.map((s: any) => [s.heads, s.tails])).toEqual([[0, 0], [0, 0], [0, 0]]); // counts cover flipped rounds only
    expect((game.def.boardView!(rt.state) as any).seats.map((s: any) => s.hasGuessed)).toEqual([true, true, false]);
    // other players' views don't reveal it either
    expect(JSON.stringify(game.def.view(rt.state, 2))).not.toMatch(/:"(heads|tails)"/);
    guess(rt, 2, "heads");
    const after = game.def.boardView!(rt.state) as any;
    expect(after.flipped).toBe(1);
    expect(after.seats.map((s: any) => s.lastGuess)).toEqual(["heads", "tails", "heads"]);
    expect(after.round).toBe(2);
  });

  it("a missed pick shows as none, scores nothing and stays out of the heads share", () => {
    const { rt, clock } = start(game, 2, { rounds: 2, roundSeconds: 5 });
    guess(rt, 0, "heads");
    clock.advance(); // the round timer fires: seat 1 never picked
    const v = game.def.boardView!(rt.state) as any;
    expect(v.seats[1].lastGuess).toBeNull();
    expect(v.seats[1].headsPct).toBeNull();
    expect(v.seats[0].headsPct).toBe(100);
  });

  it("ends with a statistics table that adds up", () => {
    const { rt } = start(game, 2, { rounds: 3, roundSeconds: 0 });
    for (const [a, b] of [["heads", "tails"], ["heads", "heads"], ["tails", "tails"]]) {
      guess(rt, 0, a);
      guess(rt, 1, b);
    }
    expect(rt.over).toBe(true);
    const t = rt.summary!.table!;
    expect(t.columns).toEqual(["Player", "Correct", "Heads", "Tails", "Heads %"]);
    const [r0, r1] = t.rows;
    expect(r0.slice(2)).toEqual([2, 1, "67%"]);
    expect(r1.slice(2)).toEqual([1, 2, "33%"]);
    const flips = (rt.summary!.highlights as any).flips as string[];
    const picks = [["heads", "heads", "tails"], ["tails", "heads", "tails"]];
    expect([r0[1], r1[1]]).toEqual(picks.map((p) => p.filter((g, k) => g === flips[k]).length));
    expect(expectReplay(game, rt)).toBe(true);
  });

  it("counts the time to guess in seconds, and still reads roundMs from logs made before 0.2", () => {
    const fresh = start(game, 1, { rounds: 1, roundSeconds: 10 });
    expect((fresh.rt.state as any).roundMs).toBe(10_000);
    // a 0.1 log carries roundMs in its settings; replay passes them to setup as they were
    const old = game.def.setup({ seats: [{ seat: 0, playerId: "a", name: "A", kind: "human", edge: "south" }], random: () => 0.5, setTimer() {}, clearTimer() {} } as any, { rounds: 1, roundMs: 7000 }) as any;
    expect(old.roundMs).toBe(7000);
  });
});
