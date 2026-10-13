// Automated lobby tests: drive the board control API and fake decks against a real Table Host.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Deck, sleep, testHost, until } from "./helpers.ts";
import { LogStore } from "../apps/table-host/src/logs.ts";
import { replay } from "../apps/table-host/src/runtime.ts";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const GAMES = join(import.meta.dirname, "../games");

let t: Awaited<ReturnType<typeof testHost>>;
beforeEach(async () => {
  t = await testHost();
});
afterEach(async () => {
  await t.close();
});

describe("access", () => {
  it("rejects board control calls without the table key", async () => {
    expect((await t.api("GET", "/state", undefined, "wrong")).status).toBe(401);
    expect((await t.api("GET", "/state")).status).toBe(200);
  });

  it("serves health and the deck page to anyone, the board only to the table PC", async () => {
    expect((await fetch(`${t.base}/health`)).status).toBe(200);
    expect((await fetch(`${t.base}/deck/`)).status).toBe(200);
    const board = await fetch(`${t.base}/board/`); // tests connect from loopback
    expect(board.status).toBe(200);
    expect(await board.text()).toContain("test-key");
  });
});

describe("joining", () => {
  it("issues one short, speakable join code that every player at the table can use", async () => {
    const { token, url } = await t.ok("GET", "/join");
    expect(token).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(url).toContain(`/j/${token}`);
    for (const name of ["Ann", "Ben", "Cleo"]) await Deck.connect(t.base, { joinToken: token, name }).then((d) => t.decks.push(d));
    expect(t.host.table.state().players.map((p) => p.name)).toEqual(["Ann", "Ben", "Cleo"]);
    expect((await t.ok("GET", "/join")).token).toBe(token); // same QR code on the board all along
  });

  it("makes a new code on request; the old one stops working and players stay in", async () => {
    const { token } = await t.ok("GET", "/join");
    await Deck.connect(t.base, { joinToken: token, name: "Ann" }).then((d) => t.decks.push(d));
    const fresh = await t.ok("POST", "/join/new");
    expect(fresh.token).not.toBe(token);
    expect(t.host.table.state().joinUrl).toContain(fresh.token);
    await expect(Deck.connect(t.base, { joinToken: token, name: "Mallory" })).rejects.toThrow(/invalid or expired/);
    await Deck.connect(t.base, { joinToken: fresh.token, name: "Ben" }).then((d) => t.decks.push(d));
    expect(t.host.table.state().players.map((p) => p.name)).toEqual(["Ann", "Ben"]);
  });

  it("keeps the code while the table runs, even when everyone leaves, and makes a new one at every start", async () => {
    const { token } = await t.ok("GET", "/join");
    const a = await Deck.connect(t.base, { joinToken: token, name: "Ann" });
    await t.ok("DELETE", `/players/${a.playerId}`);
    expect((await t.ok("GET", "/join")).token).toBe(token);
    const other = await testHost(); // a restart of the table PC
    try {
      expect((await other.ok("GET", "/join")).token).not.toBe(token);
    } finally {
      await other.close();
    }
  });

  it("redirects the short join URL to the deck page", async () => {
    const res = await fetch(`${t.base}/j/abcd2345`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/deck/?t=ABCD2345");
  });

  it("seats players automatically in seat order and cleans up names", async () => {
    const a = await t.joinDeck("  Ann   Lee ");
    const b = await t.joinDeck("");
    const s = await t.ok("GET", "/state");
    expect(s.players.map((p: any) => [p.name, p.seat])).toEqual([
      ["Ann Lee", 0],
      ["Player 2", 1],
    ]);
    expect(a.lastState()).toBeDefined();
    expect(b.playerId).toMatch(/^p_/);
  });

  it("leaves extra players without a seat when the layout is full", async () => {
    await t.ok("POST", "/layout", { seats: 2 });
    await t.joinDeck("A");
    await t.joinDeck("B");
    await t.joinDeck("C");
    const s = await t.ok("GET", "/state");
    expect(s.players.map((p: any) => p.seat)).toEqual([0, 1, null]);
  });
});

describe("seats and orientation", () => {
  it("names AI players from a list of short names, marked (AI), never twice at one table", async () => {
    await t.ok("POST", "/layout", { seats: 8 });
    for (let i = 0; i < 8; i++) await t.ok("POST", "/ai", {});
    const names: string[] = (await t.ok("GET", "/state")).players.map((p: any) => p.name);
    expect(names).toHaveLength(8);
    expect(new Set(names).size).toBe(8);
    for (const n of names) expect(n).toMatch(/^[A-Z][a-z]{1,4} \(AI\)$/);
  });

  const ais = async () => (await t.ok("GET", "/state")).players.filter((p: any) => p.kind === "ai");

  it("removing an AI and adding another never repeats a name still at the table", async () => {
    await t.ok("POST", "/layout", { seats: 4 });
    await t.ok("POST", "/ai", {});
    await t.ok("POST", "/ai", {});
    // The old naming counted AI players, so removing "AI 1" and adding one made a second "AI 2".
    for (let i = 0; i < 40; i++) {
      const [first] = await ais();
      await t.ok("DELETE", `/players/${first.id}`);
      await t.ok("POST", "/ai", {});
      const names = (await ais()).map((p: any) => p.name);
      expect(names).toHaveLength(2);
      expect(new Set(names).size).toBe(2);
    }
  });

  it("a removed AI frees its seat and its name; re-adding fills the free seat", async () => {
    await t.ok("POST", "/layout", { seats: 4 });
    for (let i = 0; i < 4; i++) await t.ok("POST", "/ai", {});
    expect((await t.api("POST", "/ai", {})).status).toBe(409); // table full
    const gone = (await ais())[1];
    await t.ok("DELETE", `/players/${gone.id}`);
    expect((await ais()).map((p: any) => p.seat)).not.toContain(gone.seat);
    await t.ok("POST", "/ai", {});
    const now = await ais();
    expect(now).toHaveLength(4);
    expect(now.find((p: any) => p.seat === gone.seat)).toBeDefined();
    expect(new Set(now.map((p: any) => p.name)).size).toBe(4);
  });

  it("an AI never takes the name of a person at the table, and AI names don't collide with people", async () => {
    await t.ok("POST", "/layout", { seats: 8 });
    const human = await t.joinDeck("Mia");
    for (let i = 0; i < 7; i++) await t.ok("POST", "/ai", {});
    const s = await t.ok("GET", "/state");
    expect(s.players.find((p: any) => p.id === human.playerId).name).toBe("Mia");
    const names = s.players.map((p: any) => p.name);
    expect(new Set(names).size).toBe(8);
    expect(names.filter((n: string) => n.endsWith(" (AI)"))).toHaveLength(7);
  });

  it("adding an AI to a specific seat uses that seat, and a taken seat is refused", async () => {
    await t.ok("POST", "/layout", { seats: 4 });
    const id = (await t.ok("POST", "/ai", { seat: 2 })).playerId;
    expect((await ais()).find((p: any) => p.id === id).seat).toBe(2);
    expect((await t.api("POST", "/ai", { seat: 2 })).status).toBe(409);
  });

  it("over many add/remove cycles every name is from the list and names vary", async () => {
    await t.ok("POST", "/layout", { seats: 2 });
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const id = (await t.ok("POST", "/ai", {})).playerId;
      const p = (await ais()).find((x: any) => x.id === id);
      expect(p.name).toMatch(/^[A-Z][a-z]{1,4} \(AI\)$/);
      seen.add(p.name);
      await t.ok("DELETE", `/players/${id}`);
    }
    expect(seen.size).toBeGreaterThan(5); // random: 30 draws from 24 names
    expect(await ais()).toHaveLength(0);
  });

  it("moves players between seats and swaps when a seat is taken", async () => {
    const a = await t.joinDeck("A");
    const b = await t.joinDeck("B");
    await t.ok("POST", "/seats/move", { playerId: a.playerId, seat: 3 });
    await t.ok("POST", "/seats/move", { playerId: b.playerId, seat: 3 });
    const s = await t.ok("GET", "/state");
    const seatOf = (id: string) => s.players.find((p: any) => p.id === id).seat;
    expect(seatOf(b.playerId)).toBe(3);
    expect(seatOf(a.playerId)).toBe(1);
  });

  it("rotates the front edge without moving anyone's seat", async () => {
    const a = await t.joinDeck("A");
    expect((await t.ok("GET", "/state")).frontEdge).toBe("south");
    expect((await t.ok("POST", "/rotate", { degrees: 90 })).frontEdge).toBe("west");
    expect((await t.ok("POST", "/rotate", { degrees: 180 })).frontEdge).toBe("east");
    const s = await t.ok("POST", "/rotate", { degrees: 90 });
    expect(s.frontEdge).toBe("south");
    expect(s.players.find((p: any) => p.id === a.playerId).seat).toBe(0);
    expect((await t.api("POST", "/rotate", { degrees: 45 })).status).toBe(400);
  });

  it("facing east or west blocks no game: games draw the same whichever way the lobby faces (D-079)", async () => {
    for (const n of ["A", "B", "C", "D"]) await t.joinDeck(n);
    expect((await t.ok("POST", "/face", { edge: "east" })).frontEdge).toBe("east");
    expect((await t.ok("GET", "/games")).find((g: any) => g.id === "quartet").selectable).toBe(true);
    await t.ok("POST", "/game/select", { gameId: "quartet" }); // a north/south-only game, chosen while facing east
    expect((await t.ok("POST", "/face", { edge: "west" })).frontEdge).toBe("west");
    expect((await t.ok("POST", "/rotate", { degrees: 90 })).frontEdge).toBe("north"); // the old API still works
    expect((await t.api("POST", "/face", { edge: "up" })).status).toBe(400);
  });

  it("names the edge of every seat for each layout", async () => {
    expect((await t.ok("POST", "/layout", { seats: 8 })).seatEdges).toEqual(["south", "south", "south", "north", "north", "north", "east", "west"]);
    expect((await t.ok("POST", "/layout", { seats: 6 })).seatEdges).toEqual(["south", "south", "north", "north", "east", "west"]);
    expect((await t.ok("POST", "/layout", { seats: 2 })).seatEdges).toEqual(["south", "north"]);
  });

  it("refuses a smaller layout than the number of seated players", async () => {
    for (const n of ["A", "B", "C"]) await t.joinDeck(n);
    expect((await t.api("POST", "/layout", { seats: 2 })).status).toBe(409);
  });
});

