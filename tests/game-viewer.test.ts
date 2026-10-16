// The Game Viewer (D-120): finished games' logs as move lists. Player moves are numbered (refused ones too), the rest
// are rows between them; a game's `describe` writes the text, columns and automatic sub-steps; the move list goes into
// every finished game's zip; the table serves lists, pages and single steps with the state before and after; pause and
// resume are logged; and scripts/game-log.ts reads a zip without a table.
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { loadGames } from "../apps/table-host/src/games.ts";
import { LogStore } from "../apps/table-host/src/logs.ts";
import { buildMoves, GAP_MS, pageMoves, stateAt } from "../apps/table-host/src/moves.ts";
import { GameRuntime, replayLog, type Clock } from "../apps/table-host/src/runtime.ts";
import { runSimulation } from "../apps/table-host/src/simulation.ts";
import { testHost } from "./helpers.ts";

const games = await loadGames(join(import.meta.dirname, "..", "games"));
const coin = games.get("coin-flip")!;
const pachisi = games.get("pachisi")!;
const seats = [
  { seat: 0, playerId: "a", name: "Ann", kind: "human" as const },
  { seat: 1, playerId: "b", name: "Bob", kind: "human" as const },
];

/** A clock the test moves by hand; no timers (the games here run without a time limit). */
function manualClock() {
  let t = 1_790_000_000_000;
  const c: Clock & { advance(ms: number): void } = { now: () => t, setTimeout: () => 0, clearTimeout: () => {}, advance: (ms) => void (t += ms) };
  return c;
}

/** A coin-flip game played here: Ann and Bob guess, Ann taps twice in round 1, then a long silence, then a pause. */
function playedCoinFlip() {
  const clock = manualClock();
  const rt = new GameRuntime(coin.manifest, coin.def, 42, { rounds: 2, roundSeconds: 0 }, seats, clock);
  rt.submit(0, { name: "guess", payload: "heads" }, "human");
  rt.submit(0, { name: "guess", payload: "tails" }, "human"); // refused: already guessed
  clock.advance(1000);
  rt.submit(1, { name: "guess", payload: "tails" }, "board" as const);
  clock.advance(GAP_MS + 5 * 60_000); // nobody did anything for a while
  rt.submit(0, { name: "guess", payload: "heads" }, "human");
  rt.pause("cloud");
  clock.advance(10 * 60_000); // a pause explains the silence: no gap row
  rt.resume("cloud");
  rt.submit(1, { name: "guess", payload: "heads" }, "human");
  return rt;
}

