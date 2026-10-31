// No free seat (D-129): a seat is taken as soon as a player joins (phone, invite or AI), also while their phone is
// reconnecting. With none free, phones that scan the QR code are told why before they type a name, joining is refused
// with the reason, and + AI player and Invite are refused too.
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startCloud } from "../apps/cloud/src/server.ts";
import { pairTable, testHost } from "./helpers.ts";

let t: Awaited<ReturnType<typeof testHost>>;
let cloud: Awaited<ReturnType<typeof startCloud>> | null = null;
afterEach(async () => {
  await t?.close();
  await cloud?.close();
  cloud = null;
});

const seat = async (token: string) => {
  const r = await fetch(`${t.base}/j/${token}/seat`);
  return { status: r.status, body: await r.json() };
};

describe("a name to start with (D-244)", () => {
  it("is Player N with the lowest N no one at the table has, for the phone and the board's invite", async () => {
    t = await testHost();
    const { token } = await t.ok("GET", "/join");
    expect((await seat(token)).body.name).toBe("Player 1");
    await t.joinDeck("Player 1");
    await t.joinDeck("player 3");
    expect((await seat(token)).body.name).toBe("Player 2");
    expect((await t.ok("GET", "/state")).suggestedName).toBe("Player 2");
  });
});

describe("no free seat (D-129)", () => {
  it("tells a phone before it joins, and refuses the join with the reason", async () => {
    t = await testHost();
    await t.ok("POST", "/layout", { seats: 2 });
    const { token } = await t.ok("GET", "/join");
    expect((await seat(token)).body).toEqual({ free: true, message: null, name: "Player 1" });
    await t.joinDeck("Ann");
    await t.ok("POST", "/ai", {});
    const s = await seat(token);
    expect(s.body.free).toBe(false);
    expect(s.body.message).toBe("There is no free seat. Choose more seats on the board, or remove a player there.");
    expect((await seat("ZZZZZZZZ")).status).toBe(403); // only with the current code

    // The hello is refused with code "no-seat", so the phone shows the reason instead of the form.
    const ws = new WebSocket(t.base.replace("http", "ws") + "/ws");
    await new Promise((r) => ws.once("open", r));
    const reply = new Promise<any>((r) => ws.once("message", (m) => r(JSON.parse(String(m)))));
    ws.send(JSON.stringify({ v: 1, ch: "system", type: "hello", seq: 1, payload: { joinToken: token, name: "Cleo" } }));
    expect((await reply).payload).toMatchObject({ status: 409, code: "no-seat", message: expect.stringMatching(/no free seat/) });
    ws.close();
    expect((await t.ok("GET", "/state")).players).toHaveLength(2);
  });

  it("refuses + AI player, and frees up when someone is removed", async () => {
    t = await testHost();
    await t.ok("POST", "/layout", { seats: 2 });
    const a = await t.joinDeck("Ann");
    const ai = (await t.ok("POST", "/ai", {})).playerId;
    expect((await t.api("POST", "/ai", {})).status).toBe(409);
    await t.ok("DELETE", `/players/${ai}`);
    expect((await t.ok("GET", "/state")).noSeat).toBeNull();
    expect(a.playerId).toBeTruthy();
  });

  it("with eight seats taken, says that someone has to be removed (no larger layout)", async () => {
    t = await testHost();
    await t.ok("POST", "/layout", { seats: 8 });
    await t.joinDeck("Ann");
    for (let i = 0; i < 7; i++) await t.ok("POST", "/ai", {});
    expect((await t.ok("GET", "/state")).noSeat).toBe("There is no free seat. Remove a player on the board first.");
  });

  it("counts the seat of a player whose phone is reconnecting", async () => {
    t = await testHost({ graceMs: 60_000 });
    await t.ok("POST", "/layout", { seats: 2 });
    const a = await t.joinDeck("Ann");
    await t.joinDeck("Ben");
    a.close();
    await new Promise((r) => setTimeout(r, 100));
    expect((await t.ok("GET", "/state")).players.find((p: any) => p.name === "Ann").connected).toBe(false);
    expect((await t.ok("GET", "/state")).noSeat).toMatch(/no free seat/);
  });

  it("during a game that is full, says to join after it", async () => {
    t = await testHost();
    await t.ok("POST", "/layout", { seats: 2 });
    const a = await t.joinDeck("Ann");
    await t.ok("POST", "/ai", {});
    await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds: 20, roundSeconds: 0 } });
    await a.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    expect((await t.ok("GET", "/state")).noSeat).toBe("There is no free seat in this game. Join after it.");
  });

  it("refuses an invite and a remote player when no seat is free", async () => {
    const ADMIN = "admin-token-for-tests-123";
    cloud = await startCloud({ port: 0, host: "127.0.0.1", adminToken: ADMIN, publicUrl: "https://games.skylar.technology" });
    const base = `http://127.0.0.1:${cloud.port}`;
    t = await testHost({ cloudUrl: base, cloudPollMs: 30, cloudHeartbeatMs: 50 });
    await pairTable(t, base, ADMIN);
    await t.ok("POST", "/layout", { seats: 2 });
    await t.joinDeck("Ann");
    await t.ok("POST", "/ai", {});
    const r = await t.api("POST", "/invites", {});
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "no-seat", error: expect.stringMatching(/no free seat/) });
    expect(() => t.host.table.joinRemote("Rita", "sess-1")).toThrow(/no free seat/);
  });
});
