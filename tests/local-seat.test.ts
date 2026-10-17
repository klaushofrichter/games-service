// D-128: a game's localSeat puts the one player at the table on that edge when the game starts.
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { testHost } from "./helpers.ts";

const GAMES = join(import.meta.dirname, "fixtures", "local-seat");
let t: Awaited<ReturnType<typeof testHost>>;
afterEach(async () => {
  await t?.close();
});

/** A table with Duel chosen, so it has the game's two seats (south and north). */
async function host() {
  t = await testHost({ gamesDir: GAMES, showTestGames: true });
  await t.ok("POST", "/game/select", { gameId: "duel" });
  return t;
}
const seatOf = (name: string) => t.host.table.state().players.find((p) => p.name.startsWith(name))!.seat;
const edgeOf = (name: string) => t.host.table.state().seatEdges[seatOf(name)!];
async function start(...decks: { request: (ch: string, type: string, payload: unknown) => Promise<unknown> }[]) {
  for (const d of decks) await d.request("lobby", "ready", { ready: true });
  await t.ok("POST", "/game/start");
  return (t.host.table.runtime!.state as { seats: Record<number, string> }).seats;
}

describe("localSeat (D-128)", () => {
  it("moves the one player at the table south, swapping with a remote player who sat there", async () => {
    await host();
    const rita = t.host.table.joinRemote("Rita", "sess-rita"); // takes the first seat, south
    t.host.table.setReady(rita.playerId, true);
    const ann = await t.joinDeck("Ann");
    expect(edgeOf("Ann")).toBe("north");
    const seats = await start(ann);
    expect(edgeOf("Ann")).toBe("south");
    expect(edgeOf("Rita")).toBe("north");
    // The game started with the new seats.
    expect(Object.values(seats).sort()).toEqual(["Ann@south", "Rita@north"]);
  });

  it("does the same against an AI player, also after a move in the lobby", async () => {
    await host();
    await t.ok("POST", "/ai", {});
    const ann = await t.joinDeck("Ann");
    const id = t.host.table.state().players.find((p) => p.name === "Ann")!.id;
    await t.ok("POST", "/seats/move", { playerId: id, seat: t.host.table.state().seatEdges.indexOf("north") });
    expect(edgeOf("Ann")).toBe("north");
    await start(ann);
    expect(edgeOf("Ann")).toBe("south");
  });

  it("already in the lobby: choosing the game seats the player at the table south (8 seats, players east and west)", async () => {
    t = await testHost({ gamesDir: GAMES, showTestGames: true });
    await t.ok("POST", "/layout", { seats: 8 });
    await t.joinDeck("Ann");
    await t.ok("POST", "/ai", {});
    const ann = t.host.table.state().players.find((p) => p.name === "Ann")!;
    const east = t.host.table.state().seatEdges.findIndex((e) => e === "east");
    await t.ok("POST", "/seats/move", { playerId: ann.id, seat: east });
    expect(edgeOf("Ann")).toBe("east");
    await t.ok("POST", "/game/select", { gameId: "duel" });
    expect(t.host.table.state().seatEdges).toEqual(["south", "north"]);
    expect(edgeOf("Ann")).toBe("south");
  });

  it("keeps the seats when the player at the table already sits south", async () => {
    await host();
    const ann = await t.joinDeck("Ann");
    await t.ok("POST", "/ai", {});
    await start(ann);
    expect(edgeOf("Ann")).toBe("south");
  });

  it("leaves two people at the table where they chose to sit", async () => {
    await host();
    const ann = await t.joinDeck("Ann");
    const ben = await t.joinDeck("Ben");
    await t.ok("POST", "/seats/move", { playerId: t.host.table.state().players.find((p) => p.name === "Ann")!.id, seat: seatOf("Ben") });
    expect(edgeOf("Ann")).toBe("north");
    await start(ann, ben);
    expect(edgeOf("Ann")).toBe("north");
    expect(edgeOf("Ben")).toBe("south");
  });

  it("moves nobody when a game has no localSeat", async () => {
    await host();
    const rita = t.host.table.joinRemote("Rita", "sess-rita");
    t.host.table.setReady(rita.playerId, true);
    const ann = await t.joinDeck("Ann");
    // The same game without the field: the table reads the manifest at selection, so patch the loaded one.
    (t.host.table.games.get("duel")!.manifest as { localSeat?: string }).localSeat = undefined;
    await start(ann);
    expect(edgeOf("Ann")).toBe("north");
  });
});
