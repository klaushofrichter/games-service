// The statistics window's data (D-140): awards from the game, checked by the host, and what the log tells about pace.
import { beforeAll, describe, expect, it } from "vitest";
import { leastAward, mostAward } from "../packages/sdk/src/index.ts";
import { withStatistics } from "../apps/table-host/src/stats.ts";
import type { LogRecord } from "../apps/table-host/src/runtime.ts";
import { loadGame, start } from "./harness.ts";
import { testHost, until } from "./helpers.ts";

const A = { id: "a", icon: "🏅", title: "A" };
const sc = (...v: number[]) => v.map((score, seat) => ({ seat, score }));

describe("award helpers", () => {
  it("most: the seats with the highest score, ties shared", () => {
    expect(mostAward(A, sc(1, 3, 3), (n) => `${n} x`)).toEqual({ ...A, seats: [1, 2], value: "3 x" });
  });
  it("most: nobody when everyone has nothing, or everyone ties", () => {
    expect(mostAward(A, sc(0, 0, 0))).toBeNull();
    expect(mostAward(A, sc(2, 2))).toBeNull();
    expect(mostAward(A, sc(5))).toBeNull();
  });
  it("least: the lowest score, unless everyone ties", () => {
    expect(leastAward(A, sc(0, 2, 1))).toEqual({ ...A, seats: [0] });
    expect(leastAward(A, sc(1, 1, 1))).toBeNull();
  });
});

const seat = (s: number, name: string, kind: "human" | "ai" = "human") => ({ seat: s, playerId: `p${s}`, name, kind, edge: "south" as const });
function log(...rest: LogRecord[]): LogRecord[] {
  return [{ t: "start", at: 0, gameId: "g", version: "1", seed: 1, settings: {}, seats: [seat(0, "Ann"), seat(1, "Ben"), seat(2, "Bot", "ai")], aiOptions: {}, simulation: false }, ...rest];
}
const move = (at: number, s: number): LogRecord => ({ t: "intent", at, seat: s, by: s === 2 ? "ai" : "human", intent: { name: "x", payload: null }, accepted: true });

describe("withStatistics", () => {
  it("keeps the game's awards that some, not all, players hold; drops unknown seats", () => {
    const out = withStatistics(
      {
        text: "t",
        highlights: {},
        awards: [
          { ...A, id: "one", seats: [1] },
          { ...A, id: "all", seats: [0, 1, 2] },
          { ...A, id: "none", seats: [] },
          { ...A, id: "ghost", seats: [7] },
          { ...A, id: "mixed", seats: [0, 7, 0] },
        ],
      },
      log(),
    )!;
    expect(out.awards!.map((a) => [a.id, a.seats])).toEqual([["one", [1]], ["mixed", [0]]]);
    expect(out.players).toEqual([{ seat: 0, name: "Ann", ai: false }, { seat: 1, name: "Ben", ai: false }, { seat: 2, name: "Bot", ai: true }]);
  });

  it("counts moves and thinking time per player, without the time the game stood paused", () => {
    const out = withStatistics(
      { text: "t", highlights: {} },
      log(
        move(1000, 0), // Ann 1 s
        move(4000, 1), // Ben 3 s
        move(4500, 2), // the AI
        { t: "pause", at: 5000, reason: "cloud" },
        { t: "resume", at: 65000, reason: "cloud" },
        move(66500, 0), // Ann 2 s (62 s minus the 60 s pause)
        move(76500, 1), // Ben 10 s
        move(77500, 0), // Ann 1 s
        move(87500, 1), // Ben 10 s
      ),
    )!;
    expect(out.play).toEqual({
      columns: ["Player", "Moves", "Time per move", "Longest move"],
      rows: [
        ["Ann", 3, "1.3 s", "2.0 s"],
        ["Ben", 3, "7.7 s", "10 s"],
        ["Bot", 1, "–", "–"],
      ],
    });
    expect(out.awards!.map((a) => [a.id, a.seats])).toEqual([["quick-draw", [0]], ["deep-thinker", [1]]]);
  });

  it("gives no pace awards with fewer than two people of at least three moves", () => {
    const out = withStatistics({ text: "t", highlights: {} }, log(move(1000, 0), move(2000, 1), move(3000, 0), move(4000, 1)))!;
    expect(out.awards).toEqual([]);
  });

  it("no summary, no statistics", () => {
    expect(withStatistics(null, log())).toBeNull();
  });
});

