// Corner cases around seats, players, watchers and exchanges: "all seats are taken, can we add another?" in every way
// someone can arrive (a phone with the join code, + AI player, a remote invite, a watch invite, Let play, an exchange),
// in the lobby and during a game; the remote places taken by players plus watchers; exchanges at the edges (paused
// games, the game ending with one open, a seat whose player left, one replacing another, cancelled); the smallest and
// largest seat layouts; leaving and coming back; names colliding.
// Remote browsers are played through the Table's own entry points (joinRemote, remoteBoardOpened), which the WebRTC
// channel calls; tests/remote.test.ts covers the channel itself.
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { Deck, sleep, testHost, until } from "./helpers.ts";

let t: Awaited<ReturnType<typeof testHost>>;
afterEach(async () => {
  await t?.close();
});

const table = () => t.host.table;
const state = () => table().state();
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const named = (name: string) => state().players.find((p) => p.name === name);

/** A remote browser that came on a watch invite and opened its board. */
function watcher(session: string, name: string) {
  const token = `WATCH-${session}`;
  table().inviteCreated(token, true);
  table().remoteBoardOpened(session, hash(token), name);
  return state().watchers.find((w) => w.name.startsWith(name))!;
}
/** A remote player: their browser opens the board, then their deck joins. */
function remotePlayer(session: string, name: string) {
  table().remoteBoardOpened(session, undefined, name);
  return table().joinRemote(name, session);
}
/** The hello of a phone that scanned `token`, answered with the error (or the welcome). */
async function hello(token: string, name: string) {
  const ws = new WebSocket(t.base.replace("http", "ws") + "/ws");
  await new Promise((r) => ws.once("open", r));
  const reply = new Promise<any>((r) => ws.once("message", (m) => r(JSON.parse(String(m)))));
  ws.send(JSON.stringify({ v: 1, ch: "system", type: "hello", seq: 1, payload: { joinToken: token, name } }));
  const m = await reply;
  ws.close();
  return m;
}
async function start(gameId = "coin-flip", decks: Deck[] = [], settings: Record<string, unknown> = { rounds: 20, roundSeconds: 0 }) {
  await t.ok("POST", "/game/select", { gameId, settings });
  for (const d of decks) await d.request("lobby", "ready", { ready: true });
  for (const p of state().players) if (p.location === "remote" && p.kind === "human") table().setReady(p.id, true);
  await t.ok("POST", "/game/start");
}

