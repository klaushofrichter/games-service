// Game logs for offline analysis (D-116): every game's log is written on the table as it is played, packed with its
// metadata when the game ends for any reason (also an interrupted one, at the next start), queued, and uploaded until
// the service has it. Simulations go the same way. Logs carry a README, the final state and errors, and are verified by
// replaying them.
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startCloud } from "../apps/cloud/src/server.ts";
import { LogStore } from "../apps/table-host/src/logs.ts";
import { pairTable, sleep, testHost, until } from "./helpers.ts";

const ADMIN = "admin-token-for-tests-123";
let cloud: Awaited<ReturnType<typeof startCloud>>;
let base: string;
let cloudDir: string;
const cleanup: (() => Promise<unknown>)[] = [];

const admin = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) };
};
const serviceLogs = async (query = "") => (await admin("GET", `/admin/api/logs${query}`)).body as any[];

async function startService(port = 0) {
  cloud = await startCloud({ port, host: "127.0.0.1", adminToken: ADMIN, publicUrl: "https://games.skylar.technology", dataDir: cloudDir });
  base = `http://127.0.0.1:${cloud.port}`;
}

beforeEach(async () => {
  cloudDir = await mkdtemp(join(tmpdir(), "gametable-cloud-"));
  await startService();
});
afterEach(async () => {
  for (const f of cleanup.splice(0)) await f().catch(() => {});
  await cloud.close();
  await rm(cloudDir, { recursive: true, force: true });
});

/** A table on its own data folder, kept across restarts of the host; removed after the test. */
async function table(dataDir?: string, o: Parameters<typeof testHost>[0] = {}) {
  const dir = dataDir ?? (await mkdtemp(join(tmpdir(), "gametable-table-")));
  if (!dataDir) cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const t = await testHost({ dataDir: dir, cloudUrl: base, cloudPollMs: 30, cloudHeartbeatMs: 50, ...o });
  cleanup.push(() => t.close());
  return { t, dir };
}

/** One human ("Ann") and one AI in Coin Flip, `rounds` rounds without a time limit. */
async function startCoinFlip(t: Awaited<ReturnType<typeof testHost>>, rounds = 2) {
  const a = await t.joinDeck("Ann");
  await t.ok("POST", "/ai", {});
  await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds, roundSeconds: 0 } });
  await a.request("lobby", "ready", { ready: true });
  await t.ok("POST", "/game/start");
  return a;
}

async function unzip(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  const text = async (n: string) => zip.file(n)?.async("string");
  return { names: Object.keys(zip.files).sort(), text, json: async (n: string) => JSON.parse((await text(n))!), lines: async (n: string) => (await text(n))!.trim().split("\n").map((l) => JSON.parse(l)) };
}

