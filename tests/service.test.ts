// Cloud service edges, driven directly over its HTTP API (a fake table, no Table Host): table
// authentication, invite and token lifetimes, log ownership, rate limits and admin settings.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startCloud, type CloudOptions } from "../apps/cloud/src/server.ts";
import { sleep } from "./helpers.ts";

const ADMIN = "admin-token-for-tests-123";
let cloud: Awaited<ReturnType<typeof startCloud>>;
let base: string;

async function start(o: Partial<CloudOptions> = {}) {
  cloud = await startCloud({ port: 0, host: "127.0.0.1", adminToken: ADMIN, publicUrl: "https://games.skylar.technology", ...o });
  base = `http://127.0.0.1:${cloud.port}`;
}
beforeEach(() => start());
afterEach(() => cloud.close());

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" || body instanceof Uint8Array ? (body as any) : JSON.stringify(body),
  });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, body: json, text };
}
const admin = (m: string, p: string, b?: unknown) => call(m, p, b, { authorization: `Bearer ${ADMIN}` });

/** A fake table: hello → pairing code → admin approves → token. */
async function pairedTable(id = "table-0001") {
  const first = await call("POST", "/api/tables/hello", { tableId: id, name: "Fake" });
  expect(first.status).toBe(202);
  expect((await admin("POST", `/admin/api/tables/pair/${first.body.pairingCode}`)).status).toBe(200);
  const second = await call("POST", "/api/tables/hello", { tableId: id });
  expect(second.status).toBe(200);
  const token: string = second.body.tableToken;
  expect(token).toBeTruthy();
  const as = (m: string, p: string, b?: unknown) => call(m, p, b, { authorization: `Bearer ${token}` });
  return { id, token, as };
}

describe("table authentication", () => {
  it("hands the table token out once; a second hello without it gets no token", async () => {
    const t = await pairedTable();
    const again = await call("POST", "/api/tables/hello", { tableId: t.id });
    expect(again.body).toEqual({ status: "approved", tokenIssued: true });
    const withToken = await call("POST", "/api/tables/hello", { tableId: t.id }, { authorization: `Bearer ${t.token}` });
    expect(withToken.body.tableToken).toBe(t.token);
  });

  it("refuses malformed table ids and calls with a wrong or revoked token", async () => {
    expect((await call("POST", "/api/tables/hello", { tableId: "x" })).status).toBe(400);
    expect((await call("POST", "/api/tables/hello", { tableId: "../../etc" })).status).toBe(400);
    const t = await pairedTable();
    expect((await call("POST", "/api/tables/heartbeat", {}, { authorization: "Bearer nope" })).status).toBe(401);
    expect((await t.as("POST", "/api/tables/heartbeat", {})).status).toBe(200);
    expect((await admin("POST", `/admin/api/tables/${t.id}/revoke`)).status).toBe(200);
    expect((await t.as("POST", "/api/tables/heartbeat", {})).status).toBe(401);
    expect((await t.as("POST", "/api/tables/invites", {})).status).toBe(401);
    expect((await call("POST", "/api/tables/hello", { tableId: t.id })).status).toBe(403);
  });

  it("refuses the signaling socket without a valid token, and closes it on revoke", async () => {
    const bad = new WebSocket(`${base.replace("http", "ws")}/api/tables/ws`, { headers: { authorization: "Bearer nope" } });
    const refused = await new Promise<number>((r) => bad.on("unexpected-response", (_q, res) => r(res.statusCode ?? 0)));
    expect(refused).toBe(401);
    const t = await pairedTable();
    const ws = new WebSocket(`${base.replace("http", "ws")}/api/tables/ws`, { headers: { authorization: `Bearer ${t.token}` } });
    await new Promise((r) => ws.once("open", r));
    const closed = new Promise<number>((r) => ws.once("close", (c) => r(c)));
    await admin("POST", `/admin/api/tables/${t.id}/revoke`);
    expect(await closed).toBe(4001);
  });

  it("keeps the table token out of the admin table list", async () => {
    const t = await pairedTable();
    const list = await admin("GET", "/admin/api/tables");
    expect(list.text).not.toContain(t.token);
    expect(list.body[0]).toMatchObject({ tableId: t.id, status: "approved" });
  });
});