describe("game selection gating", () => {
  const avail = async (id: string) => (await t.ok("GET", "/games")).find((g: any) => g.id === id);

  it("lists installed games from their manifests", async () => {
    const games = await t.ok("GET", "/games");
    expect(games.map((g: any) => g.id)).toEqual(expect.arrayContaining(["coin-flip", "quartet", "roulette"]));
  });

  it("a game can be chosen before anyone joins; what it still needs is listed, and start waits for it", async () => {
    const g = await avail("roulette");
    expect(g.selectable).toBe(true);
    expect(g.needs).toEqual(["needs 1 more player", "needs at least one player at the table"]);
    await t.ok("POST", "/ai", {});
    const s = await t.ok("POST", "/game/select", { gameId: "roulette" });
    expect(s.phase).toBe("ready");
    expect(s.game.needs).toEqual(["needs at least one player at the table"]);
    expect((await t.api("POST", "/game/start")).body.error).toMatch(/at least one player at the table/);
  });

  it("an exact-count game without AI: chosen with 3 players, blocked by an AI seat, startable at exactly 4", async () => {
    for (const n of ["A", "B", "C"]) await t.joinDeck(n);
    expect((await avail("quartet")).selectable).toBe(true);
    expect((await avail("quartet")).needs).toEqual(["needs exactly 4 players, 1 more"]);
    await t.ok("POST", "/ai", {});
    const withAi = await avail("quartet");
    expect(withAi.selectable).toBe(false);
    expect(withAi.reasons.join()).toMatch(/no AI players/);
    const s = await t.ok("GET", "/state");
    await t.ok("DELETE", `/players/${s.players.find((p: any) => p.kind === "ai").id}`);
    await t.ok("POST", "/game/select", { gameId: "quartet" });
    expect((await t.ok("GET", "/state")).game.needs).toEqual(["needs exactly 4 players, 1 more"]);
    await t.joinDeck("D");
    expect((await t.ok("GET", "/state")).game.needs).toEqual([]);
  });

  it("explains why choosing was refused: more players seated than the game takes", async () => {
    await t.ok("POST", "/layout", { seats: 6 });
    for (const n of ["A", "B", "C", "D", "E"]) await t.joinDeck(n);
    expect((await avail("quartet")).selectable).toBe(false);
    const r = await t.api("POST", "/game/select", { gameId: "quartet" });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Quartet takes at most 4 players \(5 seated\)/);
  });

  it("choosing a game switches the table to a seat layout the game supports, with room for its players", async () => {
    await t.ok("POST", "/layout", { seats: 8 });
    expect((await avail("pachisi")).selectable).toBe(true);
    const s = await t.ok("POST", "/game/select", { gameId: "pachisi" });
    expect(s.layout).toBe(4); // Pachisi: 2, 4 or 6 seats, at most 4 players
    expect(s.layouts).toEqual([2, 4, 6]);
    // a layout the game supports is kept
    await t.ok("POST", "/game/close");
    await t.ok("POST", "/layout", { seats: 6 });
    expect((await t.ok("POST", "/game/select", { gameId: "pachisi" })).layout).toBe(6);
  });

  it("players on an edge the chosen game does not use are moved to one it does", async () => {
    // No shipped game limits its edges any more (D-084), so test with a copy of Quartet that seats only north and
    // south. The copy sits beside games/ because a game's rules import the SDK by relative path.
    const dir = await mkdtemp(join(GAMES, "../.test-games-"));
    try {
      await cp(join(GAMES, "quartet"), join(dir, "quartet"), { recursive: true });
      const mf = join(dir, "quartet", "manifest.json");
      await writeFile(mf, JSON.stringify({ ...JSON.parse(await readFile(mf, "utf8")), edges: ["north", "south"] }));
      await t.close();
      t = await testHost({ gamesDir: dir, showTestGames: true });
      await t.ok("POST", "/layout", { seats: 8 });
      const a = await t.joinDeck("A");
      let s = await t.ok("GET", "/state");
      const east = s.seatEdges.indexOf("east");
      await t.ok("POST", "/seats/move", { playerId: a.playerId, seat: east });
      s = await t.ok("POST", "/game/select", { gameId: "quartet" });
      const edges = s.seatEdges as string[];
      expect(["north", "south"]).toContain(edges[s.players.find((p: any) => p.id === a.playerId).seat]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("with no game chosen the seat buttons offer every layout some visible game supports; with one, only its layouts", async () => {
    expect((await t.ok("GET", "/state")).layouts).toEqual([2, 4, 6, 8]); // the test games include 8
    await t.joinDeck("A");
    await t.ok("POST", "/game/select", { gameId: "roulette" });
    expect((await t.ok("GET", "/state")).layouts).toEqual([2, 4, 6]);
    const r = await t.api("POST", "/layout", { seats: 8 });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Roulette does not support 8 seats/);
  });

  it("a chosen game that is full seats no more newcomers, and refuses more AI players", async () => {
    await t.ok("POST", "/layout", { seats: 6 });
    for (const n of ["A", "B", "C"]) await t.joinDeck(n);
    await t.ok("POST", "/game/select", { gameId: "pachisi" }); // at most 4
    await t.ok("POST", "/ai", {});
    expect((await t.api("POST", "/ai", {})).body.error).toMatch(/Pachisi takes at most 4 players/);
    const late = await t.joinDeck("Late");
    const s = await t.ok("GET", "/state");
    expect(s.phase).toBe("ready"); // the choice stands
    expect(s.players.find((p: any) => p.id === late.playerId).seat).toBeNull();
  });

  it("validates settings against the manifest", async () => {
    await t.joinDeck("A");
    expect((await t.api("POST", "/game/select", { gameId: "coin-flip", settings: { rounds: 99 } })).status).toBe(400);
    const s = await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds: 2 } });
    expect(s.game.settings).toMatchObject({ rounds: 2, roundSeconds: 15 });
  });
});