describe("game logs reach the service", () => {
  it("uploads a simulation, with its metadata", async () => {
    const { t } = await table();
    const pair = await pairTable(t, base, ADMIN);
    const r = await t.ok("POST", "/simulation", { gameId: "coin-flip", players: 3, games: 4, seed: 7 });
    const logs = await until(async () => (await serviceLogs()).find((l) => l.id === r.logId));
    expect(logs).toMatchObject({ gameId: "coin-flip", gameName: "Coin Flip", simulation: true, games: 4, tableId: pair.tableId, endReasons: { finished: 4 }, verified: true });
    expect(Date.parse(logs.startedAt)).toBeGreaterThan(0);
    expect(logs.players).toHaveLength(3);
    expect(logs.players[0]).toMatchObject({ seat: 0, kind: "ai" });
  });

  it("uploads a live game with who played, when, how long and how it ended", async () => {
    const { t } = await table();
    const pair = await pairTable(t, base, ADMIN);
    const a = await startCoinFlip(t, 1);
    await a.request("game", "intent", { name: "guess", payload: "heads" });
    const log = await until(async () => (await serviceLogs()).find((l) => !l.simulation));
    expect(log).toMatchObject({ gameId: "coin-flip", gameName: "Coin Flip", simulation: false, games: 1, endReason: "finished", tableId: pair.tableId, verified: true, errors: 0 });
    expect(log.result).toMatch(/\w/);
    expect(log.durationMs).toBeGreaterThanOrEqual(0);
    expect(log.players.map((p: any) => [p.name, p.kind, p.location])).toEqual([
      ["Ann", "human", "local"],
      [expect.stringMatching(/\(AI\)$/), "ai", null],
    ]);
  });

  it("uploads a game ended from the lobby", async () => {
    const { t } = await table();
    await pairTable(t, base, ADMIN);
    await startCoinFlip(t, 3);
    await t.ok("POST", "/game/end");
    const log = await until(async () => (await serviceLogs()).find((l) => !l.simulation));
    expect(log.endReason).toBe("terminated");
  });

  it("keeps a log the service could not take and uploads it once the service is back", async () => {
    const { t } = await table();
    await pairTable(t, base, ADMIN);
    const port = cloud.port;
    await cloud.close(); // the service goes away (a deploy, a network outage)
    await until(() => t.host.table.cloud.status === "offline");
    const r = await t.ok("POST", "/simulation", { gameId: "coin-flip", players: 2, games: 2, seed: 1 });
    expect((await t.ok("GET", "/logs")).map((l: any) => l.id)).toContain(r.logId); // the table has it
    expect(await t.host.logs.pendingUploads()).toContain(r.logId);
    await startService(port); // same port, same volume: the table is still approved
    const got = await until(async () => (await serviceLogs()).find((l) => l.id === r.logId));
    expect(got.games).toBe(2);
    await until(async () => (await t.host.logs.pendingUploads()).length === 0);
    await sleep(200); // more heartbeats: uploaded once only
    expect((await serviceLogs()).filter((l) => l.id === r.logId)).toHaveLength(1);
  });

  it("filters the console's list and download tokens by game, table, date and kind", async () => {
    const { t } = await table();
    const pair = await pairTable(t, base, ADMIN);
    await t.ok("POST", "/simulation", { gameId: "coin-flip", players: 2, games: 1, seed: 1 });
    await t.ok("POST", "/simulation", { gameId: "roulette", players: 2, games: 1, seed: 1, settings: { rounds: 2 } });
    await until(async () => (await serviceLogs()).length === 2);
    expect((await serviceLogs("?gameId=roulette")).map((l) => l.gameId)).toEqual(["roulette"]);
    expect(await serviceLogs(`?tableId=${pair.tableId}`)).toHaveLength(2);
    expect(await serviceLogs("?tableId=t_nobody")).toHaveLength(0);
    expect(await serviceLogs("?simulation=0")).toHaveLength(0);
    const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
    expect(await serviceLogs(`?from=${tomorrow}`)).toHaveLength(0);
    expect(await serviceLogs(`?to=${tomorrow}`)).toHaveLength(2);
    expect((await admin("GET", "/admin/api/logs?from=yesterday")).status).toBe(400);

    const dl = (await admin("POST", "/admin/api/download-tokens", { gameId: "roulette", tableId: pair.tableId, from: "2026-01-01", expiresInHours: 1 })).body;
    const list = await (await fetch(dl.url.replace("https://games.skylar.technology", base))).json();
    expect(list.map((l: any) => l.gameId)).toEqual(["roulette"]);
    const tokens = (await admin("GET", "/admin/api/download-tokens")).body;
    expect(tokens[0]).toMatchObject({ gameId: "roulette", tableId: pair.tableId, from: "2026-01-01" });
  });

  it("still takes logs in the old format", async () => {
    const { t } = await table();
    await pairTable(t, base, ADMIN);
    const token = JSON.parse(await readFile(join(t.host.cloud!["o"].dataDir, "table.json"), "utf8")).tableToken;
    const zip = new JSZip();
    zip.file("run.json", JSON.stringify({ id: "20260101000000-coin-flip-abcd", format: "gametable-log/1", gameId: "coin-flip", simulation: false, games: 1 }));
    zip.file("game-001.jsonl", "{}\n");
    const r = await fetch(`${base}/api/tables/logs/20260101000000-coin-flip-abcd?gameId=coin-flip&simulation=0`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/zip" },
      body: new Uint8Array(await zip.generateAsync({ type: "nodebuffer" })),
    });
    expect(r.status).toBe(201);
    expect((await serviceLogs())[0]).toMatchObject({ gameId: "coin-flip", simulation: false });
  });
});

