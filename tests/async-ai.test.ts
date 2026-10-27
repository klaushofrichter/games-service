// AI players that take their time (D-112): answers that come later, the thinking marker, the pause when an AI is
// out of time and "Play now", stale answers dropped, failing AIs, AIs in worker threads, and simulations.
// Uses the Think Race test games in tests/fixtures/async-games (time budget: 2 s per move).
import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { sleep, testHost } from "./helpers.ts";
import { loadGames } from "../apps/table-host/src/games.ts";
import { LogStore } from "../apps/table-host/src/logs.ts";
import { replay, type LogRecord } from "../apps/table-host/src/runtime.ts";

const GAMES = fileURLToPath(new URL("./fixtures/async-games", import.meta.url));
const games = await loadGames(GAMES);
const aborts = () => (globalThis as { __thinkRaceAborts?: number }).__thinkRaceAborts ?? 0;

let t: Awaited<ReturnType<typeof testHost>>;
afterEach(async () => {
  await t?.close();
});

async function until(fn: () => boolean, ms = 8000, what = "condition") {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

/** Ann (a phone) and one AI player with the given options start a race to `target`. */
async function race(gameId: string, ai: Record<string, unknown>, target = 3, o: { cloud?: boolean } = {}) {
  t = await testHost({ gamesDir: GAMES, showTestGames: true });
  if (o.cloud) t.host.table.setCloud({ status: "online" });
  const a = await t.joinDeck("Ann");
  await t.ok("POST", "/game/select", { gameId, settings: { target } });
  const { playerId } = await t.ok("POST", "/ai", {});
  await t.ok("POST", `/players/${playerId}/ai-options`, { options: ai });
  await a.request("lobby", "ready", { ready: true });
  await t.ok("POST", "/game/start");
  return { a, aiId: playerId };
}

const log = () => t.host.table.runtime!.log;
/** The pause and resume records (D-120), without their times. */
const pauses = () => log().filter((r) => r.t === "pause" || r.t === "resume").map(({ at: _, ...r }) => r);
const aiMoves = () => log().filter((r): r is Extract<LogRecord, { t: "intent" }> => r.t === "intent" && r.by === "ai");

describe("AI players that take their time (D-112)", { timeout: 30_000 }, () => {
  it("lists a game's notice for its AI players' options (D-224); a game without one has none", async () => {
    t = await testHost({ gamesDir: GAMES, showTestGames: true });
    const games = await t.ok("GET", "/games");
    expect(games.find((g: any) => g.id === "think-race").aiNotice).toBe("Think Race's AI is a test fixture: https://example.org/think-race (public domain).");
    expect(games.find((g: any) => g.id === "think-race-worker")).not.toHaveProperty("aiNotice");
  });

  it("plays moves that come later, logs the thinking time, and the game replays exactly", async () => {
    await race("think-race", { thinkMs: 60 });
    await until(() => t.host.table.phase === "finished", 8000, "the AI to finish the race");
    const moves = aiMoves();
    expect(moves).toHaveLength(3);
    for (const m of moves) {
      expect(m.accepted).toBe(true);
      expect(m.ai!.ms).toBeGreaterThanOrEqual(50);
      expect(m.ai!.fallback).toBeUndefined();
    }
    const g = games.get("think-race")!;
    const end = log().at(-1) as Extract<LogRecord, { t: "end" }>;
    expect(replay(g.manifest, g.def, log())).toBe(end.stateHash);
  });

  it("leaves a synchronous AI's log as before", async () => {
    await race("think-race", { behaviour: "sync" });
    await until(() => t.host.table.phase === "finished");
    expect(aiMoves().every((m) => m.ai === undefined)).toBe(true);
  });

  it("shows an AI as thinking only once it takes more than a moment", async () => {
    const { a, aiId } = await race("think-race", { thinkMs: 1400 }, 1);
    const s = await a.waitState((x) => x.aiThinking.length > 0);
    expect(s.aiThinking).toEqual([{ playerId: aiId, seat: expect.any(Number), since: expect.any(Number), deadline: expect.any(Number) }]);
    expect(s.aiThinking[0].deadline - s.aiThinking[0].since).toBe(2000);
    await until(() => t.host.table.phase === "finished");
    expect(t.host.table.state().aiThinking).toEqual([]);

    // a quick AI never shows as thinking
    await t.close();
    const quick = await race("think-race", { thinkMs: 30 }, 3);
    await until(() => t.host.table.phase === "finished");
    expect(quick.a.messages.some((m) => m.ch === "lobby" && m.type === "state" && m.payload.aiThinking.length > 0)).toBe(false);
  });

  it("pauses when an AI is out of time; Play now plays the game's quick move and the late answer is dropped", async () => {
    const { a, aiId } = await race("think-race", { thinkMs: 10_000 }, 5);
    const before = aborts();
    const s = await a.waitState((x) => x.phase === "paused");
    expect(s.pause).toMatchObject({ reason: "ai", ai: { playerId: aiId, name: expect.stringMatching(/\(AI\)$/) } });
    // the players wait too: no moves, and Continue is not the way out
    expect((await a.request("game", "intent", { name: "add", payload: { n: 1 } })).payload.message).toMatch(/paused/);
    expect((await t.api("POST", "/game/resume")).status).toBe(409);
    await t.ok("POST", "/game/play-now");
    expect(t.host.table.phase).toBe("active");
    const [m] = aiMoves();
    expect(m).toMatchObject({ intent: { name: "add", payload: { n: 2 } }, accepted: true, ai: { fallback: true } });
    expect(m.ai!.ms).toBeGreaterThanOrEqual(1900);
    expect(aborts()).toBeGreaterThan(before); // the slow move was stopped
    expect((await t.api("POST", "/game/play-now")).status).toBe(409); // nobody is waited for now
    // the log says why the game stood still and how it went on (D-120)
    const aiSeat = t.host.table.player(aiId)!.seat;
    expect(pauses()).toEqual([{ t: "pause", reason: "ai", seat: aiSeat }, { t: "resume", reason: "playNow" }]);
    // the AI thinks again about its next move (and will run out of time again)
    await a.waitState((x) => x.phase === "paused");
    await t.ok("POST", "/game/end");
  });

  it("goes on by itself when the AI answers during the pause", async () => {
    const { a } = await race("think-race", { thinkMs: 2500 }, 1);
    await a.waitState((x) => x.phase === "paused" && x.pause?.reason === "ai");
    await until(() => t.host.table.phase === "finished", 5000, "the late answer");
    const [m] = aiMoves();
    expect(m.ai!.fallback).toBeUndefined();
    expect(m.ai!.ms).toBeGreaterThanOrEqual(2400);
    expect(pauses()).toEqual([{ t: "pause", reason: "ai", seat: expect.any(Number) }, { t: "resume", reason: "ai" }]);
  });

  it("drops a stale answer when the game moves on while the AI thinks", async () => {
    const { a } = await race("think-race", { thinkMs: 600 }, 4);
    const before = aborts();
    await sleep(150); // the AI is thinking now
    expect((await a.request("game", "intent", { name: "add", payload: { n: 1 } })).type).toBe("ack");
    await until(() => aborts() > before, 3000, "the stale move to be stopped");
    await until(() => t.host.table.phase === "finished");
    // every AI move was made from the view it saw: never more than the race needed
    expect(aiMoves().length).toBeLessThanOrEqual(3);
  });

  it("plays the game's quick move when the AI fails", async () => {
    await race("think-race", { behaviour: "fail", thinkMs: 20 }, 2);
    await until(() => t.host.table.phase === "finished");
    const [m] = aiMoves();
    expect(m).toMatchObject({ intent: { payload: { n: 2 } }, ai: { fallback: true, error: "the test AI failed on purpose" } });
  });

  it("turns an AI pause into a connection pause when the service goes away, and asks the AI again after", async () => {
    const { a } = await race("think-race", { thinkMs: 10_000 }, 5, { cloud: true });
    await a.waitState((x) => x.pause?.reason === "ai");
    t.host.table.setCloud({ status: "offline" });
    expect(t.host.table.state().pause?.reason).toBe("cloud");
    t.host.table.setCloud({ status: "online" });
    await a.waitState((x) => x.phase === "active");
    await a.waitState((x) => x.pause?.reason === "ai"); // a fresh move, a fresh budget
    expect(pauses().slice(0, 3).map((r) => `${r.t} ${r.reason}`)).toEqual(["pause ai", "pause cloud", "resume cloud"]);
    await t.ok("POST", "/game/end");
  });
});

describe("AI players in a worker thread (D-112)", { timeout: 30_000 }, () => {
  it("think in their own thread: the table answers while the AI is busy", async () => {
    await race("think-race-worker", { behaviour: "busy", thinkMs: 800 }, 1);
    await sleep(200); // the worker's search is running
    const t0 = Date.now();
    expect((await t.api("GET", "/state")).status).toBe(200);
    expect(Date.now() - t0).toBeLessThan(300);
    await until(() => t.host.table.phase === "finished", 10_000, "the worker's move");
    expect(aiMoves()[0]).toMatchObject({ accepted: true, ai: { worker: true } });
  });

  it("Play now stops a worker that hangs", async () => {
    const { a } = await race("think-race-worker", { behaviour: "hang" }, 2);
    await a.waitState((x) => x.pause?.reason === "ai");
    await t.ok("POST", "/game/play-now");
    await until(() => t.host.table.phase === "finished");
    expect(aiMoves()[0]).toMatchObject({ intent: { payload: { n: 2 } }, ai: { fallback: true, worker: true } });
  });
});

describe("simulations with AI players that take their time (D-112)", { timeout: 60_000 }, () => {
  it("wait for the answers, play the quick move when one is out of time, and replay exactly", async () => {
    t = await testHost({ gamesDir: GAMES, showTestGames: true });
    const g = games.get("think-race")!;
    const check = async (aiOptions: Record<string, unknown>, settings: Record<string, unknown>) => {
      const r = await t.ok("POST", "/simulation", { gameId: "think-race", players: 2, games: 2, seed: 7, aiOptions, settings });
      expect(r.games.every((x: { reason: string }) => x.reason === "finished")).toBe(true);
      const { games: logs } = await LogStore.unzip((await t.api("GET", `/logs/${r.logId}.zip`)).body as Buffer);
      for (const l of logs as LogRecord[][]) expect(replay(g.manifest, g.def, l)).toBe((l.at(-1) as Extract<LogRecord, { t: "end" }>).stateHash);
      return (logs as LogRecord[][]).flat().filter((x): x is Extract<LogRecord, { t: "intent" }> => x.t === "intent");
    };
    const quick = await check({ thinkMs: 20 }, { target: 4 });
    expect(quick.every((x) => x.ai && !x.ai.fallback)).toBe(true);
    const slow = await check({ thinkMs: 5000 }, { target: 2 });
    expect(slow.every((x) => x.ai?.fallback && x.intent.payload && (x.intent.payload as { n: number }).n === 2)).toBe(true);
  });

  it("run AIs in worker threads too", async () => {
    t = await testHost({ gamesDir: GAMES, showTestGames: true });
    const r = await t.ok("POST", "/simulation", { gameId: "think-race-worker", players: 2, games: 2, seed: 3, aiOptions: { behaviour: "busy", thinkMs: 30 }, settings: { target: 4 } });
    expect(r.games.map((x: { reason: string }) => x.reason)).toEqual(["finished", "finished"]);
  });
});