describe("ready flow and play", () => {
  it("starts only when every human is ready", async () => {
    const a = await t.joinDeck("A");
    const b = await t.joinDeck("B");
    await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds: 1, roundSeconds: 0 } });
    expect((await a.request("lobby", "ready", { ready: true })).type).toBe("ack");
    const r = await t.api("POST", "/game/start");
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/waiting for B/);
    await b.request("lobby", "ready", { ready: true });
    expect((await t.ok("POST", "/game/start")).phase).toBe("active");
  });

  it("plays coin flip: intents reach the game, views stay private, summary and log at the end", async () => {
    const a = await t.joinDeck("A");
    const b = await t.joinDeck("B");
    await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds: 2, roundSeconds: 0 } });
    await a.request("lobby", "ready", { ready: true });
    await b.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    await a.waitView((v) => v.view.round === 1);

    expect((await a.request("game", "intent", { name: "guess", payload: "heads" })).type).toBe("ack");
    expect((await a.request("game", "intent", { name: "guess", payload: "tails" })).payload.reason).toMatch(/already guessed/);
    expect((await a.request("game", "intent", { name: "guess", payload: "edge" })).type).toBe("reject");
    // B's view never shows A's guess
    const bView = await b.waitView((v) => v.view.round === 1);
    expect(JSON.stringify(bView)).not.toContain("heads");

    await b.request("game", "intent", { name: "guess", payload: "tails" });
    await a.waitView((v) => v.view.round === 2);
    await a.request("game", "intent", { name: "guess", payload: "heads" });
    await b.request("game", "intent", { name: "guess", payload: "heads" });

    const done = await a.waitState((s) => s.phase === "finished");
    expect(done.summary?.text).toMatch(/wins|Tie/);
    expect(done.summary?.highlights).toHaveProperty("flips");
    await until(async () => (await t.ok("GET", "/metrics")).gamesPlayed === 1);

    // the log replays to the same final state (it is written to disk just after the game ends)
    await until(async () => (await t.ok("GET", "/logs")).length === 1);
    const logs = await t.ok("GET", "/logs");
    expect(logs).toHaveLength(1);
    const zip = (await t.api("GET", `/logs/${logs[0].id}.zip`)).body as Buffer;
    const { meta, games } = await LogStore.unzip(zip);
    expect(meta).toMatchObject({ gameId: "coin-flip", simulation: false, format: "gametable-log/1" });
    const g = t.host.table.games.get("coin-flip")!;
    const end = games[0].at(-1) as any;
    expect(end.t).toBe("end");
    expect(replay(g.manifest, g.def, games[0])).toBe(end.stateHash);
  });

  it("lets an AI seat play by itself", async () => {
    const a = await t.joinDeck("A");
    await t.ok("POST", "/ai", {});
    await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds: 1, roundSeconds: 0 } });
    await a.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    // the AI seat guesses on its own
    await until(async () => (await t.ok("GET", "/game/board")).view.seats.find((s: any) => s.seat === 1).hasGuessed);
    await a.request("game", "intent", { name: "guess", payload: "tails" });
    expect((await a.waitState((s) => s.phase === "finished")).summary).not.toBeNull();
  });

  it("refuses seat and layout changes while a game is running", async () => {
    const a = await t.joinDeck("A");
    await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { roundSeconds: 0 } });
    await a.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    expect((await t.api("POST", "/seats/move", { playerId: a.playerId, seat: 2 })).status).toBe(409);
    expect((await t.api("POST", "/layout", { seats: 6 })).status).toBe(409);
    expect((await t.api("POST", "/ai", {})).status).toBe(409);
  });

  it("seats a newcomer into a running game that allows dynamic players", async () => {
    const a = await t.joinDeck("A");
    await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds: 3, roundSeconds: 0 } });
    await a.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    const b = await t.joinDeck("B");
    const v = await b.waitView((v) => v.seat === 1);
    expect(v.view.round).toBe(1);
    expect((await b.request("game", "intent", { name: "guess", payload: "heads" })).type).toBe("ack");
  });

  it("ends a running game from the lobby, then returns to idle", async () => {
    const a = await t.joinDeck("A");
    await t.ok("POST", "/game/select", { gameId: "coin-flip" });
    await a.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    await t.ok("POST", "/game/end");
    const s = await a.waitState((s) => s.phase === "finished");
    expect(s.summary?.text).toMatch(/ended from the lobby/);
    await until(async () => (await t.ok("GET", "/metrics")).gamesTerminated === 1);
    expect((await t.ok("POST", "/game/close")).phase).toBe("idle");
  });

  it("ends a non-dynamic game when a player leaves", async () => {
    const decks = [];
    for (const n of ["A", "B", "C", "D"]) decks.push(await t.joinDeck(n));
    await t.ok("POST", "/game/select", { gameId: "quartet" });
    for (const d of decks) await d.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    const first = await decks[0].waitView((v) => v.view.myTurn === true);
    expect(first.seat).toBe(0);
    expect((await decks[1].request("game", "intent", { name: "pass" })).payload.reason).toMatch(/not your turn/);
    await t.ok("DELETE", `/players/${decks[2].playerId}`);
    const s = await decks[0].waitState((s) => s.phase === "finished");
    expect(s.summary?.text).toMatch(/a player left/);
  });
});