describe("move lists (D-120)", () => {
  it("numbers player moves, refused ones too, and keeps everything else as rows between them", () => {
    const rt = playedCoinFlip();
    expect(rt.over).toBe(true);
    const list = buildMoves(rt.log);
    expect(list.moves).toBe(5);
    expect(list.described).toBe(false);
    expect(list.rows.map((r) => [r.n, r.kind])).toEqual([
      [null, "start"],
      [1, "move"],
      [2, "move"],
      [3, "move"],
      [null, "gap"],
      [4, "move"],
      [null, "pause"],
      [null, "resume"],
      [5, "move"],
      [null, "end"],
    ]);
    // every row knows its line in the jsonl, so an LLM can go from "#2" to the raw record
    const r2 = list.rows.find((r) => r.n === 2)!;
    expect(rt.log[r2.line - 1]).toMatchObject({ t: "intent", accepted: false, reason: "already guessed this round" });
    expect(r2).toMatchObject({ player: "Ann", seat: 0, flags: ["rejected"], text: "guess tails · refused: already guessed this round" });
    expect(list.rows.find((r) => r.kind === "gap")!.text).toBe("No activity for 7 min");
    expect(list.rows.find((r) => r.kind === "pause")!.text).toMatch(/connection to the service/);
  });

  it("lets the game describe each step: text, columns and the automatic flip as a sub-step", () => {
    const list = buildMoves(playedCoinFlip().log, coin);
    expect(list.described).toBe(true);
    const byN = (n: number) => list.rows.find((r) => r.n === n)!;
    expect(byN(1)).toMatchObject({ text: "guesses heads", columns: { round: 1, guess: "heads", coin: null } });
    expect(byN(2).text).toBe("tries to guess tails · refused: already guessed this round");
    // the second guess completes the round: the coin flips by itself
    expect(byN(3).steps).toEqual([{ text: expect.stringMatching(/^Coin: (heads|tails) · /), auto: true }]);
    expect(byN(3).flags).toEqual(expect.arrayContaining(["described", "auto"]));
    expect(byN(3).columns!.coin).toMatch(/heads|tails/);
  });

  it("falls back to the generic line when describe throws or the log is from another version", () => {
    const log = playedCoinFlip().log;
    const broken = { ...coin, def: { ...coin.def, describe: () => { throw new Error("oops"); } } };
    const a = buildMoves(log, broken);
    expect(a.rows.find((r) => r.n === 1)).toMatchObject({ text: "guess heads", details: { "describe failed": "oops" } });
    const other = { ...coin, manifest: { ...coin.manifest, version: "9.9.9" } };
    const b = buildMoves(log, other);
    expect(b.described).toBe(false);
    expect(b.note).toMatch(/the rules here are 9\.9\.9/);
  });

  it("rebuilds the state before and after any line, as replay does", () => {
    const log = playedCoinFlip().log;
    const list = buildMoves(log, coin);
    const line = list.rows.find((r) => r.n === 3)!.line;
    const { before, after } = stateAt(log, coin, line);
    expect(after).toEqual(replayLog(coin.manifest, coin.def, log.slice(0, line)).state);
    expect((before as any).history).toHaveLength(0);
    expect((after as any).history).toHaveLength(1);
  });

  it("pages and filters: by player, moves only, problems, and the page with a given move", () => {
    const list = buildMoves(playedCoinFlip().log, coin);
    expect(pageMoves(list, { limit: 3 })).toMatchObject({ total: 10, offset: 0, limit: 3, moves: 5 });
    expect(pageMoves(list, { limit: 3, move: 4 }).rows.map((r) => r.n)).toEqual([3, null, 4]); // the page with #4: #3, the gap, #4
    expect(pageMoves(list, { seat: 1 }).rows.map((r) => r.n)).toEqual([3, 5]);
    expect(pageMoves(list, { movesOnly: true }).total).toBe(5);
    expect(pageMoves(list, { problems: true }).rows.map((r) => r.kind)).toEqual(["move", "gap", "pause"]);
    expect(pageMoves(list, { q: "refused" }).rows.map((r) => r.n)).toEqual([2]);
  });

  it("shows the moves the rules make by themselves, e.g. Pachisi's turn timer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "viewer-"));
    try {
      const logs = new LogStore(dir);
      const r = await runSimulation(pachisi, { players: 2, games: 1, seed: 3, settings: { tokens: 1 } }, logs, "test");
      const { games: [log] } = await LogStore.unzip((await logs.read(r.logId))!);
      const list = buildMoves(log, pachisi);
      expect(list.rows.filter((x) => x.kind === "move").every((x) => x.flags.includes("described"))).toBe(true);
      expect(list.rows.some((x) => /^rolls a [1-6]/.test(x.text))).toBe(true);
      // a turn the timer plays: a timer row with the move as an automatic sub-step
      const clock = manualClock();
      const rt = new GameRuntime(pachisi.manifest, pachisi.def, 5, { tokens: 1, turnSeconds: 10 }, seats, { ...clock, setTimeout: () => 0 });
      rt.fireTimer("turn");
      const t = buildMoves(rt.log, pachisi).rows.find((x) => x.kind === "timer")!;
      expect(t.text).toMatch(/^Time is up for (Ann|Bob)$/);
      expect(t.steps).toEqual([{ seat: expect.any(Number), player: expect.stringMatching(/Ann|Bob/), text: expect.stringMatching(/^rolls a/), auto: true }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

let t: Awaited<ReturnType<typeof testHost>> | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

/** A coin-flip game on a real table: Ann (phone) and an AI, two rounds, the service lost and back in between. */
async function playOnTable() {
  t = await testHost();
  t.host.table.setCloud({ status: "online" });
  const a = await t.joinDeck("Ann");
  await t.ok("POST", "/ai", {});
  await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds: 2, roundSeconds: 0 } });
  await a.request("lobby", "ready", { ready: true });
  await t.ok("POST", "/game/start");
  await a.waitView((v) => v.view.round === 1);
  await a.request("game", "intent", { name: "guess", payload: "heads" });
  await a.request("game", "intent", { name: "guess", payload: "tails" }); // refused
  t.host.table.setCloud({ status: "offline" });
  await a.waitState((s) => s.phase === "paused");
  t.host.table.setCloud({ status: "online" });
  await a.waitState((s) => s.phase === "active");
  await a.waitView((v) => v.view.round === 2 && !v.view.myGuess);
  await a.request("game", "intent", { name: "guess", payload: "tails" });
  await a.waitState((s) => s.phase === "finished");
  await t.host.table.flush();
  const [log] = await t.ok("GET", "/history");
  return { a, id: log.id as string };
}

describe("the Game Viewer on the table (D-120)", { timeout: 30_000 }, () => {
  it("logs pause and resume, packs the move list into the zip, and the game still replays", async () => {
    const { id } = await playOnTable();
    const zip = await JSZip.loadAsync((await t!.api("GET", `/logs/${id}.zip`)).body as Buffer);
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(["game-001.jsonl", "game-001.moves.jsonl", "README.md"]));
    const records = (await zip.file("game-001.jsonl")!.async("string")).trim().split("\n").map((l) => JSON.parse(l));
    expect(records.filter((r) => r.t === "pause" || r.t === "resume").map((r) => `${r.t} ${r.reason}`)).toEqual(["pause cloud", "resume cloud"]);
    const meta = JSON.parse(await zip.file("run.json")!.async("string"));
    expect(meta.verify).toMatchObject({ checked: 1, ok: 1 });
    const moves = (await zip.file("game-001.moves.jsonl")!.async("string")).trim().split("\n").map((l) => JSON.parse(l));
    expect(moves.filter((r) => r.n !== null)).toHaveLength(records.filter((r) => r.t === "intent").length);
    expect(moves.find((r) => r.flags.includes("rejected"))).toMatchObject({ player: "Ann", text: "tries to guess tails · refused: already guessed this round" });
    expect(await zip.file("README.md")!.async("string")).toMatch(/moves\.jsonl/);
  });

  it("lists finished games and serves pages and single steps with the state before and after", async () => {
    const { id } = await playOnTable();
    const [entry] = await t!.ok("GET", "/history");
    expect(entry).toMatchObject({ id, gameId: "coin-flip", gameName: "Coin Flip", kind: "game", endReason: "finished", players: [{ name: "Ann" }, { kind: "ai" }] });
    const info = await t!.ok("GET", `/history/${id}`);
    expect(info).toMatchObject({ rulesInstalled: true, columns: coin.manifest.viewer.columns, gameList: [{ game: 1, described: true, endReason: "finished" }] });
    const moves = info.gameList[0].moves;
    const page = await t!.ok("GET", `/history/${id}/1/moves?limit=2&offset=1`);
    expect(page).toMatchObject({ offset: 1, limit: 2, moves, columns: coin.manifest.viewer.columns });
    expect(page.rows.map((r: any) => r.n)).toEqual([1, 2]);
    expect((await t!.ok("GET", `/history/${id}/1/moves?problems=1`)).rows.map((r: any) => r.kind)).toEqual(["move", "pause"]);
    const step = await t!.ok("GET", `/history/${id}/1/moves/2`);
    expect(step).toMatchObject({ reference: `${id} #2`, row: { n: 2, flags: expect.arrayContaining(["rejected"]) }, record: { t: "intent", accepted: false }, prevMove: 1, nextMove: 3 });
    expect(step.state.before).toEqual(step.state.after); // a refused move changes nothing
    const pause = (await t!.ok("GET", `/history/${id}/1/moves?problems=1`)).rows.find((r: any) => r.kind === "pause");
    expect(await t!.ok("GET", `/history/${id}/1/lines/${pause.line}`)).toMatchObject({ reference: `${id} line ${pause.line}`, row: { kind: "pause" } });
    expect((await t!.api("GET", `/history/${id}/1/moves/999`)).status).toBe(404);
    expect((await t!.api("GET", "/history/no-such-log")).status).toBe(404);
    expect((await t!.api("GET", `/history/${id}/2/moves`)).status).toBe(404);
  });

  it("does not list the game that is still running, and builds move lists for simulations on request", async () => {
    t = await testHost();
    const sim = await t.ok("POST", "/simulation", { gameId: "pachisi", players: 2, games: 2, seed: 9, settings: { tokens: 1 } });
    const a = await t.joinDeck("Ann");
    await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds: 3, roundSeconds: 0 } });
    await a.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    const list = await t.ok("GET", "/history");
    expect(list.map((e: any) => e.id)).toEqual([sim.logId]); // the running coin-flip game is not there
    const info = await t.ok("GET", `/history/${sim.logId}`);
    expect(info).toMatchObject({ kind: "simulation", games: 2, gameList: [{ game: 1, described: true }, { game: 2, described: true }] });
    const g2 = await t.ok("GET", `/history/${sim.logId}/2/moves?limit=5`);
    expect(g2.rows.find((r: any) => r.n === 1).text).toMatch(/^rolls a [1-6]/);
    expect((await t.ok("GET", `/history/${sim.logId}/2/moves/1`)).reference).toBe(`${sim.logId} game 2 #1`);
  });
});

