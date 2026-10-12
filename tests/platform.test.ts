// Platform edges: manifest schema, game loading, settings, HTTP hardening, deck socket robustness,
// join code expiry and log retention.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, utimes } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { allowedPlayerCounts, manifestSchema, rotateEdge, seatEdges } from "../packages/protocol/src/index.ts";
import { loadGames, settingsWithDefaults } from "../apps/table-host/src/games.ts";
import { LogStore } from "../apps/table-host/src/logs.ts";
import { Deck, sleep, testHost } from "./helpers.ts";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

async function host(o: Parameters<typeof testHost>[0] = {}) {
  const t = await testHost(o);
  cleanup.push(() => t.close());
  return t;
}

const base = {
  id: "tiny",
  name: "Tiny",
  version: "1.0.0",
  sdk: "^0.1",
  players: { min: 1, max: 4 },
  turnModel: "sequential",
  seatLayouts: [2, 4],
  edges: ["north", "south"],
};

/** A raw HTTP GET, so paths reach the server exactly as written (fetch would normalise ".."). */
function rawGet(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("manifest schema", () => {
  it("accepts a minimal manifest and fills in the defaults", () => {
    const m = manifestSchema.parse(base);
    expect(m).toMatchObject({ dynamicPlayers: false, saveGame: false, remoteBoardControl: true, lobbyButton: "bottom-right", test: false });
    expect(m.ai.supported).toBe(false);
    expect(allowedPlayerCounts(m)).toEqual([1, 2, 3, 4]);
  });

  it("takes player counts as a list as well as a range", () => {
    expect(allowedPlayerCounts(manifestSchema.parse({ ...base, players: [2, 4, 6] }))).toEqual([2, 4, 6]);
  });

  it("rejects impossible or unsupported shapes", () => {
    const bad = [
      { ...base, id: "Has Spaces" },
      { ...base, players: { min: 0, max: 4 } },
      { ...base, players: { min: 1, max: 9 } },
      { ...base, players: { min: 5, max: 2 } }, // no player count at all
      { ...base, players: [] },
      { ...base, seatLayouts: [3] },
      { ...base, seatLayouts: [] },
      { ...base, edges: ["east", "west"] }, // every game needs north and south
      { ...base, turnModel: "whenever" },
      { ...base, lobbyButton: "middle" },
    ];
    for (const m of bad) expect(manifestSchema.safeParse(m).success, JSON.stringify(m)).toBe(false);
  });
});

describe("seat edges", () => {
  it("has as many edges as seats, north and south first", () => {
    for (const n of [2, 4, 6, 8] as const) {
      const e = seatEdges(n);
      expect(e).toHaveLength(n);
      expect(e.filter((x) => x === "south").length).toBe(e.filter((x) => x === "north").length);
    }
    expect(seatEdges(8).slice(-2).sort()).toEqual(["east", "west"]);
  });

  it("comes back to the start after four quarter turns or two half turns", () => {
    for (const e of ["north", "east", "south", "west"] as const) {
      let x = e;
      for (let i = 0; i < 4; i++) x = rotateEdge(x, 90);
      expect(x).toBe(e);
      expect(rotateEdge(rotateEdge(e, 180), 180)).toBe(e);
      expect(rotateEdge(e, 180)).not.toBe(e);
    }
  });
});

describe("game loading", () => {
  async function gamesDir() {
    const dir = await mkdtemp(join(tmpdir(), "games-"));
    const rules = `export default { setup: () => ({}), view: () => ({}), apply: (s) => ({ state: s }) };\n`;
    const pkg = async (name: string, manifest: unknown, withRules = true) => {
      await mkdir(join(dir, name));
      await writeFile(join(dir, name, "manifest.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
      if (withRules) await writeFile(join(dir, name, "rules.js"), rules);
    };
    await pkg("good", { ...base, id: "good" });
    await pkg("broken-json", "{ not json");
    await pkg("no-rules", { ...base, id: "no-rules" }, false);
    await pkg("bad-schema", { ...base, id: "bad-schema", players: { min: 5, max: 2 } });
    await pkg("dupe", { ...base, id: "good", name: "Impostor" }); // same id as another package
    await writeFile(join(dir, "README.txt"), "not a game");
    return dir;
  }

  it("loads valid packages and skips the rest without failing", async () => {
    const errors: string[] = [];
    const orig = console.error;
    console.error = (m: string) => errors.push(String(m));
    try {
      const games = await loadGames(await gamesDir());
      expect([...games.keys()]).toEqual(["good"]);
      expect(games.get("good")!.manifest.name).toBe("Tiny"); // not the impostor in another folder
      expect(errors.join("\n")).toMatch(/broken-json/);
      expect(errors.join("\n")).toMatch(/no-rules/);
      expect(errors.join("\n")).toMatch(/bad-schema/);
      expect(errors.join("\n")).toMatch(/dupe.*must match the folder name/);
    } finally {
      console.error = orig;
    }
  });
});

describe("game settings", () => {
  const m = manifestSchema.parse({
    ...base,
    settings: [
      { key: "rounds", type: "int", min: 1, max: 10, default: 3 },
      { key: "speed", type: "enum", values: ["slow", "fast"], default: "slow" },
    ],
  });

  it("fills defaults, rounds integers and drops unknown keys", () => {
    expect(settingsWithDefaults(m)).toEqual({ rounds: 3, speed: "slow" });
    expect(settingsWithDefaults(m, { rounds: "4.6", speed: "fast", cheat: true })).toEqual({ rounds: 5, speed: "fast" });
  });

  it("refuses values outside the declared range or set", () => {
    expect(() => settingsWithDefaults(m, { rounds: 0 })).toThrow(/≥ 1/);
    expect(() => settingsWithDefaults(m, { rounds: 11 })).toThrow(/≤ 10/);
    expect(() => settingsWithDefaults(m, { rounds: "many" })).toThrow(/number/);
    expect(() => settingsWithDefaults(m, { speed: "warp" })).toThrow(/one of slow, fast/);
  });
});

describe("HTTP hardening", () => {
  it("never serves files outside the public folder or a game's UI files", async () => {
    const t = await host();
    const port = t.host.port;
    for (const p of [
      "/board/../../src/server.ts",
      "/shared/../../src/host.ts",
      "/deck/%2e%2e/%2e%2e/src/table.ts",
      "/shared/..%2f..%2fsrc%2fserver.ts",
      "/games/roulette/rules.ts",
      "/games/roulette/manifest.json",
      "/games/roulette/assets/../rules.ts",
      "/games/roulette/assets/%2e%2e/rules.ts",
      "/games/..%2froulette/rules.ts",
    ]) {
      const r = await rawGet(port, p);
      expect(r.status, p).not.toBe(200);
      expect(r.body, p).not.toMatch(/import |defineGame|TABLE_KEY/);
    }
  });

  it("answers unknown endpoints, bad JSON and oversized bodies with clear errors", async () => {
    const t = await host();
    expect((await t.api("GET", "/nope")).status).toBe(404);
    const call = (body: string) =>
      fetch(`${t.base}/api/v1/layout`, { method: "POST", headers: { "x-table-key": "test-key", "content-type": "application/json" }, body });
    expect((await call("{ nope")).status).toBe(400);
    expect((await call(JSON.stringify({ seats: 4, pad: "x".repeat(70 * 1024) }))).status).toBe(413);
    expect((await call(JSON.stringify({ seats: 4 }))).status).toBe(200); // the host is still fine
  });

  it("does not take the table key from the query string", async () => {
    const t = await host();
    expect((await fetch(`${t.base}/api/v1/state?key=test-key`)).status).toBe(401);
    expect((await fetch(`${t.base}/api/v1/state`, { headers: { "x-table-key": "test-ke" } })).status).toBe(401);
  });
});

describe("deck socket robustness", () => {
  /** A bare socket that records everything, for messages the Deck helper would never send. */
  async function rawSocket(baseUrl: string) {
    const ws = new WebSocket(baseUrl.replace("http", "ws") + "/ws");
    const msgs: any[] = [];
    let closed: number | null = null;
    ws.on("message", (raw) => msgs.push(JSON.parse(String(raw))));
    ws.on("close", (c) => (closed = c));
    await new Promise((r) => ws.once("open", r));
    const until = async (pred: (m: any) => boolean) => {
      for (let i = 0; i < 100; i++) {
        const m = msgs.find(pred);
        if (m) return m;
        await sleep(20);
      }
      throw new Error("no such message");
    };
    return { ws, msgs, until, closed: () => closed };
  }

  it("answers garbage and out-of-order messages with errors and keeps the socket open", async () => {
    const t = await host();
    const s = await rawSocket(t.base);
    s.ws.send("{ not json");
    await s.until((m) => m.type === "error" && /JSON/.test(m.payload.message));
    s.ws.send(JSON.stringify({ v: 1, ch: "game", type: "intent", seq: 1, payload: { name: "x" } }));
    expect((await s.until((m) => m.seq === 1)).payload.message).toMatch(/hello first/);
    expect(s.closed()).toBeNull();
    // after all that, a proper hello still works on the same socket
    const { token } = await t.ok("GET", "/join");
    s.ws.send(JSON.stringify({ v: 1, ch: "system", type: "hello", seq: 2, payload: { joinToken: token, name: "Late" } }));
    expect((await s.until((m) => m.seq === 2)).type).toBe("welcome");
  });

  it("closes the socket when a hello is refused", async () => {
    const t = await host();
    const s = await rawSocket(t.base);
    s.ws.send(JSON.stringify({ v: 1, ch: "system", type: "hello", seq: 1, payload: { joinToken: "WRONG123", name: "X" } }));
    await s.until((m) => m.seq === 1 && m.type === "error");
    for (let i = 0; i < 50 && s.closed() === null; i++) await sleep(20);
    expect(s.closed()).toBe(4003);
    expect(t.host.table.state().players).toHaveLength(0);
  });

  it("refuses an unknown session token and a board hello without the key", async () => {
    const t = await host();
    await expect(Deck.connect(t.base, { sessionToken: "made-up" })).rejects.toThrow(/session expired/);
    const s = await rawSocket(t.base);
    s.ws.send(JSON.stringify({ v: 1, ch: "system", type: "hello", seq: 1, payload: { role: "board", key: "guess" } }));
    expect((await s.until((m) => m.seq === 1)).payload.message).toMatch(/table key/);
  });

  it("rejects intents from a player who is not seated in the running game", async () => {
    const t = await host();
    await t.ok("POST", "/layout", { seats: 2 });
    const a = await t.joinDeck("A");
    const b = await t.joinDeck("B");
    const c = await t.joinDeck("C"); // no seat left
    expect(t.host.table.state().players.find((p) => p.name === "C")!.seat).toBeNull();
    await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds: 1, roundMs: 0 } });
    await a.request("lobby", "ready", { ready: true });
    await b.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    const r = await c.request("game", "intent", { name: "guess", payload: "heads" });
    expect(r.type).toBe("error");
    expect(r.payload.message).toMatch(/not playing/);
    const nameless = await a.request("game", "intent", { payload: "heads" });
    expect(nameless.payload.message).toMatch(/needs a name/);
  });

  it("keeps a player connected while a second socket with the same session closes", async () => {
    const t = await host({ graceMs: 100 });
    const a = await t.joinDeck("A");
    const second = await Deck.connect(t.base, { sessionToken: a.sessionToken }); // e.g. a second tab
    second.ws.close();
    await sleep(250);
    const p = t.host.table.state().players.find((x) => x.name === "A")!;
    expect(p.connected).toBe(true);
  });
});