describe("disconnects and eviction", () => {
  it("keeps the seat through a short disconnect and resumes with the session token", async () => {
    const a = await t.joinDeck("A");
    await t.joinDeck("B");
    a.close();
    let s = await until(async () => {
      const st = await t.ok("GET", "/state");
      return st.players.find((p: any) => p.id === a.playerId)?.connected === false && st;
    });
    expect(s.players.find((p: any) => p.id === a.playerId)).toMatchObject({ connected: false, seat: 0 });
    const again = await Deck.connect(t.base, { sessionToken: a.sessionToken });
    t.decks.push(again);
    expect(again.playerId).toBe(a.playerId);
    await sleep(400); // past the grace period
    s = await t.ok("GET", "/state");
    expect(s.players.find((p: any) => p.id === a.playerId)).toMatchObject({ connected: true, seat: 0 });
  });

  it("frees the seat once the grace period runs out", async () => {
    const a = await t.joinDeck("A");
    a.close();
    await until(async () => (await t.ok("GET", "/state")).players.length === 0); // after the grace period
    await expect(Deck.connect(t.base, { sessionToken: a.sessionToken })).rejects.toThrow(/session expired/);
  });

  it("evicts a deck: its socket is closed and its session revoked", async () => {
    const a = await t.joinDeck("A");
    const removed = a.next((m) => m.ch === "system" && m.type === "removed");
    await t.ok("DELETE", `/players/${a.playerId}`);
    expect((await removed).payload.reason).toBe("evicted");
    expect(await until(() => a.closeCode)).toBe(4001);
    await expect(Deck.connect(t.base, { sessionToken: a.sessionToken })).rejects.toThrow(/session expired/);
  });

  it("removes a disconnected player from a running dynamic game after the grace period", async () => {
    const a = await t.joinDeck("A");
    const b = await t.joinDeck("B");
    await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds: 2, roundSeconds: 0 } });
    await a.request("lobby", "ready", { ready: true });
    await b.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    await a.request("game", "intent", { name: "guess", payload: "heads" });
    b.close();
    // once B's grace period is over, B is removed and A's guess completes the round
    const v = await a.waitView((v) => v.view.round === 2);
    expect(v.view.lastFlip).toMatch(/heads|tails/);
    expect((await t.ok("GET", "/state")).phase).toBe("active");
  });
});

