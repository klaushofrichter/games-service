// Play from the board (D-175): a developer setting for one person who plays without a phone. The board's page shows
// their deck beside the board; that deck joins with the table key; nobody else joins at the table while it is on;
// remote players, watchers and AI players are as usual. Off again, that player stays as an ordinary one.
import { afterEach, describe, expect, it } from "vitest";
import { Deck, testHost } from "./helpers.ts";

let t: Awaited<ReturnType<typeof testHost>>;
afterEach(async () => t?.close());

const state = () => t.ok("GET", "/state");
const boardDeck = (on: boolean) => t.api("POST", "/developer", { boardDeck: on });
const fromBoard = (name: string, key = "test-key") => Deck.connect(t.base, { boardKey: key, name } as never);

describe("play from the board (D-175)", () => {
  it("one player at the table, from the board's deck; phones and exchanges for someone at the table are turned away", async () => {
    t = await testHost();
    expect((await state()).developer.boardDeck).toBe(false);
    // Without the setting, the board's deck is refused
    await expect(fromBoard("Dev")).rejects.toThrow(/switched off/);
    expect((await boardDeck(true)).status).toBe(200);
    expect((await state()).developer.boardDeck).toBe(true);
    // A wrong key is refused; with the key the deck takes a seat as the one person at the table
    await expect(fromBoard("Dev", "nope")).rejects.toThrow(/table key/);
    const dev = await fromBoard("Dev");
    expect((await state()).players.find((p: any) => p.id === dev.playerId)).toMatchObject({ name: "Dev", kind: "human", location: "local" });
    expect((await state()).players.find((p: any) => p.id === dev.playerId).seat).not.toBeNull();
    // A phone with the join code is turned away, so is a second name from the board
    const { token } = await t.ok("GET", "/join");
    await expect(Deck.connect(t.base, { joinToken: token, name: "Phone" })).rejects.toThrow(/played from its board/);
    await expect(fromBoard("Other")).rejects.toThrow(/Dev is at the table already/);
    // AI players as usual; a game starts with the board's player
    await t.ok("POST", "/ai", {});
    await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds: 3, roundSeconds: 0 } });
    await dev.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    const aiSeat = (await state()).players.find((p: any) => p.kind === "ai").seat;
    // "Someone at the table" can't come in through an exchange; an AI exchange still works
    expect((await t.api("POST", "/exchange", { seat: aiSeat, kind: "local" })).status).toBe(409);
    const devSeat = (await state()).players.find((p: any) => p.id === dev.playerId).seat;
    expect((await t.api("POST", "/exchange", { seat: devSeat, kind: "ai" })).status).toBe(200);
  });

  it("the same name takes over: the board's player after a reload, or someone who played by phone before", async () => {
    t = await testHost();
    const phone = await t.joinDeck("Klaus");
    expect((await boardDeck(true)).status).toBe(200); // one person at the table: allowed
    const removed = phone.next((m) => m.ch === "system" && m.type === "removed");
    const board = await fromBoard("klaus"); // the name, in any case
    expect(board.playerId).toBe(phone.playerId);
    expect((await removed).payload).toEqual({ reason: "board" });
    await expect(Deck.connect(t.base, { sessionToken: phone.sessionToken })).rejects.toThrow(/play from the board/);
    // a reload of the board page: the deck comes back with its own session, the same player
    board.close();
    const again = await Deck.connect(t.base, { sessionToken: board.sessionToken });
    expect(again.playerId).toBe(phone.playerId);
    expect((await state()).players.filter((p: any) => p.location === "local")).toHaveLength(1);
  });

  it("is refused while two people are at the table; off again, the player stays and phones join as before", async () => {
    t = await testHost();
    await t.joinDeck("Ann");
    const ben = await t.joinDeck("Ben");
    const r = await boardDeck(true);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/only one person at the table/);
    await t.ok("DELETE", `/players/${ben.playerId}`);
    expect((await boardDeck(true)).status).toBe(200);
    const board = await fromBoard("Ann");
    expect((await boardDeck(false)).status).toBe(200);
    expect((await state()).players.find((p: any) => p.id === board.playerId)).toMatchObject({ name: "Ann", location: "local" });
    await expect(fromBoard("Ann")).rejects.toThrow(/switched off/);
    await expect(t.joinDeck("Cleo")).resolves.toBeTruthy();
    // the other developer setting is set on its own, as before
    expect((await t.api("POST", "/developer", { allowNoLocalPlayer: true })).status).toBe(200);
    expect((await state()).developer).toMatchObject({ allowNoLocalPlayer: true, boardDeck: false });
    expect((await t.api("POST", "/developer", {})).status).toBe(400);
  });

  it("serves the board-and-deck page only on the table PC, with the table key", async () => {
    t = await testHost();
    const page = await (await fetch(`${t.base}/board/play.html`)).text();
    expect(page).toContain('window.TABLE_KEY = "test-key"');
    expect(page).toContain('src="/deck/?board=1"');
    expect(page).toContain('src="/board/?in=play"');
  });
});