describe("scripts/game-log.ts (D-120)", { timeout: 60_000 }, () => {
  it("reads a zip without a table: the overview, a range of moves and one move in full", async () => {
    const dir = await mkdtemp(join(tmpdir(), "viewer-cli-"));
    try {
      const logs = new LogStore(dir);
      const rt = playedCoinFlip();
      const file = await logs.save({ id: "cli-test", tableName: "t", gameId: "coin-flip", gameVersion: coin.manifest.version, simulation: false, startedAt: new Date().toISOString(), endedAt: "", games: 1, format: "gametable-log/2", timeZone: "Europe/Berlin" }, [rt.log], [rt.state]);
      const run = async (...args: string[]) => (await promisify(execFile)(process.execPath, [join(import.meta.dirname, "..", "scripts", "game-log.ts"), file, ...args])).stdout;
      const info = JSON.parse(await run("info", "--json"));
      expect(info).toMatchObject({ id: "cli-test", thisGame: { moves: 5, movesFile: "built now", described: true }, rules: expect.stringMatching(/states available/) });
      const text = await run("moves", "2-4");
      expect(text).toMatch(/#2 .*refused: already guessed this round/);
      expect(text).toMatch(/No activity for 7 min/);
      expect(text).not.toMatch(/#5/);
      const one = JSON.parse(await run("move", "3", "--json"));
      expect(one).toMatchObject({ reference: "cli-test #3", row: { n: 3 }, record: { t: "intent", seat: 1, by: "board" } });
      expect(one.state.after.history).toHaveLength(1);
      expect(JSON.parse(await run("state", "3", "--before")).history).toHaveLength(0);
      await expect(run("move", "99")).rejects.toThrow(/no move 99/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
