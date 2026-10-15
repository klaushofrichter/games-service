// Deleting records from the console (D-114): tables, logs (one, or in bulk), and download tokens.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCloud } from "../apps/cloud/src/server.ts";

const ADMIN = "admin-token-for-tests-123";
let dir: string;
let cloud: Awaited<ReturnType<typeof startCloud>>;
let base: string;

const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : null };
};
const admin = (method: string, path: string, body?: unknown) => call(method, path, body, { authorization: `Bearer ${ADMIN}` });
/** An approved table (through an access code), with its token. */
const table = async (tableId: string) => {
  const code = (await admin("POST", "/admin/api/codes", { validity: "week", label: tableId })).body;
  const r = await call("POST", "/api/tables/hello", { tableId, name: tableId, accessCode: code.code });
  return { tableId, token: r.body.tableToken as string, codeId: code.id as string };
};
const upload = (t: { token: string }, id: string, simulation = false) =>
  fetch(`${base}/api/tables/logs/${id}?gameId=coin-flip&simulation=${simulation ? 1 : 0}`, { method: "PUT", headers: { authorization: `Bearer ${t.token}` }, body: id });
const logIds = async () => ((await admin("GET", "/admin/api/logs")).body as any[]).map((l) => l.id).sort();

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gamecloud-"));
  cloud = await startCloud({ port: 0, host: "127.0.0.1", adminToken: ADMIN, publicUrl: "https://games.skylar.technology", dataDir: dir, gameRepoRefreshMs: 0 });
  base = `http://127.0.0.1:${cloud.port}`;
});
afterEach(async () => {
  await cloud.close();
  await rm(dir, { recursive: true, force: true });
});

describe("deleting tables", () => {
  it("refuses an approved table, deletes a disconnected one and frees its code; logs stay unless asked", async () => {
    const a = await table("t_delete_me_1234");
    await upload(a, "log-a-1");
    expect((await admin("DELETE", `/admin/api/tables/${a.tableId}`)).status).toBe(409);
    await admin("POST", `/admin/api/tables/${a.tableId}/revoke`);
    expect((await admin("DELETE", `/admin/api/tables/${a.tableId}`)).body).toEqual({ ok: true, logsDeleted: 0 });
    expect(((await admin("GET", "/admin/api/tables")).body as any[]).map((t) => t.tableId)).not.toContain(a.tableId);
    expect(((await admin("GET", "/admin/api/codes")).body as any[]).find((c) => c.id === a.codeId).table).toBeNull();
    expect(await logIds()).toEqual(["log-a-1"]);
    expect(((await admin("GET", "/admin/api/logs")).body as any[])[0].tableName).toBeNull();
    // The same PC saying hello again is a new table waiting for approval.
    expect((await call("POST", "/api/tables/hello", { tableId: a.tableId })).body.status).toBe("pending");
    expect((await admin("DELETE", "/admin/api/tables/t_no_such_table_1")).status).toBe(404);
  });

  it("deletes the table's logs with ?logs=1, and only those", async () => {
    const a = await table("t_with_logs_12345");
    const b = await table("t_other_table_123");
    await upload(a, "log-a-1");
    await upload(a, "log-a-2", true);
    await upload(b, "log-b-1");
    await admin("POST", `/admin/api/tables/${a.tableId}/revoke`);
    expect((await admin("DELETE", `/admin/api/tables/${a.tableId}?logs=1`)).body).toEqual({ ok: true, logsDeleted: 2 });
    expect(await logIds()).toEqual(["log-b-1"]);
    expect(existsSync(join(dir, "logs", "log-a-1.zip"))).toBe(false);
  });

  it("stays deleted after a restart", async () => {
    const a = await table("t_gone_for_good_1");
    await admin("POST", `/admin/api/tables/${a.tableId}/revoke`);
    await admin("DELETE", `/admin/api/tables/${a.tableId}`);
    await cloud.close();
    cloud = await startCloud({ port: 0, host: "127.0.0.1", adminToken: ADMIN, publicUrl: "https://games.skylar.technology", dataDir: dir, gameRepoRefreshMs: 0 });
    base = `http://127.0.0.1:${cloud.port}`;
    expect((await admin("GET", "/admin/api/tables")).body).toEqual([]);
  });
});

describe("deleting logs", () => {
  it("deletes one log, file included", async () => {
    const a = await table("t_log_owner_12345");
    await upload(a, "log-1");
    await upload(a, "log-2");
    expect((await admin("DELETE", "/admin/api/logs/log-1")).status).toBe(200);
    expect(await logIds()).toEqual(["log-2"]);
    expect(existsSync(join(dir, "logs", "log-1.zip"))).toBe(false);
    expect((await admin("DELETE", "/admin/api/logs/log-1")).status).toBe(404);
  });

  it("deletes in bulk by kind and table, and never everything at once", async () => {
    const a = await table("t_bulk_a_123456789");
    const b = await table("t_bulk_b_123456789");
    await upload(a, "a-real");
    await upload(a, "a-sim", true);
    await upload(b, "b-real");
    await upload(b, "b-sim", true);
    expect((await admin("POST", "/admin/api/logs/delete", {})).status).toBe(400);
    expect((await admin("POST", "/admin/api/logs/delete", { simulation: true, tableId: b.tableId })).body).toEqual({ deleted: 1 });
    expect(await logIds()).toEqual(["a-real", "a-sim", "b-real"]);
    expect((await admin("POST", "/admin/api/logs/delete", { simulation: true })).body).toEqual({ deleted: 1 });
    expect((await admin("POST", "/admin/api/logs/delete", { tableId: a.tableId })).body).toEqual({ deleted: 1 });
    expect(await logIds()).toEqual(["b-real"]);
  });
});

describe("download tokens", () => {
  it("lists active tokens without the token, and revokes one at once", async () => {
    const t = (await admin("POST", "/admin/api/download-tokens", { label: "pipeline", gameId: "holdem" })).body;
    const other = (await admin("POST", "/admin/api/download-tokens", {})).body;
    const list = (await admin("GET", "/admin/api/download-tokens")).body as any[];
    expect(list.map((d) => d.id).sort()).toEqual([t.id, other.id].sort());
    expect(list.find((d) => d.id === t.id)).toMatchObject({ label: "pipeline", gameId: "holdem", createdBy: "admin token" });
    expect(JSON.stringify(list)).not.toContain(t.token);
    expect((await fetch(`${base}/dl/${t.token}`)).status).toBe(200);
    expect((await admin("DELETE", `/admin/api/download-tokens/${t.id}`)).status).toBe(200);
    expect((await fetch(`${base}/dl/${t.token}`)).status).toBe(404);
    expect((await fetch(`${base}/dl/${other.token}`)).status).toBe(200);
    expect((await admin("DELETE", `/admin/api/download-tokens/${t.id}`)).status).toBe(404);
  });

  it("needs a signed-in admin for all of it", async () => {
    for (const [m, p] of [["GET", "/admin/api/download-tokens"], ["DELETE", "/admin/api/download-tokens/d_000000000000"], ["DELETE", "/admin/api/logs/x"], ["POST", "/admin/api/logs/delete"], ["DELETE", "/admin/api/tables/t_x_1234567"]] as const)
      expect((await call(m, p, m === "POST" ? {} : undefined)).status).toBe(401);
  });
});
