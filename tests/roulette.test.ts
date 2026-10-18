// Roulette: wheel math, rules, AI simulation invariants, replay, and play through a real host.
import { beforeAll, describe, expect, it } from "vitest";
import { colorOf, PAYOUT, RED, returnFor, validBet, WHEEL_ORDER, wins } from "../games/roulette/wheel.ts";
import { expectReplay, loadGame, start } from "./harness.ts";
import { sleep, testHost } from "./helpers.ts";
import { runSimulation } from "../apps/table-host/src/simulation.ts";
import { LogStore } from "../apps/table-host/src/logs.ts";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let game: Awaited<ReturnType<typeof loadGame>>;
beforeAll(async () => {
  game = await loadGame("roulette");
});

describe("wheel", () => {
  it("has 37 distinct pockets, 18 red and 18 black", () => {
    expect(new Set(WHEEL_ORDER).size).toBe(37);
    expect([...WHEEL_ORDER].sort((a, b) => a - b)).toEqual(Array.from({ length: 37 }, (_, i) => i));
    expect(RED.size).toBe(18);
    expect(WHEEL_ORDER.filter((n) => colorOf(n) === "black")).toHaveLength(18);
    // colors alternate around the wheel after zero
    for (let i = 1; i < 36; i++) expect(colorOf(WHEEL_ORDER[i])).not.toBe(colorOf(WHEEL_ORDER[i + 1]));
  });

  it("settles every bet type correctly", () => {
    expect(wins({ type: "straight", target: 17 }, 17)).toBe(true);
    expect(wins({ type: "red" }, 32)).toBe(true);
    expect(wins({ type: "black" }, 32)).toBe(false);
    expect(wins({ type: "odd" }, 0)).toBe(false);
    expect(wins({ type: "even" }, 0)).toBe(false);
    expect(wins({ type: "low" }, 18)).toBe(true);
    expect(wins({ type: "high" }, 19)).toBe(true);
    expect(wins({ type: "dozen", target: 3 }, 25)).toBe(true);
    expect(wins({ type: "dozen", target: 2 }, 12)).toBe(false);
    expect(wins({ type: "column", target: 1 }, 34)).toBe(true);
    expect(wins({ type: "column", target: 3 }, 36)).toBe(true);
    expect(returnFor({ type: "straight", target: 5, amount: 10 }, 5)).toBe(360);
    expect(returnFor({ type: "dozen", target: 1, amount: 10 }, 5)).toBe(30);
    expect(returnFor({ type: "red", amount: 10 }, 0)).toBe(0);
  });

  it("has the standard house edge of 1/37 on every bet", () => {
    for (const type of Object.keys(PAYOUT) as (keyof typeof PAYOUT)[]) {
      const target = type === "straight" ? 7 : type === "dozen" || type === "column" ? 2 : undefined;
      let back = 0;
      for (let n = 0; n <= 36; n++) back += returnFor({ type, target, amount: 37 }, n);
      expect(back / 37).toBe(36); // stake 37 on each of 37 numbers, 36 back on average
    }
  });

  it("validates bet shapes", () => {
    expect(validBet("straight", 37)).toMatch(/0–36/);
    expect(validBet("dozen", 0)).toMatch(/1, 2 or 3/);
    expect(validBet("red", 5)).toMatch(/no number/);
    expect(validBet("corner", 1)).toMatch(/unknown/);
    expect(validBet("column", 3)).toBeNull();
  });
});

