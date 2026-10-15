// Moves made by touching the board (D-102): which intents, for which players, from which board.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { manifestSchema } from "../packages/protocol/src/index.ts";
import type { State } from "../games/pachisi/rules.ts";
import { Deck, testHost, until } from "./helpers.ts";

type Host = Awaited<ReturnType<typeof testHost>>;
let t: Host;
let board: Deck;
let ann: Deck;
let ids: Record<string, { id: string; seat: number }>;

/** Pachisi with Ann and Ben at the table, Rita remote (session "sess-rita") and an AI; every token on the track. */
beforeEach(async () => {
  t = await testHost();
  ann = await t.joinDeck("Ann");
  const ben = await t.joinDeck("Ben");
  const rita = t.host.table.joinRemote("Rita", "sess-rita");
  await t.ok("POST", "/ai", {});
  await t.ok("POST", "/game/select", { gameId: "pachisi", settings: { turnSeconds: 0, tokens: 2 } });
  await ann.request("lobby", "ready", { ready: true });
  await ben.request("lobby", "ready", { ready: true });
  t.host.table.setReady(rita.playerId, true);
  await t.ok("POST", "/game/start");
  ids = Object.fromEntries(t.host.table.state().players.map((p) => [p.name.startsWith("Ann") || p.name.startsWith("Ben") || p.name.startsWith("Rita") ? p.name : "ai", { id: p.id, seat: p.seat! }]));
  board = await Deck.connect(t.base, { role: "board", key: "test-key" } as never);
});
afterEach(async () => {
  board.close();
  await t.close();
});

/** Ann (or whoever) to move with a 3 rolled, all tokens on the track. */
function turnOf(name: string) {
  const rt = t.host.table.runtime!;
  const s = rt.state as State;
  const players = Object.fromEntries(Object.entries(s.players).map(([k, p]) => [k, { ...p, tokens: p.tokens.map((_, i) => i * 5) }]));
  rt.state = { ...s, players, turn: ids[name].seat, die: 3, phase: "move", sixes: 0 } satisfies State;
}
const fromBoard = (who: string, name: string, payload: unknown = { token: 0 }) => board.request("game", "intent", { playerId: ids[who].id, name, payload });
const tokens = (name: string) => (t.host.table.runtime!.state as State).players[ids[name].seat].tokens;

describe("board intents (D-102)", () => {
  it("lets the table's board move a token for the local player whose turn it is, and the phone follows", async () => {
    turnOf("Ann");
    const r = await fromBoard("Ann", "move", { token: 1 });
    expect(r.type).toBe("ack");
    expect(tokens("Ann")).toEqual([0, 8]);
    const rec = t.host.table.runtime!.log.at(-1) as { t: string; by: string; seat: number };
    expect(rec).toMatchObject({ t: "intent", by: "board", seat: ids.Ann.seat });
    // Ann's phone gets the new position
    await ann.waitView((v) => v.view.tokens[1] === 8);
  });

  it("only allows the intents the game lists: rolling stays on the phone", async () => {
    turnOf("Ann");
    (t.host.table.runtime!.state as State).phase = "roll";
    const r = await fromBoard("Ann", "roll", undefined);
    expect(r.type).toBe("error");
    expect(r.payload).toMatchObject({ status: 403, message: "roll is done on the phone, not on the board" });
  });

  it("still applies the game's rules: not your turn, an illegal token", async () => {
    turnOf("Ann");
    expect((await fromBoard("Ben", "move")).payload.reason).toMatch(/Ann's turn/);
    expect((await fromBoard("Ann", "move", { token: 7 })).payload.reason).toBe("that token cannot move");
    expect(tokens("Ann")).toEqual([0, 5]);
  });

  it("does not move for AI players or remote players from the table's board", async () => {
    turnOf("ai");
    expect((await fromBoard("ai", "move")).payload).toMatchObject({ status: 403, message: "only players at the table can move from the board" });
    turnOf("Rita");
    expect((await fromBoard("Rita", "move")).payload).toMatchObject({ status: 403 });
    expect(tokens("Rita")).toEqual([0, 5]);
  });

  it("lets a remote board move only its own player's tokens", () => {
    const table = t.host.table;
    turnOf("Rita");
    expect(() => table.boardIntent(ids.Rita.id, { name: "move", payload: { token: 0 } }, "sess-other")).toThrow(/only move your own/);
    turnOf("Ann");
    expect(() => table.boardIntent(ids.Ann.id, { name: "move", payload: { token: 0 } }, "sess-rita")).toThrow(/only move your own/);
    turnOf("Rita");
    expect(table.boardIntent(ids.Rita.id, { name: "move", payload: { token: 0 } }, "sess-rita")).toEqual({ ok: true });
    expect(tokens("Rita")).toEqual([3, 5]);
  });

  it("refuses unknown players, malformed intents and a paused game", async () => {
    turnOf("Ann");
    expect((await board.request("game", "intent", { playerId: "nobody", name: "move" })).payload).toMatchObject({ status: 404 });
    expect((await board.request("game", "intent", { playerId: ids.Ann.id })).payload).toMatchObject({ status: 400 });
    t.host.table.pauseGame("cloud");
    await until(() => t.host.table.phase === "paused");
    expect((await fromBoard("Ann", "move")).payload).toMatchObject({ status: 409, message: "the game is paused" });
  });

  it("is refused for a game that lists no board intents", async () => {
    await t.ok("POST", "/game/end", {});
    await until(() => t.host.table.phase !== "active");
    await t.ok("POST", "/game/close", {}).catch(() => {});
    await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: {} });
    for (const d of [ann, t.decks[1]]) await d.request("lobby", "ready", { ready: true });
    t.host.table.setReady(ids.Rita.id, true);
    await t.ok("POST", "/game/start");
    await until(() => t.host.table.phase === "active");
    expect((await fromBoard("Ann", "guess", { side: "heads" })).payload).toMatchObject({ status: 403, message: "guess is done on the phone, not on the board" });
  });
});

const minimal = { id: "x", name: "X", version: "1.0.0", sdk: "^0.1", description: "d", players: { min: 1, max: 2 }, turnModel: "sequential", seatLayouts: [2], edges: ["north", "south"] };

describe("manifest boardIntents", () => {
  it("defaults to none and takes plain intent names only", () => {
    expect(manifestSchema.parse(minimal).boardIntents).toEqual([]);
    expect(manifestSchema.parse({ ...minimal, boardIntents: ["move", "play-card"] }).boardIntents).toEqual(["move", "play-card"]);
    for (const bad of [[""], ["a b"], ["../x"], ["x".repeat(41)], Array(11).fill("m")]) expect(() => manifestSchema.parse({ ...minimal, boardIntents: bad })).toThrow();
  });
});
