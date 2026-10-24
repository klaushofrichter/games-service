// Extra-game repositories (D-097): the console lists repositories, the service fetches each one's games/ folder as a
// bundle, an admin ticks repositories per table, and the table installs, updates and drops those games between games.
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startCloud } from "../apps/cloud/src/server.ts";
import { packRepoTarball, parseRepoSpec } from "../apps/cloud/src/game-repos.ts";
import { decodeBundle, readTarGz, safeBundlePath } from "../packages/protocol/src/bundle.ts";
import { githubTarball } from "./tar.ts";
import { sleep, testHost, until } from "./helpers.ts";
import { BUNDLE_LIMITS } from "../packages/protocol/src/bundle.ts";
const BUNDLE_LIMITS_TOTAL = BUNDLE_LIMITS.totalBytes;

const ADMIN = "admin-token-for-tests-123";
const TOKEN = "github_pat_reads_private_repos";

/** A tiny game in the shape an extra-games repository has: it imports the SDK by name, not by path. */
const manifest = (id: string, version = "0.1.0", name = "Dice Duel") =>
  JSON.stringify({
    id, name, version, sdk: "^0.1", description: "Everyone rolls once; the highest roll wins.",
    players: { min: 1, max: 4 }, turnModel: "simultaneous", seatLayouts: [2, 4], edges: ["north", "south", "east", "west"],
    seatConstraints: null, dynamicPlayers: false, saveGame: false, settings: [],
    ai: { supported: true, options: [], hostConfig: [] }, simulation: { supported: true, headless: true },
    remoteBoardControl: true, lobbyButton: "bottom-right", permissions: [],
  });
const rules = (label = "v1") => `
import { count, defineGame } from "@game-table/sdk";
type S = { rolls: Record<number, number>; seats: number[]; label: string };
export default defineGame<S>({
  setup(ctx) { return { rolls: {}, seats: ctx.seats.map((s) => s.seat), label: ${JSON.stringify(label)} }; },
  onIntent(s, seat, intent, ctx) {
    if (intent.name !== "roll" || s.rolls[seat]) return { reject: "roll once" };
    return { state: { ...s, rolls: { ...s.rolls, [seat]: ctx.randomInt(1, 6) } } };
  },
  view(s, seat) { return { mine: s.rolls[seat] ?? null, label: s.label }; },
  boardView(s) { return { rolls: s.rolls, label: s.label }; },
  isOver(s) {
    if (!s.seats.every((x) => s.rolls[x])) return null;
    return { text: "Rolled " + count(s.seats.length, "die", "dice") + ".", highlights: { label: s.label } };
  },
  ai(view: any) { return view.mine ? null : { name: "roll" }; },
});`;
const gameFiles = (id: string, o: { version?: string; label?: string } = {}) => ({
  [`games/${id}/manifest.json`]: manifest(id, o.version),
  [`games/${id}/rules.ts`]: rules(o.label),
  [`games/${id}/board.js`]: "export function mount(root){return{update(){},destroy(){}}}",
  [`games/${id}/deck.js`]: "export function mount(root){return{update(){},destroy(){}}}",
});

// ----- a fake GitHub serving tarballs -----
let github: Server;
let githubUrl: string;
const repos = new Map<string, { sha: string; files: Record<string, string>; private?: boolean; raw?: Buffer }>();
let tarballRequests = 0;
/** How long the fake GitHub takes to answer, for tests that need requests to overlap. */
let githubDelayMs = 0;

let cloud: Awaited<ReturnType<typeof startCloud>>;
let base: string;
const admin = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : null };
};

beforeEach(async () => {
  repos.clear();
  tarballRequests = 0;
  githubDelayMs = 0;
  github = createServer((req, res) => {
    const m = req.url!.match(/^\/repos\/([^/]+\/[^/]+)\/tarball\/(.+)$/);
    const r = m && repos.get(`${m[1]}@${decodeURIComponent(m[2])}`);
    if (!r || (r.private && req.headers.authorization !== `Bearer ${TOKEN}`)) return void res.writeHead(404).end('{"message":"Not Found"}');
    tarballRequests++;
    if (githubDelayMs) return void setTimeout(() => res.writeHead(200, { "content-type": "application/x-gzip" }).end(r.raw ?? githubTarball(m![1], r.sha, r.files)), githubDelayMs);
    res.writeHead(200, { "content-type": "application/x-gzip" }).end(r.raw ?? githubTarball(m![1], r.sha, r.files));
  });
  await new Promise<void>((ok) => github.listen(0, "127.0.0.1", ok));
  githubUrl = `http://127.0.0.1:${(github.address() as { port: number }).port}`;
  repos.set("klaushofrichter/extra-games@main", { sha: "abc1234", files: gameFiles("dice-duel"), private: true });
  cloud = await startCloud({ port: 0, host: "127.0.0.1", adminToken: ADMIN, publicUrl: "https://games.skylar.technology", githubApiUrl: githubUrl, gameRepoToken: TOKEN, gameRepoRefreshMs: 0 });
  base = `http://127.0.0.1:${cloud.port}`;
});
afterEach(async () => {
  await cloud.close();
  await new Promise((ok) => github.close(ok));
});

/** A table that pairs with this cloud, approved with the given repositories ticked. */
async function pairedTable(repoIds: string[]) {
  const t = await testHost({ cloudUrl: base, cloudPollMs: 30, cloudHeartbeatMs: 50 });
  const code = await until(() => t.host.table.cloud.pairingCode);
  const r = await admin("POST", `/admin/api/tables/pair/${code}`, { repos: repoIds });
  expect(r.status).toBe(200);
  await until(() => t.host.table.cloud.status === "online");
  return { t, tableId: r.body.tableId as string };
}