describe("all seats taken: can another one come in?", () => {
  it("in the lobby: no phone, no AI, no player invite, no Let play, no exchange; a watcher yes", async () => {
    t = await testHost();
    await t.ok("POST", "/layout", { seats: 2 });
    await t.joinDeck("Ann");
    await t.ok("POST", "/ai", {});
    const full = state().noSeat!;
    expect(full).toMatch(/no free seat/);
    const { token } = await t.ok("GET", "/join");
    expect((await hello(token, "Ben")).payload).toMatchObject({ code: "no-seat", message: full });
    expect((await t.api("POST", "/ai", {})).status).toBe(409);
    expect(() => table().joinRemote("Rita", "s-rita")).toThrow(/no free seat/);
    expect((await t.api("POST", "/exchange", { seat: 0, kind: "ai" })).status).toBe(409); // no game running
    const w = watcher("s-wanda", "Wanda"); // a watch invite needs no seat
    expect(w).toBeTruthy();
    const play = await t.api("POST", `/watchers/${w.id}/play`);
    expect(play.status).toBe(409);
    expect(play.body.code).toBe("no-seat");
    expect(state().players).toHaveLength(2);
    // a larger layout makes room: the phone and Let play work again
    await t.ok("POST", "/layout", { seats: 4 });
    expect(state().noSeat).toBeNull();
    await t.ok("POST", `/watchers/${w.id}/play`);
    table().joinRemote("Wanda", "s-wanda");
    expect(named("Wanda")).toMatchObject({ location: "remote", seat: expect.any(Number) });
    expect(state().watchers).toEqual([]);
  });

  it("with a chosen game at its maximum, the free seats of the layout don't count", async () => {
    t = await testHost();
    await t.ok("POST", "/layout", { seats: 6 });
    await t.joinDeck("Ann");
    await t.ok("POST", "/game/select", { gameId: "pachisi" }); // 2 to 4 players
    for (let i = 0; i < 3; i++) await t.ok("POST", "/ai", {});
    expect(state().noSeat).toMatch(/Pachisi takes at most 4 players/);
    const { token } = await t.ok("GET", "/join");
    expect((await hello(token, "Ben")).payload.code).toBe("no-seat");
    expect((await t.api("POST", "/ai", {})).status).toBe(409);
    expect(() => table().joinRemote("Rita", "s-rita")).toThrow(/at most 4/);
    expect(state().phase).toBe("ready"); // the choice stays
  });

  it("during a full game: the join code says to wait, no AI, no remote player; a watcher yes, and an exchange lets them play", async () => {
    t = await testHost();
    await t.ok("POST", "/layout", { seats: 2 });
    const ann = await t.joinDeck("Ann");
    await t.ok("POST", "/ai", {});
    await start("coin-flip", [ann]);
    expect(state().noSeat).toBe("There is no free seat in this game. Join after it.");
    const { token } = await t.ok("GET", "/join");
    expect((await hello(token, "Ben")).payload.code).toBe("no-seat");
    expect((await t.api("POST", "/ai", {})).status).toBe(409);
    expect(() => table().joinRemote("Rita", "s-rita")).toThrow(/no free seat in this game/);
    const w = watcher("s-wanda", "Wanda");
    expect((await t.api("POST", `/watchers/${w.id}/play`)).body.error).toMatch(/exchange/);
    const aiSeat = state().players.find((p) => p.kind === "ai")!.seat!;
    await t.ok("POST", "/exchange", { seat: aiSeat, kind: "watcher", watcher: w.id });
    expect(table().mayJoin("s-wanda")).toBe(true);
    table().joinRemote("Wanda", "s-wanda");
    expect(named("Wanda")).toMatchObject({ seat: aiSeat, location: "remote" });
    expect(state().players).toHaveLength(2);
    expect(table().runtime!.seats.map((s) => s.name).sort()).toEqual(["Ann", "Wanda"]);
  });

  it("during a game with a free seat: a game that takes newcomers seats them, one that doesn't keeps them for the next game", async () => {
    t = await testHost();
    await t.ok("POST", "/layout", { seats: 4 });
    const ann = await t.joinDeck("Ann");
    await t.ok("POST", "/ai", {});
    await start("coin-flip", [ann]); // dynamicPlayers
    const ben = await t.joinDeck("Ben");
    expect(named("Ben")!.seat).not.toBeNull();
    expect(table().runtime!.seats.some((s) => s.name === "Ben")).toBe(true);
    await t.ok("POST", "/game/end");
    await until(() => table().phase === "finished");
    await t.ok("POST", "/game/close");
    // Hold'em takes no newcomers: Cleo joins without a seat during the game
    await t.ok("POST", "/game/select", { gameId: "holdem" });
    for (const d of [ann, ben]) await d.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    const cleo = await t.joinDeck("Cleo");
    expect(named("Cleo")!.seat).toBeNull();
    expect(state().noSeat).toBeNull();
    expect(table().runtime!.seats.some((s) => s.name === "Cleo")).toBe(false);
    expect(cleo.playerId).toBeTruthy();
  });

  it("smallest layout: two seats, both exchanged in turn; largest: eight seats, eight players, an exchange", async () => {
    t = await testHost();
    await t.ok("POST", "/layout", { seats: 2 });
    const ann = await t.joinDeck("Ann");
    await t.ok("POST", "/ai", {});
    await start("coin-flip", [ann]);
    const annSeat = named("Ann")!.seat!;
    const aiSeat = state().players.find((p) => p.kind === "ai")!.seat!;
    const r = await t.ok("POST", "/exchange", { seat: aiSeat, kind: "local" });
    const ben = await Deck.connect(t.base, { joinToken: r.url.split("/").pop(), name: "Ben" });
    expect(named("Ben")!.seat).toBe(aiSeat);
    await t.ok("POST", "/exchange", { seat: annSeat, kind: "ai" });
    expect(state().players.find((p) => p.seat === annSeat)).toMatchObject({ name: "Ann (AI)", kind: "ai" });
    expect(state().players).toHaveLength(2);
    ben.close();
    await t.close();

    t = await testHost();
    await t.ok("POST", "/layout", { seats: 8 });
    const cleo = await t.joinDeck("Cleo");
    for (let i = 0; i < 7; i++) await t.ok("POST", "/ai", {});
    expect(state().noSeat).toMatch(/Remove a player on the board first/);
    await start("coin-flip", [cleo]);
    expect(table().runtime!.seats).toHaveLength(8);
    const last = state().players.find((p) => p.seat === 7)!;
    const x = await t.ok("POST", "/exchange", { seat: 7, kind: "local" });
    const dan = await Deck.connect(t.base, { joinToken: x.url.split("/").pop(), name: "Dan" });
    expect(state().players.find((p) => p.seat === 7)).toMatchObject({ name: "Dan", kind: "human" });
    expect(state().players.some((p) => p.id === last.id)).toBe(false);
    expect(state().players).toHaveLength(8);
    expect(new Set(state().players.map((p) => p.color)).size).toBe(8); // colours still all different
    dan.close();
  });
});

