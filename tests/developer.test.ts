// The developer setting "Games without a player at the table" (D-118): off at every start, the table's board turns it
// on. Off: a game needs a player at the table, and the board can't remove the last one while a game is chosen or
// running (a phone that goes away still leaves). On: remote and AI players only, or AI players only.
import { afterEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { testHost, until } from "./helpers.ts";

let t: Awaited<ReturnType<typeof testHost>>;
afterEach(async () => t?.close());

const pick = (rounds = 1) => t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds, roundSeconds: 0 } });

describe("games without a player at the table (D-118)", () => {
  it("is off at start, and the state says so", async () => {
    t = await testHost();
    expect((await t.ok("GET", "/state")).developer).toEqual({ allowNoLocalPlayer: false, boardDeck: false, protectedPlayer: null });
    expect((await t.api("POST", "/developer", { allowNoLocalPlayer: "yes" })).status).toBe(400);
  });

  it("off: AI players alone, or remote players and AIs, can't start", async () => {
    t = await testHost();
    await t.ok("POST", "/ai", {});
    await t.ok("POST", "/ai", {});
    await pick();
    expect((await t.ok("GET", "/state")).game.needs).toEqual(["needs at least one player at the table (or, under Advanced › Developer, games without one)"]);
    expect((await t.api("POST", "/game/start")).body.error).toMatch(/at least one player at the table/);
    const r = t.host.table.joinRemote("Rita", "sess-1");
    t.host.table.setReady(r.playerId, true);
    expect((await t.api("POST", "/game/start")).body.error).toMatch(/at least one player at the table/);
  });

  it("on: a game of AI players only plays to its end, and its log says the setting was on", async () => {
    t = await testHost();
    await t.ok("POST", "/developer", { allowNoLocalPlayer: true });
    expect((await t.ok("GET", "/state")).developer.allowNoLocalPlayer).toBe(true);
    await t.ok("POST", "/ai", {});
    await t.ok("POST", "/ai", {});
    await pick(2);
    expect((await t.ok("GET", "/state")).game.needs).toEqual([]);
    await t.ok("POST", "/game/start");
    await until(async () => (await t.ok("GET", "/state")).phase === "finished");
    const [l] = await until(async () => {
      const list = await t.ok("GET", "/logs");
      return list.length ? list : null;
    });
    const zip = await JSZip.loadAsync((await t.api("GET", `/logs/${l.id}.zip`)).body);
    const run = JSON.parse(await zip.file("run.json")!.async("string"));
    expect(run).toMatchObject({ endReason: "finished", developer: { allowNoLocalPlayer: true } });
    expect(run.players.every((p: any) => p.kind === "ai")).toBe(true);
  });

  it("on: remote players and AIs start a game", async () => {
    t = await testHost();
    await t.ok("POST", "/developer", { allowNoLocalPlayer: true });
    const r = t.host.table.joinRemote("Rita", "sess-1");
    await t.ok("POST", "/ai", {});
    await pick();
    t.host.table.setReady(r.playerId, true);
    await t.ok("POST", "/game/start");
    expect((await t.ok("GET", "/state")).phase).toBe("active");
  });

  it("a log of a normal game has no developer field", async () => {
    t = await testHost();
    const a = await t.joinDeck("Ann");
    await t.ok("POST", "/ai", {});
    await pick();
    await a.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    await a.request("game", "intent", { name: "guess", payload: "heads" });
    const [l] = await until(async () => {
      const list = await t.ok("GET", "/logs");
      return list.length ? list : null;
    });
    const zip = await JSZip.loadAsync((await t.api("GET", `/logs/${l.id}.zip`)).body);
    expect(JSON.parse(await zip.file("run.json")!.async("string")).developer).toBeUndefined();
  });

  it("off: the last player at the table can't be removed while a game is chosen or running", async () => {
    t = await testHost();
    const a = await t.joinDeck("Ann");
    const ai = (await t.ok("POST", "/ai", {})).playerId;
    // No game chosen yet: removing is harmless, so it is allowed (Ann joins again below).
    expect((await t.ok("GET", "/state")).developer.protectedPlayer).toBeNull();
    await pick(3);
    expect((await t.ok("GET", "/state")).developer.protectedPlayer).toBe(a.playerId);
    const refused = await t.api("DELETE", `/players/${a.playerId}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/Ann is the last player at the table/);
    // A second player at the table: either may go, but not both.
    const b = await t.joinDeck("Ben");
    expect((await t.ok("GET", "/state")).developer.protectedPlayer).toBeNull();
    await t.ok("DELETE", `/players/${b.playerId}`);
    expect((await t.api("DELETE", `/players/${a.playerId}`)).status).toBe(409);
    // AI players can always go.
    await t.ok("POST", "/ai", {});
    await t.ok("DELETE", `/players/${ai}`);
    // During the game too.
    await a.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    expect((await t.api("DELETE", `/players/${a.playerId}`)).status).toBe(409);
    expect((await t.ok("GET", "/state")).players.map((p: any) => p.name)).toContain("Ann");
  });

  it("off: a phone that goes away keeps its seat, and the game carries on with the AIs (D-159)", async () => {
    t = await testHost();
    const a = await t.joinDeck("Ann");
    await t.ok("POST", "/ai", {});
    await t.ok("POST", "/ai", {});
    await pick(20);
    await a.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    a.close(); // grace period in the tests: 300 ms
    await new Promise((r) => setTimeout(r, 600));
    const s = await t.ok("GET", "/state");
    expect(s.players.find((p: any) => p.name === "Ann")).toMatchObject({ connected: false });
    expect(s.phase).toBe("active");
  });

  it("on: the last player at the table can be exchanged for an AI, and the game carries on (D-159)", async () => {
    t = await testHost();
    const a = await t.joinDeck("Ann");
    await t.ok("POST", "/ai", {});
    await t.ok("POST", "/ai", {});
    await pick(20);
    await a.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/developer", { allowNoLocalPlayer: true });
    expect((await t.ok("GET", "/state")).developer.protectedPlayer).toBeNull();
    await t.ok("POST", "/game/start");
    const seat = (await t.ok("GET", "/state")).players.find((p: any) => p.id === a.playerId).seat;
    await t.ok("POST", "/exchange", { seat, kind: "ai" });
    const s = await t.ok("GET", "/state");
    expect(s.phase).toBe("active");
    expect(s.players.every((p: any) => p.kind === "ai")).toBe(true);
  });

  it("turning it off drops a chosen game that now can't start, keeps a running one", async () => {
    t = await testHost();
    await t.ok("POST", "/developer", { allowNoLocalPlayer: true });
    await t.ok("POST", "/ai", {});
    await t.ok("POST", "/ai", {});
    await pick(20);
    await t.ok("POST", "/game/start");
    await t.ok("POST", "/developer", { allowNoLocalPlayer: false });
    expect((await t.ok("GET", "/state")).phase).toBe("active");
    await t.ok("POST", "/game/end");
    await until(async () => (await t.ok("GET", "/state")).phase === "finished");
    await t.ok("POST", "/game/close");
    await pick();
    expect((await t.ok("GET", "/state")).game.needs).toEqual(["needs at least one player at the table (or, under Advanced › Developer, games without one)"]);
  });

  it("is off again after a restart, unless the table starts with it on", async () => {
    t = await testHost();
    await t.ok("POST", "/developer", { allowNoLocalPlayer: true });
    await t.close();
    t = await testHost();
    expect((await t.ok("GET", "/state")).developer.allowNoLocalPlayer).toBe(false);
    await t.close();
    t = await testHost({ allowNoLocalPlayer: true }); // ALLOW_NO_LOCAL_PLAYER=1
    expect((await t.ok("GET", "/state")).developer.allowNoLocalPlayer).toBe(true);
  });

  it("exchanging the last player at the table for an AI may switch it on with the exchange (D-223)", async () => {
    t = await testHost();
    const ann = await t.joinDeck("Ann");
    await t.ok("POST", "/ai", {});
    await pick(3);
    await ann.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    const s = await t.ok("GET", "/state");
    const seat = s.players.find((p: any) => p.name === "Ann").seat;
    expect(s.developer.protectedPlayer).toBe(ann.playerId); // the board asks before exchanging her
    await t.ok("POST", "/exchange", { seat, kind: "ai", allowNoLocalPlayer: true });
    const after = await t.ok("GET", "/state");
    expect(after.developer).toMatchObject({ allowNoLocalPlayer: true, protectedPlayer: null });
    expect(after.players.find((p: any) => p.seat === seat).kind).toBe("ai");
  });
});
