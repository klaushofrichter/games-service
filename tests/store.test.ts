// The service's persistent store (D-113): state in DATA_DIR survives a restart, a damaged database is replaced by the
// snapshot, and no usable secret is ever written to disk.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCloud } from "../apps/cloud/src/server.ts";
import { Store } from "../apps/cloud/src/store.ts";
import { testHost, until } from "./helpers.ts";

const ADMIN = "admin-token-for-tests-123";
let dir: string;
let cloud: Awaited<ReturnType<typeof startCloud>> | null = null;
let port = 0;
const hosts: Awaited<ReturnType<typeof testHost>>[] = [];

/** Start (or restart) the service on DATA_DIR = dir, on the same port so tables find it again. */
const start = async () => {
  cloud = await startCloud({ port, host: "127.0.0.1", adminToken: ADMIN, publicUrl: "https://games.skylar.technology", dataDir: dir, githubApiUrl: "http://127.0.0.1:9", gameRepoRefreshMs: 0 });
  port = cloud.port;
};
const stop = async () => {
  await cloud?.close();
  cloud = null;
};
const base = () => `http://127.0.0.1:${port}`;
/** fetch, retried once: after a restart on the same port, a kept-alive connection to the old server is closed. */
const get = async (url: string, init?: RequestInit) => {
  try {
    return await fetch(url, init);
  } catch {
    return await fetch(url, init);
  }
};
const admin = async (method: string, path: string, body?: unknown) => {
  const r = await get(`${base()}${path}`, { method, headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) };
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gamecloud-"));
  port = 0;
});
afterEach(async () => {
  for (const h of hosts.splice(0)) await h.close();
  await stop();
  await rm(dir, { recursive: true, force: true });
});

