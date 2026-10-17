// Skipping a game's wait from the board (D-136): Hold'em's "Next hand" fires its "next" timer at once.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { manifestSchema } from "../packages/protocol/src/index.ts";
import { Deck, testHost, until } from "./helpers.ts";

type Host = Awaited<ReturnType<typeof testHost>>;
let t: Host;
let decks: Record<number, Deck>;

const view = () => t.host.table.runtime!.boardView() as { phase: string; hand: number; toAct: number | null; over: boolean };

/** Hold'em with Ann and Ben, a long result pause, and the first hand ended by a fold. */
async function toResult() {
  const ann = await t.joinDeck("Ann");
  const ben = await t.joinDeck("Ben");
  await t.ok("POST", "/game/select", { gameId: "holdem", settings: { hands: 3, turnSeconds: 0, showdownSeconds: 30 } });
  await ann.request("lobby", "ready", { ready: true });
  await ben.request("lobby", "ready", { ready: true });
  await t.ok("POST", "/game/start");
  const seats = Object.fromEntries(t.host.table.state().players.map((p) => [p.seat!, p.name === "Ann" ? ann : ben]));
  decks = seats;
  const v = view();
  const r = await decks[v.toAct!].request("game", "intent", { name: "fold" });
  expect(r.type).toBe("ack");
  expect(view().phase).toBe("handOver");
}

beforeEach(async () => {
  t = await testHost();
});
afterEach(async () => {
  await t.close();
});

describe("skipping a game's wait (D-136)", () => {
  it("starts the next hand at once instead of after the result's pause, and logs it as an early timer", async () => {
    await toResult();
    expect(t.host.table.runtime!.timerDeadlines()).toHaveProperty("next");
    await t.ok("POST", "/game/skip-timer", { id: "next" });
    expect(view()).toMatchObject({ phase: "betting", hand: 2 });
    const rec = t.host.table.runtime!.log.filter((r) => r.t === "timer").at(-1);
    expect(rec).toMatchObject({ t: "timer", id: "next", early: true });
    expect(t.host.table.runtime!.timerDeadlines()).not.toHaveProperty("next"); // the old deadline is gone
  });

  it("answers 409 when there is nothing to skip, and 403 for a timer the game does not list", async () => {
    await toResult();
    await t.ok("POST", "/game/skip-timer", { id: "next" });
    const again = await t.api("POST", "/game/skip-timer", { id: "next" }); // a second tap: the hand already runs
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/nothing to skip/);
    expect((await t.api("POST", "/game/skip-timer", { id: "turn" })).status).toBe(403);
    expect((await t.api("POST", "/game/skip-timer", {})).status).toBe(400);
    expect(view().hand).toBe(2);
  });

  it("is refused while no game runs and while the game is paused", async () => {
    expect((await t.api("POST", "/game/skip-timer", { id: "next" })).status).toBe(409);
    await toResult();
    t.host.table.runtime!.pause("cloud");
    expect(t.host.table.runtime!.skipTimer("next")).toBe(false); // a paused clock keeps its timers
    t.host.table.runtime!.resume("cloud");
    expect(t.host.table.runtime!.skipTimer("next")).toBe(true);
  });

  it("replays exactly: a game with skipped results verifies", async () => {
    await toResult();
    await t.ok("POST", "/game/skip-timer", { id: "next" });
    const v = view();
    await decks[v.toAct!].request("game", "intent", { name: "fold" });
    await t.ok("POST", "/game/skip-timer", { id: "next" });
    expect(view().hand).toBe(3);
    await t.ok("POST", "/game/end");
    const logs = await until(async () => {
      const l = await t.ok("GET", "/logs");
      return l.length ? l : null;
    });
    expect(await t.ok("POST", `/logs/${logs[0].id}/verify`)).toMatchObject({ ok: true });
  });

  it("is a manifest list of timer ids, empty by default", () => {
    const base = { id: "x", name: "X", version: "1", sdk: "^0.1", description: "", players: { min: 1, max: 2 }, turnModel: "sequential", seatLayouts: [2], edges: ["north", "south"] };
    expect(manifestSchema.parse(base).skipTimers).toEqual([]);
    expect(manifestSchema.parse({ ...base, skipTimers: ["next"] }).skipTimers).toEqual(["next"]);
    expect(() => manifestSchema.parse({ ...base, skipTimers: ["no spaces"] })).toThrow();
  });
});
