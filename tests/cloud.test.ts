// Cloud service and the table's cloud link: pairing, heartbeat metrics, log upload and download, invites.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startCloud } from "../apps/cloud/src/server.ts";
import { pairTable, testHost, until } from "./helpers.ts";

const ADMIN = "admin-token-for-tests-123";
let cloud: Awaited<ReturnType<typeof startCloud>>;
let base: string;

const admin = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) };
};

beforeEach(async () => {
  cloud = await startCloud({ port: 0, host: "127.0.0.1", adminToken: ADMIN, publicUrl: "https://games.skylar.technology" });
  base = `http://127.0.0.1:${cloud.port}`;
});
afterEach(async () => {
  await cloud.close();
});

describe("cloud service", () => {
  it("serves the developer guide for game authors and language models, publicly (D-160)", async () => {
    const llms = await fetch(`${base}/llms.txt`);
    expect(llms.status).toBe(200);
    expect(llms.headers.get("content-type")).toMatch(/^text\/plain/);
    const text = await llms.text();
    expect(text).toMatch(/^# Game Table\n\n> /); // llmstxt.org: a title, then a one-paragraph summary
    expect(text).toContain("https://games.skylar.technology/docs/game-development.md");
    const guide = await (await fetch(`${base}/docs/game-development.md`)).text();
    expect(guide).toMatch(/^# Writing a game for Game Table/);
    // The local installation runbook, which llms.txt points to (D-174): no cloud service needed.
    expect(text).toContain("https://games.skylar.technology/docs/local-docker.md");
    const runbook = await fetch(`${base}/docs/local-docker.md`);
    expect(runbook.headers.get("content-type")).toMatch(/^text\/markdown/);
    const local = await runbook.text();
    expect(local).toMatch(/^# Runbook: Game Table on one machine with Docker/);
    expect(local).toMatch(/Games from a private repository/);
    expect((await fetch(`${base}/docs/cloud-state-reset.md`)).status).toBe(404); // the cluster runbooks stay unpublished
    const full = await (await fetch(`${base}/llms-full.txt`)).text();
    expect(full.startsWith(text) && full.includes(guide) && full.includes(local)).toBe(true);
    // The install guides of the packages for one computer (D-257): served, linked from llms.txt and the website, each
    // with a section for an agent.
    const guides: string[] = [];
    for (const os of ["windows", "macos", "linux"]) {
      expect(text).toContain(`https://games.skylar.technology/docs/install/${os}.md`);
      const r = await fetch(`${base}/docs/install/${os}.md`);
      expect(r.status, os).toBe(200);
      expect(r.headers.get("content-type")).toMatch(/^text\/markdown/);
      const g = await r.text();
      expect(g).toMatch(/^# How to install Game Table on /);
      expect(g).toContain("## With an AI agent");
      expect(g).toContain("https://github.com/klaushofrichter/games-service/releases/");
      guides.push(g);
    }
    expect((await fetch(`${base}/docs/install/other.md`)).status).toBe(404);
    const home = await (await fetch(`${base}/`)).text();
    for (const os of ["windows", "macos", "linux"]) expect(home).toContain(`href="/docs/install/${os}.md"`);
    expect(home).toContain('id="download-prompt"');
    // Only public repositories: no private game repository is named as a source.
    for (const t of [text, guide, local, ...guides]) expect(t).not.toMatch(/loopy-game|starforge-game|traders-game/);
    expect(await (await fetch(`${base}/`)).text()).toContain('href="/llms.txt"');
  });

  it("serves the terms of service, linked beside the version at the foot of the website (D-197)", async () => {
    const home = await (await fetch(`${base}/`)).text();
    expect(home).toMatch(/Version <(a|span) class="version"[^>]*>[^<]*<\/(a|span)> · <a class="terms" href="\/terms">Terms of service<\/a>/);
    const r = await fetch(`${base}/terms`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    const terms = await r.text();
    expect(terms).toContain("<h1>Terms of service</h1>");
    expect(terms).toContain('href="mailto:klaus@skylar.technology"');
    expect(terms).not.toContain("{{version}}");
    // The glossary is for the repository, not the website.
    expect((await fetch(`${base}/docs/glossary.md`)).status).toBe(404);
  });

  it("rejects admin calls without the admin token", async () => {
    expect((await fetch(`${base}/admin/api/tables`)).status).toBe(401);
  });

  it("serves the admin page publicly and its data only with the token", async () => {
    const page = await fetch(`${base}/admin`);
    expect(page.status).toBe(200);
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect(await page.text()).toContain("Game Table Console");
    expect((await fetch(`${base}/admin/api/settings`)).status).toBe(401);
    expect((await admin("GET", "/admin/api/settings")).body).toEqual({ logRetentionDays: 90 });
  });

  it("pairs a table, receives heartbeats and uploaded logs, and serves them by token", async () => {
    const t = await testHost({ cloudUrl: base, cloudPollMs: 30, cloudHeartbeatMs: 50 });
    try {
      const pending = await until(() => (t.host.table.cloud.status === "pending" ? t.host.table.cloud : null));
      expect(pending.pairingCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      expect((await t.ok("GET", "/state")).cloud.status).toBe("pending");

      expect((await admin("POST", `/admin/api/tables/pair/${pending.pairingCode}`)).status).toBe(200);
      await until(() => t.host.table.cloud.status === "online");

      // play a game; its log is uploaded
      const a = await t.joinDeck("A");
      await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds: 1, roundSeconds: 0 } });
      await a.request("lobby", "ready", { ready: true });
      await t.ok("POST", "/game/start");
      await a.request("game", "intent", { name: "guess", payload: "heads" });
      const logs = await until(async () => {
        const r = await admin("GET", "/admin/api/logs");
        return r.body.length ? r.body : null;
      });
      expect(logs[0]).toMatchObject({ gameId: "coin-flip", simulation: false });

      // heartbeat carries platform metrics
      await until(async () => (await admin("GET", "/admin/api/metrics")).body.gamesPlayed === 1);

      // admin download and token download without login
      expect((await admin("GET", `/admin/api/logs/${logs[0].id}.zip`)).body.subarray(0, 2).toString()).toBe("PK");
      const dl = (await admin("POST", "/admin/api/download-tokens", { gameId: "coin-flip", expiresInHours: 1 })).body;
      const local = dl.url.replace("https://games.skylar.technology", base);
      const list = await (await fetch(local)).json();
      expect(list.map((l: any) => l.id)).toEqual([logs[0].id]);
      expect((await fetch(`${local}/${logs[0].id}.zip`)).status).toBe(200);
      const other = (await admin("POST", "/admin/api/download-tokens", { gameId: "quartet" })).body;
      expect(await (await fetch(other.url.replace("https://games.skylar.technology", base))).json()).toEqual([]);

      // retention setting is synced to the table
      await admin("PUT", "/admin/api/settings", { logRetentionDays: 30 });
      await until(() => t.host.logs.retentionDays === 30);
    } finally {
      await t.close();
    }
  });

  it("issues short invite codes and resolves them", async () => {
    const t = await testHost({ cloudUrl: base, cloudPollMs: 30, cloudHeartbeatMs: 50 });
    try {
      await pairTable(t, base, ADMIN);
      const token = JSON.parse((await import("node:fs")).readFileSync(`${(t.host.logs.dir as string).replace(/\/logs$/, "")}/table.json`, "utf8")).tableToken;
      const inv = await (await fetch(`${base}/api/tables/invites`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{}" })).json();
      expect(inv.token).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      expect(inv.url).toBe(`https://games.skylar.technology/i/${inv.token}`);
      expect((await fetch(`${base}/i/${inv.token.toLowerCase()}`)).status).toBe(200);
      expect((await fetch(`${base}/i/ZZZZZZZZ`)).status).toBe(404);
    } finally {
      await t.close();
    }
  });

  it("drops a revoked table back to pairing and blocks new games when the cloud is required", async () => {
    const t = await testHost({ cloudUrl: base, cloudPollMs: 30, cloudHeartbeatMs: 50, requireCloud: true });
    try {
      const pending = await until(() => (t.host.table.cloud.status === "pending" ? t.host.table.cloud : null));
      await t.joinDeck("A");
      expect((await t.ok("GET", "/games")).find((g: any) => g.id === "coin-flip").reasons).toContain("the table is offline");
      const { body } = await admin("POST", `/admin/api/tables/pair/${pending.pairingCode}`);
      await until(() => t.host.table.cloud.status === "online");
      expect((await t.ok("GET", "/games")).find((g: any) => g.id === "coin-flip").selectable).toBe(true);
      await admin("POST", `/admin/api/tables/${body.tableId}/revoke`);
      await until(() => t.host.table.cloud.status === "revoked");
      expect((await t.ok("GET", "/games")).find((g: any) => g.id === "coin-flip").selectable).toBe(false);
    } finally {
      await t.close();
    }
  });

  it("reconnects a disconnected table without pairing again (D-085)", async () => {
    const t = await testHost({ cloudUrl: base, cloudPollMs: 30, cloudHeartbeatMs: 50, requireCloud: true });
    try {
      const pending = await until(() => (t.host.table.cloud.status === "pending" ? t.host.table.cloud : null));
      const { body } = await admin("POST", `/admin/api/tables/pair/${pending.pairingCode}`);
      await until(() => t.host.table.cloud.status === "online");
      // only a disconnected table can be reconnected
      expect((await admin("POST", `/admin/api/tables/${body.tableId}/reconnect`)).status).toBe(409);
      expect((await admin("POST", `/admin/api/tables/no-such-table/reconnect`)).status).toBe(404);
      await admin("POST", `/admin/api/tables/${body.tableId}/revoke`);
      await until(() => t.host.table.cloud.status === "revoked");
      const r = await admin("POST", `/admin/api/tables/${body.tableId}/reconnect`);
      expect(r.status).toBe(200);
      expect(r.body.status).toBe("approved");
      await until(() => t.host.table.cloud.status === "online");
      expect((await t.ok("GET", "/games")).find((g: any) => g.id === "coin-flip").selectable).toBe(true);
      // the same table, no second entry and no pairing code
      const tables = (await admin("GET", "/admin/api/tables")).body.filter((x: any) => x.tableId === body.tableId);
      expect(tables).toHaveLength(1);
      expect(tables[0].status).toBe("approved");
    } finally {
      await t.close();
    }
  });
});
