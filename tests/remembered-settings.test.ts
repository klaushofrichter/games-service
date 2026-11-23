// A game begins with the settings it was last played with on this table (D-325): kept with the game's data, so they
// outlast the table's restart. What a game changes while it runs can be kept too (`remember` in its settings()).
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { testHost } from "./helpers.ts";

let t: Awaited<ReturnType<typeof testHost>> | undefined;
afterEach(async () => { await t?.close(); t = undefined; });

async function play(host: NonNullable<typeof t>, settings?: Record<string, unknown>) {
  const ann = await host.joinDeck("Ann");
  const ben = await host.joinDeck("Ben");
  await host.ok("POST", "/game/select", { gameId: "coin-flip", ...(settings ? { settings } : {}) });
  await ann.request("lobby", "ready", { ready: true });
  await ben.request("lobby", "ready", { ready: true });
  await host.ok("POST", "/game/start");
  const used = (await host.ok("GET", "/state")).game.settings;
  await host.ok("POST", "/game/end");
  return used;
}

describe("a game's settings on a table", () => {
  it("are those it was last played with, also after the table was started anew; what is given wins", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "gametable-kept-"));
    t = await testHost({ dataDir });
    const defaults = (await t.ok("POST", "/game/select", { gameId: "coin-flip" }), (await t.ok("GET", "/state")).game.settings);
    expect(defaults.rounds).not.toBe(2);
    // Choosing a game keeps nothing; playing it does.
    await t.ok("POST", "/game/settings", { settings: { rounds: 2 } });
    expect((await t.ok("GET", "/game-data/coin-flip").catch(() => null))?.settings).toBeUndefined();
    expect((await play(t, { rounds: 2, roundSeconds: 0 })).rounds).toBe(2);
    expect((await t.ok("GET", "/game-data/coin-flip")).settings).toMatchObject({ rounds: 2, roundSeconds: 0 });
    await t.close();

    t = await testHost({ dataDir });
    await t.ok("POST", "/game/select", { gameId: "coin-flip" });
    expect((await t.ok("GET", "/state")).game.settings).toMatchObject({ rounds: 2, roundSeconds: 0 });
    await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds: 4 } });
    expect((await t.ok("GET", "/state")).game.settings).toMatchObject({ rounds: 4, roundSeconds: 0 });
  });

  it("a setting the game changes while it runs is kept for the next game; one it does not have is refused", async () => {
    t = await testHost();
    await t.ok("POST", "/game/select", { gameId: "coin-flip" });
    await t.ok("POST", "/game/settings/remember", { settings: { rounds: 3 } });
    expect((await t.ok("GET", "/game-data/coin-flip")).settings.rounds).toBe(3);
    expect((await t.api("POST", "/game/settings/remember", { settings: { nonsense: 1 } })).status).toBe(400);
    expect((await t.api("POST", "/game/settings/remember", { settings: { rounds: -5 } })).status).toBe(400);
    await t.ok("POST", "/game/select", { gameId: "roulette" });
    await t.ok("POST", "/game/select", { gameId: "coin-flip" });
    expect((await t.ok("GET", "/state")).game.settings.rounds).toBe(3);
  });

  it("kept settings that fit the game no longer are let go, not in the way", async () => {
    t = await testHost();
    t.host.table["data"].setSettings({ id: "coin-flip", name: "Coin Flip", version: "0" }, { rounds: 99999, gone: true });
    await t.ok("POST", "/game/select", { gameId: "coin-flip" });
    expect((await t.ok("GET", "/state")).game.settings.rounds).toBeLessThan(99999);
  });
});