describe("invites", () => {
  it("expire after their time to live", async () => {
    const t = await pairedTable();
    const inv = (await t.as("POST", "/api/tables/invites", { ttlMinutes: 0.005 })).body; // 300 ms
    expect((await fetch(`${base}/i/${inv.token}`)).status).toBe(200);
    await sleep(400);
    expect((await fetch(`${base}/i/${inv.token}`)).status).toBe(404);
  });

  it("use the default lifetime for nonsense and cap it at a day", async () => {
    const t = await pairedTable();
    const hours = (r: any) => (Date.parse(r.body.expiresAt) - Date.now()) / 3600_000;
    for (const ttl of ["soon", null, -5, 0]) {
      const r = await t.as("POST", "/api/tables/invites", { ttlMinutes: ttl });
      expect(r.status, String(ttl)).toBe(201);
      expect(hours(r), String(ttl)).toBeGreaterThan(1.9);
      expect(hours(r), String(ttl)).toBeLessThan(2.1);
    }
    expect(hours(await t.as("POST", "/api/tables/invites", { ttlMinutes: 99999 }))).toBeLessThanOrEqual(24);
  });

  it("are 8 characters from the speakable alphabet and resolve case-insensitively", async () => {
    const t = await pairedTable();
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const { token } = (await t.as("POST", "/api/tables/invites", {})).body;
      expect(token).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      seen.add(token);
    }
    expect(seen.size).toBe(30);
    const one = [...seen][0];
    expect((await fetch(`${base}/i/${one.toLowerCase()}`)).status).toBe(200);
  });

  it("rate-limit lookups per client", async () => {
    let last = 0;
    for (let i = 0; i < 22; i++) last = (await fetch(`${base}/i/NOPE${i}`)).status;
    expect(last).toBe(429);
  });

  it("behind the ingress, count each forwarded client separately, and only when told to trust the proxy", async () => {
    await cloud.close();
    await start({ trustProxy: true });
    const lookup = (ip: string) => fetch(`${base}/i/NOPE`, { headers: { "x-forwarded-for": `1.2.3.4, ${ip}` } }).then((r) => r.status);
    for (let i = 0; i < 21; i++) await lookup("10.0.0.1");
    expect(await lookup("10.0.0.1")).toBe(429);
    expect(await lookup("10.0.0.2")).toBe(404); // another client is not blocked
    // a forged first entry doesn't help: the ingress's own (last) entry decides
    expect(await fetch(`${base}/i/NOPE`, { headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } }).then((r) => r.status)).toBe(429);

    await cloud.close();
    await start(); // not behind a proxy: the header is ignored
    for (let i = 0; i < 21; i++) await lookup(`10.1.0.${i}`);
    expect(await lookup("10.1.0.99")).toBe(429);
  });
});

describe("logs", () => {
  it("does not let one table overwrite another table's log", async () => {
    const a = await pairedTable("table-aaaa");
    const b = await pairedTable("table-bbbb");
    const zip = new TextEncoder().encode("PK-a");
    expect((await call("PUT", "/api/tables/logs/run-1?gameId=roulette", zip, { authorization: `Bearer ${a.token}`, "content-type": "application/zip" })).status).toBe(201);
    const steal = await call("PUT", "/api/tables/logs/run-1?gameId=roulette", new TextEncoder().encode("PK-b"), { authorization: `Bearer ${b.token}`, "content-type": "application/zip" });
    expect(steal.status).toBe(409);
    const r = await fetch(`${base}/admin/api/logs/run-1.zip`, { headers: { authorization: `Bearer ${ADMIN}` } });
    expect(Buffer.from(await r.arrayBuffer()).toString()).toBe("PK-a");
    // the owner may upload it again (a retry)
    expect((await call("PUT", "/api/tables/logs/run-1?gameId=roulette", zip, { authorization: `Bearer ${a.token}`, "content-type": "application/zip" })).status).toBe(201);
  });

  it("caps the total size of stored logs, dropping the oldest first", async () => {
    await cloud.close();
    await start({ maxLogBytes: 10 });
    const t = await pairedTable();
    const put = async (id: string, data: string) => {
      expect((await call("PUT", `/api/tables/logs/${id}?gameId=roulette`, new TextEncoder().encode(data), { authorization: `Bearer ${t.token}`, "content-type": "application/zip" })).status).toBe(201);
      await sleep(5); // distinct upload times
    };
    await put("old", "1234");
    await put("mid", "5678");
    await put("new", "9abc"); // 12 bytes would exceed 10: "old" goes
    expect((await admin("GET", "/admin/api/logs")).body.map((l: any) => l.id)).toEqual(["mid", "new"]);
    await put("mid", "56789"); // replacing a log counts only its new size: 4 + 5 fits
    expect((await admin("GET", "/admin/api/logs")).body.map((l: any) => l.id).sort()).toEqual(["mid", "new"]);
  });

  it("download tokens expire, and nonsense lifetimes fall back to a day", async () => {
    const short = (await admin("POST", "/admin/api/download-tokens", { expiresInHours: 0.0001 })).body; // 360 ms
    const path = new URL(short.url).pathname;
    expect((await fetch(base + path)).status).toBe(200);
    await sleep(450);
    expect((await fetch(base + path)).status).toBe(404);
    for (const h of ["forever", -1, null]) {
      const t = (await admin("POST", "/admin/api/download-tokens", { expiresInHours: h })).body;
      const hours = (Date.parse(t.expiresAt) - Date.now()) / 3600_000;
      expect(hours, String(h)).toBeGreaterThan(23.9);
      expect(hours, String(h)).toBeLessThan(24.1);
    }
  });
});

describe("admin settings", () => {
  it("validates the retention period and hands it to tables with the heartbeat", async () => {
    for (const d of [0, -1, 3651, 1.5, "ninety"]) expect((await admin("PUT", "/admin/api/settings", { logRetentionDays: d })).status, String(d)).toBe(400);
    expect((await admin("PUT", "/admin/api/settings", { logRetentionDays: 14 })).body).toEqual({ logRetentionDays: 14 });
    const t = await pairedTable();
    expect((await t.as("POST", "/api/tables/heartbeat", {})).body.config.logRetentionDays).toBe(14);
  });

  it("compares the admin token in full", async () => {
    for (const tok of [ADMIN.slice(0, -1), ADMIN + "x", "", ADMIN.toUpperCase()]) {
      expect((await call("GET", "/admin/api/settings", undefined, { authorization: `Bearer ${tok}` })).status, tok).toBe(401);
    }
  });
});
