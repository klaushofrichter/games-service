// D-015: a lost cloud connection pauses a running game; it resumes when the link returns, or can be
// saved (games that allow it) or ended.
import { afterEach, describe, expect, it } from "vitest";
import { pairTable, sleep, testHost } from "./helpers.ts";
import { startCloud } from "../apps/cloud/src/server.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { replay } from "../apps/table-host/src/runtime.ts";

let t: Awaited<ReturnType<typeof testHost>>;
afterEach(async () => {
  await t?.close();
});

async function startRoulette(host: typeof t) {
  const a = await host.joinDeck("Ann");
  await host.ok("POST", "/game/select", { gameId: "roulette", settings: { bettingSeconds: 5, rounds: 2 } });
  await a.request("lobby", "ready", { ready: true });
  await host.ok("POST", "/game/start");
  await a.waitView((v) => v.view.phase === "betting");
  return a;
}

describe("pause on a lost service connection", () => {
  it("pauses, freezes timers and intents, and resumes when the connection returns", async () => {
    t = await testHost();
    t.host.table.setCloud({ status: "online" });
    const a = await startRoulette(t);
    t.host.table.setCloud({ status: "offline" });
    const s = await a.waitState((x) => x.phase === "paused");
    expect(s.pause).toMatchObject({ reason: "cloud", canSave: false });
    expect((await a.request("game", "intent", { name: "placeBet", payload: { type: "red", amount: 10 } })).payload.message).toMatch(/paused/);
    expect((await t.api("POST", "/game/resume")).status).toBe(409); // still offline
    // the betting window (5 s) would have closed by now; paused, it has not
    await sleep(300);
    expect(t.host.table.runtime!.timerDeadlines()).toEqual({});
    t.host.table.setCloud({ status: "online" });
    const back = await a.waitState((x) => x.phase === "active");
    expect(back.pause).toBeNull();
    const v = await a.waitView((x) => x.timers?.betting !== undefined);
    expect(v.timers.betting - v.now).toBeGreaterThan(3000); // the remaining time was kept, not restarted at zero
    expect((await a.request("game", "intent", { name: "placeBet", payload: { type: "red", amount: 10 } })).type).toBe("ack");
  });

  it("does not pause games when the table runs without a cloud service", async () => {
    t = await testHost();
    await startRoulette(t);
    t.host.table.setCloud({ status: "offline" }); // from 'disabled': never was online
    expect(t.host.table.phase).toBe("active");
  });

  it("can end a paused game", async () => {
    t = await testHost();
    t.host.table.setCloud({ status: "online" });
    const a = await startRoulette(t);
    t.host.table.setCloud({ status: "offline" });
    await a.waitState((x) => x.phase === "paused");
    await t.ok("POST", "/game/end");
    const s = await a.waitState((x) => x.phase === "finished");
    expect(s.pause).toBeNull();
  });

  it("saves a savable game and exits; the save replays to the saved position", async () => {
    t = await testHost();
    t.host.table.setCloud({ status: "online" });
    const a = await t.joinDeck("Ann");
    const b = await t.joinDeck("Ben");
    await t.ok("POST", "/game/select", { gameId: "pachisi", settings: { turnSeconds: 0 } });
    await a.request("lobby", "ready", { ready: true });
    await b.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    for (let i = 0; i < 6; i++) {
      const board = (await t.ok("GET", "/game/board")).view;
      const d = board.turn === 0 ? a : b;
      if (board.phase === "roll") await d.request("game", "intent", { name: "roll" });
      else await d.request("game", "intent", { name: "move", payload: { token: board.players.find((p: any) => p.seat === board.turn).tokens.findIndex((x: number) => x !== 44) } });
    }
    const stateHash = (await import("../apps/table-host/src/runtime.ts")).stateHash(t.host.table.runtime!.state);
    t.host.table.setCloud({ status: "offline" });
    const p = await a.waitState((x) => x.phase === "paused");
    expect(p.pause?.canSave).toBe(true);
    const r = await t.ok("POST", "/game/save");
    expect(r.saveId).toMatch(/pachisi-save/);
    const done = await a.waitState((x) => x.phase === "finished");
    expect(done.summary?.text).toMatch(/saved/);
    const saves = await t.ok("GET", "/saves");
    expect(saves[0]).toMatchObject({ id: r.saveId, gameId: "pachisi" });
    const save = JSON.parse(await readFile(join(t.host.logs.dir, "..", "saves", `${r.saveId}.json`), "utf8"));
    const g = t.host.table.games.get("pachisi")!;
    expect(replay(g.manifest, g.def, save.log)).toBe(stateHash);
  });

  it("refuses to save games that do not support it", async () => {
    t = await testHost();
    await startRoulette(t);
    expect((await t.api("POST", "/game/save")).body.error).toMatch(/cannot be saved/);
  });

  it("pauses when the real cloud service goes away", async () => {
    const ADMIN = "admin-token-for-tests-123";
    const cloud = await startCloud({ port: 0, host: "127.0.0.1", adminToken: ADMIN, publicUrl: "https://example.test" });
    const base = `http://127.0.0.1:${cloud.port}`;
    t = await testHost({ cloudUrl: base, cloudPollMs: 30, cloudHeartbeatMs: 60 });
    await pairTable(t, base, ADMIN);
    const a = await startRoulette(t);
    await cloud.close();
    const s = await a.waitState((x) => x.phase === "paused");
    expect(s.cloud.status).toBe("offline");
  });
});
