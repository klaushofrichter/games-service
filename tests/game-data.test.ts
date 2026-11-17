// Game data (D-302): what a game keeps on the table between games. The store itself (limits, files, a damaged file),
// then a real Table Host: the board and seated players' phones read and write, the others hear of it, it survives a
// restart, and the board's Game data window lists, exports, imports and deletes it.
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GAME_DATA_LIMITS, GameData, GameDataError } from "../apps/table-host/src/game-data.ts";
import { Deck, testHost, until } from "./helpers.ts";

const GAMES = join(import.meta.dirname, "fixtures", "store-games");
const KEEPER = { id: "keeper", name: "Keeper", version: "1.0.0" };
const dirs: string[] = [];
const tmp = async () => (dirs.push(await mkdtemp(join(tmpdir(), "game-data-"))), dirs.at(-1)!);

afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("the store", () => {
  it("keeps entries per game, removes them with null, and hands out copies", () => {
    const d = new GameData();
    expect(d.set(KEEPER, "favourites", ["a", "b"])).toEqual(["a", "b"]);
    d.set({ ...KEEPER, id: "other" }, "favourites", ["x"]);
    const got = d.data("keeper");
    expect(got).toEqual({ favourites: ["a", "b"] });
    (got.favourites as string[]).push("changed outside");
    expect(d.data("keeper")).toEqual({ favourites: ["a", "b"] });
    expect(d.set(KEEPER, "favourites", null)).toBeNull();
    expect(d.data("keeper")).toEqual({});
    expect(d.data("other")).toEqual({ favourites: ["x"] });
    expect(d.list().map((e) => e.gameId)).toEqual(["other"]); // a game with nothing left is not listed
  });

  it("refuses bad keys, values that are not JSON, and more than its limits", () => {
    const d = new GameData();
    for (const key of ["", "1st", "a b", "ä", "x".repeat(65), 7, null, "__proto__"]) expect(() => d.set(KEEPER, key, 1), String(key)).toThrow(GameDataError);
    expect(() => d.set(KEEPER, "f", () => 1)).toThrow(/JSON/);
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => d.set(KEEPER, "f", loop)).toThrow(/JSON/);
    expect(() => d.set(KEEPER, "big", "x".repeat(GAME_DATA_LIMITS.entry))).toThrow(/48 KB/);
    // 256 KB in all: six entries of 45 KB do not fit.
    const chunk = "x".repeat(45 * 1024);
    for (let i = 0; i < 5; i++) d.set(KEEPER, `part${i}`, chunk);
    expect(() => d.set(KEEPER, "part5", chunk)).toThrow(/256 KB/);
    expect(Object.keys(d.data("keeper"))).toHaveLength(5); // the refused entry changed nothing
    const many = new GameData();
    for (let i = 0; i < GAME_DATA_LIMITS.keys; i++) many.set(KEEPER, `k${i}`, i);
    expect(() => many.set(KEEPER, "one-more", 1)).toThrow(/64 entries/);
    expect(many.set(KEEPER, "k0", "replaced")).toBe("replaced"); // replacing an entry is not one more
  });

  it("writes one whole file per game and reads it back", async () => {
    const dir = await tmp();
    const d = new GameData(dir);
    for (let i = 0; i < 30; i++) d.set(KEEPER, "counter", i); // the newest write is the one that stays
    d.setPrefs(KEEPER, { pieces: "numbers" });
    await d.flush();
    expect(readdirSync(dir)).toEqual(["keeper.json"]); // no temporary file left
    const file = JSON.parse(readFileSync(join(dir, "keeper.json"), "utf8"));
    expect(file).toMatchObject({ format: 1, gameId: "keeper", gameName: "Keeper", gameVersion: "1.0.0", data: { counter: 29 }, prefs: { pieces: "numbers" } });
    const again = new GameData(dir);
    expect(again.data("keeper")).toEqual({ counter: 29 });
    expect(again.allPrefs()).toEqual([["keeper", { pieces: "numbers" }]]);
    again.delete("keeper");
    await again.flush();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("sets a damaged file aside and starts that game without data", async () => {
    const dir = await tmp();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "keeper.json"), "{ not json");
    writeFileSync(join(dir, "other.json"), JSON.stringify({ format: 1, gameId: "other", data: { ok: true }, prefs: {} }));
    writeFileSync(join(dir, "wrong.json"), JSON.stringify({ format: 1, gameId: "someone-else", data: {} })); // not its own file
    const d = new GameData(dir);
    expect(d.data("keeper")).toEqual({});
    expect(d.data("other")).toEqual({ ok: true });
    const names = readdirSync(dir).sort();
    expect(names.filter((n) => n.startsWith("keeper.json.broken-"))).toHaveLength(1);
    expect(names.filter((n) => n.startsWith("wrong.json.broken-"))).toHaveLength(1);
    d.set(KEEPER, "fresh", 1);
    await d.flush();
    expect(existsSync(join(dir, "keeper.json"))).toBe(true);
  });

  it("exports a game's data and takes an export in, replacing what was there", () => {
    const d = new GameData();
    d.set(KEEPER, "favourites", ["a"]);
    d.setPrefs(KEEPER, { theme: "dark" });
    const file = d.export("keeper", "Kitchen table")!;
    expect(file).toMatchObject({ format: 1, gameId: "keeper", tableName: "Kitchen table", data: { favourites: ["a"] }, prefs: { theme: "dark" } });
    expect(Date.parse(file.exportedAt!)).not.toBeNaN();
    expect(d.export("nothing-here", "t")).toBeNull();

    const other = new GameData();
    other.set(KEEPER, "old", true);
    expect(other.inspect(file)).toMatchObject({ gameId: "keeper" });
    expect(other.data("keeper")).toEqual({ old: true }); // looking changes nothing
    other.import(JSON.parse(JSON.stringify(file)));
    expect(other.data("keeper")).toEqual({ favourites: ["a"] });
    for (const bad of [null, [], "text", {}, { ...file, format: 2 }, { ...file, gameId: "../etc" }, { ...file, data: { "bad key": 1 } }, { ...file, data: { big: "x".repeat(GAME_DATA_LIMITS.entry) } }])
      expect(() => other.import(bad), JSON.stringify(bad)?.slice(0, 60)).toThrow(GameDataError);
    expect(other.data("keeper")).toEqual({ favourites: ["a"] });
  });
});

