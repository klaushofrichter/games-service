// Player names (D-148): at most 12 characters, unique at the table ignoring case, "(AI)" kept for AI players, and a
// player can change their own name between games.
import { afterEach, describe, expect, it } from "vitest";
import { Deck, testHost } from "./helpers.ts";

let t: Awaited<ReturnType<typeof testHost>>;
afterEach(async () => t?.close());
const names = async () => (await t.ok("GET", "/state")).players.map((p: any) => p.name);

describe("player names (D-148)", () => {
  it("cuts a long name to 12 characters, tidies spaces and drops control characters", async () => {
    t = await testHost();
    await t.joinDeck("  Alexandra   Maximiliane  ");
    await t.joinDeck("Zo\u0000e​");
    expect(await names()).toEqual(["Alexandra Ma", "Zoe"]);
    await t.joinDeck("👩‍🚀👩‍🚀👩‍🚀👩‍🚀👩‍🚀"); // cut by characters, not UTF-16 units
    expect((await names())[2].length).toBeLessThanOrEqual(12 * 2);
  });

  it("refuses a name that is already at the table, ignoring case and spaces", async () => {
    t = await testHost();
    await t.joinDeck("Ann");
    await expect(t.joinDeck("ann")).rejects.toThrow(/ann is already at this table/);
    await expect(t.joinDeck(" ANN ")).rejects.toThrow(/already at this table/);
    // The cut matters: two long names that differ only after 12 characters are the same name.
    await t.joinDeck("Christophers1");
    await expect(t.joinDeck("Christophers2")).rejects.toThrow(/Christophers is already at this table/);
    expect(await names()).toEqual(["Ann", "Christophers"]);
  });

  it("answers the phone's hello with code name-taken, and keeps (AI) for AI players", async () => {
    t = await testHost();
    await t.joinDeck("Ann");
    const { token } = await t.ok("GET", "/join");
    const d = new Deck();
    await expect(d.open(t.base, { joinToken: token, name: "Mia (AI)" })).rejects.toThrow(/for AI players/);
    const ai = (await t.ok("POST", "/ai", {})).playerId;
    const aiName = (await t.ok("GET", "/state")).players.find((p: any) => p.id === ai).name.replace(" (AI)", "");
    await t.joinDeck(aiName); // "Mia" is fine beside "Mia (AI)"
  });

  it("gives an empty name the next free Player N", async () => {
    t = await testHost();
    await t.joinDeck("Player 2");
    await t.joinDeck("   ");
    expect(await names()).toEqual(["Player 2", "Player 3"]);
  });

  it("numbers a remote player's taken name instead of refusing it", async () => {
    t = await testHost();
    await t.ok("POST", "/layout", { seats: 8 });
    await t.joinDeck("Ann");
    t.host.table.joinRemote("Ann", "s1");
    t.host.table.joinRemote("ann", "s2");
    t.host.table.joinRemote("Christophers", "s3");
    t.host.table.joinRemote("Christophers", "s4");
    expect(await names()).toEqual(["Ann", "Ann 2", "ann 3", "Christophers", "Christophe 2"]);
  });

  it("lets a player change their own name between games, not to a taken one, and not during a game", async () => {
    t = await testHost();
    const ann = await t.joinDeck("Ann");
    await t.joinDeck("Ben");
    expect((await ann.request("lobby", "rename", { name: "Annabel" })).type).toBe("ack");
    expect(await names()).toEqual(["Annabel", "Ben"]);
    const taken = await ann.request("lobby", "rename", { name: "ben" });
    expect(taken.payload).toMatchObject({ status: 409, code: "name-taken" });
    expect((await ann.request("lobby", "rename", { name: "  " })).payload).toMatchObject({ code: "name-invalid" });
    expect((await ann.request("lobby", "rename", { name: "ANNABEL" })).type).toBe("ack"); // only the case: fine
    expect(await names()).toEqual(["ANNABEL", "Ben"]);

    await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds: 3, roundSeconds: 0 } });
    await ann.request("lobby", "ready", { ready: true });
    const ben = t.decks[1];
    await ben.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    expect((await ann.request("lobby", "rename", { name: "Anna" })).payload.message).toMatch(/between games/);
  });
});
