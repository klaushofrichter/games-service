// FreeCell (D-308): the cards' rules, the solver, and the game as the table plays it.
import { beforeAll, describe, expect, it } from "vitest";
import { HOME, apply, autoMoves, bestTarget, capacity, deal, refusal, runLength, solve, solved, type Position } from "../games/freecell/engine.ts";
import { expectReplay, loadGame, start } from "./harness.ts";

let game: Awaited<ReturnType<typeof loadGame>>;
beforeAll(async () => {
  game = await loadGame("freecell");
});

// card = rank * 4 + suit; suits ♠ 0, ♥ 1, ♦ 2, ♣ 3
const c = (name: string) => "A23456789TJQK".indexOf(name[0]!) * 4 + "shdc".indexOf(name[1]!);
const pos = (cols: string[][], cells: (string | null)[] = [null, null, null, null], home = [0, 0, 0, 0]): Position => ({
  cols: Array.from({ length: 8 }, (_, i) => (cols[i] ?? []).map(c)),
  cells: cells.map((x) => (x === null ? null : c(x))),
  home,
});

describe("FreeCell: the cards", () => {
  it("a deal is its number: 52 different cards, seven in the first four columns, six in the others", () => {
    const d = deal(4711);
    expect(d).toEqual(deal(4711));
    expect(d).not.toEqual(deal(4712));
    expect(new Set(d.cols.flat()).size).toBe(52);
    expect(d.cols.map((col) => col.length)).toEqual([7, 7, 7, 7, 6, 6, 6, 6]);
  });

  it("a card goes on one a rank higher of the other colour, to a free cell, or home in its suit's order", () => {
    const p = pos([["7h"], ["6s"], ["6d"], ["As", "2s"]], ["Kc", null, null, null]);
    expect(refusal(p, { from: 1, to: 0, n: 1 })).toBeNull(); // 6♠ on 7♥
    expect(refusal(p, { from: 2, to: 0, n: 1 })).toMatch(/6♦ can't go on 7♥/); // the same colour
    expect(refusal(p, { from: 1, to: 9, n: 1 })).toBeNull();
    expect(refusal(p, { from: 1, to: 8, n: 1 })).toMatch(/taken/);
    expect(refusal(p, { from: 3, to: HOME, n: 1 })).toMatch(/2♠ can't go to its foundation yet/);
    expect(refusal({ ...p, home: [1, 0, 0, 0], cols: p.cols.map((col, i) => (i === 3 ? [c("2s")] : col)) }, { from: 3, to: HOME, n: 1 })).toBeNull();
    expect(refusal(p, { from: 5, to: 0, n: 1 })).toMatch(/no such card/);
  });

  it("a run moves together as far as free cells and empty columns allow", () => {
    const p = pos([["9c", "8h", "7s", "6d", "5c"], ["6h"], ["Ks"], ["Qs"], ["Js"], ["Ts"], ["9s"], ["8s"]], ["2c", "3c", null, null]);
    expect(runLength(p.cols[0]!)).toBe(5);
    expect(capacity(p, 1)).toBe(3); // two free cells, no empty column
    expect(refusal(p, { from: 0, to: 1, n: 1 })).toBeNull(); // 5♣ on 6♥
    const q = pos([["9c", "8h", "7s", "6d", "5c"], ["Th"], [], ["Qs"], ["Js"], ["Ts"], ["9s"], ["8s"]], ["2c", "3c", "4c", null]);
    expect(capacity(q, 1)).toBe(4); // one free cell, one empty column
    expect(refusal(q, { from: 0, to: 1, n: 5 })).toMatch(/Not enough free cells/);
    expect(refusal(q, { from: 0, to: 1, n: 6 })).toMatch(/no such card/);
    expect(capacity(q, 2)).toBe(2); // to the empty column itself: it does not count as room
    expect(refusal(q, { from: 0, to: 2, n: 2 })).toBeNull();
    expect(refusal(q, { from: 0, to: 2, n: 3 })).toMatch(/Not enough/);
  });

  it("cards nobody needs go home by themselves; with every column in order, all of them", () => {
    const p = pos([["Ks", "As"], ["2s", "3h"], ["Ah"]]);
    const a = autoMoves(p);
    expect(a.cards.map((x) => x)).toEqual([c("As"), c("Ah")]); // the 2♠ lies under the 3♥
    const sorted = pos([["Ks", "Qs", "Js"], ["Kh", "Qh"]], [null, null, null, null], [10, 11, 13, 13]);
    expect(solved(autoMoves(sorted).position)).toBe(true);
  });

  it("a tapped card goes home first, then onto a card, then to an empty column, then to a free cell", () => {
    const p = pos([["As"], ["7h"], ["6s"], ["9d"], ["Kd"], ["Qd"], ["Jd"], []]);
    expect(bestTarget(p, 0, 1)).toEqual({ from: 0, to: HOME, n: 1 });
    expect(bestTarget(p, 2, 1)).toEqual({ from: 2, to: 1, n: 1 });
    expect(bestTarget(p, 3, 1)).toEqual({ from: 3, to: 8, n: 1 }); // a column's only card: not to the empty column
    const q = pos([["3s", "9d"], ["7h"], [], ["Kd"], ["Qd"], ["Jd"], ["Td"], ["8d"]]);
    expect(bestTarget(q, 0, 1)).toEqual({ from: 0, to: 2, n: 1 });
  });
});

describe("FreeCell: the solver", () => {
  it("finds a way through most deals, made of allowed moves only, and the same way every time", () => {
    let found = 0;
    for (let n = 1; n <= 30; n++) {
      const way = solve(deal(n), 20000);
      if (!way) continue;
      found++;
      let p = deal(n);
      for (const m of way) {
        expect(refusal(p, m)).toBeNull();
        p = apply(p, m);
      }
      expect(solved(p)).toBe(true);
    }
    expect(found).toBeGreaterThanOrEqual(24);
    expect(solve(deal(1), 20000)).toEqual(solve(deal(1), 20000));
  });

  it("says so when there is no way", () => {
    // two kings over their suits' aces, nowhere to put them: every free cell holds a card nothing takes
    const stuck = pos([["As", "Ks"], ["Ah", "Kh"], ["Ad", "Kd"], ["Ac", "Kc"], ["2s", "Qs"], ["2h", "Qh"], ["2d", "Qd"], ["2c", "Qc"]], ["Js", "Jh", "Jd", "Jc"]);
    expect(solve(stuck, 5000)).toBeNull();
  });
});

describe("FreeCell: the game", () => {
  const send = (rt: any, name: string, payload?: unknown) => rt.submit(0, { name, payload }, "board");
  const view = (rt: any) => game.def.boardView!(rt.state) as any;

  it("deals only what can be solved, and following the hints solves it", () => {
    const { rt } = start(game, 1, {}, 7);
    expect((rt.state as any).plan.length).toBeGreaterThan(0);
    const v = view(rt);
    expect(v.cols.flat().length).toBe(52);
    expect(v.moves).toBe(0);
    let guard = 0;
    while (!rt.summary && guard++ < 400) {
      expect(send(rt, "hint")).toEqual({ ok: true });
      const h = view(rt).hint;
      expect(h).not.toBeNull();
      expect(send(rt, "move", h)).toEqual({ ok: true });
    }
    expect(rt.summary!.text).toMatch(/Ann solves deal \d+ in \d+ moves and \d+:\d\d\./);
    expect(rt.summary!.highlights).toMatchObject({ won: true, cardsHome: 52, winners: ["Ann"] });
    const ids = rt.summary!.awards!.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(["solved", "no-undo", "good-advice"]));
    expect(ids).not.toContain("no-hint");
    expect(rt.summary!.table).toMatchObject({ columns: ["Cards home", "Moves", "Undos", "Hints", "Time"] });
    expect(rt.summary!.table!.rows[0]![0]).toBe(52);
    expect(expectReplay(game, rt)).toBe(true);
  });

  it("the same seed is the same deal; another seed another", () => {
    const dealOf = (seed: number) => (start(game, 1, {}, seed).rt.state as any).deal;
    expect(dealOf(3)).toBe(dealOf(3));
    expect(dealOf(4)).not.toBe(dealOf(3));
  });

  it("a move that is not allowed is refused in words and changes nothing", () => {
    const { rt } = start(game, 1, {}, 7);
    const before = JSON.stringify(rt.state);
    const col = view(rt).cols[0];
    const r = send(rt, "move", { from: 0, to: HOME, n: 1 });
    if (r.ok) return; // (an ace on top of the first column: this seed has none there)
    expect(r.reason).toMatch(/can't go to its foundation yet/);
    expect(send(rt, "move", { from: 0, to: 0, n: 1 }).reason).toMatch(/already there/);
    expect(send(rt, "move", { from: "x", to: 1 }).reason).toMatch(/not a move/);
    expect(send(rt, "move", { from: 0, to: 1, n: col.length }).ok).toBe(false);
    expect(send(rt, "undo").reason).toMatch(/nothing to take back/);
    expect(send(rt, "nonsense").ok).toBe(false);
    expect(rt.submit(1, { name: "hint" }, "board").ok).toBe(false);
    expect(JSON.stringify(rt.state)).toBe(before);
  });

  it("Undo takes moves back one by one, with the cards that went home after them; Start again deals anew", () => {
    const { rt } = start(game, 1, {}, 7);
    const dealt = JSON.stringify(view(rt).cols);
    const positions = [JSON.stringify([view(rt).cols, view(rt).cells, view(rt).home])];
    for (let i = 0; i < 25; i++) {
      send(rt, "hint");
      expect(send(rt, "move", view(rt).hint)).toEqual({ ok: true });
      positions.push(JSON.stringify([view(rt).cols, view(rt).cells, view(rt).home]));
    }
    expect(view(rt).moves).toBe(25);
    for (let i = 24; i >= 10; i--) {
      expect(send(rt, "undo")).toEqual({ ok: true });
      expect(JSON.stringify([view(rt).cols, view(rt).cells, view(rt).home])).toBe(positions[i]);
    }
    expect(view(rt).undos).toBe(15);
    expect(view(rt).canUndo).toBe(true);
    // off the solver's way now: a hint finds a new one from here
    expect((rt.state as any).plan).toBeNull();
    expect(send(rt, "hint")).toEqual({ ok: true });
    expect(view(rt).hint).not.toBeNull();
    expect(send(rt, "restart")).toEqual({ ok: true });
    expect(JSON.stringify(view(rt).cols)).toBe(dealt);
    expect(view(rt).canUndo).toBe(false);
    expect(send(rt, "restart").ok).toBe(false);
  });

  it("a tap moves a card where it fits best, and what can be moved is listed for the board", () => {
    const { rt } = start(game, 1, {}, 7);
    const legal = view(rt).legal as Record<string, number[]>;
    const [key, targets] = Object.entries(legal).find(([k]) => k.endsWith(":1"))!;
    const from = Number(key.split(":")[0]);
    expect(targets.length).toBeGreaterThan(0);
    const want = bestTarget({ cols: view(rt).cols, cells: view(rt).cells, home: view(rt).home }, from, 1)!;
    const card = view(rt).cols[from].at(-1);
    expect(send(rt, "tap", { from })).toEqual({ ok: true });
    const v = view(rt);
    const there = want.to === HOME ? v.home[card & 3] > card >> 2 : want.to >= 8 ? v.cells[want.to - 8] === card : v.cols[want.to].includes(card);
    expect(there).toBe(true);
    expect(v.moves).toBe(1);
  });

  it("giving up ends the game unsolved, with the cards that were home", () => {
    const { rt } = start(game, 1, {}, 7);
    send(rt, "hint");
    send(rt, "move", view(rt).hint);
    expect(send(rt, "giveUp")).toEqual({ ok: true });
    expect(rt.summary!.text).toMatch(/Ann gives up deal \d+ with \d+ of 52 cards home\./);
    expect(rt.summary!.highlights).toMatchObject({ won: false, winners: [] });
    expect(rt.summary!.awards!.map((a) => a.id)).not.toContain("solved");
    expect(send(rt, "hint").ok).toBe(false);
    expect(expectReplay(game, rt)).toBe(true);
  });

  it("the phone and the board see the same open cards", () => {
    const { rt } = start(game, 1, {}, 7);
    expect(game.def.view(rt.state, 0)).toEqual(game.def.boardView!(rt.state));
  });
});
