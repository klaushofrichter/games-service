// Players lost during a game (D-119), with the Partners test game (tests/fixtures/seat-games): a game that can't go on
// without a player waits for them while their phone is away (seat held, game paused, no time limit), goes on when they
// are back, and ends with its own reason when they are removed or someone ends it. Games without the hook go on.
import { join } from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { Deck, sleep, testHost, until } from "./helpers.ts";

const GAMES = join(import.meta.dirname, "fixtures", "seat-games");
let t: Awaited<ReturnType<typeof testHost>>;
const extra: Deck[] = [];
afterEach(async () => {
  for (const d of extra.splice(0)) d.close();
  await t?.close();
});

const state = () => t.ok("GET", "/state");

/** Ann and Ben at the table, two AI players that don't score, Partners in `mode`. */
async function partners(mode: "teams" | "free") {
  t = await testHost({ gamesDir: GAMES, showTestGames: true });
  const ann = await t.joinDeck("Ann");
  const ben = await t.joinDeck("Ben");
  await t.ok("POST", "/ai", {});
  await t.ok("POST", "/ai", {});
  await t.ok("POST", "/game/select", { gameId: "partners", settings: { mode } });
  await ann.request("lobby", "ready", { ready: true });
  await ben.request("lobby", "ready", { ready: true });
  await t.ok("POST", "/game/start");
  return { ann, ben };
}

async function back(d: Deck) {
  const again = await Deck.connect(t.base, { sessionToken: d.sessionToken });
  extra.push(again);
  return again;
}

async function lastLog() {
  const [l] = await until(async () => {
    const list = await t.ok("GET", "/logs");
    return list.length ? list : null;
  });
  const zip = await JSZip.loadAsync((await t.api("GET", `/logs/${l.id}.zip`)).body);
  return {
    run: JSON.parse(await zip.file("run.json")!.async("string")),
    records: (await zip.file("game-001.jsonl")!.async("string")).trim().split("\n").map((x) => JSON.parse(x)),
  };
}

describe("a game that can't go on without a player (D-119)", () => {
  it("waits for a player whose phone is away, holds the seat past the waiting time, and goes on when they are back", async () => {
    const { ann } = await partners("teams");
    ann.close();
    const paused = await until(async () => {
      const s = await state();
      return s.phase === "paused" ? s : null;
    });
    expect(paused.pause).toMatchObject({ reason: "player", players: [{ name: "Ann", text: "Partners can't go on without a full team." }] });
    expect(paused.needed).toMatchObject({ [ann.playerId]: "Partners can't go on without a full team." });
    await sleep(600); // twice the tests' waiting time (graceMs 300): the seat is still held
    expect((await state()).players.find((p: any) => p.name === "Ann")).toMatchObject({ connected: false });
    expect((await t.api("POST", "/game/resume")).body.error).toMatch(/waiting for Ann to come back/);
    await back(ann);
    await until(async () => (await state()).phase === "active");
    expect((await state()).pause).toBeNull();
  });

  it("waits for everyone it needs: two players away, one comes back", async () => {
    const { ann, ben } = await partners("teams");
    ann.close();
    ben.close();
    await until(async () => (await state()).pause?.players?.length === 2);
    await back(ann);
    const s = await until(async () => {
      const x = await state();
      return x.pause?.players?.length === 1 ? x : null;
    });
    expect(s.phase).toBe("paused");
    expect(s.pause.players[0].name).toBe("Ben");
    await back(ben);
    await until(async () => (await state()).phase === "active");
  });

  it("ends when the table chooses End game, and the player away then leaves after the waiting time", async () => {
    const { ann } = await partners("teams");
    ann.close();
    await until(async () => (await state()).phase === "paused");
    await t.ok("POST", "/game/end");
    await until(async () => (await state()).phase === "finished");
    await until(async () => !(await state()).players.some((p: any) => p.name === "Ann"));
    const { run, records } = await lastLog();
    expect(run).toMatchObject({ endReason: "terminated", verify: { ok: 1 } });
    expect(records.find((r) => r.t === "disconnected")).toMatchObject({ waiting: "Partners can't go on without a full team." });
  });

  it("ends with the game's reason when a player it needs is removed, and the board can tell beforehand", async () => {
    const { ben } = await partners("teams");
    expect((await state()).needed[ben.playerId]).toBe("Partners can't go on without a full team.");
    await t.ok("DELETE", `/players/${ben.playerId}`);
    const s = await until(async () => {
      const x = await state();
      return x.phase === "finished" ? x : null;
    });
    expect(s.summary.text).toBe("Partners can't go on without a full team.");
    const { run, records } = await lastLog();
    expect(run).toMatchObject({ endReason: "seatLeft", result: "Partners can't go on without a full team.", verify: { ok: 1 } });
    expect(records.at(-2)).toMatchObject({ t: "seatLeft", ended: true });
  });

  it("logs a disconnect and a return, and the game still replays exactly", async () => {
    const { ann } = await partners("teams");
    ann.close();
    await until(async () => (await state()).phase === "paused");
    const again = await back(ann);
    await until(async () => (await state()).phase === "active");
    await again.request("game", "intent", { name: "point" });
    await t.ok("POST", "/game/end");
    const { run, records } = await lastLog();
    const kinds = records.map((r) => r.t);
    expect(kinds.indexOf("disconnected")).toBeLessThan(kinds.indexOf("reconnected"));
    expect(kinds.indexOf("reconnected")).toBeLessThan(kinds.lastIndexOf("intent"));
    expect(run.verify).toMatchObject({ checked: 1, ok: 1 });
  });
});

describe("a game that goes on without a player (D-119)", () => {
  it("goes on while a phone is away, and the player leaves after the waiting time", async () => {
    const { ann } = await partners("free");
    expect((await state()).needed).toEqual({});
    ann.close();
    await sleep(100);
    expect((await state()).phase).toBe("active");
    await until(async () => !(await state()).players.some((p: any) => p.name === "Ann"));
    expect((await state()).phase).toBe("active");
  });

  it("ends with its own reason from onSeatLeft", async () => {
    const { ann, ben } = await partners("free");
    const ais = (await state()).players.filter((p: any) => p.kind === "ai");
    await t.ok("DELETE", `/players/${ais[0].id}`);
    await t.ok("DELETE", `/players/${ais[1].id}`);
    await t.ok("DELETE", `/players/${ben.playerId}`);
    const s = await until(async () => {
      const x = await state();
      return x.phase === "finished" ? x : null;
    });
    expect(s.summary).toMatchObject({ text: "Partners needs at least two players.", highlights: { left: expect.any(Number) } });
    expect(ann.playerId).toBeTruthy();
    expect((await lastLog()).run).toMatchObject({ endReason: "seatLeft", verify: { ok: 1 } });
  });
});

describe("games without the hook", () => {
  it("go on as before when a phone is away", async () => {
    t = await testHost();
    const a = await t.joinDeck("Ann");
    const b = await t.joinDeck("Ben");
    await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds: 20, roundSeconds: 0 } });
    await a.request("lobby", "ready", { ready: true });
    await b.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    expect((await state()).needed).toEqual({});
    b.close();
    await sleep(100);
    expect((await state()).phase).toBe("active");
    await until(async () => !(await state()).players.some((p: any) => p.name === "Ben"));
    expect((await state()).phase).toBe("active");
  });
});