describe("AI-only simulation", () => {
  it("runs headless games and writes a replayable log zip", async () => {
    const r = await t.ok("POST", "/simulation", { gameId: "coin-flip", players: 4, games: 3, seed: 42, settings: { rounds: 5 } });
    expect(r.games).toHaveLength(3);
    expect(r.games.every((g: any) => g.reason === "finished")).toBe(true);
    const zip = (await t.api("GET", `/logs/${r.logId}.zip`)).body as Buffer;
    const { meta, games } = await LogStore.unzip(zip);
    expect(meta).toMatchObject({ simulation: true, games: 3 });
    expect(games).toHaveLength(3);
    const g = t.host.table.games.get("coin-flip")!;
    for (const log of games) expect(replay(g.manifest, g.def, log)).toBe((log.at(-1) as any).stateHash);
    expect((await t.ok("GET", "/metrics")).simulations).toBe(1);
  });

  it("is deterministic for a given seed", async () => {
    const one = await t.ok("POST", "/simulation", { gameId: "coin-flip", players: 3, games: 2, seed: 7 });
    const two = await t.ok("POST", "/simulation", { gameId: "coin-flip", players: 3, games: 2, seed: 7 });
    expect(two.games.map((g: any) => g.summary)).toEqual(one.games.map((g: any) => g.summary));
  });

  it("refuses games without AI or simulation support", async () => {
    const r = await t.api("POST", "/simulation", { gameId: "quartet", players: 4, games: 1, seed: 1 });
    expect(r.status).toBe(409);
  });
});