describe("rules", () => {
  it("takes bets, refunds cleared bets and enforces limits", () => {
    const { rt, state } = start(game, 2, { startPoints: 100, minBet: 10, maxBet: 50 });
    expect(rt.submit(0, { name: "placeBet", payload: { type: "red", amount: 5 } }, "human")).toMatchObject({ ok: false, reason: /minimum/ });
    expect(rt.submit(0, { name: "placeBet", payload: { type: "red", amount: 40 } }, "human").ok).toBe(true);
    expect(rt.submit(0, { name: "placeBet", payload: { type: "red", amount: 20 } }, "human")).toMatchObject({ ok: false, reason: /maximum 50/ });
    expect(rt.submit(0, { name: "placeBet", payload: { type: "straight", target: 7, amount: 50 } }, "human").ok).toBe(true);
    expect(rt.submit(0, { name: "placeBet", payload: { type: "black", amount: 20 } }, "human")).toMatchObject({ ok: false, reason: /not enough/ });
    expect(state().balances[0]).toBe(10);
    expect(rt.submit(0, { name: "clearBets" }, "human").ok).toBe(true);
    expect(state().balances[0]).toBe(100);
    expect(rt.submit(1, { name: "placeBet", payload: { type: "red", amount: 10 } }, "human").ok).toBe(true);
    expect(rt.view(0)).toMatchObject({ balance: 100, myBets: [] }); // seat 0 never sees seat 1's private view
  });

  it("spins when everyone is done, settles, and starts the next round after the result timer", () => {
    const { rt, clock, state } = start(game, 2, { startPoints: 1000, rounds: 2 }, 7);
    rt.submit(0, { name: "placeBet", payload: { type: "red", amount: 100 } }, "human");
    rt.submit(0, { name: "placeBet", payload: { type: "straight", target: 0, amount: 10 } }, "human");
    rt.submit(1, { name: "placeBet", payload: { type: "dozen", target: 2, amount: 50 } }, "human");
    rt.submit(0, { name: "done" }, "human");
    expect(state().phase).toBe("betting");
    expect(rt.submit(0, { name: "placeBet", payload: { type: "red", amount: 10 } }, "human").ok).toBe(false);
    rt.submit(1, { name: "done" }, "human");
    const s = state();
    expect(s.phase).toBe("result");
    const n = s.last.number;
    const expect0 = 890 + (colorOf(n) === "red" ? 200 : 0) + (n === 0 ? 360 : 0);
    const expect1 = 950 + (n >= 13 && n <= 24 ? 150 : 0);
    expect(s.balances).toEqual({ 0: expect0, 1: expect1 });
    expect(s.last.results[0].net).toBe(expect0 - 1000);
    expect(rt.submit(0, { name: "placeBet", payload: { type: "red", amount: 10 } }, "human")).toMatchObject({ ok: false, reason: /no more bets/ });
    clock.advance(); // result timer
    expect(state()).toMatchObject({ phase: "betting", round: 2 });
  });

  it("closes betting when the timer runs out and ends after the last round", () => {
    const { rt, clock, state } = start(game, 1, { rounds: 2 }, 3);
    rt.submit(0, { name: "placeBet", payload: { type: "even", amount: 10 } }, "human");
    clock.advance(); // betting timer
    expect(state().phase).toBe("result");
    clock.advance(); // result
    clock.advance(); // betting (no bets)
    clock.advance(); // result -> over
    expect(rt.over).toBe(true);
    expect(rt.summary?.text).toMatch(/Ann wins with \d+ points/);
    expect(rt.summary?.highlights.spins).toHaveLength(2);
    expect(expectReplay(game, rt)).toBe(true);
  });

  it("lets players join and leave between and during rounds", () => {
    const { rt, state } = start(game, 2, {}, 4);
    rt.seatJoined({ seat: 2, playerId: "p2", name: "Cleo", kind: "human" });
    expect(state().balances[2]).toBe(1000);
    rt.submit(0, { name: "placeBet", payload: { type: "red", amount: 10 } }, "human");
    rt.submit(0, { name: "done" }, "human");
    rt.submit(2, { name: "done" }, "human");
    expect(rt.seatLeft(1)).toBe(false); // the last undecided player leaves: the wheel spins
    expect(state().phase).toBe("result");
    expect(rt.seatLeft(0)).toBe(false);
    expect(rt.seatLeft(2)).toBe(true); // nobody left
  });
});

describe("AI simulation", () => {
  it("plays many games for every style without losing or creating points out of thin air", async () => {
    const dir = await mkdtemp(join(tmpdir(), "roulette-sim-"));
    const logs = new LogStore(dir);
    const g = { manifest: game.manifest, def: game.def, dir: "" };
    for (const style of ["conservative", "aggressive", "erratic"]) {
      const r = await runSimulation(g, { players: 4, games: 40, seed: 11, settings: { rounds: 20 }, aiOptions: { style } }, logs, "test");
      expect(r.games.every((x) => x.reason === "finished")).toBe(true);
      const { games } = await LogStore.unzip((await logs.read(r.logId))!);
      for (const log of games) {
        const end = log.at(-1) as any;
        const balances = Object.values(end.summary.highlights.balances) as number[];
        expect(balances.every((b) => b >= 0)).toBe(true);
        // every point won or lost is accounted for by settled bets
        const settled = log.flatMap((r: any) => (r.events ?? []).filter((e: any) => e.name === "settled"));
        const net = settled.reduce((a: number, e: any) => a + Object.values(e.data as Record<string, { net: number }>).reduce((x, y) => x + y.net, 0), 0);
        expect(balances.reduce((a, b) => a + b, 0)).toBe(4000 + net);
        expect(game.def && (await import("../apps/table-host/src/runtime.ts")).replay(game.manifest, game.def, log)).toBe(end.stateHash);
      }
    }
  });

  it("aggressive players spread more bets than conservative ones", async () => {
    const dir = await mkdtemp(join(tmpdir(), "roulette-sim-"));
    const logs = new LogStore(dir);
    const r = await runSimulation({ ...game, dir: "" }, { players: 2, games: 10, seed: 5, settings: { rounds: 5 }, aiOptions: [{ style: "conservative" }, { style: "aggressive" }] }, logs, "test");
    const { games } = await LogStore.unzip((await logs.read(r.logId))!);
    const bets = [0, 0];
    for (const log of games) for (const rec of log as any[]) if (rec.t === "intent" && rec.accepted && rec.intent.name === "placeBet") bets[rec.seat]++;
    expect(bets[1]).toBeGreaterThan(bets[0] * 2);
    expect((games[0][0] as any).aiOptions).toEqual({ 0: { style: "conservative" }, 1: { style: "aggressive" } });
  });
});

