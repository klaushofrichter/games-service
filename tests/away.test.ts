// Players away during a game (D-144): by default their seat waits (no waiting time), the board shows them as away and
// can hand the seat to an AI player; the old waiting time is a setting. With the Partners test game
// (tests/fixtures/seat-games): "free" goes on without a player, "teams" can't (D-119).
import { join } from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Table } from "../apps/table-host/src/table.ts";
import { Deck, sleep, testHost, until } from "./helpers.ts";

const GAMES = join(import.meta.dirname, "fixtures", "seat-games");
let t: Awaited<ReturnType<typeof testHost>>;
const showMs = Table.AWAY_SHOW_MS;
beforeEach(() => {
  Table.AWAY_SHOW_MS = 100;
});
afterEach(async () => {
  Table.AWAY_SHOW_MS = showMs;
  await t?.close();
});

const state = () => t.ok("GET", "/state");

async function partners(mode: "teams" | "free") {
  t = await testHost({ gamesDir: GAMES, showTestGames: true }); // graceMs 300
  const ann = await t.joinDeck("Ann");
  const ben = await t.joinDeck("Ben");
  await t.ok("POST", "/ai", {});
  await t.ok("POST", "/ai", {});
  await t.ok("POST", "/game/select", { gameId: "partners", settings: { mode } });
  await ann.request("lobby", "ready", { ready: true });
  await ben.request("lobby", "ready", { ready: true });
  await t.ok("POST", "/game/start");
  return { ann, ben };
}

describe("players away during a game (D-144)", () => {
  it("off (the default): the seat waits past the waiting time, and the board shows the player as away", async () => {
    const { ann } = await partners("free");
    expect((await state()).play).toEqual({ awayTimeout: false });
    ann.close();
    await sleep(60);
    expect((await state()).away).toEqual([]); // not at once: a phone that locks for a moment shows nothing
    const s = await until(async () => ((await state()).away.length ? await state() : null));
    expect(s.away).toMatchObject([{ playerId: ann.playerId, name: "Ann" }]);
    await sleep(500); // past graceMs: still seated
    const now = await state();
    expect(now.phase).toBe("active");
    expect(now.players.find((p: any) => p.id === ann.playerId)).toMatchObject({ connected: false });
    // Back: no longer away.
    const again = await Deck.connect(t.base, { sessionToken: ann.sessionToken });
    await until(async () => ((await state()).away.length === 0 ? true : null));
    again.close();
  });

  it("hands an away player's seat to an AI: the colour stays, the phone is told why, the log has it", async () => {
    const { ann } = await partners("free");
    const before = await state();
    const color = before.players.find((p: any) => p.id === ann.playerId).color;
    const seat = before.players.find((p: any) => p.id === ann.playerId).seat;
    expect((await t.api("POST", `/players/${ann.playerId}/replace-with-ai`)).status).toBe(409); // connected: no
    ann.close();
    await until(async () => ((await state()).players.find((p: any) => p.id === ann.playerId)?.connected === false ? true : null));
    const r = await t.ok("POST", `/players/${ann.playerId}/replace-with-ai`);
    const ai = r.state.players.find((p: any) => p.id === r.playerId);
    expect(ai).toMatchObject({ kind: "ai", name: "Ann (AI)", seat, color });
    expect(r.state.players.some((p: any) => p.id === ann.playerId)).toBe(false);
    expect(r.state.away).toEqual([]);
    const log = t.host.table.runtime!.log;
    expect(log.at(-1)).toMatchObject({ t: "aiTakeover", seat, name: "Ann (AI)" });
    // The phone, back, hears why.
    await expect(Deck.connect(t.base, { sessionToken: ann.sessionToken })).rejects.toThrow(/handed to Ann \(AI\)/);
    // The seat is an AI player's now: it plays there (Partners' AI moves with behaviour "play").
    await t.ok("POST", "/game/end");
    await until(async () => ((await t.ok("GET", "/logs")).length ? true : null));
    const [l] = await t.ok("GET", "/logs");
    const zip = await JSZip.loadAsync((await t.api("GET", `/logs/${l.id}.zip`)).body);
    const records = (await zip.file("game-001.jsonl")!.async("string")).trim().split("\n").map((x) => JSON.parse(x));
    expect(records.some((x: any) => x.t === "aiTakeover" && x.seat === seat)).toBe(true);
    const moves = (await zip.file("game-001.moves.jsonl")!.async("string")).trim().split("\n").map((x) => JSON.parse(x));
    expect(moves.some((m: any) => m.kind === "aiTakeover")).toBe(true);
  });

  it("a game that waited for the player (D-119) goes on once the seat is an AI's", async () => {
    const { ann } = await partners("teams");
    ann.close();
    await until(async () => ((await state()).phase === "paused" ? true : null));
    const r = await t.ok("POST", `/players/${ann.playerId}/replace-with-ai`);
    expect(r.state.phase).toBe("active");
    expect(r.state.pause).toBeNull();
  });

  it("on: the player leaves after the waiting time, as before; turning it on starts the waiting time for players already away", async () => {
    const { ann } = await partners("free");
    ann.close();
    await sleep(500);
    expect((await state()).players.some((p: any) => p.id === ann.playerId)).toBe(true);
    await t.ok("POST", "/play", { awayTimeout: true });
    expect((await state()).play).toEqual({ awayTimeout: true });
    await until(async () => ((await state()).players.some((p: any) => p.id === ann.playerId) ? null : true), 3000);
    expect((await t.api("POST", "/play", { awayTimeout: "yes" })).status).toBe(400);
  });

  it("a player leaves from the phone (D-158): before a game they leave the table; in one the seat is offered to an AI at once", async () => {
    t = await testHost({ gamesDir: GAMES, showTestGames: true });
    const cleo = await t.joinDeck("Cleo");
    await cleo.request("lobby", "leave", {});
    await until(async () => ((await state()).players.some((p: any) => p.id === cleo.playerId) ? null : true));
    await t.close();
    const { ann } = await partners("free");
    const removed = ann.next((m) => m.ch === "system" && m.type === "removed");
    expect((await ann.request("lobby", "leave", {})).type).toBe("ack");
    expect((await removed).payload).toEqual({ reason: "left" });
    const s = await until(async () => ((await state()).away.length ? await state() : null));
    expect(s.away).toMatchObject([{ playerId: ann.playerId, left: true }]); // no wait for a phone lock
    expect(s.phase).toBe("active");
    await expect(Deck.connect(t.base, { sessionToken: ann.sessionToken })).rejects.toThrow(/you left this game/);
    const r = await t.ok("POST", `/players/${ann.playerId}/replace-with-ai`);
    expect(r.state.players.find((p: any) => p.id === r.playerId)).toMatchObject({ name: "Ann (AI)", kind: "ai" });
  });

  it("leaving a game that can't go on without the player (D-119) pauses it with the player marked as left", async () => {
    const { ann } = await partners("teams");
    await ann.request("lobby", "leave", {});
    const s = await until(async () => ((await state()).phase === "paused" ? await state() : null));
    expect(s.pause.players).toMatchObject([{ playerId: ann.playerId, left: true }]);
    await t.ok("POST", `/players/${ann.playerId}/replace-with-ai`);
    expect((await state()).phase).toBe("active");
  });
});