describe("the remote places: players and watchers together", () => {
  it("counts a remote player and a watcher; a third is refused at every door, a watcher taking a seat keeps the count", async () => {
    t = await testHost({ maxRemotePlayers: 2 });
    await t.ok("POST", "/layout", { seats: 4 });
    const ann = await t.joinDeck("Ann");
    remotePlayer("s-rita", "Rita");
    const w = watcher("s-wanda", "Wanda");
    expect(table().remoteCount()).toBe(2);
    expect(state().remote).toMatchObject({ players: 1, maxPlayers: 2 });
    expect(() => table().assertRemoteRoom()).toThrow(/no room/);
    const refused = /no room for more remote players or watchers/;
    expect(() => table().joinRemote("Ruth", "s-ruth")).toThrow(refused);
    table().inviteCreated("WATCH-late", true);
    expect(() => table().remoteBoardOpened("s-late", hash("WATCH-late"), "Wilma")).toThrow(refused);
    // Let play turns a watcher into a player: one place changes from watching to playing
    await t.ok("POST", `/watchers/${w.id}/play`);
    table().joinRemote("Wanda", "s-wanda");
    expect(table().remoteCount()).toBe(2);
    expect(state().watchers).toEqual([]);
    // a local phone is never counted
    await t.joinDeck("Ben");
    expect(table().remoteCount()).toBe(2);
    expect(ann.playerId).toBeTruthy();
  });

  it("an exchange for a remote player is refused when the places are full, unless the seat's remote player frees one", async () => {
    t = await testHost({ maxRemotePlayers: 2 });
    await t.ok("POST", "/layout", { seats: 4 });
    const ann = await t.joinDeck("Ann");
    await t.ok("POST", "/ai", {});
    remotePlayer("s-rita", "Rita");
    remotePlayer("s-ruth", "Ruth");
    await start("coin-flip", [ann]);
    await until(() => state().phase === "active");
    const aiSeat = state().players.find((p) => p.kind === "ai")!.seat!;
    const ritaSeat = named("Rita")!.seat!;
    // full: an AI's seat can't go to a new remote player (that would make three)
    expect(() => table().exchange(aiSeat, "remote", "https://games.example/i/AAAAAAAA")).toThrow(/no room for more remote players or watchers/);
    // Rita's browser still has its board open: exchanged, she would stay as a watcher, so that is full too
    expect(() => table().exchange(ritaSeat, "remote", "https://games.example/i/AAAAAAAA")).toThrow(/no room/);
    // her browser closes: her place is free for whoever takes her seat
    table().remoteBoardClosed("s-rita");
    table().exchange(ritaSeat, "remote", "https://games.example/i/BBBBBBBB");
    remotePlayer("s-rose", "Rose");
    expect(named("Rose")).toMatchObject({ seat: ritaSeat, location: "remote" });
    expect(table().remoteCount()).toBe(2);
    // an exchange for an AI or someone at the table never needs a remote place
    await t.ok("POST", "/exchange", { seat: named("Ruth")!.seat!, kind: "ai" });
    expect(table().remoteCount()).toBeLessThanOrEqual(2);
  });

  it("an exchange for a watcher keeps the count even when full: the watcher plays, the old remote player watches", async () => {
    t = await testHost({ maxRemotePlayers: 2 });
    await t.ok("POST", "/layout", { seats: 2 });
    const ann = await t.joinDeck("Ann");
    remotePlayer("s-rita", "Rita");
    const w = watcher("s-wanda", "Wanda");
    await start("coin-flip", [ann]);
    await until(() => state().phase === "active");
    const ritaSeat = named("Rita")!.seat!;
    await t.ok("POST", "/exchange", { seat: ritaSeat, kind: "watcher", watcher: w.id });
    table().joinRemote("Wanda", "s-wanda");
    expect(named("Wanda")).toMatchObject({ seat: ritaSeat });
    expect(state().watchers.map((x) => x.name)).toEqual(["Rita"]);
    expect(table().remoteCount()).toBe(2);
  });
});

