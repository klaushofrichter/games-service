// Pachisi: geometry, movement and capture rules, timers, leaving players, AI strength, replay, host play.
import { beforeAll, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assignSides, cellOf, FINISH, legalMoves, SAFE, startCell, type State } from "../games/pachisi/rules.ts";
import { loadGame, seats, start } from "./harness.ts";
import { runSimulation } from "../apps/table-host/src/simulation.ts";
import { LogStore } from "../apps/table-host/src/logs.ts";
import { replay } from "../apps/table-host/src/runtime.ts";
import { testHost } from "./helpers.ts";

let game: Awaited<ReturnType<typeof loadGame>>;
beforeAll(async () => {
  game = await loadGame("pachisi");
});

/** Put the game into a chosen position: tokens per seat, whose turn, and a die waiting to be used. */
function position(st: State, tokens: Record<number, number[]>, turn: number, die: number | null) {
  const players = Object.fromEntries(Object.entries(st.players).map(([k, p]) => [k, { ...p, tokens: tokens[Number(k)] ?? p.tokens }]));
  return { ...st, players, turn, die, phase: die === null ? "roll" : "move", sixes: 0 } as State;
}

describe("board geometry", () => {
  it("starts each side just after its midpoint and wraps around 40 cells", () => {
    expect([0, 1, 2, 3].map(startCell)).toEqual([6, 16, 26, 36]);
    expect(cellOf(2, 0)).toBe(26);
    expect(cellOf(2, 13)).toBe(39);
    expect(cellOf(2, 14)).toBe(0);
    expect(cellOf(2, 39)).toBe(25); // last track cell is the side's midpoint, the home column starts there
    expect(cellOf(2, 40)).toBeNull();
    expect(cellOf(2, -1)).toBeNull();
    expect([...SAFE]).toEqual([6, 16, 26, 36]);
  });

  it("gives players the side of the board they sit at", () => {
    expect(assignSides(seats(2))).toEqual({ 0: 2, 1: 0 });
    expect(assignSides(seats(4))).toEqual({ 0: 2, 1: 1, 2: 0, 3: 3 });
    expect(assignSides(seats(3, "human", 6))).toEqual({ 0: 2, 1: 1, 2: 0 }); // two on the south edge, one north
    expect(assignSides(seats(3, "human", 8))).toEqual({ 0: 2, 1: 1, 2: 3 }); // three on the south edge
  });
});

describe("rules", () => {
  it("needs a 6 to leave the base; otherwise the turn passes", () => {
    let sawSix = false;
    let sawPass = false;
    for (let seed = 1; seed < 40; seed++) {
      const { rt, state } = start(game, 2, { turnSeconds: 0 }, seed);
      const first = state().turn;
      rt.submit(first, { name: "roll" }, "human");
      if (state().die === 6) {
        sawSix = true;
        expect(state()).toMatchObject({ phase: "move", turn: first });
        expect(legalMoves(state(), first, 6)).toEqual([0, 1, 2, 3]);
      } else {
        sawPass = true;
        expect(state()).toMatchObject({ phase: "roll" });
        expect(state().turn).not.toBe(first);
      }
    }
    expect(sawSix && sawPass).toBe(true);
  });

  it("rejects moves out of turn, before rolling and with tokens that cannot move", () => {
    const { rt, state } = start(game, 2, { turnSeconds: 0 });
    const other = state().order.find((x: number) => x !== state().turn);
    expect(rt.submit(other, { name: "roll" }, "human")).toMatchObject({ ok: false, reason: /turn/ });
    expect(rt.submit(state().turn, { name: "move", payload: { token: 0 } }, "human")).toMatchObject({ ok: false, reason: /roll the die/ });
    rt.state = position(state(), { 0: [5, -1, -1, -1] }, 0, 3);
    expect(rt.submit(0, { name: "move", payload: { token: 1 } }, "human")).toMatchObject({ ok: false, reason: /cannot move/ });
    expect(rt.submit(0, { name: "move", payload: { token: 0 } }, "human").ok).toBe(true);
    expect(state().players[0].tokens[0]).toBe(8);
    expect(state().turn).toBe(1);
  });

  it("captures on a normal square and sends the token back to base", () => {
    const { rt, state } = start(game, 2, { turnSeconds: 0 });
    // seat 0 is on side 2 (bottom, starts at cell 26), seat 1 on side 0 (top, starts at cell 6)
    rt.state = position(state(), { 0: [10, -1, -1, -1], 1: [24, -1, -1, -1] }, 0, 4); // seat 0: 26+14=0 → cell 0; seat 1: 6+24=30
    expect(cellOf(2, 14)).toBe(0);
    rt.state = position(state(), { 0: [10, -1, -1, -1], 1: [34, -1, -1, -1] }, 0, 4); // seat 1 at cell (6+34)%40 = 0
    rt.submit(0, { name: "move", payload: { token: 0 } }, "human");
    expect(state().players[1].tokens[0]).toBe(-1);
    expect(state().players[0].captures).toBe(1);
    expect(state().lastMove.captured).toEqual([{ seat: 1, token: 0 }]);
  });

  it("does not capture on a safe start square", () => {
    const { rt, state } = start(game, 2, { turnSeconds: 0 });
    // seat 1 waits on seat 0's start cell 26 = (6 + 20) for seat 1; seat 0 enters with a 6
    rt.state = position(state(), { 0: [-1, -1, -1, -1], 1: [20, -1, -1, -1] }, 0, 6);
    rt.submit(0, { name: "move", payload: { token: 0 } }, "human");
    expect(state().players[1].tokens[0]).toBe(20);
    expect(state().turn).toBe(0); // a 6 earns another roll
  });

  it("needs the exact count to finish and wins when every token is home", () => {
    const { rt, state } = start(game, 2, { turnSeconds: 0, tokens: 2 });
    rt.state = position(state(), { 0: [FINISH, 42] }, 0, 3);
    expect(legalMoves(state(), 0, 3)).toEqual([]);
    expect(legalMoves(state(), 0, 2)).toEqual([1]);
    rt.state = position(state(), { 0: [FINISH, 42] }, 0, 2);
    rt.submit(0, { name: "move", payload: { token: 1 } }, "human");
    expect(rt.over).toBe(true);
    expect(rt.summary?.text).toMatch(/Ann brings every token home/);
  });

  it("plays automatically for a player whose time runs out", () => {
    const { rt, clock, state } = start(game, 2, { turnSeconds: 10 }, 3);
    const first = state().turn;
    clock.advance(); // auto roll
    if (state().phase === "move") clock.advance(); // auto move
    expect(rt.log.some((r) => r.t === "timer")).toBe(true);
    expect(state().turn === first ? state().die === 6 : true).toBe(true);
  });

  it("keeps going when a player leaves, and the last one standing wins", () => {
    const { rt, state } = start(game, 3, { turnSeconds: 0 });
    const t = state().turn;
    expect(rt.seatLeft(t)).toBe(false);
    expect(state().order).toHaveLength(2);
    expect(state().turn).not.toBe(t);
    expect(rt.seatLeft(state().order[0])).toBe(true);
    expect(rt.summary?.highlights.winner).toBeTruthy();
  });
});

