// D-126: ctx.now(), the game time a rule sees: the table's clock since the start, pauses left out, logged with every
// input so a replay gets the same values. The test game records ctx.now() for every input in its state.
import { describe, expect, it } from "vitest";
import { defineGame } from "../packages/sdk/src/index.ts";
import { manifestSchema } from "../packages/protocol/src/index.ts";
import { GameRuntime, VirtualClock, replay, replayLog, stateHash, type Clock } from "../apps/table-host/src/runtime.ts";

type S = { seen: [string, number][] };
const def = defineGame<S>({
  setup: (ctx) => ({ seen: [["setup", ctx.now()]] }),
  onIntent: (s, seat, intent, ctx) => (intent.name === "tap" ? { state: { seen: [...s.seen, [`tap${seat}`, ctx.now()]] } } : { reject: "no" }),
  onTimer: (s, id, ctx) => ({ state: { seen: [...s.seen, [id, ctx.now()]] } }),
  onSeatLeft: (s, seat, ctx) => ({ state: { seen: [...s.seen, [`left${seat}`, ctx.now()]] } }),
  view: (s) => s,
  boardView: (s) => s,
  isOver: () => null,
});
const manifest = manifestSchema.parse({
  id: "clock-test", name: "Clock test", version: "1.0.0", sdk: "^0.1", players: { min: 2, max: 2 }, turnModel: "sequential",
  seatLayouts: [2], edges: ["north", "south"],
});
const seats = [0, 1].map((seat) => ({ seat, playerId: `p${seat}`, name: `P${seat}`, kind: "human" as const }));

/** A clock the test moves by hand. */
class HandClock implements Clock {
  t = 1_000_000;
  private v = new VirtualClock();
  now() {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number) {
    return this.v.setTimeout(fn, ms);
  }
  clearTimeout(h: unknown) {
    this.v.clearTimeout(h);
  }
}

function end(rt: GameRuntime) {
  rt.finish("terminated", null);
  return rt.log.at(-1) as { stateHash: string };
}

describe("game time (D-126)", () => {
  it("counts from the start, leaves pauses out, and is the same in the rules and the log", () => {
    const clock = new HandClock();
    const rt = new GameRuntime(manifest, def, 1, {}, seats, clock);
    clock.t += 1500;
    rt.submit(0, { name: "tap" }, "human");
    rt.pause("cloud");
    clock.t += 60_000; // the service was away for a minute: nobody's clock runs
    rt.resume("cloud");
    clock.t += 250;
    rt.submit(1, { name: "tap" }, "human");
    rt.pause("ai", 1);
    clock.t += 5000;
    rt.pause("player"); // a second reason while paused changes nothing
    clock.t += 5000;
    expect(rt.gameTime()).toBe(1750); // still paused: frozen
    rt.resume("player");
    clock.t += 100;
    rt.fireTimer("flag");
    rt.seatLeft(1);
    const seen = (rt.state as S).seen;
    expect(seen).toEqual([["setup", 0], ["tap0", 1500], ["tap1", 1750], ["flag", 1850], ["left1", 1850]]);
    const gts = rt.log.filter((r) => "gt" in r).map((r) => [r.t, (r as { gt: number }).gt]);
    expect(gts).toEqual([["intent", 1500], ["intent", 1750], ["timer", 1850], ["seatLeft", 1850]]);
    const { stateHash: hash } = end(rt);
    expect(replay(manifest, def, rt.log)).toBe(hash);
  });

  it("refused moves carry their game time too", () => {
    const clock = new HandClock();
    const rt = new GameRuntime(manifest, def, 1, {}, seats, clock);
    clock.t += 42;
    expect(rt.submit(0, { name: "nope" }, "human").ok).toBe(false);
    expect(rt.log.at(-1)).toMatchObject({ t: "intent", accepted: false, gt: 42 });
  });

  it("replays a log from before D-126 (no gt) with game time 0", () => {
    const clock = new HandClock();
    const rt = new GameRuntime(manifest, def, 1, {}, seats, clock);
    clock.t += 900;
    rt.submit(0, { name: "tap" }, "human");
    end(rt);
    const old = rt.log.map((r) => {
      const { gt: _gt, ...rest } = r as Record<string, unknown>;
      return rest;
    }) as typeof rt.log;
    expect((replayLog(manifest, def, old).state as S).seen).toEqual([["setup", 0], ["tap0", 0]]);
    expect(stateHash(replayLog(manifest, def, rt.log).state)).toBe(stateHash(rt.state));
  });
});