describe("exchanges at the edges", () => {
  async function twoSeats() {
    t = await testHost();
    await t.ok("POST", "/layout", { seats: 2 });
    const ann = await t.joinDeck("Ann");
    await t.ok("POST", "/ai", {});
    await start("coin-flip", [ann]);
    return { ann, annSeat: named("Ann")!.seat!, aiSeat: state().players.find((p) => p.kind === "ai")!.seat! };
  }
  const code = (r: { url: string }) => r.url.split("/").pop()!;

  it("a second exchange replaces the first: the first code stops working; cancelled, the code is gone too", async () => {
    const { annSeat, aiSeat } = await twoSeats();
    const first = await t.ok("POST", "/exchange", { seat: aiSeat, kind: "local" });
    const second = await t.ok("POST", "/exchange", { seat: annSeat, kind: "local" });
    expect(state().exchange).toMatchObject({ seat: annSeat });
    expect((await fetch(`${t.base}/j/${code(first)}/seat`)).status).toBe(403);
    expect((await hello(code(first), "Ben")).payload.message).toMatch(/invalid or expired/);
    const seat = await (await fetch(`${t.base}/j/${code(second)}/seat`)).json();
    expect(seat).toMatchObject({ free: true, exchange: true });
    await t.ok("DELETE", "/exchange");
    expect((await hello(code(second), "Ben")).payload.message).toMatch(/invalid or expired/);
    await t.ok("DELETE", "/exchange"); // cancelling nothing is fine
    expect(state().players.map((p) => p.name).sort()).toEqual(["Ann", expect.stringMatching(/\(AI\)$/)]);
  });

  it("the game ends with an exchange open: it closes, and its code seats nobody afterwards", async () => {
    const { aiSeat } = await twoSeats();
    const r = await t.ok("POST", "/exchange", { seat: aiSeat, kind: "local" });
    await t.ok("POST", "/game/end");
    await until(() => table().phase === "finished");
    expect(state().exchange).toBeNull();
    expect((await hello(code(r), "Ben")).payload.message).toMatch(/invalid or expired/);
    expect((await t.api("POST", "/exchange", { seat: aiSeat, kind: "ai" })).status).toBe(409);
  });

  it("an exchange for a seat whose player left: the newcomer may take the old name; a taken name is refused and the exchange stays open", async () => {
    const { ann, annSeat } = await twoSeats();
    await ann.request("lobby", "leave", {});
    await until(() => named("Ann")?.connected === false);
    const r = await t.ok("POST", "/exchange", { seat: annSeat, kind: "local" });
    const ai = state().players.find((p) => p.kind === "ai")!;
    // the AI's name is taken; "(AI)" is for AI players
    expect((await hello(code(r), ai.name)).payload.code).toBe("name-invalid");
    expect(state().exchange).toMatchObject({ seat: annSeat });
    const back = await Deck.connect(t.base, { joinToken: code(r), name: "ann" });
    expect(state().players.find((p) => p.seat === annSeat)).toMatchObject({ name: "ann", connected: true });
    expect(state().away).toEqual([]);
    back.close();
  });

  it("a name already at the table is refused for the newcomer, and the exchange stays open for another try", async () => {
    t = await testHost();
    await t.ok("POST", "/layout", { seats: 4 });
    const ann = await t.joinDeck("Ann");
    const ben = await t.joinDeck("Ben");
    await t.ok("POST", "/ai", {});
    await start("holdem", [ann, ben]);
    const aiSeat = state().players.find((p) => p.kind === "ai")!.seat!;
    const r = await t.ok("POST", "/exchange", { seat: aiSeat, kind: "local" });
    expect((await hello(code(r), "BEN")).payload.code).toBe("name-taken");
    expect(state().exchange).toMatchObject({ seat: aiSeat });
    const cleo = await Deck.connect(t.base, { joinToken: code(r), name: "Cleo" });
    expect(named("Cleo")!.seat).toBe(aiSeat);
    cleo.close();
  });

  it("an AI taking over a long name stays within twelve characters", async () => {
    t = await testHost();
    await t.ok("POST", "/layout", { seats: 2 });
    const a = await t.joinDeck("Alexandra 12");
    await t.ok("POST", "/ai", {});
    await start("coin-flip", [a]);
    const seat = named("Alexandra 12")!.seat!;
    await t.ok("POST", "/exchange", { seat, kind: "ai" });
    const ai = state().players.find((p) => p.seat === seat)!;
    expect(ai.kind).toBe("ai");
    expect(ai.name).toMatch(/\(AI\)$/);
    expect(Array.from(ai.name).length).toBeLessThanOrEqual(12);
    expect(ai.name).toBe("Alexand (AI)");
  });

  it("during a pause for the service, an exchange is made; the game goes on when the service is back", async () => {
    const { annSeat } = await twoSeats();
    table().setCloud({ status: "online" });
    table().setCloud({ status: "offline" });
    expect(state().pause?.reason).toBe("cloud");
    await t.ok("POST", "/exchange", { seat: annSeat, kind: "ai" });
    expect(state()).toMatchObject({ phase: "paused", pause: { reason: "cloud" } });
    table().setCloud({ status: "online" });
    expect(state()).toMatchObject({ phase: "active", pause: null });
  });
});