describe("regressions from review", () => {
  it("keeps the selected game's layout rules, and checks again at start", async () => {
    for (const n of ["A", "B"]) await t.joinDeck(n);
    await t.ok("POST", "/game/select", { gameId: "roulette" });
    expect((await t.api("POST", "/layout", { seats: 8 })).status).toBe(409); // roulette does not support 8 seats
    const s = await t.ok("GET", "/state");
    expect(s.phase).toBe("ready");
    expect(s.game.id).toBe("roulette");
    expect((await t.api("POST", "/game/start")).status).toBe(409); // nobody tapped Ready
  });
});

describe("AI configuration", () => {
  it("stores per-seat AI options, checks them against the selected game, and passes them to the game", async () => {
    const a = await t.joinDeck("Ann");
    const { playerId: ai1 } = await t.ok("POST", "/ai", {});
    const { playerId: ai2 } = await t.ok("POST", "/ai", {});
    expect((await t.api("POST", `/players/${a.playerId}/ai-options`, { options: { style: "erratic" } })).status).toBe(400);
    await t.ok("POST", "/game/select", { gameId: "roulette" });
    const games = await t.ok("GET", "/games");
    expect(games.find((g: any) => g.id === "roulette").aiOptions[0]).toMatchObject({ key: "style", values: ["conservative", "aggressive", "erratic"] });
    expect(games.find((g: any) => g.id === "roulette").settings.map((s: any) => s.key)).toContain("bettingSeconds");
    expect((await t.api("POST", `/players/${ai1}/ai-options`, { options: { style: "reckless" } })).body.error).toMatch(/one of/);
    expect((await t.api("POST", `/players/${ai1}/ai-options`, { options: { mood: "x" } })).body.error).toMatch(/no AI option mood/);
    const s = await t.ok("POST", `/players/${ai1}/ai-options`, { options: { style: "aggressive" } });
    expect(s.players.find((p: any) => p.id === ai1).aiOptions).toEqual({ style: "aggressive" });
    await a.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    const start = t.host.table.runtime!.log[0] as any;
    const seatOf = (id: string) => s.players.find((p: any) => p.id === id).seat;
    expect(start.aiOptions[seatOf(ai1)]).toEqual({ style: "aggressive" });
    expect(start.aiOptions[seatOf(ai2)]).toEqual({ style: "conservative" }); // manifest default
    expect((await t.api("POST", `/players/${ai2}/ai-options`, { options: { style: "erratic" } })).status).toBe(409); // not while playing
  });
});