describe("Coin Flip awards", () => {
  let game: Awaited<ReturnType<typeof loadGame>>;
  beforeAll(async () => {
    game = await loadGame("coin-flip");
  });
  it("calls out the sharpshooter and the fans, and leaves out what everyone shares", () => {
    const { rt } = start(game, 3, { rounds: 2, roundSeconds: 0 });
    for (const g of [["heads", "tails", "tails"], ["heads", "tails", "heads"]]) g.forEach((x, s) => rt.submit(s, { name: "guess", payload: x }, "human"));
    const awards = rt.summary!.awards!;
    const heads = rt.summary!.table!.rows.map((r) => r[2]);
    expect(awards.find((a) => a.id === "heads-fan")!.seats).toEqual(heads.map((h, s) => [h, s]).filter(([h]) => h === Math.max(...(heads as number[]))).map(([, s]) => s));
    for (const a of awards) expect(a.seats.length).toBeGreaterThan(0), expect(a.seats.length).toBeLessThan(3);
  });
});

describe("on the table", () => {
  it("the finished game's summary carries the statistics, also in the history", async () => {
    const t = await testHost();
    const ann = await t.joinDeck("Ann");
    const ben = await t.joinDeck("Ben");
    await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds: 1, roundSeconds: 0 } });
    await ann.request("lobby", "ready", { ready: true });
    await ben.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    await ann.request("game", "intent", { name: "guess", payload: "heads" });
    await ben.request("game", "intent", { name: "guess", payload: "tails" });
    await until(() => t.host.table.state().phase === "finished");
    const s = t.host.table.state().summary!;
    expect(s.players!.map((p) => p.name)).toEqual(["Ann", "Ben"]);
    expect(s.play!.rows.map((r) => [r[0], r[1]])).toEqual([["Ann", 1], ["Ben", 1]]);
    await until(async () => (await t.api("GET", "/history")).body.length > 0);
    const id = (await t.api("GET", "/history")).body[0].id;
    const h = await t.ok("GET", `/history/${id}/1/statistics`);
    expect(h.players).toEqual(s.players);
    expect(h.awards).toEqual(s.awards);
    ann.close();
    ben.close();
    await t.close();
  });
});

describe("Hold'em awards", () => {
  it("counts during the game without touching earlier states, and awards the standouts", async () => {
    const game = await loadGame("holdem");
    const { rt, clock } = start(game, 3, { hands: 6, turnSeconds: 0, showdownSeconds: 2 }, 7);
    const states: string[] = [];
    let guard = 0;
    while (!rt.over && guard++ < 2000) {
      const s = rt.state as any;
      if (s.toAct === null) {
        clock.advance(); // the next hand after the showdown
        continue;
      }
      states.push(JSON.stringify(s.stats));
      const legal = ["raise", "call", "check", "fold"];
      const pick = guard % 7 === 0 ? "fold" : guard % 3 === 0 ? "raise" : "call";
      for (const a of [pick, ...legal]) if (rt.submit(s.toAct, { name: a }, "human").ok) break;
    }
    expect(rt.over).toBe(true);
    const sum = rt.summary!;
    expect(sum.table!.columns).toContain("Best hand");
    for (const a of sum.awards!) {
      expect(a.seats.length).toBeGreaterThan(0);
      expect(a.seats.length).toBeLessThan(3);
    }
    const peak = (rt.state as any).stats;
    const rich = sum.awards!.find((a) => a.id === "rich");
    if (rich) expect(rich.seats.every((x) => peak[x].peak === Math.max(...Object.values(peak).map((p: any) => p.peak)))).toBe(true);
    // the first recorded counters were not changed by later moves (the rules stay pure)
    expect(JSON.parse(states[0])).toEqual(Object.fromEntries([0, 1, 2].map((x) => [x, { peak: 500, biggestPot: 0, handsWon: 0, raises: 0, folds: 0, allIns: 0, bestHand: null }])));
  });
});