describe("exchanging the AI the game waits for (D-112)", { timeout: 30_000 }, () => {
  it("ends the pause: the new player is not kept waiting for an AI that has gone", async () => {
    const GAMES = fileURLToPath(new URL("./fixtures/async-games", import.meta.url));
    t = await testHost({ gamesDir: GAMES, showTestGames: true });
    const ann = await t.joinDeck("Ann");
    await t.ok("POST", "/game/select", { gameId: "think-race", settings: { target: 5 } });
    const { playerId } = await t.ok("POST", "/ai", {});
    await t.ok("POST", `/players/${playerId}/ai-options`, { options: { thinkMs: 10_000 } });
    await ann.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    await ann.waitState((s) => s.phase === "paused" && s.pause?.reason === "ai");
    const seat = table().player(playerId)!.seat!;
    const r = await t.ok("POST", "/exchange", { seat, kind: "local" });
    const ben = await Deck.connect(t.base, { joinToken: r.url.split("/").pop(), name: "Ben" });
    expect(state()).toMatchObject({ phase: "active", pause: null });
    expect((await ben.request("game", "intent", { name: "add", payload: { n: 1 } })).type).toBe("ack");
    ben.close();
  });
});

describe("leaving and coming back", () => {
  it("in the lobby the name is free again; during a full game only an exchange brings the player back", async () => {
    t = await testHost();
    await t.ok("POST", "/layout", { seats: 2 });
    const ann = await t.joinDeck("Ann");
    await ann.request("lobby", "leave", {});
    await until(() => !named("Ann"));
    const again = await t.joinDeck("Ann");
    expect(named("Ann")!.seat).not.toBeNull();
    await t.ok("POST", "/ai", {});
    await start("coin-flip", [again]);
    const seat = named("Ann")!.seat!;
    await again.request("lobby", "leave", {});
    await until(() => named("Ann")?.connected === false);
    const { token } = await t.ok("GET", "/join");
    expect((await hello(token, "Ann")).payload.code).toBe("no-seat");
    await expect(Deck.connect(t.base, { sessionToken: again.sessionToken })).rejects.toThrow(/you left this game/);
    const r = await t.ok("POST", "/exchange", { seat, kind: "local" });
    const back = await Deck.connect(t.base, { joinToken: r.url.split("/").pop(), name: "Ann" });
    expect(named("Ann")).toMatchObject({ seat, connected: true });
    expect(state().players).toHaveLength(2);
    back.close();
  });

  it("a phone that drops in the lobby keeps its seat for the waiting time and gets it back with its session", async () => {
    t = await testHost({ graceMs: 400 });
    await t.ok("POST", "/layout", { seats: 2 });
    const ann = await t.joinDeck("Ann");
    const seat = named("Ann")!.seat;
    ann.close();
    await until(() => named("Ann")?.connected === false);
    const back = await Deck.connect(t.base, { sessionToken: ann.sessionToken });
    expect(named("Ann")).toMatchObject({ seat, connected: true });
    back.close();
    await until(() => !named("Ann"), 3000); // gone after the waiting time
    expect(state().noSeat).toBeNull();
  });
});