describe("persistent store", () => {
  it("keeps tables, ticks, codes, repositories, settings, logs and invites across a restart", async () => {
    await start();
    await admin("POST", "/admin/api/repos", { repo: "klaus/extra-games", ref: "production" });
    await admin("PUT", "/admin/api/settings", { logRetentionDays: 30 });
    const code = (await admin("POST", "/admin/api/codes", { label: "kept", validity: "year", scope: { kind: "all" } })).body;
    const t = await testHost({ cloudUrl: base(), cloudPollMs: 30, cloudHeartbeatMs: 50 });
    hosts.push(t);
    const pairing = await until(() => t.host.table.cloud.pairingCode);
    await admin("POST", `/admin/api/tables/pair/${pairing}`, { repos: ["extra-games"] });
    await until(() => t.host.table.cloud.status === "online");
    const tableId = t.host.cloud!["identity"].tableId as string;
    // a log, an invite, a download token
    const token = t.host.cloud!["identity"].tableToken as string;
    await fetch(`${base()}/api/tables/logs/log-coin-flip-1?gameId=coin-flip`, { method: "PUT", headers: { authorization: `Bearer ${token}` }, body: "zipdata" });
    const invite = await t.host.cloud!.createInvite();
    const dl = (await admin("POST", "/admin/api/download-tokens", {})).body;

    await stop();
    await start();

    // The table carries on with its token: no new pairing.
    const row = ((await admin("GET", "/admin/api/tables")).body as any[]).find((x) => x.tableId === tableId);
    expect(row).toMatchObject({ status: "approved", repos: ["extra-games"], reposFrom: "table" });
    await until(async () => (await get(`${base()}/api/tables/heartbeat`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{}" })).status === 200);
    expect(t.host.table.cloud.status).not.toBe("pending");
    expect((await admin("GET", "/admin/api/repos")).body.repos).toMatchObject([{ id: "extra-games", repo: "klaus/extra-games", ref: "production", origin: "console" }]);
    expect((await admin("GET", "/admin/api/settings")).body).toEqual({ logRetentionDays: 30 });
    expect((await admin("GET", "/admin/api/codes")).body).toMatchObject([{ id: code.id, label: "kept", scope: { kind: "all" } }]);
    expect((await admin("GET", "/admin/api/logs/log-coin-flip-1.zip")).body.toString()).toBe("zipdata");
    expect((await get(`${base()}/i/${invite.token}`)).status).toBe(200);
    expect((await (await get(`${base()}/dl/${dl.token}`)).json())).toMatchObject([{ id: "log-coin-flip-1" }]);
    // The access code still works after the restart.
    const r = await get(`${base()}/api/tables/hello`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tableId: "t_another_table_1234", accessCode: code.code }) });
    expect((await r.json()).status).toBe("approved");
  });

  it("writes no usable secret to disk: tokens and codes are kept as hashes", async () => {
    await start();
    const code = (await admin("POST", "/admin/api/codes", { validity: "week" })).body;
    const r = await fetch(`${base()}/api/tables/hello`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tableId: "t_secret_check_1234", accessCode: code.code }) });
    const { tableToken } = await r.json();
    expect(tableToken).toBeTruthy();
    const dl = (await admin("POST", "/admin/api/download-tokens", {})).body;
    await stop(); // checkpoints the WAL and writes the snapshot
    const bytes = Buffer.concat(["state.db", "snapshots/state.db"].map((f) => readFileSync(join(dir, f))));
    for (const secret of [tableToken, code.code, code.code.replace("-", ""), dl.token]) expect(bytes.includes(secret)).toBe(false);
  });

  it("starts from the snapshot when the database is damaged, and keeps the damaged file", async () => {
    await start();
    const code = (await admin("POST", "/admin/api/codes", { label: "survivor", validity: "forever" })).body;
    await stop();
    writeFileSync(join(dir, "state.db"), Buffer.alloc(8192, 0x41)); // not a database any more
    await start();
    expect((await admin("GET", "/admin/api/codes")).body).toMatchObject([{ id: code.id, label: "survivor" }]);
    expect(readdirSync(dir).some((f) => f.startsWith("state.db.damaged-"))).toBe(true);
  });

  it("starts from the snapshot when the database is missing (a restore that copied only the snapshot)", async () => {
    await start();
    await admin("POST", "/admin/api/codes", { label: "from snapshot", validity: "forever" });
    await stop();
    for (const f of ["state.db", "state.db-wal", "state.db-shm"]) await rm(join(dir, f), { force: true });
    await start();
    expect((await admin("GET", "/admin/api/codes")).body).toMatchObject([{ label: "from snapshot" }]);
  });

  it("uses the snapshot when RESTORE_FROM_SNAPSHOT is there, even over a readable database", async () => {
    await start();
    await admin("POST", "/admin/api/codes", { label: "in the snapshot", validity: "forever" });
    await stop(); // snapshot has one code
    await start();
    await admin("POST", "/admin/api/codes", { label: "only in state.db", validity: "forever" });
    // The snapshot written at this start has one code; a clean stop would write a new one, so put the old one back
    // afterwards (as after a crash, or a backup taken between two snapshots).
    const snap = readFileSync(join(dir, "snapshots/state.db"));
    await stop();
    writeFileSync(join(dir, "snapshots/state.db"), snap);
    writeFileSync(join(dir, "RESTORE_FROM_SNAPSHOT"), "");
    await start();
    expect(((await admin("GET", "/admin/api/codes")).body as any[]).map((c) => c.label)).toEqual(["in the snapshot"]);
    expect(existsSync(join(dir, "RESTORE_FROM_SNAPSHOT"))).toBe(false);
    expect(readdirSync(dir).some((f) => f.startsWith("state.db.replaced-"))).toBe(true);
  });

  it("starts empty, keeping the damaged file, when there is no snapshot to fall back on", async () => {
    writeFileSync(join(dir, "state.db"), Buffer.alloc(8192, 0x41));
    const s = new Store({ dataDir: dir, snapshotMs: 0, log: () => {} });
    expect(s.opened.how).toBe("corrupt-fresh");
    expect(s.all("code")).toEqual([]);
    s.close();
    expect(readdirSync(dir).some((f) => f.startsWith("state.db.damaged-"))).toBe(true);
  });

  it("drops log records without a file and log files without a record", async () => {
    await start();
    const code = (await admin("POST", "/admin/api/codes", { validity: "week" })).body;
    const r = await fetch(`${base()}/api/tables/hello`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tableId: "t_logs_check_12345", accessCode: code.code }) });
    const { tableToken } = await r.json();
    for (const id of ["log-a-1", "log-b-1"]) await fetch(`${base()}/api/tables/logs/${id}?gameId=x`, { method: "PUT", headers: { authorization: `Bearer ${tableToken}` }, body: id });
    await stop();
    await rm(join(dir, "logs", "log-a-1.zip"));
    writeFileSync(join(dir, "logs", "stray.zip"), "x");
    await start();
    expect(((await admin("GET", "/admin/api/logs")).body as any[]).map((l) => l.id)).toEqual(["log-b-1"]);
    expect(readdirSync(join(dir, "logs")).sort()).toEqual(["log-b-1.zip"]);
  });

  it("without DATA_DIR keeps everything in memory, as before", async () => {
    const s = new Store();
    expect(s.persistent).toBe(false);
    s.put("code", "a", { x: 1 });
    expect(s.all("code")).toEqual([{ key: "a", value: { x: 1 } }]);
    s.close();
  });
});