describe("bundles", () => {
  it("packs only games/, keeps the commit, and hashes the same files the same way", () => {
    const tar = githubTarball("o/r", "deadbee", { ...gameFiles("dice-duel"), "README.md": "hi", "scripts/x.sh": "rm -rf /" });
    const a = packRepoTarball(tar, "o/r", "main");
    const b = packRepoTarball(githubTarball("o/r", "deadbee", gameFiles("dice-duel")), "o/r", "main");
    expect(a.hash).toBe(b.hash);
    expect(a.commit).toBe("deadbee");
    expect(a.games).toEqual([{ id: "dice-duel", name: "Dice Duel", version: "0.1.0" }]);
    const files = Object.keys(decodeBundle(a.payload, a.hash).files).sort();
    expect(files).toEqual(["games/dice-duel/board.js", "games/dice-duel/deck.js", "games/dice-duel/manifest.json", "games/dice-duel/rules.ts"]);
  });

  it("reads long names from pax headers and skips links", () => {
    const long = `games/g/assets/${"x".repeat(90)}.png`;
    const tar = githubTarball("o/r", "1", { [long]: "img" }, [{ name: "games/g/evil", type: "2", data: "" }]);
    const files = readTarGz(tar);
    expect([...files.keys()].some((p) => p.endsWith(long))).toBe(true);
    expect([...files.keys()].some((p) => p.endsWith("evil"))).toBe(false);
  });

  it("refuses unsafe paths, bad manifests, mismatched ids and tampered bundles", () => {
    for (const p of ["../x", "games/../../etc", "/abs", "games/.hidden", "games/a b", "games//x", ""]) expect(safeBundlePath(p), p).toBe(false);
    expect(safeBundlePath("games/dice-duel/assets/die-1.png")).toBe(true);
    expect(() => packRepoTarball(githubTarball("o/r", "1", { "games/x/manifest.json": "{", "games/x/rules.ts": "" }), "o/r", "main")).toThrow(/not valid/);
    expect(() => packRepoTarball(githubTarball("o/r", "1", { "games/x/manifest.json": manifest("y"), "games/x/rules.ts": "" }), "o/r", "main")).toThrow(/must match the folder/);
    expect(() => packRepoTarball(githubTarball("o/r", "1", { "games/x/manifest.json": manifest("x") }), "o/r", "main")).toThrow(/no rules/);
    expect(() => packRepoTarball(githubTarball("o/r", "1", { "README.md": "" }), "o/r", "main")).toThrow(/no games/);
    const ok = packRepoTarball(githubTarball("o/r", "1", gameFiles("dice-duel")), "o/r", "main");
    expect(() => decodeBundle(ok.payload, "0".repeat(64))).toThrow(/hash mismatch/);
  });

  it("parses repository specs", () => {
    expect(parseRepoSpec("klaushofrichter/extra-games")).toEqual({ repo: "klaushofrichter/extra-games", ref: "main" });
    expect(parseRepoSpec("a/b@release/1.0")).toEqual({ repo: "a/b", ref: "release/1.0" });
    for (const bad of ["nope", "a/b/c", "a/..", "a/b@x..y", "a b/c"]) expect(() => parseRepoSpec(bad), bad).toThrow();
  });

  it("the host's import hook maps @game-table/sdk in plain Node, outside Vitest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "extra-hook-"));
    try {
      for (const [p, c] of Object.entries(gameFiles("dice-duel"))) {
        await mkdir(join(dir, p, ".."), { recursive: true });
        await writeFile(join(dir, p), c);
      }
      await writeFile(join(dir, "package.json"), '{"type":"module"}');
      const games = new URL("../apps/table-host/src/games.ts", import.meta.url).pathname;
      const script = `const { loadGames } = await import(${JSON.stringify(games)}); const g = await loadGames(${JSON.stringify(join(dir, "games"))}); console.log([...g.keys()].join(","), typeof g.get("dice-duel")?.def.setup);`;
      const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script]);
      expect(stdout.trim()).toBe("dice-duel function");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("console: game repositories", () => {
  it("adds a private repository with the token, lists its games, and reports failures without losing the last bundle", async () => {
    const add = await admin("POST", "/admin/api/repos", { repo: "klaushofrichter/extra-games" });
    expect(add.status).toBe(201);
    expect(add.body).toMatchObject({ id: "extra-games", repo: "klaushofrichter/extra-games", ref: "main", error: null, bundle: { commit: "abc1234", games: [{ id: "dice-duel" }] } });
    const first = add.body.bundle.hash;

    // A broken push: the console shows why, and tables keep the last good bundle.
    repos.get("klaushofrichter/extra-games@main")!.files["games/dice-duel/manifest.json"] = "{ broken";
    const bad = await admin("POST", "/admin/api/repos/extra-games/refresh");
    expect(bad.body.error).toMatch(/not valid/);
    expect(bad.body.bundle.hash).toBe(first);

    expect((await admin("POST", "/admin/api/repos", { repo: "klaushofrichter/extra-games" })).status).toBe(409);
    expect((await admin("POST", "/admin/api/repos", { repo: "not a repo" })).status).toBe(400);
    const missing = await admin("POST", "/admin/api/repos", { repo: "klaushofrichter/nothing-here" });
    expect(missing.status).toBe(201);
    expect(missing.body.error).toMatch(/does not exist, or GAME_REPO_TOKEN cannot read it/);

    const list = await admin("GET", "/admin/api/repos");
    expect(list.body.token).toBe(true);
    expect(list.body.repos.map((r: { id: string }) => r.id)).toEqual(["extra-games", "nothing-here"]);
    expect(JSON.stringify(list.body)).not.toContain(TOKEN);
    expect((await fetch(`${base}/admin/api/repos`)).status).toBe(401);
  });

  it("without a token, a private repository is reported as unreadable", async () => {
    const plain = await startCloud({ port: 0, host: "127.0.0.1", adminToken: ADMIN, publicUrl: "https://games.skylar.technology", githubApiUrl: githubUrl, gameRepos: ["klaushofrichter/extra-games"], gameRepoRefreshMs: 0 });
    try {
      const b = `http://127.0.0.1:${plain.port}`;
      const list = await until(async () => {
        const r = await (await fetch(`${b}/admin/api/repos`, { headers: { authorization: `Bearer ${ADMIN}` } })).json();
        return r.repos[0]?.error ? r : null;
      });
      expect(list.token).toBe(false);
      expect(list.repos[0].error).toMatch(/needs GAME_REPO_TOKEN/);
    } finally {
      await plain.close();
    }
  });

  it("flags game ids that two repositories share, and refuses unknown repositories for a table", async () => {
    repos.set("someone/more-games@main", { sha: "fff0000", files: gameFiles("dice-duel") });
    await admin("POST", "/admin/api/repos", { repo: "klaushofrichter/extra-games" });
    await admin("POST", "/admin/api/repos", { repo: "someone/more-games" });
    const list = (await admin("GET", "/admin/api/repos")).body.repos;
    expect(list.map((r: { clashes: string[] }) => r.clashes)).toEqual([["dice-duel"], ["dice-duel"]]);
    expect((await admin("POST", "/admin/api/tables/pair/ABCDEF", { repos: ["nope"] })).body.error).toMatch(/unknown repositories: nope/);
  });
});

describe("tables get the games of their repositories", () => {
  it("installs a ticked repository's games at approval, and they play like built-in ones", async () => {
    await admin("POST", "/admin/api/repos", { repo: "klaushofrichter/extra-games" });
    const { t } = await pairedTable(["extra-games"]);
    try {
      await until(() => t.host.table.games.has("dice-duel"));
      const games = await t.ok("GET", "/games");
      expect(games.find((g: { id: string }) => g.id === "dice-duel")).toMatchObject({ name: "Dice Duel", extra: true, selectable: true });
      expect(games.find((g: { id: string }) => g.id === "roulette").extra).toBeUndefined();
      // The UI files are served like a built-in game's; the rules never are.
      expect((await fetch(`${t.base}/games/dice-duel/board.js`)).status).toBe(200);
      expect((await fetch(`${t.base}/games/dice-duel/rules.ts`)).status).toBe(404);

      const a = await t.joinDeck("Ann");
      await t.ok("POST", "/ai", {});
      await t.ok("POST", "/game/select", { gameId: "dice-duel" });
      await a.request("lobby", "ready", { ready: true });
      await t.ok("POST", "/game/start");
      await a.request("game", "intent", { name: "roll" });
      await until(() => t.host.table.phase === "finished");
      expect(t.host.table.state().summary!.text).toBe("Rolled two dice.");

      // The log names the exact code it ran.
      const log = await until(async () => ((await t.ok("GET", "/logs")) as { id: string }[]).find((l) => l.id.includes("dice-duel")));
      const zip = await t.api("GET", `/logs/${log.id}.zip`);
      const { LogStore } = await import("../apps/table-host/src/logs.ts");
      const { meta } = await LogStore.unzip(zip.body as Buffer);
      expect(meta.gameSource).toMatch(/^klaushofrichter\/extra-games@main abc1234 \(bundle [0-9a-f]{12}\)$/);

      // Simulations work too.
      const sim = await t.ok("POST", "/simulation", { gameId: "dice-duel", players: 2, games: 3, seed: 1 });
      expect(sim.games).toHaveLength(3);
    } finally {
      await t.close();
    }
  });

  it("a table without the tick gets nothing, and cannot download the bundle", async () => {
    const add = await admin("POST", "/admin/api/repos", { repo: "klaushofrichter/extra-games" });
    const { t } = await pairedTable([]);
    try {
      await until(async () => (await admin("GET", "/admin/api/tables")).body[0]?.lastSeen);
      expect(t.host.table.games.has("dice-duel")).toBe(false);
      expect((await fetch(`${base}/api/tables/bundles/${add.body.bundle.hash}`)).status).toBe(401);
      const token = JSON.parse(await (await import("node:fs/promises")).readFile(join(t.host.cloud!["o"].dataDir, "table.json"), "utf8")).tableToken;
      expect((await fetch(`${base}/api/tables/bundles/${add.body.bundle.hash}`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
    } finally {
      await t.close();
    }
  });

  it("ticking and unticking later adds and removes the games; never during a game", async () => {
    await admin("POST", "/admin/api/repos", { repo: "klaushofrichter/extra-games" });
    const { t, tableId } = await pairedTable([]);
    try {
      expect((await admin("PUT", `/admin/api/tables/${tableId}/repos`, { repos: ["extra-games"] })).body.repos).toEqual(["extra-games"]);
      await until(() => t.host.table.games.has("dice-duel"));

      const a = await t.joinDeck("Ann");
      await t.ok("POST", "/game/select", { gameId: "dice-duel" });
      await a.request("lobby", "ready", { ready: true });
      await t.ok("POST", "/ai", {});
      await t.ok("POST", "/game/start");
      // Unticked mid-game: the game goes on, the change waits for its end.
      await admin("PUT", `/admin/api/tables/${tableId}/repos`, { repos: [] });
      await until(() => t.host.table.extraGames().pending !== null);
      expect(t.host.table.games.has("dice-duel")).toBe(true);
      await a.request("game", "intent", { name: "roll" });
      await until(() => !t.host.table.games.has("dice-duel"));
      expect(t.host.table.phase).toBe("idle");
      const dir = join(t.host.cloud!["o"].dataDir, "extra-games");
      await until(async () => !(await readdir(dir)).some((f) => /^[0-9a-f]{64}$/.test(f)));
    } finally {
      await t.close();
    }
  });

  it("a new commit replaces the game, and a selected game stays chosen with the new code", async () => {
    await admin("POST", "/admin/api/repos", { repo: "klaushofrichter/extra-games" });
    const { t } = await pairedTable(["extra-games"]);
    try {
      await until(() => t.host.table.games.has("dice-duel"));
      await t.joinDeck("Ann");
      await t.ok("POST", "/game/select", { gameId: "dice-duel" });
      repos.set("klaushofrichter/extra-games@main", { sha: "beef999", files: gameFiles("dice-duel", { version: "0.2.0", label: "v2" }), private: true });
      await admin("POST", "/admin/api/repos/extra-games/refresh");
      await until(() => t.host.table.games.get("dice-duel")?.manifest.version === "0.2.0");
      expect(t.host.table.state().game).toMatchObject({ id: "dice-duel", version: "0.2.0" });
      expect(t.host.table.games.get("dice-duel")!.source).toMatchObject({ repo: "klaushofrichter/extra-games@main", commit: "beef999" });
    } finally {
      await t.close();
    }
  });

  it("never replaces a built-in game, and removing the repository or disconnecting the table drops its games", async () => {
    repos.set("klaushofrichter/extra-games@main", { sha: "c0ffee0", files: { ...gameFiles("dice-duel"), ...gameFiles("roulette") }, private: true });
    await admin("POST", "/admin/api/repos", { repo: "klaushofrichter/extra-games" });
    const { t, tableId } = await pairedTable(["extra-games"]);
    try {
      await until(() => t.host.table.games.has("dice-duel"));
      expect(t.host.table.games.get("roulette")!.source).toBeUndefined();
      expect(t.host.table.extraGames().installed).toEqual(["dice-duel"]);

      await admin("POST", `/admin/api/tables/${tableId}/revoke`);
      await until(() => !t.host.table.games.has("dice-duel"));
      await admin("POST", `/admin/api/tables/${tableId}/reconnect`);
      await until(() => t.host.table.games.has("dice-duel"));

      expect((await admin("DELETE", "/admin/api/repos/extra-games")).status).toBe(200);
      await until(() => !t.host.table.games.has("dice-duel"));
      expect((await admin("GET", "/admin/api/tables")).body[0].repos).toEqual([]);
    } finally {
      await t.close();
    }
  });

  it("a restarted table offers its installed games from disk before the service answers", async () => {
    await admin("POST", "/admin/api/repos", { repo: "klaushofrichter/extra-games" });
    const { t } = await pairedTable(["extra-games"]);
    const dataDir: string = t.host.cloud!["o"].dataDir;
    await until(() => t.host.table.games.has("dice-duel"));
    await until(async () => (await readdir(join(dataDir, "extra-games"))).includes("installed.json"));
    await t.host.close();
    const before = tarballRequests;
    // Same data folder, a service that is not there: the games come from disk, nothing is downloaded.
    const again = await testHost({ dataDir, cloudUrl: "http://127.0.0.1:9", cloudPollMs: 30, cloudHeartbeatMs: 50 });
    try {
      expect(again.host.table.games.has("dice-duel")).toBe(true);
      expect(tarballRequests).toBe(before);
    } finally {
      await again.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

// Several independent repositories at once, as in production: extra-games and loopy-game, both private, read with the
// one GAME_REPO_TOKEN (a fine-grained token that covers both), each ticked for some tables and not others.
describe("several independent repositories", () => {
  const LOOPY = "klaushofrichter/loopy-game@main";
  /** Bundle folders a table has unpacked: <dataDir>/extra-games/<hash>. */
  const bundleDirs = async (t: Awaited<ReturnType<typeof pairedTable>>["t"]) =>
    (await readdir(join(t.host.cloud!["o"].dataDir, "extra-games"))).filter((f) => /^[0-9a-f]{64}$/.test(f)).sort();

  beforeEach(async () => {
    repos.set(LOOPY, { sha: "1009100", files: { ...gameFiles("loopy-lite", { label: "loopy" }), ...gameFiles("loopy-practice", { label: "practice" }) }, private: true });
    expect((await admin("POST", "/admin/api/repos", { repo: "klaushofrichter/extra-games" })).body.error).toBeNull();
    expect((await admin("POST", "/admin/api/repos", { repo: "klaushofrichter/loopy-game" })).body.error).toBeNull();
  });

  it("each table gets exactly the repositories ticked for it; a table with both has both bundles side by side and plays from each", async () => {
    const list = (await admin("GET", "/admin/api/repos")).body.repos;
    expect(list.map((r: { id: string; clashes: string[] }) => [r.id, r.clashes])).toEqual([["extra-games", []], ["loopy-game", []]]);
    const a = await pairedTable(["extra-games"]);
    const b = await pairedTable(["loopy-game"]);
    const c = await pairedTable(["extra-games", "loopy-game"]);
    try {
      await until(() => a.t.host.table.games.has("dice-duel") && b.t.host.table.games.has("loopy-lite") && c.t.host.table.games.has("loopy-practice") && c.t.host.table.games.has("dice-duel"));
      // Wait for every table's heartbeat to have settled, then nothing more may arrive.
      await sleep(200);
      expect(a.t.host.table.extraGames().installed).toEqual(["dice-duel"]);
      expect(b.t.host.table.extraGames().installed).toEqual(["loopy-lite", "loopy-practice"]);
      expect(c.t.host.table.extraGames().installed).toEqual(["dice-duel", "loopy-lite", "loopy-practice"]);
      expect(await bundleDirs(a.t)).toHaveLength(1);
      expect(await bundleDirs(b.t)).toHaveLength(1);
      expect(await bundleDirs(c.t)).toEqual([...(await bundleDirs(a.t)), ...(await bundleDirs(b.t))].sort());

      // Every game knows which repository and commit it came from.
      expect(c.t.host.table.games.get("dice-duel")!.source).toMatchObject({ repo: "klaushofrichter/extra-games@main", commit: "abc1234" });
      expect(c.t.host.table.games.get("loopy-lite")!.source).toMatchObject({ repo: LOOPY, commit: "1009100" });
      const ids = (await c.t.ok("GET", "/games")).filter((g: { extra?: boolean }) => g.extra).map((g: { id: string }) => g.id).sort();
      expect(ids).toEqual(["dice-duel", "loopy-lite", "loopy-practice"]);

      // A table only downloads its own repositories' bundles.
      const bHash = (await bundleDirs(b.t))[0];
      const aToken = JSON.parse(await readFile(join(a.t.host.cloud!["o"].dataDir, "table.json"), "utf8")).tableToken;
      expect((await fetch(`${base}/api/tables/bundles/${bHash}`, { headers: { authorization: `Bearer ${aToken}` } })).status).toBe(404);

      // One game from each repository, one after the other, on the table that has both.
      const ann = await c.t.joinDeck("Ann");
      await c.t.ok("POST", "/ai", {});
      for (const [gameId, label] of [["loopy-lite", "loopy"], ["dice-duel", "v1"]]) {
        await c.t.ok("POST", "/game/select", { gameId });
        await ann.request("lobby", "ready", { ready: true });
        await c.t.ok("POST", "/game/start");
        await ann.request("game", "intent", { name: "roll" });
        await until(() => c.t.host.table.phase === "finished");
        expect(c.t.host.table.state().summary!.highlights).toMatchObject({ label });
        await c.t.ok("POST", "/game/close");
      }
    } finally {
      await a.t.close();
      await b.t.close();
      await c.t.close();
    }
  });

  it("repositories update, fail and go away independently of each other", async () => {
    const c = await pairedTable(["extra-games", "loopy-game"]);
    try {
      await until(() => c.t.host.table.games.has("dice-duel") && c.t.host.table.games.has("loopy-lite"));
      const extraHash = c.t.host.table.games.get("dice-duel")!.source!.hash;

      // A new loopy-game commit replaces only loopy-game's games; extra-games keeps its bundle, nothing is refetched.
      repos.set(LOOPY, { sha: "2009200", files: { ...gameFiles("loopy-lite", { version: "0.2.0" }), ...gameFiles("loopy-practice") }, private: true });
      const extraFetches = tarballRequests;
      await admin("POST", "/admin/api/repos/loopy-game/refresh");
      await until(() => c.t.host.table.games.get("loopy-lite")?.manifest.version === "0.2.0");
      expect(tarballRequests - extraFetches).toBe(1);
      expect(c.t.host.table.games.get("dice-duel")!.source!.hash).toBe(extraHash);
      await until(async () => (await bundleDirs(c.t)).length === 2); // the old loopy bundle is deleted

      // A broken loopy-game push: loopy-game shows the error and keeps its last good bundle; extra-games is unaffected.
      repos.get(LOOPY)!.files["games/loopy-lite/manifest.json"] = "{ broken";
      const bad = await admin("POST", "/admin/api/repos/loopy-game/refresh");
      expect(bad.body.error).toMatch(/not valid/);
      const list = (await admin("GET", "/admin/api/repos")).body.repos;
      expect(list.find((r: { id: string }) => r.id === "extra-games").error).toBeNull();
      expect(c.t.host.table.games.get("loopy-lite")!.manifest.version).toBe("0.2.0");

      // A repository that disappears from GitHub: same, the last good bundle stays.
      repos.delete(LOOPY);
      expect((await admin("POST", "/admin/api/repos/loopy-game/refresh")).body.error).toMatch(/does not exist/);
      expect((await admin("POST", "/admin/api/repos/extra-games/refresh")).body.error).toBeNull();
      await sleep(200);
      expect(c.t.host.table.extraGames().installed).toEqual(["dice-duel", "loopy-lite", "loopy-practice"]);

      // Removing one repository drops only its games.
      expect((await admin("DELETE", "/admin/api/repos/loopy-game")).status).toBe(200);
      await until(() => !c.t.host.table.games.has("loopy-lite"));
      expect(c.t.host.table.extraGames().installed).toEqual(["dice-duel"]);
      expect((await admin("GET", "/admin/api/tables")).body[0].repos).toEqual(["extra-games"]);
      await until(async () => (await bundleDirs(c.t)).length === 1);
    } finally {
      await c.t.close();
    }
  });
});

// ----- the table's installer on its own: what it does with bad, malicious or repeated input -----
import { ExtraGames } from "../apps/table-host/src/extra-games.ts";
import { BUNDLE_FORMAT, encodeBundle } from "../packages/protocol/src/bundle.ts";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

/** A bundle for the installer, as the cloud would serve it. */
function bundleOf(files: Record<string, string>, games = [{ id: "dice-duel", name: "Dice Duel", version: "0.1.0" }]) {
  const b = encodeBundle({ format: BUNDLE_FORMAT, repo: "o/r", ref: "main", commit: "c0ffee1", games, files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(v)])) });
  return { ...b, ref: { repo: "r", source: "o/r@main", hash: b.hash, commit: "c0ffee1", games } };
}

describe("the table's installer", () => {
  let t: Awaited<ReturnType<typeof testHost>>;
  let dir: string;
  beforeEach(async () => {
    t = await testHost();
    dir = await mkdtemp(join(tmpdir(), "extra-installer-"));
  });
  afterEach(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("installs once, and a repeated list downloads nothing", async () => {
    const b = bundleOf(gameFiles("dice-duel"));
    let downloads = 0;
    const x = new ExtraGames(t.host.table, dir, async () => (downloads++, b.payload));
    await x.sync([b.ref]);
    await x.sync([b.ref]);
    await x.sync([{ ...b.ref }]);
    expect(downloads).toBe(1);
    expect(t.host.table.games.get("dice-duel")?.source).toEqual({ repo: "o/r@main", commit: "c0ffee1", hash: b.hash });
  });

  it("concurrent syncs are queued, not interleaved", async () => {
    const b1 = bundleOf(gameFiles("dice-duel"));
    const b2 = bundleOf(gameFiles("dice-duel", { version: "0.2.0" }));
    const x = new ExtraGames(t.host.table, dir, async (h) => {
      await sleep(30);
      return h === b1.hash ? b1.payload : b2.payload;
    });
    await Promise.all([x.sync([b1.ref]), x.sync([b2.ref]), x.sync([])]);
    expect(t.host.table.games.has("dice-duel")).toBe(false); // the last list wins
    await x.sync([b2.ref]);
    expect(t.host.table.games.get("dice-duel")!.manifest.version).toBe("0.2.0");
    expect((await readdir(join(dir, "extra-games"))).filter((f) => /^[0-9a-f]{64}$/.test(f))).toEqual([b2.hash]);
  });

  it("a corrupted download installs nothing, says why, and is tried again next time", async () => {
    const b = bundleOf(gameFiles("dice-duel"));
    let n = 0;
    const x = new ExtraGames(t.host.table, dir, async () => (n++ === 0 ? Buffer.concat([b.payload.subarray(0, 40), Buffer.alloc(40)]) : b.payload));
    await x.sync([b.ref]);
    expect(t.host.table.games.has("dice-duel")).toBe(false);
    expect(x.errors.get("r")).toBeTruthy();
    await x.sync([b.ref]);
    expect(t.host.table.games.has("dice-duel")).toBe(true);
    expect(x.errors.size).toBe(0);
  });

  it("a payload that does not match the promised hash is refused", async () => {
    const good = bundleOf(gameFiles("dice-duel"));
    const other = bundleOf(gameFiles("dice-duel", { label: "evil" }));
    const x = new ExtraGames(t.host.table, dir, async () => other.payload);
    await x.sync([good.ref]);
    expect(x.errors.get("r")).toMatch(/hash mismatch/);
    expect(t.host.table.games.has("dice-duel")).toBe(false);
  });

  it("a bundle that tries to write outside its folder is refused, and nothing lands outside", async () => {
    // Hand-made: a correct hash over a path that escapes. The cloud would never build this; a table must not trust that.
    const json = JSON.stringify({ format: BUNDLE_FORMAT, repo: "o/r", ref: "main", commit: "x", games: [], files: { "games/../../escaped.txt": Buffer.from("x").toString("base64") } });
    const hash = createHash("sha256").update(json).digest("hex");
    const x = new ExtraGames(t.host.table, dir, async () => gzipSync(json));
    await x.sync([{ repo: "r", source: "o/r@main", hash, commit: "x", games: [] }]);
    expect(x.errors.get("r")).toMatch(/unsafe path/);
    await expect(readFile(join(dir, "escaped.txt"))).rejects.toThrow();
    await expect(readFile(join(dir, "..", "escaped.txt"))).rejects.toThrow();
  });

  it("a gzip bomb is cut off instead of filling the memory", async () => {
    const huge = gzipSync(Buffer.alloc(BUNDLE_LIMITS_TOTAL * 3, 32));
    const x = new ExtraGames(t.host.table, dir, async () => huge);
    await x.sync([{ repo: "r", source: "o/r@main", hash: "a".repeat(64), commit: "x", games: [] }]);
    expect(x.errors.get("r")).toMatch(/buffer|length|exceed|large/i);
  });

  it("rules that don't load leave the table's other games alone", async () => {
    const broken = bundleOf({ ...gameFiles("dice-duel"), "games/dice-duel/rules.ts": "export default {{{ not typescript" });
    const x = new ExtraGames(t.host.table, dir, async () => broken.payload);
    await x.sync([broken.ref]);
    expect(t.host.table.games.has("dice-duel")).toBe(false);
    expect(x.errors.get("r")).toMatch(/no game that loads/);
    expect(t.host.table.games.has("roulette")).toBe(true);
  });

  it("rules without a default defineGame export are refused", async () => {
    const b = bundleOf({ ...gameFiles("dice-duel"), "games/dice-duel/rules.ts": "export const x = 1;" });
    const x = new ExtraGames(t.host.table, dir, async () => b.payload);
    await x.sync([b.ref]);
    expect(t.host.table.games.has("dice-duel")).toBe(false);
  });

  it("two repositories with the same game id: the first listed wins, the other's games still load", async () => {
    const a = bundleOf(gameFiles("dice-duel"));
    const b = bundleOf({ ...gameFiles("dice-duel", { version: "9.9.9" }), ...gameFiles("coin-race") }, [{ id: "dice-duel", name: "x", version: "9.9.9" }, { id: "coin-race", name: "y", version: "1" }]);
    const x = new ExtraGames(t.host.table, dir, async (h) => (h === a.hash ? a.payload : b.payload));
    await x.sync([a.ref, { ...b.ref, repo: "r2" }]);
    expect(t.host.table.games.get("dice-duel")!.manifest.version).toBe("0.1.0");
    expect(t.host.table.games.has("coin-race")).toBe(true);
  });

  it("garbage in the installed list on disk is ignored at start", async () => {
    await mkdir(join(dir, "extra-games"), { recursive: true });
    await writeFile(join(dir, "extra-games", "installed.json"), '[{"hash":"../../etc"},{"hash":42},"x"]');
    const x = new ExtraGames(t.host.table, dir, async () => Buffer.alloc(0));
    await x.restore();
    expect(t.host.table.extraGames().installed).toEqual([]);
    await writeFile(join(dir, "extra-games", "installed.json"), "not json");
    await x.restore();
  });

  it("a chosen extra game whose settings no longer fit an update is unchosen", async () => {
    const withSetting = (max: number) => ({ ...gameFiles("dice-duel"), "games/dice-duel/manifest.json": JSON.stringify({ ...JSON.parse(manifest("dice-duel")), settings: [{ key: "n", type: "int", min: 1, max, default: 1 }] }) });
    const v1 = bundleOf(withSetting(10));
    const v2 = bundleOf(withSetting(2));
    const x = new ExtraGames(t.host.table, dir, async (h) => (h === v1.hash ? v1.payload : v2.payload));
    await x.sync([v1.ref]);
    await t.joinDeck("Ann");
    await t.ok("POST", "/game/select", { gameId: "dice-duel", settings: { n: 7 } });
    await x.sync([v2.ref]);
    expect(t.host.table.state()).toMatchObject({ phase: "idle", game: null });
  });
});

describe("the service, edge cases", () => {
  it("validates the per-table repository list", async () => {
    await admin("POST", "/admin/api/repos", { repo: "klaushofrichter/extra-games" });
    expect((await admin("PUT", "/admin/api/tables/nope/repos", { repos: [] })).status).toBe(404);
    const { t, tableId } = await pairedTable([]);
    try {
      expect((await admin("PUT", `/admin/api/tables/${tableId}/repos`, { repos: "extra-games" })).status).toBe(400);
      expect((await admin("PUT", `/admin/api/tables/${tableId}/repos`, { repos: [1] })).status).toBe(400);
      expect((await admin("PUT", `/admin/api/tables/${tableId}/repos`, { repos: ["extra-games", "extra-games"] })).body.repos).toEqual(["extra-games"]);
    } finally {
      await t.close();
    }
  });

  it("refuses repositories whose games are too big, and lists at most 50", async () => {
    repos.set("o/big@main", { sha: "1", files: { ...gameFiles("dice-duel"), "games/dice-duel/assets/huge.bin": "x".repeat(6 * 1024 * 1024) } });
    const big = await admin("POST", "/admin/api/repos", { repo: "o/big" });
    expect(big.body.error).toMatch(/larger than 5 MB/);
    for (let i = 0; i < 49; i++) expect((await admin("POST", "/admin/api/repos", { repo: `o/r${i}` })).status).toBe(201);
    expect((await admin("POST", "/admin/api/repos", { repo: "o/one-too-many" })).status).toBe(409);
  }, 30000);

  it("concurrent refreshes of one repository make one fetch", async () => {
    await admin("POST", "/admin/api/repos", { repo: "klaushofrichter/extra-games" });
    const before = tarballRequests;
    githubDelayMs = 300; // all four arrive while the first fetch is still running
    await Promise.all([1, 2, 3, 4].map(() => admin("POST", "/admin/api/repos/extra-games/refresh")));
    expect(tarballRequests - before).toBe(1);
  });

  it("the same repository on another branch is a separate entry", async () => {
    repos.set("klaushofrichter/extra-games@production", { sha: "aaa0001", files: gameFiles("dice-duel"), private: true });
    await admin("POST", "/admin/api/repos", { repo: "klaushofrichter/extra-games" });
    const prod = await admin("POST", "/admin/api/repos", { repo: "klaushofrichter/extra-games", ref: "production" });
    expect(prod.body).toMatchObject({ id: "extra-games-2", ref: "production", bundle: { commit: "aaa0001" } });
  });

  it("GAME_REPOS entries are listed and fetched at start; bad ones are skipped with a warning", async () => {
    const c = await startCloud({ port: 0, host: "127.0.0.1", adminToken: ADMIN, publicUrl: "https://games.skylar.technology", githubApiUrl: githubUrl, gameRepoToken: TOKEN, gameRepos: ["klaushofrichter/extra-games", "not a repo"], gameRepoRefreshMs: 0 });
    try {
      const b = `http://127.0.0.1:${c.port}`;
      const list = await until(async () => {
        const r = await (await fetch(`${b}/admin/api/repos`, { headers: { authorization: `Bearer ${ADMIN}` } })).json();
        return r.repos[0]?.bundle ? r.repos : null;
      });
      expect(list.map((r: { id: string }) => r.id)).toEqual(["extra-games"]);
    } finally {
      await c.close();
    }
  });

  it("a table on a service from before extra games keeps what it has", async () => {
    await admin("POST", "/admin/api/repos", { repo: "klaushofrichter/extra-games" });
    const { t } = await pairedTable(["extra-games"]);
    try {
      await until(() => t.host.table.games.has("dice-duel"));
      // An old service's answer: config without gameBundles.
      (t.host.cloud as any).applyConfig({ logRetentionDays: 90 });
      await sleep(100);
      expect(t.host.table.games.has("dice-duel")).toBe(true);
    } finally {
      await t.close();
    }
  });

  it("a table without a service has only its built-in games", async () => {
    const t = await testHost();
    try {
      expect(t.host.cloud).toBeNull();
      expect([...t.host.table.games.values()].every((g) => !g.source)).toBe(true);
    } finally {
      await t.close();
    }
  });

  it("the console page has the repository section and the per-table column", async () => {
    const html = await (await fetch(`${base}/admin`)).text();
    for (const s of ["Game repositories", "repo-form", "pair-repos", "Extra games"]) expect(html).toContain(s);
  });
});

// ----- the deploy-time list (D-098) -----
import { parseRepoConfig } from "../apps/cloud/src/game-repos.ts";
import { spawn } from "node:child_process";

describe("the deploy-time repository list", () => {
  it("deploy/game-repos.json is valid and lists extra-games, loopy-game and starforge-game on their production branches", async () => {
    const text = await readFile(new URL("../deploy/game-repos.json", import.meta.url), "utf8");
    expect(parseRepoConfig(text)).toEqual(["klaushofrichter/extra-games@production", "klaushofrichter/loopy-game@production", "klaushofrichter/starforge-game@production"]);
  });

  it("parses entries with and without a branch, and refuses anything malformed", () => {
    expect(parseRepoConfig('{"repos":[{"repo":"a/b"},{"repo":"c/d","ref":"x/y"}]}')).toEqual(["a/b", "c/d@x/y"]);
    expect(parseRepoConfig('{"repos":[]}')).toEqual([]);
    for (const bad of ["", "{", "[]", '{"repos":{}}', '{"repos":[{"ref":"main"}]}', '{"repos":[{"repo":"nope"}]}', '{"repos":[{"repo":"a/b","ref":1}]}', '{"repos":[{"repo":"a/b","ref":"x..y"}]}'])
      expect(() => parseRepoConfig(bad), bad).toThrow();
  });

  it("deploy-time repositories are marked and can't be removed in the console; console ones can", async () => {
    const c = await startCloud({ port: 0, host: "127.0.0.1", adminToken: ADMIN, publicUrl: "https://games.skylar.technology", githubApiUrl: githubUrl, gameRepoToken: TOKEN, gameRepos: ["klaushofrichter/extra-games"], gameRepoRefreshMs: 0 });
    const b = `http://127.0.0.1:${c.port}`;
    const call = async (method: string, path: string, body?: unknown) => {
      const r = await fetch(`${b}${path}`, { method, headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json() };
    };
    try {
      repos.set("someone/more-games@main", { sha: "fff0000", files: gameFiles("coin-race") });
      expect((await call("POST", "/admin/api/repos", { repo: "someone/more-games" })).body.origin).toBe("console");
      const list = (await call("GET", "/admin/api/repos")).body.repos;
      expect(list.map((r: { id: string; origin: string }) => [r.id, r.origin])).toEqual([["extra-games", "deploy"], ["more-games", "console"]]);
      const refused = await call("DELETE", "/admin/api/repos/extra-games");
      expect(refused.status).toBe(409);
      expect(refused.body.error).toMatch(/deploy\/game-repos\.json/);
      expect((await call("DELETE", "/admin/api/repos/more-games")).status).toBe(200);
      // A deploy-time repository can still be ticked and unticked per table, and refreshed.
      expect((await call("POST", "/admin/api/repos/extra-games/refresh")).status).toBe(200);
    } finally {
      await c.close();
    }
  });

  /** Start the real entry point (main.ts) and return its exit code, or the repos it lists once it answers. */
  async function runMain(env: Record<string, string>): Promise<{ code: number | null; out: string; repos?: { repo: string; ref: string; origin: string }[] }> {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, ["apps/cloud/src/main.ts"], {
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, PORT: String(port), PUBLIC_URL: `http://127.0.0.1:${port}`, ADMIN_TOKEN: ADMIN, GAME_REPO_API_URL: githubUrl, GAME_REPOS: "", ...env },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const exited = new Promise<number | null>((ok) => child.on("exit", (c) => ok(c)));
    try {
      const up = await Promise.race([
        exited.then(() => false),
        until(async () => (await fetch(`http://127.0.0.1:${port}/health`).catch(() => null))?.ok, 10000).then(() => true),
      ]);
      if (!up) return { code: await exited, out };
      const r = await (await fetch(`http://127.0.0.1:${port}/admin/api/repos`, { headers: { authorization: `Bearer ${ADMIN}` } })).json();
      return { code: null, out, repos: r.repos };
    } finally {
      child.kill();
    }
  }

  it("the service starts with the repositories of deploy/game-repos.json, plus GAME_REPOS", async () => {
    const r = await runMain({ GAME_REPOS: "someone/more-games" });
    expect(r.repos?.map((x) => [x.repo, x.ref, x.origin])).toEqual([
      ["klaushofrichter/extra-games", "production", "deploy"],
      ["klaushofrichter/loopy-game", "production", "deploy"],
      ["klaushofrichter/starforge-game", "production", "deploy"],
      ["someone/more-games", "main", "deploy"],
    ]);
  }, 20000);

  it("a broken GAME_REPOS_FILE stops the service with a clear message", async () => {
    const dir = await mkdtemp(join(tmpdir(), "repo-file-"));
    try {
      await writeFile(join(dir, "bad.json"), '{"repos":[{"repo":"not a repo"}]}');
      const bad = await runMain({ GAME_REPOS_FILE: join(dir, "bad.json") });
      expect(bad.code).toBe(1);
      expect(bad.out).toMatch(/bad\.json: .*not a GitHub repository/);
      const missing = await runMain({ GAME_REPOS_FILE: join(dir, "missing.json") });
      expect(missing.code).toBe(1);
      expect(missing.out).toMatch(/cannot be read/);
      const none = await runMain({ GAME_REPOS_FILE: "none" });
      expect(none.repos).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);

  it("CONSOLE_URL must be an origin of its own, and the Google redirect URI follows it (D-204)", async () => {
    for (const [v, msg] of [["games-console.example", /must be an origin/], ["http://127.0.0.1:1/admin", /must be an origin/], ["ftp://console.example", /must be an origin/]] as const) {
      const r = await runMain({ CONSOLE_URL: v });
      expect(r.code, v).toBe(1);
      expect(r.out, v).toMatch(msg);
    }
    const https = await runMain({ PUBLIC_URL: "https://games.example", CONSOLE_URL: "http://console.example", GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "x", GOOGLE_REDIRECT_URI: "http://console.example/auth/google/callback", ALLOWED_EMAILS: "a@example.com", COOKIE_SECRET: "c".repeat(32) });
    expect(https.out).toMatch(/must be https when PUBLIC_URL is/);
    const redirect = await runMain({ PUBLIC_URL: "https://games.example", CONSOLE_URL: "https://console.example", GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "x", GOOGLE_REDIRECT_URI: "https://games.example/auth/google/callback", ALLOWED_EMAILS: "a@example.com", COOKIE_SECRET: "c".repeat(32) });
    expect(redirect.out).toMatch(/GOOGLE_REDIRECT_URI must be https:\/\/console\.example\/auth\/google\/callback/);
    const ok = await runMain({ CONSOLE_URL: "http://localhost:1/" });
    expect(ok.code).toBeNull();
    expect(ok.out).toMatch(/console at http:\/\/localhost:1;/);
  }, 40000);
});