describe("the log on the table", () => {
  it("is written as the game is played, not only at its end", async () => {
    const { t, dir } = await table(undefined, { cloudUrl: undefined });
    const a = await startCoinFlip(t, 3);
    await a.request("game", "intent", { name: "guess", payload: "tails" });
    const running = join(dir, "logs", "running");
    const [id] = await readdir(running);
    const records = (await readFile(join(running, id, "game-001.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(records[0]).toMatchObject({ t: "start", gameId: "coin-flip" });
    expect(records.some((r) => r.t === "intent" && r.intent.payload === "tails")).toBe(true);
    expect(JSON.parse(await readFile(join(running, id, "run.json"), "utf8"))).toMatchObject({ gameId: "coin-flip", players: [{ name: "Ann" }, {}] });
    await t.ok("POST", "/game/end");
    await until(async () => (await readdir(running)).length === 0); // packed and gone
    expect((await t.ok("GET", "/logs")).map((l: any) => l.id)).toContain(id);
  });

  it("recovers a game the table stopped in the middle of, at its next start", async () => {
    const { t, dir } = await table();
    await pairTable(t, base, ADMIN);
    const a = await startCoinFlip(t, 5);
    await a.request("game", "intent", { name: "guess", payload: "heads" });
    await until(async () => (await readdir(join(dir, "logs", "running"))).length === 1);
    await t.close(); // the table PC is switched off mid-game
    const { t: again } = await table(dir);
    const log = await until(async () => (await serviceLogs()).find((l) => !l.simulation));
    expect(log).toMatchObject({ gameId: "coin-flip", endReason: "interrupted" });
    const z = await unzip((await again.api("GET", `/logs/${log.id}.zip`)).body);
    const records = await z.lines("game-001.jsonl");
    expect(records.some((r) => r.t === "intent" && r.intent.payload === "heads")).toBe(true);
    expect(records.at(-1)).toMatchObject({ t: "end", reason: "interrupted" });
    expect(await z.json("game-001.state.json")).toBeTruthy(); // rebuilt by replaying the log
    expect(await readdir(join(dir, "logs", "running"))).toEqual([]);
  });

  it("is a zip an LLM can read: a README, metadata, the records and the final state", async () => {
    const { t } = await table(undefined, { cloudUrl: undefined });
    const a = await startCoinFlip(t, 1);
    await a.request("game", "intent", { name: "guess", payload: "heads" });
    const [l] = await until(async () => {
      const list = await t.ok("GET", "/logs");
      return list.length ? list : null;
    });
    const z = await unzip((await t.api("GET", `/logs/${l.id}.zip`)).body);
    expect(z.names).toEqual(["README.md", "game-001.jsonl", "game-001.state.json", "run.json"]);
    const readme = (await z.text("README.md"))!;
    for (const word of ["run.json", "start", "intent", "timer", "seatJoined", "seatLeft", "error", "snapshot", "end", "state.json"]) expect(readme).toContain(word);
    const run = await z.json("run.json");
    expect(run).toMatchObject({ format: "gametable-log/2", kind: "game", gameId: "coin-flip", gameName: "Coin Flip", games: 1, endReason: "finished", verify: { checked: 1, ok: 1 }, counts: { errors: 0 } });
    expect(run.settings).toMatchObject({ rounds: 1 });
    expect(run.timeZone).toMatch(/\w/);
    expect(run.platform).toMatchObject({ protocol: 1 });
    expect(run.counts.intents).toBeGreaterThan(0);
    const state = await z.json("game-001.state.json");
    expect(JSON.stringify(state)).toContain("heads");
  });

  it("records an error thrown by the rules, keeps the game going, and still replays", async () => {
    const { t } = await table(undefined, { cloudUrl: undefined });
    const g = t.host.table.games.get("coin-flip")!;
    t.host.table.games.set("coin-flip", {
      ...g,
      def: {
        ...g.def,
        onIntent: (s: any, seat: number, i: any, ctx: any) => {
          if (i.payload === "edge") throw new Error("the coin landed on its edge");
          return g.def.onIntent(s, seat, i, ctx);
        },
      },
    });
    const a = await startCoinFlip(t, 1);
    const bad = await a.request("game", "intent", { name: "guess", payload: "edge" });
    expect(bad.type).toBe("error");
    await a.request("game", "intent", { name: "guess", payload: "heads" });
    const [l] = await until(async () => {
      const list = await t.ok("GET", "/logs");
      return list.length ? list : null;
    });
    const z = await unzip((await t.api("GET", `/logs/${l.id}.zip`)).body);
    const err = (await z.lines("game-001.jsonl")).find((r) => r.error);
    expect(err).toMatchObject({ t: "intent", seat: 0, intent: { payload: "edge" }, accepted: false, error: { message: "the coin landed on its edge" } });
    expect(err.error.stack).toContain("game-logs.test.ts");
    expect(await z.json("run.json")).toMatchObject({ counts: { errors: 1 }, verify: { ok: 1 }, endReason: "finished" });
  });

  it("verifies a log by replaying it, on request and at the end of every game", async () => {
    const { t, dir } = await table(undefined, { cloudUrl: undefined });
    const r = await t.ok("POST", "/simulation", { gameId: "pachisi", players: 2, games: 2, seed: 3, settings: { turnSeconds: 0 } });
    expect(await t.ok("POST", `/logs/${r.logId}/verify`)).toMatchObject({ logId: r.logId, ok: true, games: [{ game: 1, ok: true }, { game: 2, ok: true }] });

    // A changed record no longer replays to the state the game ended in.
    const file = join(dir, "logs", `${r.logId}.zip`);
    const zip = await JSZip.loadAsync(await readFile(file));
    const records = (await zip.file("game-001.jsonl")!.async("string")).trim().split("\n").map((l) => JSON.parse(l));
    const i = records.findIndex((x) => x.t === "intent" && x.accepted && x.intent.name === "roll");
    records.splice(i, 1);
    zip.file("game-001.jsonl", records.map((x) => JSON.stringify(x)).join("\n") + "\n");
    await writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));
    const v = await t.ok("POST", `/logs/${r.logId}/verify`);
    expect(v.ok).toBe(false);
    expect(v.games[0]).toMatchObject({ game: 1, ok: false });
    expect(v.games[1]).toMatchObject({ game: 2, ok: true });
    expect((await t.api("POST", "/logs/nope/verify")).status).toBe(404);
  });

  it("flags a game that does not replay (randomness outside ctx.random)", async () => {
    const { t } = await table(undefined, { cloudUrl: undefined });
    const g = t.host.table.games.get("coin-flip")!;
    t.host.table.games.set("coin-flip", { ...g, def: { ...g.def, setup: (ctx: any, s: any) => ({ ...g.def.setup(ctx, s), noise: Math.random() }) } });
    const r = await t.ok("POST", "/simulation", { gameId: "coin-flip", players: 2, games: 3, seed: 1 });
    const z = await unzip((await t.api("GET", `/logs/${r.logId}.zip`)).body);
    expect((await z.json("run.json")).verify).toMatchObject({ checked: 3, ok: 0, failed: [1, 2, 3] });
  });

  it("can add state snapshots every N moves, which replay ignores", async () => {
    const { t } = await table(undefined, { cloudUrl: undefined, logSnapshotEvery: 2 });
    const r = await t.ok("POST", "/simulation", { gameId: "coin-flip", players: 2, games: 1, seed: 1, settings: { rounds: 3 } });
    const z = await unzip((await t.api("GET", `/logs/${r.logId}.zip`)).body);
    const records = await z.lines("game-001.jsonl");
    const snaps = records.filter((x) => x.t === "snapshot");
    expect(snaps.length).toBeGreaterThan(0);
    expect(snaps[0]).toMatchObject({ inputs: 2 });
    expect(snaps[0].state).toBeTruthy();
    expect((await z.json("run.json")).verify.ok).toBe(1);
  });

  it("names simulation logs by their result, and the board's dialog gets it", async () => {
    const { t } = await table(undefined, { cloudUrl: undefined });
    const r = await t.ok("POST", "/simulation", { gameId: "coin-flip", players: 2, games: 3, seed: 1 });
    expect(r).toMatchObject({ endReasons: { finished: 3 }, verified: true });
  });

  it("keeps the upload queue in step with retention", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gametable-logs-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const logs = new LogStore(dir, 1);
    await logs.save({ id: "20200101000000-coin-flip-aaaa", tableName: "T", gameId: "coin-flip", gameVersion: "1", simulation: false, startedAt: "", endedAt: "", games: 1, format: "gametable-log/2" }, [[]]);
    expect(await logs.pendingUploads()).toEqual(["20200101000000-coin-flip-aaaa"]);
    await logs.prune(Date.now() + 3 * 86400_000);
    expect(await logs.pendingUploads()).toEqual([]);
  });
});