describe("AI", () => {
  const sim = async (players: number, games: number, aiOptions: any, seed = 9) => {
    const logs = new LogStore(await mkdtemp(join(tmpdir(), "pachisi-")));
    const r = await runSimulation({ ...game, dir: "" }, { players, games, seed, settings: { turnSeconds: 0 }, aiOptions }, logs, "test");
    return { r, ...(await LogStore.unzip((await logs.read(r.logId))!)) };
  };

  it("finishes every game with a winner, for 2, 3 and 4 players, and replays exactly", async () => {
    for (const n of [2, 3, 4]) {
      const { r, games } = await sim(n, 15, { level: "average" }, n);
      expect(r.games.every((g) => g.reason === "finished" && (g.summary as any).highlights.winner)).toBe(true);
      for (const log of games) expect(replay(game.manifest, game.def, log)).toBe((log.at(-1) as any).stateHash);
    }
  });

  it("the average AI beats the beginner most of the time", async () => {
    const { r } = await sim(2, 120, [{ level: "beginner" }, { level: "average" }], 21);
    const avgWins = r.games.filter((g) => (g.summary as any).highlights.winner === "AI 2").length;
    expect(avgWins / r.games.length).toBeGreaterThan(0.6);
  });
});

describe("through the table host", () => {
  it("lets two decks take turns: roll, move, and refuse out-of-turn actions", async () => {
    const t = await testHost();
    try {
      const a = await t.joinDeck("Ann");
      const b = await t.joinDeck("Ben");
      await t.ok("POST", "/game/select", { gameId: "pachisi", settings: { turnSeconds: 0, tokens: 1 } });
      await a.request("lobby", "ready", { ready: true });
      await b.request("lobby", "ready", { ready: true });
      await t.ok("POST", "/game/start");
      const v = await a.waitView((x) => x.view.myTurn === true);
      expect(v.view.players).toHaveLength(2);
      expect((await b.request("game", "intent", { name: "roll" })).payload.reason).toMatch(/Ann's turn/);
      // play until someone wins (tokens: 1 keeps it short)
      for (let i = 0; i < 400; i++) {
        const st = await t.ok("GET", "/state");
        if (st.phase === "finished") break;
        const board = (await t.ok("GET", "/game/board")).view;
        const deck = board.turn === 0 ? a : b;
        if (board.phase === "roll") await deck.request("game", "intent", { name: "roll" });
        else {
          const me = board.players.find((p: any) => p.seat === board.turn);
          const token = me.tokens.findIndex((x: number) => x !== 44);
          await deck.request("game", "intent", { name: "move", payload: { token } });
        }
      }
      const done = await a.waitState((s) => s.phase === "finished");
      expect(done.summary?.text).toMatch(/wins/);
    } finally {
      await t.close();
    }
  });
});