describe("game display prefs (D-088)", () => {
  it("keeps display choices per game, shared in the state, merged key by key", async () => {
    expect((await t.api("POST", "/game/prefs", { prefs: { a: 1 } })).status).toBe(409); // no game chosen
    await t.ok("POST", "/game/select", { gameId: "pachisi" });
    let s = await t.ok("GET", "/state");
    expect(s.game.prefs).toEqual({});
    s = await t.ok("POST", "/game/prefs", { prefs: { colors: { p1: "#c38be8" }, log: false } });
    expect(s.game.prefs).toEqual({ colors: { p1: "#c38be8" }, log: false });
    s = await t.ok("POST", "/game/prefs", { prefs: { log: null, size: "large" } }); // null removes a key
    expect(s.game.prefs).toEqual({ colors: { p1: "#c38be8" }, size: "large" });
    // another game has its own; coming back to Pachisi brings its choices back
    await t.ok("POST", "/game/close");
    await t.ok("POST", "/game/select", { gameId: "roulette" });
    expect((await t.ok("GET", "/state")).game.prefs).toEqual({});
    await t.ok("POST", "/game/close");
    expect((await t.ok("POST", "/game/select", { gameId: "pachisi" })).game.prefs.size).toBe("large");
  });

  it("refuses prefs that are not a small plain object", async () => {
    await t.ok("POST", "/game/select", { gameId: "pachisi" });
    expect((await t.api("POST", "/game/prefs", { prefs: [1, 2] })).status).toBe(400);
    expect((await t.api("POST", "/game/prefs", { prefs: "x" })).status).toBe(400);
    expect((await t.api("POST", "/game/prefs", { prefs: { "bad key!": 1 } })).status).toBe(400);
    expect((await t.api("POST", "/game/prefs", { prefs: { big: "x".repeat(5000) } })).status).toBe(413);
    expect((await t.ok("GET", "/state")).game.prefs).toEqual({}); // nothing half-applied
  });
});

