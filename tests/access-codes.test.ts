// Pre-approved access codes (D-112): created in the console, used by one table, approving it without a pairing code.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCloud } from "../apps/cloud/src/server.ts";
import { check, expiryFor, normalizeCode, parseScope, stale, type AccessCode } from "../apps/cloud/src/access-codes.ts";
import { normalizeAccessCode } from "../apps/table-host/src/cloud.ts";
import { testHost, until } from "./helpers.ts";

const ADMIN = "admin-token-for-tests-123";
let cloud: Awaited<ReturnType<typeof startCloud>>;
let base: string;
const hosts: Awaited<ReturnType<typeof testHost>>[] = [];

const admin = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : null };
};
const hello = async (body: Record<string, unknown>, headers: Record<string, string> = {}) => {
  const r = await fetch(`${base}/api/tables/hello`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const newCode = async (o: Record<string, unknown> = {}) => {
  const r = await admin("POST", "/admin/api/codes", { label: "Klaus home", validity: "month", ...o });
  expect(r.status).toBe(201);
  return r.body as { id: string; code: string; hint: string };
};
const host = async (o: Parameters<typeof testHost>[0] = {}) => {
  const t = await testHost({ cloudUrl: base, cloudPollMs: 30, cloudHeartbeatMs: 50, ...o });
  hosts.push(t);
  return t;
};
const tableRow = async (tableId: string) => ((await admin("GET", "/admin/api/tables")).body as any[]).find((t) => t.tableId === tableId);
const codeRow = async (id: string) => ((await admin("GET", "/admin/api/codes")).body as any[]).find((c) => c.id === id);
/** A table id the way the table host makes them. */
const tid = () => `t_${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`.slice(0, 26);

beforeEach(async () => {
  // GitHub is unreachable here: added repositories stay listed with a fetch error, which is all the scope tests need.
  cloud = await startCloud({ port: 0, host: "127.0.0.1", adminToken: ADMIN, publicUrl: "https://games.skylar.technology", githubApiUrl: "http://127.0.0.1:9", gameRepoRefreshMs: 0 });
  base = `http://127.0.0.1:${cloud.port}`;
});
afterEach(async () => {
  vi.useRealTimers();
  for (const h of hosts.splice(0)) await h.close();
  await cloud.close();
});

describe("access codes: the pieces", () => {
  it("normalises typed codes the same way on the service and the table", () => {
    for (const f of [normalizeCode, normalizeAccessCode]) {
      expect(f("abcd-efgh")).toBe("ABCDEFGH");
      expect(f(" ABCD EFGH ")).toBe("ABCDEFGH");
      expect(f("ABCDEFG")).toBeNull(); // too short
      expect(f("ABCDEFG0")).toBeNull(); // 0 is not in the alphabet
      expect(f("ABCDEFGI")).toBeNull(); // nor I
      expect(f(42)).toBeNull();
    }
  });

  it("counts a week in days and months and years on the calendar", () => {
    const from = Date.UTC(2026, 0, 31, 12);
    expect(expiryFor("week", from)).toBe(from + 7 * 86400_000);
    expect(new Date(expiryFor("month", from)!).toISOString()).toBe("2026-03-03T12:00:00.000Z"); // 31 Jan + 1 month rolls over
    expect(new Date(expiryFor("year", from)!).toISOString()).toBe("2027-01-31T12:00:00.000Z");
    expect(expiryFor("forever", from)).toBeNull();
  });

  it("checks a code for a table: unknown, revoked, someone else's, expired only before binding", () => {
    const now = Date.now();
    const c = { revokedAt: null, tableId: null, expiresAt: now + 1000 } as unknown as AccessCode;
    expect(check(undefined, "t1", now)).toBe("unknown");
    expect(check(c, "t1", now)).toBe("accepted");
    expect(check({ ...c, expiresAt: now - 1 }, "t1", now)).toBe("expired");
    expect(check({ ...c, tableId: "t1", expiresAt: now - 1 }, "t1", now)).toBe("accepted"); // bound: past validity, still good
    expect(check({ ...c, tableId: "t2" }, "t1", now)).toBe("in-use");
    expect(check({ ...c, revokedAt: now }, "t1", now)).toBe("revoked");
  });

  it("keeps an ended code for a year, and longer while a table uses it", () => {
    const now = Date.now();
    const year = 365 * 86400_000;
    const c = { revokedAt: null, expiresAt: now - year - 1000 } as unknown as AccessCode;
    expect(stale(c, false, now)).toBe(true);
    expect(stale(c, true, now)).toBe(false);
    expect(stale({ ...c, expiresAt: now - year + 1000 }, false, now)).toBe(false);
    expect(stale({ ...c, expiresAt: null }, false, now)).toBe(false); // forever
    expect(stale({ ...c, expiresAt: null, revokedAt: now - year - 1 }, false, now)).toBe(true);
  });

  it("parses scopes and refuses nonsense", () => {
    expect(parseScope({ kind: "none" })).toEqual({ kind: "none" });
    expect(parseScope({ kind: "all" })).toEqual({ kind: "all" });
    expect(parseScope({ kind: "repos", repos: ["Klaus/Extra-Games", "klaus/extra-games"] })).toEqual({ kind: "repos", repos: ["klaus/extra-games"] });
    expect(parseScope({ kind: "repos", repos: [] })).toEqual({ kind: "none" });
    for (const bad of [null, "all", { kind: "some" }, { kind: "repos" }, { kind: "repos", repos: ["../x"] }]) expect(() => parseScope(bad)).toThrow();
  });
});

describe("access codes: console", () => {
  it("creates a code, shows it only in the answer, and lists it by hint and label", async () => {
    const c = await newCode();
    expect(c.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(c.hint).toBe(c.code.slice(0, 2));
    const list = (await admin("GET", "/admin/api/codes")).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: c.id, label: "Klaus home", validity: "month", state: "active", table: null, scope: { kind: "none" }, createdBy: "admin token" });
    expect(JSON.stringify(list)).not.toContain(c.code.replace("-", ""));
    expect(JSON.stringify(list)).not.toContain(c.code);
    expect(list[0].hash).toBeUndefined();
  });

  it("refuses bad validities, scopes and unknown repositories, and needs a signed-in admin", async () => {
    expect((await admin("POST", "/admin/api/codes", { validity: "decade" })).status).toBe(400);
    expect((await admin("POST", "/admin/api/codes", { validity: "week", scope: { kind: "some" } })).status).toBe(400);
    const unknown = await admin("POST", "/admin/api/codes", { validity: "week", scope: { kind: "repos", repos: ["klaus/nowhere"] } });
    expect(unknown).toMatchObject({ status: 400, body: { error: expect.stringContaining("klaus/nowhere") } });
    expect((await fetch(`${base}/admin/api/codes`)).status).toBe(401);
    expect((await fetch(`${base}/admin/api/codes`, { method: "POST", body: "{}" })).status).toBe(401);
  });

  it("edits label, validity (from now) and scope", async () => {
    const c = await newCode({ validity: "week" });
    await admin("POST", "/admin/api/repos", { repo: "klaus/extra-games" });
    const r = await admin("PATCH", `/admin/api/codes/${c.id}`, { label: "Demo kit", validity: "forever", scope: { kind: "repos", repos: ["klaus/extra-games"] } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ label: "Demo kit", validity: "forever", expiresAt: null, scope: { kind: "repos", repos: ["klaus/extra-games"] } });
    expect((await admin("PATCH", "/admin/api/codes/c_000000000000", { label: "x" })).status).toBe(404);
  });
});

describe("access codes: tables", () => {
  it("approves a table started with a code at once, without a pairing code", async () => {
    const c = await newCode();
    const t = await host({ accessCode: c.code.toLowerCase() });
    await until(() => t.host.table.cloud.status === "online");
    expect(t.host.table.cloud.code).toEqual({ hint: c.hint, source: "start", status: "accepted" });
    const state = await t.ok("GET", "/state");
    expect(state.cloud.code).toEqual({ hint: c.hint, source: "start", status: "accepted" });
    expect(JSON.stringify(state)).not.toContain(c.code.replace("-", "")); // phones get the lobby state too
    const row = await tableRow(t.host.cloud!["identity"].tableId);
    expect(row).toMatchObject({ status: "approved", reposFrom: "code", code: { id: c.id, label: "Klaus home" } });
    expect(await codeRow(c.id)).toMatchObject({ state: "active", table: { tableId: row.tableId, status: "approved" }, boundAt: expect.any(Number) });
  });

  it("serves one board: a second table with the same code is refused and waits for a pairing code", async () => {
    const c = await newCode();
    const a = await host({ accessCode: c.code });
    await until(() => a.host.table.cloud.status === "online");
    const b = await host({ accessCode: c.code });
    await until(() => b.host.table.cloud.code?.status === "in-use");
    expect(b.host.table.cloud).toMatchObject({ status: "pending", pairingCode: expect.stringMatching(/^[A-Z0-9]{6}$/) });
    expect((await codeRow(c.id)).lastRefusedAt).toEqual(expect.any(Number));
    // The first table keeps working.
    expect(a.host.table.cloud.status).toBe("online");
  });

  it("tells a table what is wrong with its code and leaves it waiting for a pairing code", async () => {
    const expired = await newCode({ validity: "week" });
    const revoked = await newCode();
    await admin("POST", `/admin/api/codes/${revoked.id}/revoke`);
    expect((await hello({ tableId: tid(), accessCode: "ZZZZ-ZZZZ" })).body).toMatchObject({ status: "pending", code: { status: "unknown" } });
    expect((await hello({ tableId: tid(), accessCode: "not a code" })).body).toMatchObject({ status: "pending", code: { status: "unknown" } });
    expect((await hello({ tableId: tid(), accessCode: revoked.code })).body).toMatchObject({ status: "pending", code: { status: "revoked" } });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 8 * 86400_000);
    expect((await hello({ tableId: tid(), accessCode: expired.code })).body).toMatchObject({ status: "pending", code: { status: "expired" } });
    expect((await codeRow(expired.id)).state).toBe("expired");
  });

  it("keeps a bound table working after its code expires, and the console flags it", async () => {
    const c = await newCode({ validity: "week" });
    const t = await host({ accessCode: c.code });
    await until(() => t.host.table.cloud.status === "online");
    const tableId = t.host.cloud!["identity"].tableId;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 8 * 86400_000);
    // Heartbeats carry on; the same table even says hello again with the code (say, after losing its token).
    const again = await hello({ tableId, accessCode: c.code });
    expect(again.body.code).toBeUndefined(); // an approved table's hello does not re-check its code
    expect(await codeRow(c.id)).toMatchObject({ state: "expired", pastValidity: true, table: { tableId } });
    expect(await tableRow(tableId)).toMatchObject({ status: "approved", code: { pastValidity: true } });
  });

  it("revoking a code disconnects its table, which then hears that the code was revoked", async () => {
    const c = await newCode();
    const t = await host({ accessCode: c.code });
    await until(() => t.host.table.cloud.status === "online");
    expect((await admin("POST", `/admin/api/codes/${c.id}/revoke`)).body).toMatchObject({ state: "revoked" });
    await until(() => t.host.table.cloud.status === "revoked" && t.host.table.cloud.code?.status === "revoked");
    // Reconnect in the console brings the table back, without the revoked code's scope.
    const tableId = t.host.cloud!["identity"].tableId;
    expect((await admin("POST", `/admin/api/tables/${tableId}/reconnect`)).status).toBe(200);
    await until(() => t.host.table.cloud.status === "online");
    expect(await tableRow(tableId)).toMatchObject({ reposFrom: "table", code: null });
  });

  it("releasing a code disconnects its table and lets the next board use it", async () => {
    const c = await newCode();
    const a = await host({ accessCode: c.code });
    await until(() => a.host.table.cloud.status === "online");
    expect((await admin("POST", `/admin/api/codes/${c.id}/release`)).body).toMatchObject({ table: null, boundAt: null });
    await until(() => a.host.table.cloud.status === "revoked");
    a.host.cloud!.stop(); // the old PC is gone
    const b = await host({ accessCode: c.code });
    await until(() => b.host.table.cloud.status === "online");
    expect((await codeRow(c.id)).table.tableId).toBe(b.host.cloud!["identity"].tableId);
  });

  it("deleting a code disconnects its table and removes it from the list", async () => {
    const c = await newCode();
    const t = await host({ accessCode: c.code });
    await until(() => t.host.table.cloud.status === "online");
    expect((await admin("DELETE", `/admin/api/codes/${c.id}`)).status).toBe(200);
    await until(() => t.host.table.cloud.status === "revoked");
    expect((await admin("GET", "/admin/api/codes")).body).toEqual([]);
    await until(() => t.host.table.cloud.code?.status === "unknown"); // its next hello hears the code is gone
  });

  it("gives the table its code's repositories: none, some, all (also ones added later); editing the scope follows", async () => {
    await admin("POST", "/admin/api/repos", { repo: "klaus/extra-games" });
    await admin("POST", "/admin/api/repos", { repo: "klaus/loopy-game" });
    const c = await newCode({ scope: { kind: "repos", repos: ["Klaus/Loopy-Game"] } });
    const t = await host({ accessCode: c.code });
    await until(() => t.host.table.cloud.status === "online");
    const tableId = t.host.cloud!["identity"].tableId;
    expect((await tableRow(tableId)).repos).toEqual(["loopy-game"]);
    // The row's own ticks can't override the code.
    expect((await admin("PUT", `/admin/api/tables/${tableId}/repos`, { repos: ["extra-games"] })).status).toBe(409);
    await admin("PATCH", `/admin/api/codes/${c.id}`, { scope: { kind: "all" } });
    expect((await tableRow(tableId)).repos).toEqual(["extra-games", "loopy-game"]);
    await admin("POST", "/admin/api/repos", { repo: "klaus/third" });
    expect((await tableRow(tableId)).repos).toEqual(["extra-games", "loopy-game", "third"]);
    await admin("PATCH", `/admin/api/codes/${c.id}`, { scope: { kind: "none" } });
    expect((await tableRow(tableId)).repos).toEqual([]);
  });

  it("takes a code typed on the board: approves a waiting table, and can be removed again", async () => {
    const c = await newCode();
    const t = await host();
    await until(() => t.host.table.cloud.status === "pending");
    expect((await t.api("POST", "/cloud/code", { code: "ABC" })).status).toBe(400);
    const s = await t.ok("POST", "/cloud/code", { code: c.code });
    expect(s.cloud.code).toMatchObject({ hint: c.hint, source: "board" });
    await until(() => t.host.table.cloud.status === "online" && t.host.table.cloud.code?.status === "accepted");
    // Kept in table.json: a restart of the table needs nothing.
    expect(t.host.cloud!["identity"].accessCode).toBe(c.code.replace("-", ""));
    const cleared = await t.ok("POST", "/cloud/code", { code: "" });
    expect(cleared.cloud.code).toBeNull();
    expect(t.host.table.cloud.status).toBe("online"); // removing the code does not disconnect the table
  });

  it("links an already approved table to a code typed later, freeing its old code", async () => {
    const first = await newCode({ label: "first" });
    const second = await newCode({ label: "second" });
    const t = await host();
    const pairing = await until(() => t.host.table.cloud.pairingCode);
    await admin("POST", `/admin/api/tables/pair/${pairing}`);
    await until(() => t.host.table.cloud.status === "online");
    const tableId = t.host.cloud!["identity"].tableId;
    expect((await tableRow(tableId)).reposFrom).toBe("table");
    await t.ok("POST", "/cloud/code", { code: first.code });
    await until(() => t.host.table.cloud.code?.status === "accepted");
    expect((await tableRow(tableId)).code.id).toBe(first.id);
    await t.ok("POST", "/cloud/code", { code: second.code });
    await until(() => t.host.table.cloud.code?.status === "accepted" && t.host.table.cloud.code.hint === second.hint);
    expect((await tableRow(tableId)).code.id).toBe(second.id);
    expect((await codeRow(first.id)).table).toBeNull(); // free for another board
  });

  it("lets the code given at start win: the board can't change it", async () => {
    const c = await newCode();
    const t = await host({ accessCode: c.code });
    await until(() => t.host.table.cloud.status === "online");
    expect((await t.api("POST", "/cloud/code", { code: "ABCD-EFGH" })).status).toBe(409);
    expect((await t.api("POST", "/cloud/code", { code: "" })).status).toBe(409);
  });

  it("needs the service for a code at all", async () => {
    const t = await testHost();
    hosts.push(t);
    expect((await t.api("POST", "/cloud/code", { code: "ABCD-EFGH" })).status).toBe(409);
  });

  it("does not let a disconnected table come back with a code", async () => {
    const c = await newCode();
    const t = await host({ accessCode: c.code });
    await until(() => t.host.table.cloud.status === "online");
    const tableId = t.host.cloud!["identity"].tableId;
    await admin("POST", `/admin/api/tables/${tableId}/revoke`);
    await until(() => t.host.table.cloud.status === "revoked");
    const fresh = await newCode();
    expect((await hello({ tableId, accessCode: fresh.code })).body).toMatchObject({ status: "revoked", code: { status: "accepted" } });
    expect((await codeRow(fresh.id)).table).toBeNull(); // not bound to it either
  });

  it("refuses hellos with a code from an address that guessed wrong too often", async () => {
    for (let i = 0; i < 30; i++) expect((await hello({ tableId: tid(), accessCode: "ZZZZ-ZZZZ" })).status).toBe(202);
    expect((await hello({ tableId: tid(), accessCode: "ZZZZ-ZZZZ" })).status).toBe(429);
    // A right code from that address waits too; hellos without a code are unaffected.
    const c = await newCode();
    expect((await hello({ tableId: tid(), accessCode: c.code })).status).toBe(429);
    expect((await hello({ tableId: tid() })).status).toBe(202);
  });

  it("removes codes that ended more than a year ago, unless a table still uses one", async () => {
    const used = await newCode({ validity: "week" });
    const unused = await newCode({ validity: "week" });
    const revoked = await newCode({ validity: "forever" });
    await admin("POST", `/admin/api/codes/${revoked.id}/revoke`);
    const t = await host({ accessCode: used.code });
    await until(() => t.host.table.cloud.status === "online");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 380 * 86400_000);
    await admin("PUT", "/admin/api/settings", { logRetentionDays: 90 }); // runs the housekeeping
    const left = ((await admin("GET", "/admin/api/codes")).body as any[]).map((c) => c.id);
    expect(left).toEqual([used.id]);
  });
});
