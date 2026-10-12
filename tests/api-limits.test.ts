// The edges of the board control API: invalid input, caps, and the table staying responsive while
// it runs a long AI-only simulation.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testHost } from "./helpers.ts";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});
async function host(o: Parameters<typeof testHost>[0] = {}) {
  const t = await testHost(o);
  cleanup.push(() => t.close());
  return t;
}

describe("lobby API input", () => {
  it("refuses impossible layouts, rotations, seats and players", async () => {
    const t = await host();
    const a = await t.joinDeck("A");
    const id = t.host.table.state().players[0].id;
    const cases: [string, string, unknown, number[]][] = [
      ["POST", "/layout", { seats: 3 }, [400]],
      ["POST", "/layout", { seats: "four" }, [400]],
      ["POST", "/layout", {}, [400]],
      ["POST", "/rotate", { degrees: 45 }, [400]],
      ["POST", "/rotate", { degrees: -90 }, [400]],
      ["POST", "/seats/move", { playerId: id, seat: 99 }, [400, 409]],
      ["POST", "/seats/move", { playerId: id, seat: -1 }, [400, 409]],
      ["POST", "/seats/move", { playerId: "p_nobody", seat: 1 }, [404]],
      ["DELETE", "/players/p_nobody", undefined, [404]],
      ["POST", "/game/select", { gameId: "chess" }, [404]],
      ["POST", "/game/select", { gameId: "../roulette" }, [404]],
      ["POST", "/game/start", {}, [409]],
      ["POST", "/game/end", {}, [409]],
      ["POST", "/players/p_nobody/ai-options", { options: {} }, [404]],
    ];
    for (const [m, p, b, codes] of cases) {
      const r = await t.api(m, p, b);
      expect(codes, `${m} ${p} ${JSON.stringify(b)} → ${r.status} ${JSON.stringify(r.body)}`).toContain(r.status);
      expect(typeof r.body.error, `${m} ${p}`).toBe("string");
    }
    // none of that changed anything
    const st = t.host.table.state();
    expect(st.layout).toBe(4);
    expect(st.players.map((p) => [p.name, p.seat])).toEqual([["A", 0]]);
    a.ws.close();
  });

  it("caps AI seats at the layout and names them distinctly", async () => {
    const t = await host();
    await t.ok("POST", "/layout", { seats: 4 });
    const results = [];
    for (let i = 0; i < 6; i++) results.push((await t.api("POST", "/ai", {})).status);
    const ai = t.host.table.state().players.filter((p) => p.kind === "ai");
    expect(ai.filter((p) => p.seat !== null).length).toBeLessThanOrEqual(4);
    expect(new Set(ai.map((p) => p.name)).size).toBe(ai.length);
    expect(results.slice(0, 4)).toEqual([201, 201, 201, 201]);
    expect(results.slice(4), "an AI player without a free seat is refused, not parked").toEqual([409, 409]);
    expect(ai).toHaveLength(4);
  });
});

describe("simulation API", () => {
  it("validates the game, the player count and the settings", async () => {
    const t = await host();
    expect((await t.api("POST", "/simulation", { gameId: "chess", players: 2 })).status).toBe(404);
    expect((await t.api("POST", "/simulation", { gameId: "quartet", players: 4 })).status).toBe(409); // no AI
    for (const players of [0, 9, "two", null]) expect((await t.api("POST", "/simulation", { gameId: "pachisi", players })).status, String(players)).toBe(400);
    expect((await t.api("POST", "/simulation", { gameId: "pachisi", players: 2, settings: { tokens: 9 } })).status).toBe(400);
  });

  it("clamps the number of games and replaces unknown AI options with defaults", async () => {
    const t = await host();
    const few = await t.ok("POST", "/simulation", { gameId: "coin-flip", players: 1, games: -5, settings: { rounds: 1 } });
    expect(few.games).toHaveLength(1);
    const many = await t.ok("POST", "/simulation", { gameId: "coin-flip", players: 1, games: 5000, settings: { rounds: 1, roundMs: 0 } });
    expect(many.games).toHaveLength(1000);
    const odd = await t.ok("POST", "/simulation", { gameId: "pachisi", players: 2, games: 1, settings: { tokens: 1 }, aiOptions: { level: "godlike", extra: 1 } });
    expect(odd.games[0].aiOptions[0]).toEqual({ level: "average" });
  });

  it("stops a simulation of a game that can never finish, instead of hanging", async () => {
    const dir = await mkdtemp(join(tmpdir(), "games-"));
    await cp(join(import.meta.dirname, "..", "games", "coin-flip"), join(dir, "coin-flip"), { recursive: true });
    await mkdir(join(dir, "stuck"));
    await writeFile(
      join(dir, "stuck", "manifest.json"),
      JSON.stringify({
        id: "stuck", name: "Stuck", version: "1", sdk: "^0.1", players: { min: 2, max: 2 }, turnModel: "sequential",
        seatLayouts: [2, 4], edges: ["north", "south"], ai: { supported: true }, simulation: { supported: true, headless: true },
      }),
    );
    // the AI keeps proposing a move the rules always reject: no progress, no timers
    await writeFile(
      join(dir, "stuck", "rules.js"),
      `export default {
        setup: () => ({}), onIntent: () => ({ reject: "never" }), view: () => ({}), boardView: () => ({}),
        isOver: () => null, ai: () => ({ name: "try" }),
      };\n`,
    );
    const t = await host({ gamesDir: dir });
    const started = Date.now();
    const r = await t.ok("POST", "/simulation", { gameId: "stuck", players: 2, games: 3 });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(r.games.map((g: any) => g.reason)).toEqual(["terminated", "terminated", "terminated"]);
  });

  it("keeps the table responsive while a long simulation runs", async () => {
    const t = await host();
    let worst = 0;
    let running = true;
    const sim = t.ok("POST", "/simulation", { gameId: "holdem", players: 6, games: 250, seed: 7 }).finally(() => (running = false));
    while (running) {
      const at = Date.now();
      const r = await fetch(`${t.base}/health`);
      expect(r.status).toBe(200);
      worst = Math.max(worst, Date.now() - at);
      await new Promise((res) => setTimeout(res, 20));
    }
    const result = await sim;
    expect(result.games).toHaveLength(250);
    expect(worst, `slowest health answer during the simulation: ${worst} ms`).toBeLessThan(750);
  }, 120_000);
});