describe("statistics (D-150)", () => {
  it("ends with a player table, the wheel's facts and awards", async () => {
    const dir = await mkdtemp(join(tmpdir(), "roulette-sim-"));
    const logs = new LogStore(dir);
    const r = await runSimulation({ ...game, dir: "" }, { players: 6, games: 3, seed: 7, settings: { rounds: 30 }, aiOptions: { style: "aggressive" } }, logs, "test");
    const { games } = await LogStore.unzip((await logs.read(r.logId))!);
    for (const log of games) {
      const summary = (log.at(-1) as any).summary;
      expect(summary.table.columns).toEqual(["Player", "Points", "Net", "Bets", "Spins won", "Biggest win", "Best streak"]);
      expect(summary.table.rows).toHaveLength(6);
      const f = summary.highlights.facts;
      expect(f.spins).toBe(summary.highlights.spins.length);
      expect(f.reds + f.blacks + f.zeros).toBe(f.spins);
      expect(summary.text).toMatch(/Over \d+ spins: \d+ red, \d+ black/);
      expect(summary.awards.length).toBeGreaterThan(3);
      for (const a of summary.awards) expect(a.seats.length).toBeGreaterThan(0);
    }
  });

  it("counts runs of a colour and bets by type", () => {
    const { rt, clock, state } = start(game, 2, { rounds: 3 }, 9);
    for (let k = 0; k < 3; k++) {
      rt.submit(0, { name: "placeBet", payload: { type: "odd", amount: 10 } }, "human");
      rt.submit(0, { name: "placeBet", payload: { type: "straight", target: 0, amount: 10 } }, "human");
      clock.advance();
      clock.advance();
    }
    const st = (state() as any).stats;
    expect(st[0].byType).toEqual({ odd: 3, straight: 3 });
    expect(st[0].zero).toBe(3);
    expect(st[1].sitOut).toBe(3);
    expect(rt.summary?.awards?.map((a) => a.id)).toEqual(expect.arrayContaining(["odd-man", "zero-hero", "wallflower"]));
    expect(expectReplay(game, rt)).toBe(true);
  });

  it("gives AI players some variety: numbers too, not only even-money chances", async () => {
    const dir = await mkdtemp(join(tmpdir(), "roulette-sim-"));
    const logs = new LogStore(dir);
    const r = await runSimulation({ ...game, dir: "" }, { players: 4, games: 4, seed: 3, settings: { rounds: 20 }, aiOptions: { style: "conservative" } }, logs, "test");
    const { games } = await LogStore.unzip((await logs.read(r.logId))!);
    const types = new Set<string>();
    for (const log of games) for (const rec of log as any[]) if (rec.t === "intent" && rec.accepted && rec.intent.name === "placeBet") types.add(rec.intent.payload.type);
    expect(types).toContain("straight");
    expect([...types].some((t) => t === "dozen" || t === "column")).toBe(true);
  });
});