describe("join codes", () => {
  it("expire after their time to live even when unused", async () => {
    const t = await host({ joinTokenTtlMs: 150 });
    const { token } = await t.ok("GET", "/join");
    await sleep(250);
    await expect(Deck.connect(t.base, { joinToken: token, name: "Slow" })).rejects.toThrow(/invalid or expired/);
    const fresh = await t.ok("GET", "/join");
    expect(fresh.token).not.toBe(token);
    await Deck.connect(t.base, { joinToken: fresh.token, name: "Quick" }).then((d) => d.ws.close());
  });

  it("accept lower-case input, since people type them", async () => {
    const t = await host();
    const { token } = await t.ok("GET", "/join");
    const d = await Deck.connect(t.base, { joinToken: token.toLowerCase(), name: "lower" });
    expect(d.playerId).toBeTruthy();
    d.ws.close();
  });
});

describe("log retention", () => {
  async function store(days: number) {
    const root = await mkdtemp(join(tmpdir(), "logs-"));
    return new LogStore(join(root, "logs"), days);
  }
  const meta = (id: string) => ({
    id, tableName: "T", gameId: "coin-flip", gameVersion: "1", simulation: true,
    startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), games: 1, format: "gametable-log/1" as const,
  });
  const age = async (file: string, days: number) => {
    const t = new Date(Date.now() - days * 86400_000);
    await utimes(file, t, t);
  };

  it("packages a run as run.json plus one JSONL file per game, and reads it back", async () => {
    const s = await store(90);
    const games = [[{ t: 0, k: "setup" }], [{ t: 0, k: "setup" }, { t: 5, k: "intent", seat: 1 }]] as any;
    await s.save(meta("run-1"), games);
    const back = await LogStore.unzip((await s.read("run-1"))!);
    expect(back.meta.id).toBe("run-1");
    expect(back.games).toEqual(games);
    expect(await s.read("../etc/passwd")).toBeNull();
    expect(await s.read("missing")).toBeNull();
  });

  it("deletes logs and saves older than the retention period, and keeps the rest", async () => {
    const s = await store(30);
    await s.save(meta("old"), [[]]);
    await s.save(meta("new"), [[]]);
    await s.saveGame("old-save", { id: "old-save", gameId: "pachisi", savedAt: "2026-01-01T00:00:00Z", players: [] });
    await s.saveGame("new-save", { id: "new-save", gameId: "pachisi", savedAt: new Date().toISOString(), players: [] });
    await age(join(s.dir, "old.zip"), 31);
    await age(join(s.dir, "..", "saves", "old-save.json"), 31);
    await s.prune();
    expect((await s.list()).map((l) => l.id)).toEqual(["new"]);
    expect((await s.listSaves()).map((x) => x.id)).toEqual(["new-save"]);
  });

  it("prunes on a running table when the service lowers the retention period", async () => {
    const { startCloud } = await import("../apps/cloud/src/server.ts");
    const ADMIN = "admin-token-for-tests-123";
    const cloud = await startCloud({ port: 0, host: "127.0.0.1", adminToken: ADMIN, publicUrl: "https://x.test" });
    cleanup.push(() => cloud.close());
    const cloudUrl = `http://127.0.0.1:${cloud.port}`;
    const t = await host({ cloudUrl, cloudPollMs: 30, cloudHeartbeatMs: 50 });
    const admin = (m: string, p: string, b?: unknown) =>
      fetch(cloudUrl + p, { method: m, headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined });
    for (let i = 0; i < 100 && !t.host.table.cloud.pairingCode; i++) await sleep(20);
    await admin("POST", `/admin/api/tables/pair/${t.host.table.cloud.pairingCode}`);
    for (let i = 0; i < 100 && t.host.table.cloud.status !== "online"; i++) await sleep(20);

    await t.host.logs.save(meta("ten-days"), [[]]);
    await age(join(t.host.logs.dir, "ten-days.zip"), 10);
    expect((await t.host.logs.list()).map((l) => l.id)).toContain("ten-days");
    expect((await admin("PUT", "/admin/api/settings", { logRetentionDays: 7 })).status).toBe(200);
    for (let i = 0; i < 100 && t.host.logs.retentionDays !== 7; i++) await sleep(20);
    expect(t.host.logs.retentionDays).toBe(7);
    for (let i = 0; i < 100 && (await t.host.logs.list()).some((l) => l.id === "ten-days"); i++) await sleep(20);
    expect((await t.host.logs.list()).map((l) => l.id)).not.toContain("ten-days");
  });
});