describe("on a table host", () => {
  let t: Awaited<ReturnType<typeof testHost>>;
  afterEach(() => t?.close());

  const board = (h = t) => Deck.connect(h.base, { role: "board", key: "test-key" } as never);
  const ask = async (d: Deck, type: string, payload?: unknown) => (await d.request("store", type, payload)) as { type: string; payload: any };
  const changes = (d: Deck) => d.messages.filter((m) => (m.ch as string) === "store").map((m) => m.payload);
  async function play(gameId = "keeper", names = ["Ann"]) {
    const decks = [];
    for (const n of names) decks.push(await t.joinDeck(n));
    await t.ok("POST", "/game/select", { gameId });
    for (const d of decks) await d.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    return decks;
  }

  it("the board and a seated player's phone read and write; everyone hears of a change", async () => {
    t = await testHost({ gamesDir: GAMES });
    const b = await board();
    const [ann, ben] = await play("keeper", ["Ann", "Ben"]);
    expect(b.lastState()!.game).toMatchObject({ id: "keeper", storage: true });

    expect((await ask(b, "keys")).payload).toEqual({ gameId: "keeper", keys: [] });
    expect((await ask(b, "get", { key: "favourites" })).payload).toEqual({ gameId: "keeper", key: "favourites", value: null });
    expect((await ask(b, "set", { key: "favourites", value: ["board 1"] })).type).toBe("ack");
    expect((await ask(ann, "set", { key: "favourites", value: ["board 1", "phone 2"] })).type).toBe("ack");
    expect((await ask(ben, "get", { key: "favourites" })).payload.value).toEqual(["board 1", "phone 2"]);
    expect((await ask(ben, "keys")).payload.keys).toEqual(["favourites"]);
    for (const d of [b, ann, ben]) {
      await until(() => changes(d).length === 2);
      expect(changes(d)).toEqual([
        { gameId: "keeper", key: "favourites", value: ["board 1"] },
        { gameId: "keeper", key: "favourites", value: ["board 1", "phone 2"] },
      ]);
    }
    // Removing an entry: null.
    await ask(ann, "set", { key: "favourites", value: null });
    expect((await ask(b, "keys")).payload.keys).toEqual([]);
    // What is refused says why, and changes nothing.
    const refused = await ask(ann, "set", { key: "bad key", value: 1 });
    expect(refused).toMatchObject({ type: "error", payload: { status: 400 } });
    expect((await ask(b, "set", { key: "big", value: "x".repeat(50 * 1024) })).payload).toMatchObject({ status: 413 });
    // The rules never see the store: nothing of it is in the game's state or log.
    expect(JSON.stringify(t.host.table.runtime!.state)).not.toContain("phone 2");
    expect(JSON.stringify(t.host.table.runtime!.log)).not.toContain("phone 2");
  });

  it("only seated players and the table's board change it; a game without storage has none", async () => {
    t = await testHost({ gamesDir: GAMES });
    const b = await board();
    await play("keeper");
    expect(() => t.host.table.storeSet("favourites", [1], "nobody")).toThrow(/players with a seat/);
    expect(() => t.host.table.storeKeys("nobody")).toThrow(/players at the table/);
    await t.ok("POST", "/game/end");
    await t.ok("POST", "/game/close").catch(() => {});
    await t.ok("POST", "/game/select", { gameId: "forgetful" });
    expect(b.lastState()!.game).toMatchObject({ id: "forgetful", storage: false });
    expect((await ask(b, "set", { key: "favourites", value: [1] })).payload).toMatchObject({ status: 409, message: expect.stringMatching(/keeps no data/) });
    expect((await ask(b, "keys")).payload).toMatchObject({ status: 409 });
  });

  it("survives a restart of the table, display choices too", async () => {
    const dataDir = await tmp();
    t = await testHost({ gamesDir: GAMES, dataDir });
    const b = await board();
    await t.ok("POST", "/game/select", { gameId: "keeper" });
    await ask(b, "set", { key: "favourites", value: ["kept"] });
    await t.ok("POST", "/game/prefs", { prefs: { theme: "dark" } });
    await t.host.close();
    for (const d of t.decks) d.close();
    expect(JSON.parse(readFileSync(join(dataDir, "game-data", "keeper.json"), "utf8"))).toMatchObject({ data: { favourites: ["kept"] }, prefs: { theme: "dark" } });

    t = await testHost({ gamesDir: GAMES, dataDir });
    const again = await board();
    await t.ok("POST", "/game/select", { gameId: "keeper" });
    expect((await ask(again, "get", { key: "favourites" })).payload.value).toEqual(["kept"]);
    expect((await t.ok("GET", "/state")).game.prefs).toEqual({ theme: "dark" });
    // testHost removes the folder it made, not ours: the afterEach above does.
  });

  it("the Game data window: list, export, import and delete, for the table's board only", async () => {
    t = await testHost({ gamesDir: GAMES });
    const b = await board();
    expect((await t.ok("GET", "/game-data")).games).toEqual([]);
    await t.ok("POST", "/game/select", { gameId: "keeper" });
    await ask(b, "set", { key: "favourites", value: ["a", "b"] });
    await ask(b, "set", { key: "configs", value: { one: 1 } });
    await t.ok("POST", "/game/prefs", { prefs: { theme: "dark" } });

    const { games, limits } = await t.ok("GET", "/game-data");
    expect(limits).toEqual(GAME_DATA_LIMITS);
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ gameId: "keeper", gameName: "Keeper", gameVersion: "1.0.0", entries: 2, prefs: 1, installed: true, running: false });
    expect(games[0].bytes).toBeGreaterThan(20);
    expect(Date.parse(games[0].updatedAt)).not.toBeNaN();

    const file = await t.ok("GET", "/game-data/keeper");
    expect(file).toMatchObject({ format: 1, gameId: "keeper", tableName: "Game Table", data: { favourites: ["a", "b"], configs: { one: 1 } }, prefs: { theme: "dark" } });
    expect((await t.api("GET", "/game-data/forgetful")).status).toBe(404);
    expect((await t.api("GET", "/game-data", undefined, "wrong-key")).status).toBe(401);

    // Import: the board looks first, then replaces. A file for a game this table doesn't have is still kept.
    const edited = { ...file, data: { favourites: ["imported"] }, prefs: {} };
    expect(await t.ok("POST", "/game-data/inspect", { file: edited })).toMatchObject({ gameId: "keeper", gameName: "Keeper", installed: true, entries: 1, prefs: 0, now: { entries: 2, prefs: 1 } });
    expect((await ask(b, "get", { key: "favourites" })).payload.value).toEqual(["a", "b"]);
    const before = changes(b).length;
    expect((await t.ok("POST", "/game-data/import", { file: edited })).gameId).toBe("keeper");
    await until(() => changes(b).length > before);
    expect(changes(b).at(-1)).toEqual({ gameId: "keeper", reset: true });
    expect((await ask(b, "keys")).payload.keys).toEqual(["favourites"]);
    expect((await t.ok("GET", "/state")).game.prefs).toEqual({});
    const gone = { ...file, gameId: "gone-game", gameName: "Gone Game" };
    expect(await t.ok("POST", "/game-data/inspect", { file: gone })).toMatchObject({ gameId: "gone-game", gameName: "Gone Game", installed: false, now: null });
    await t.ok("POST", "/game-data/import", { file: gone });
    expect((await t.ok("GET", "/game-data")).games.map((g: any) => [g.gameId, g.installed])).toEqual([["gone-game", false], ["keeper", true]]);
    for (const bad of [{}, { file: null }, { file: { ...file, format: 9 } }, { file: "text" }]) expect((await t.api("POST", "/game-data/import", bad)).status).toBe(400);
    // A whole store of 256 KB comes back in.
    const full = { ...file, data: Object.fromEntries([0, 1, 2, 3, 4].map((i) => [`part${i}`, "x".repeat(45 * 1024)])) };
    expect((await t.api("POST", "/game-data/import", { file: full })).status).toBe(200);

    // While the game runs, its data is neither replaced nor removed; exporting is fine.
    const ann = await t.joinDeck("Ann");
    await ann.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    expect((await t.ok("GET", "/game-data")).games.find((g: any) => g.gameId === "keeper").running).toBe(true);
    expect((await t.api("DELETE", "/game-data/keeper")).status).toBe(409);
    expect((await t.api("POST", "/game-data/import", { file: edited })).body).toMatchObject({ code: "game-running" });
    expect((await t.api("GET", "/game-data/keeper")).status).toBe(200);
    expect((await t.api("DELETE", "/game-data/gone-game")).status).toBe(200); // another game's is
    await t.ok("POST", "/game/end");

    expect((await t.ok("DELETE", "/game-data/keeper")).games).toEqual([]);
    expect((await t.api("DELETE", "/game-data/keeper")).status).toBe(404);
    expect((await ask(b, "keys")).payload.keys).toEqual([]);
  });
});