describe("through the table host", () => {
  it("lets six AI players bet at the same time, not one after another (D-150)", async () => {
    // With one second's pause before each AI move, six AIs in a row (a bet and Done each) would need about 12 s;
    // at the same time they are done in about 2, well inside the 5 s to bet.
    const t = await testHost({ aiDelayMs: 1000, allowNoLocalPlayer: true });
    try {
      await t.ok("POST", "/layout", { seats: 6 });
      for (let k = 0; k < 6; k++) await t.ok("POST", "/ai", {});
      await t.ok("POST", "/game/select", { gameId: "roulette", settings: { rounds: 1, bettingSeconds: 5, resultSeconds: 2 } });
      await t.ok("POST", "/game/start");
      const t0 = Date.now();
      let board: any;
      for (;;) {
        board = await t.ok("GET", "/game/board");
        if (board.view.phase === "result" || Date.now() - t0 > 8000) break;
        await sleep(100);
      }
      expect(board.view.phase).toBe("result");
      const staked = Object.values(board.view.last.results as Record<string, { staked: number }>).map((x) => x.staked);
      expect(staked).toHaveLength(6);
      expect(staked.every((x) => x > 0)).toBe(true);
      expect(Date.now() - t0).toBeLessThan(4500); // everyone said Done before the timer ran out
    } finally {
      await t.close();
    }
  });

  it("plays a round from two decks and an AI seat, with private views and a countdown", async () => {
    const t = await testHost();
    try {
      const a = await t.joinDeck("Ann");
      const b = await t.joinDeck("Ben");
      await t.ok("POST", "/ai", {});
      await t.ok("POST", "/game/select", { gameId: "roulette", settings: { rounds: 1, bettingSeconds: 30, resultSeconds: 2 } });
      await a.request("lobby", "ready", { ready: true });
      await b.request("lobby", "ready", { ready: true });
      await t.ok("POST", "/game/start");
      const first = await a.waitView((v) => v.view.phase === "betting");
      expect(first.timers.betting).toBeGreaterThan(first.now + 25_000);

      expect((await a.request("game", "intent", { name: "placeBet", payload: { type: "red", amount: 100 } })).type).toBe("ack");
      expect((await a.request("game", "intent", { name: "placeBet", payload: { type: "red", amount: 5 } })).payload.reason).toMatch(/minimum/);
      const bView = await b.waitView((v) => v.view.phase === "betting");
      expect(bView.view.myBets).toEqual([]);
      expect(bView.view.balance).toBe(1000);
      await b.request("game", "intent", { name: "placeBet", payload: { type: "straight", target: 17, amount: 50 } });

      const board = await t.ok("GET", "/game/board");
      expect(board.view.bets.map((x: any) => x.seat)).toEqual(expect.arrayContaining([0, 1])); // the AI seat may have bet too

      await sleep(60); // the AI seat finishes betting
      await a.request("game", "intent", { name: "done" });
      await b.request("game", "intent", { name: "done" });
      const res = await a.waitView((v) => v.view.phase === "result");
      expect(res.view.last.mine.staked).toBe(100);
      const end = await a.waitState((s) => s.phase === "finished");
      expect(end.summary?.highlights).toHaveProperty("balances");
    } finally {
      await t.close();
    }
  });

  it("serves the game's own board and deck UI but not its rules", async () => {
    const t = await testHost();
    try {
      for (const f of ["board.js", "deck.js"]) {
        const r = await fetch(`${t.base}/games/roulette/${f}`);
        expect(r.status).toBe(200);
        expect(r.headers.get("content-type")).toMatch(/javascript/);
      }
      expect((await fetch(`${t.base}/games/roulette/rules.ts`)).status).toBe(404);
      expect((await fetch(`${t.base}/games/roulette/manifest.json`)).status).toBe(404);
      expect((await fetch(`${t.base}/games/roulette/assets/../rules.ts`)).status).toBe(404);
    } finally {
      await t.close();
    }
  });
});

describe("regressions from review", () => {
  it("does not let a null target bypass the per-spot maximum", () => {
    const { rt } = start(game, 1, { maxBet: 100 });
    expect(rt.submit(0, { name: "placeBet", payload: { type: "red", amount: 100 } }, "human").ok).toBe(true);
    expect(rt.submit(0, { name: "placeBet", payload: { type: "red", target: null, amount: 100 } }, "human")).toMatchObject({ ok: false, reason: /maximum/ });
  });

  it("keeps the maximum bet at or above the minimum", () => {
    const { state } = start(game, 1, { minBet: 500, maxBet: 100 });
    expect(state().maxBet).toBe(500);
  });

  it("AI players keep playing after a timer moves the game on", async () => {
    const t = await testHost();
    try {
      const a = await t.joinDeck("Ann");
      await t.ok("POST", "/ai", {});
      await t.ok("POST", "/game/select", { gameId: "roulette", settings: { rounds: 2, bettingSeconds: 5, resultSeconds: 2 } });
      await a.request("lobby", "ready", { ready: true });
      await t.ok("POST", "/game/start");
      await a.waitView((v) => v.view.phase === "betting");
      await a.request("game", "intent", { name: "done" });
      await a.waitView((v) => v.view.round === 2 && v.view.phase === "betting", );
      await a.request("game", "intent", { name: "done" });
      // round 2 was opened by the result timer; the AI must still act for the wheel to spin early
      const r2 = await a.waitView((v) => v.view.round === 2 && v.view.phase === "result");
      expect(r2.view.last.round).toBe(2);
    } finally {
      await t.close();
    }
  });
});
