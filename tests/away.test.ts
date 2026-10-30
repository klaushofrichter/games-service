// Players away during a game (D-144): by default their seat waits (no waiting time), the board shows them as away and
// can hand the seat to an AI player; the old waiting time is a setting. With the Partners test game
// (tests/fixtures/seat-games): "free" goes on without a player, "teams" can't (D-119).
import { join } from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Table } from "../apps/table-host/src/table.ts";
import { withStatistics } from "../apps/table-host/src/stats.ts";
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
  it("the seat waits past the waiting time, and the board shows the player as away", async () => {
    const { ann } = await partners("free");
    expect((await state()).play).toBeUndefined(); // no waiting-time setting any more (D-159)
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

  it("exchanges a player for an AI (D-159), connected or away: the colour stays, the phone is told why, the log has it", async () => {
    const { ann } = await partners("free");
    const before = await state();
    const color = before.players.find((p: any) => p.id === ann.playerId).color;
    const seat = before.players.find((p: any) => p.id === ann.playerId).seat;
    // Connected: Ann's phone hears at once that the seat went to an AI player.
    const told = ann.next((m) => m.ch === "system" && m.type === "removed");
    const r = await t.ok("POST", "/exchange", { seat, kind: "ai" });
    expect((await told).payload).toEqual({ reason: "replaced" });
    const ai = r.state.players.find((p: any) => p.id === r.playerId);
    expect(ai).toMatchObject({ kind: "ai", name: "Ann (AI)", seat, color });
    expect(r.state.players.some((p: any) => p.id === ann.playerId)).toBe(false);
    expect(r.state.away).toEqual([]);
    const log = t.host.table.runtime!.log;
    expect(log.at(-1)).toMatchObject({ t: "seatChanged", seat: { seat, name: "Ann (AI)", kind: "ai" }, aiOptions: expect.any(Object) });
    expect((await t.api("POST", "/exchange", { seat, kind: "ai" })).status).toBe(409); // an AI already: options instead
    // The phone, back, hears why.
    await expect(Deck.connect(t.base, { sessionToken: ann.sessionToken })).rejects.toThrow(/handed to Ann \(AI\)/);
    // The seat's player in the statistics: the last one, marked (D-159).
    expect(withStatistics({ text: "x", highlights: {} }, log)!.players!.find((p) => p.seat === seat)).toEqual({ seat, name: "Ann (AI)", ai: true, changed: true });
    // The seat is an AI player's now: it plays there (Partners' AI moves with behaviour "play").
    await t.ok("POST", "/game/end");
    await until(async () => ((await t.ok("GET", "/logs")).length ? true : null));
    const [l] = await t.ok("GET", "/logs");
    const zip = await JSZip.loadAsync((await t.api("GET", `/logs/${l.id}.zip`)).body);
    const records = (await zip.file("game-001.jsonl")!.async("string")).trim().split("\n").map((x) => JSON.parse(x));
    expect(records.some((x: any) => x.t === "seatChanged" && x.seat.seat === seat)).toBe(true);
    const moves = (await zip.file("game-001.moves.jsonl")!.async("string")).trim().split("\n").map((x) => JSON.parse(x));
    expect(moves.some((m: any) => m.kind === "seatChanged" && /Ann \(AI\) took over Ann's seat/.test(m.text))).toBe(true);
    expect(JSON.parse(await zip.file("run.json")!.async("string")).verify).toMatchObject({ ok: 1 }); // replays exactly
  });

  it("a game that waited for the player (D-119) goes on once the seat is an AI's", async () => {
    const { ann } = await partners("teams");
    ann.close();
    await until(async () => ((await state()).phase === "paused" ? true : null));
    const r = await t.ok("POST", "/exchange", { seat: (await state()).players.find((p: any) => p.id === ann.playerId).seat, kind: "ai" });
    expect(r.state.phase).toBe("active");
    expect(r.state.pause).toBeNull();
  });

  it("exchanges a player for someone at the table: the seat waits for the exchange's code until they join (D-159)", async () => {
    const { ann } = await partners("free");
    const seat = (await state()).players.find((p: any) => p.id === ann.playerId).seat;
    const r = await t.ok("POST", "/exchange", { seat, kind: "local" });
    expect(r.url).toMatch(/\/j\/[A-Z0-9]{8}$/);
    expect(r.state.exchange).toMatchObject({ seat, kind: "local", url: r.url, playerId: ann.playerId, name: "Ann" });
    const token = r.url.split("/").pop();
    expect(token).not.toBe((await t.ok("GET", "/join")).token);
    // The table's join code seats nobody in a running game that is full; the exchange's code takes Ann's seat.
    const cleo = await Deck.connect(t.base, { joinToken: token, name: "Cleo" });
    const s = await state();
    expect(s.exchange).toBeNull();
    expect(s.players.find((p: any) => p.id === cleo.playerId)).toMatchObject({ name: "Cleo", seat, kind: "human" });
    expect(s.players.some((p: any) => p.id === ann.playerId)).toBe(false);
    expect(t.host.table.runtime!.seats.find((x) => x.seat === seat)).toMatchObject({ name: "Cleo", kind: "human" });
    // The code worked once.
    await expect(Deck.connect(t.base, { joinToken: token, name: "Dan" })).rejects.toThrow();
    cleo.close();
  });

  it("exchanges for a remote player: the next remote player takes the seat; an exchange can be cancelled; it ends with the game", async () => {
    const { ben } = await partners("free");
    const seat = (await state()).players.find((p: any) => p.id === ben.playerId).seat;
    t.host.table.exchange(seat, "remote", "https://games.example/i/ABCDEFGH");
    expect((await state()).exchange).toMatchObject({ seat, kind: "remote", url: "https://games.example/i/ABCDEFGH" });
    await t.ok("DELETE", "/exchange");
    expect((await state()).exchange).toBeNull();
    t.host.table.exchange(seat, "remote", "https://games.example/i/ABCDEFGH");
    const rita = t.host.table.joinRemote("Rita", "sess-rita");
    expect(t.host.table.state().players.find((p) => p.id === rita.playerId)).toMatchObject({ seat, location: "remote" });
    expect(t.host.table.state().players.some((p) => p.id === ben.playerId)).toBe(false);
    t.host.table.exchange(seat === 0 ? 1 : 0, "local");
    await t.ok("POST", "/game/end");
    expect((await state()).exchange).toBeNull();
    expect((await t.api("POST", "/exchange", { seat, kind: "ai" })).status).toBe(409); // no game running
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
    const r = await t.ok("POST", "/exchange", { seat: (await state()).players.find((p: any) => p.id === ann.playerId).seat, kind: "ai" });
    expect(r.state.players.find((p: any) => p.id === r.playerId)).toMatchObject({ name: "Ann (AI)", kind: "ai" });
  });

  it("a player who left and scans the join code again with their name gets their waiting seat back (D-172)", async () => {
    const { ann } = await partners("free");
    const seat = (await state()).players.find((p: any) => p.id === ann.playerId).seat;
    await ann.request("lobby", "leave", {});
    await until(async () => ((await state()).away.length ? true : null));
    // someone else with another name finds no free seat; Ann, with her name in any case, is back in her seat
    await expect(t.joinDeck("Dora")).rejects.toThrow(/seat/);
    const back = await t.joinDeck("  ANN ");
    expect(back.playerId).toBe(ann.playerId);
    const s = await until(async () => ((await state()).away.length === 0 ? await state() : null));
    expect(s.players.find((p: any) => p.id === ann.playerId)).toMatchObject({ name: "Ann", seat, connected: true });
    expect(s.players.filter((p: any) => p.name === "Ann")).toHaveLength(1);
    expect(s.phase).toBe("active");
    expect(t.host.table.runtime!.seats.find((x) => x.seat === seat)).toMatchObject({ name: "Ann", kind: "human" });
    // the old phone's session stays ended; a new one works, and leaving again works as before
    await expect(Deck.connect(t.base, { sessionToken: ann.sessionToken })).rejects.toThrow(/you left this game/);
    back.close();
    const phone = await Deck.connect(t.base, { sessionToken: back.sessionToken }); // the same phone, reconnecting
    await phone.request("lobby", "leave", {});
    await until(async () => ((await state()).away.length ? true : null));
    // once the seat went to an AI player, Ann takes it back from "Ann (AI)" with her name (D-222)
    await t.ok("POST", "/exchange", { seat, kind: "ai" });
    await t.joinDeck("Ann");
    const after = await state();
    expect(after.players.find((p: any) => p.name === "Ann")).toMatchObject({ seat, kind: "human" });
    expect(after.players.some((p: any) => p.name === "Ann (AI)")).toBe(false);
  });

  it("coming back to a waiting seat also ends the pause of a game that can't go on without the player (D-172)", async () => {
    const { ann } = await partners("teams");
    await ann.request("lobby", "leave", {});
    await until(async () => ((await state()).phase === "paused" ? true : null));
    const back = await t.joinDeck("Ann");
    expect(back.playerId).toBe(ann.playerId);
    await until(async () => ((await state()).phase === "active" ? true : null));
    expect((await state()).pause).toBeNull();
  });

  it("leaving a game that can't go on without the player (D-119) pauses it with the player marked as left", async () => {
    const { ann } = await partners("teams");
    await ann.request("lobby", "leave", {});
    const s = await until(async () => ((await state()).phase === "paused" ? await state() : null));
    expect(s.pause.players).toMatchObject([{ playerId: ann.playerId, left: true }]);
    await t.ok("POST", "/exchange", { seat: (await state()).players.find((p: any) => p.id === ann.playerId).seat, kind: "ai" });
    expect((await state()).phase).toBe("active");
  });
});

describe("an away player replaced by an AI player (D-236)", () => {
  async function partnersWithRule(minutes: 0 | 3 | 5) {
    t = await testHost({ gamesDir: GAMES, showTestGames: true, awayToAiMinuteMs: 100 }); // a "minute" of 100 ms
    await t.ok("POST", "/rules", { awayToAi: minutes });
    const ann = await t.joinDeck("Ann");
    const ben = await t.joinDeck("Ben");
    await t.ok("POST", "/ai", {});
    await t.ok("POST", "/ai", {});
    await t.ok("POST", "/game/select", { gameId: "partners", settings: { mode: "free" } });
    await ann.request("lobby", "ready", { ready: true });
    await ben.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    return { ann, ben };
  }
  const seatOf = (s: any, id: string) => s.players.find((p: any) => p.id === id)?.seat;

  it("after the chosen minutes away, an AI player takes the seat, standing in for the person", async () => {
    const { ann } = await partnersWithRule(3);
    const seat = seatOf(await state(), ann.playerId);
    ann.close();
    await sleep(150);
    expect(seatOf(await state(), ann.playerId)).toBe(seat); // not yet: 3 "minutes" are 300 ms
    const s = await until(async () => {
      const now = await state();
      return now.players.find((p: any) => p.seat === seat && p.kind === "ai") ? now : null;
    });
    expect(s.players.find((p: any) => p.seat === seat)).toMatchObject({ kind: "ai", name: "Ann (AI)" });
    expect(s.phase).toBe("active");
    expect(s.away).toEqual([]);
  });

  it("not if the player comes back in time, and never with the rule off (D-159)", async () => {
    const { ann } = await partnersWithRule(3);
    const seat = seatOf(await state(), ann.playerId);
    ann.close();
    await sleep(150);
    const again = await Deck.connect(t.base, { sessionToken: ann.sessionToken });
    await sleep(400); // past the 300 ms
    expect((await state()).players.find((p: any) => p.seat === seat)).toMatchObject({ id: ann.playerId, kind: "human" });
    again.close();
    await t.close();

    const off = await partnersWithRule(0);
    const seat2 = seatOf(await state(), off.ann.playerId);
    off.ann.close();
    await sleep(700);
    expect((await state()).players.find((p: any) => p.seat === seat2)).toMatchObject({ id: off.ann.playerId, kind: "human", connected: false });
  });
});