describe("names colliding", () => {
  it("phones are refused a taken name in any case; remote players and watchers get a number; watchers are told apart", async () => {
    t = await testHost();
    await t.ok("POST", "/layout", { seats: 8 });
    await t.joinDeck("Ann");
    const { token } = await t.ok("GET", "/join");
    expect((await hello(token, "  ANN ")).payload.code).toBe("name-taken");
    expect((await hello(token, "Bob (ai)")).payload.code).toBe("name-invalid");
    remotePlayer("s-ann", "Ann");
    expect(state().players.map((p) => p.name)).toEqual(["Ann", "Ann 2"]);
    watcher("s-w1", "Wanda");
    watcher("s-w2", "Wanda");
    watcher("s-w3", "Ann");
    expect(state().watchers.map((w) => w.name)).toEqual(["Wanda", "Wanda 2", "Ann 3"]);
    // a watcher let in to play keeps the name they were listed with
    await t.ok("POST", `/watchers/${state().watchers[1].id}/play`);
    table().joinRemote("Wanda", "s-w2");
    expect(state().players.map((p) => p.name)).toContain("Wanda 2");
  });

  it("an AI that takes over a seat gets the old player's name with (AI), or another one when that is taken", async () => {
    t = await testHost();
    await t.ok("POST", "/layout", { seats: 4 });
    const ann = await t.joinDeck("Ann");
    const ben = await t.joinDeck("Ben");
    await start("coin-flip", [ann, ben]);
    await t.ok("POST", "/exchange", { seat: named("Ann")!.seat!, kind: "ai" });
    expect(named("Ann (AI)")).toBeTruthy();
    // Ben's phone takes Ann (AI)'s seat back as "Ann"... then Ann's AI name is free again for the next exchange
    const r = await t.ok("POST", "/exchange", { seat: named("Ann (AI)")!.seat!, kind: "local" });
    const a2 = await Deck.connect(t.base, { joinToken: r.url.split("/").pop(), name: "Ann" });
    await t.ok("POST", "/exchange", { seat: named("Ann")!.seat!, kind: "ai" });
    expect(named("Ann (AI)")).toBeTruthy();
    a2.close();
    await sleep(10);
  });
});

describe("dead ends that are refused", () => {
  it("removing a player of the running game is refused; one without a seat in it can go", async () => {
    t = await testHost();
    await t.ok("POST", "/layout", { seats: 4 });
    const ann = await t.joinDeck("Ann");
    const ben = await t.joinDeck("Ben");
    await start("holdem", [ann, ben]);
    const r = await t.api("DELETE", `/players/${ben.playerId}`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("in-game");
    const cleo = await t.joinDeck("Cleo"); // no seat in Hold'em during the game
    await t.ok("DELETE", `/players/${cleo.playerId}`);
    expect(named("Cleo")).toBeUndefined();
    expect(state().seatColors).toEqual({});
  });

  it("an exchange for a seat outside the game, of an unknown kind, or AI for an AI, is refused", async () => {
    t = await testHost();
    await t.ok("POST", "/layout", { seats: 4 });
    const ann = await t.joinDeck("Ann");
    await t.ok("POST", "/ai", {});
    await start("holdem", [ann]);
    const aiSeat = state().players.find((p) => p.kind === "ai")!.seat!;
    expect((await t.api("POST", "/exchange", { seat: 3, kind: "ai" })).status).toBe(404);
    expect((await t.api("POST", "/exchange", { seat: aiSeat, kind: "robot" })).status).toBe(400);
    expect((await t.api("POST", "/exchange", { seat: aiSeat, kind: "ai" })).status).toBe(409);
    expect((await t.api("POST", "/exchange", { seat: aiSeat, kind: "remote" })).status).toBe(409); // needs the service
  });
});