describe("changing game settings before the start (D-090)", () => {
  it("changes only the keys given, keeps everyone's Ready, and is closed once the game runs", async () => {
    const a = await t.joinDeck("A");
    await t.ok("POST", "/ai", {});
    await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds: 3, roundSeconds: 0 } });
    a.send("lobby", "ready", { ready: true });
    await until(async () => (await t.ok("GET", "/state")).players.every((p: any) => p.ready));
    let s = await t.ok("POST", "/game/settings", { settings: { rounds: 7 } });
    expect(s.game.settings).toEqual({ rounds: 7, roundSeconds: 0 });
    expect(s.players.every((p: any) => p.ready)).toBe(true);
    expect((await t.api("POST", "/game/settings", { settings: { rounds: 99 } })).status).toBe(400); // max 20
    expect((await t.api("POST", "/game/settings", { settings: [1] })).status).toBe(400);
    expect((await t.ok("GET", "/state")).game.settings.rounds).toBe(7);
    await t.ok("POST", "/game/start");
    expect((await t.api("POST", "/game/settings", { settings: { rounds: 2 } })).status).toBe(409);
  });

  it("is refused with no game chosen", async () => {
    expect((await t.api("POST", "/game/settings", { settings: { rounds: 2 } })).status).toBe(409);
  });
});

describe("sound effects setting (D-092)", () => {
  it("is on by default, switches with POST /display, and refuses anything but true or false", async () => {
    expect((await t.ok("GET", "/state")).display).toEqual({ sound: true });
    expect((await t.ok("POST", "/display", { sound: false })).display.sound).toBe(false);
    expect((await t.api("POST", "/display", { sound: "no" })).status).toBe(400);
    expect((await t.api("POST", "/display", {})).status).toBe(400);
    expect((await t.ok("POST", "/display", { sound: true })).display.sound).toBe(true);
  });
});
