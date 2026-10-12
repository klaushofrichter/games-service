// Many things at once: phones scanning the same code, parallel seat moves, double starts, a flood of
// simultaneous bets, and a game whose rules crash. The table must stay consistent through all of it.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deck, sleep, testHost } from "./helpers.ts";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});
async function host(o: Parameters<typeof testHost>[0] = {}) {
  const t = await testHost(o);
  cleanup.push(() => t.close());
  return t;
}

/** No two players on one seat, no seat outside the layout. */
function expectConsistentSeats(state: { layout: number; players: { seat: number | null }[] }) {
  const taken = state.players.map((p) => p.seat).filter((s): s is number => s !== null);
  expect(new Set(taken).size).toBe(taken.length);
  for (const s of taken) expect(s >= 0 && s < state.layout).toBe(true);
}

describe("concurrency", () => {
  it("lets exactly one of several phones that scanned the same code in; the others are told to scan again", async () => {
    const t = await host();
    const { token } = await t.ok("GET", "/join");
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => Deck.connect(t.base, { joinToken: token, name: `P${i}` })));
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    for (const r of results.filter((r) => r.status === "rejected")) expect(String((r as PromiseRejectedResult).reason)).toMatch(/scan the QR code again/);
    expect(t.host.table.state().players).toHaveLength(1);
    for (const r of ok) (r as PromiseFulfilledResult<Deck>).value.ws.close();
  });

  it("seats eight players joining one after another as fast as they can", async () => {
    const t = await host();
    await t.ok("POST", "/layout", { seats: 8 });
    const decks = [];
    for (let i = 0; i < 8; i++) decks.push(await t.joinDeck(`P${i}`));
    const st = t.host.table.state();
    expect(st.players.map((p) => p.seat).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expectConsistentSeats(st);
  });

  it("keeps seats consistent under a storm of parallel seat moves", async () => {
    const t = await host();
    await t.ok("POST", "/layout", { seats: 8 });
    for (let i = 0; i < 6; i++) await t.joinDeck(`P${i}`);
    const ids = t.host.table.state().players.map((p) => p.id);
    const moves = Array.from({ length: 60 }, (_, i) => t.api("POST", "/seats/move", { playerId: ids[i % ids.length], seat: (i * 5) % 8 }));
    const results = await Promise.all(moves);
    for (const r of results) expect([200, 409]).toContain(r.status);
    const st = t.host.table.state();
    expectConsistentSeats(st);
    expect(st.players.filter((p) => p.seat !== null)).toHaveLength(6); // nobody lost their seat
  });

  it("starts one game when start is pressed twice at once", async () => {
    const t = await host();
    const a = await t.joinDeck("A");
    await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds: 2, roundMs: 0 } });
    await a.request("lobby", "ready", { ready: true });
    const [r1, r2] = await Promise.all([t.api("POST", "/game/start"), t.api("POST", "/game/start")]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(t.host.table.phase).toBe("active");
  });

  it("accepts a flood of simultaneous bets without losing or double-counting any", async () => {
    const t = await host();
    await t.ok("POST", "/layout", { seats: 6 });
    const decks = [];
    for (let i = 0; i < 6; i++) decks.push(await t.joinDeck(`P${i}`));
    await t.ok("POST", "/game/select", { gameId: "roulette", settings: { rounds: 1, bettingSeconds: 60 } });
    await Promise.all(decks.map((d) => d.request("lobby", "ready", { ready: true })));
    await t.ok("POST", "/game/start");
    const rt = t.host.table.runtime!;
    const start = { ...(rt.state as any).balances };
    const BET = { type: "red", amount: 10 };
    // every deck fires 10 bets without waiting for answers
    const answers = await Promise.all(decks.flatMap((d) => Array.from({ length: 10 }, () => d.request("game", "intent", { name: "placeBet", payload: BET }))));
    const accepted = answers.filter((a) => a.type === "ack").length;
    expect(accepted + answers.filter((a) => a.type === "reject").length).toBe(60);
    expect(accepted).toBeGreaterThan(0);
    const s = rt.state as any;
    const staked = Object.values(s.bets as Record<string, { amount: number }[]>).reduce((sum, bets) => sum + bets.reduce((x, b) => x + b.amount, 0), 0);
    expect(staked).toBe(accepted * 10);
    // money only moved from balances to the table
    for (let i = 0; i < 6; i++) {
      const mine = (s.bets[i] ?? []).reduce((x: number, b: { amount: number }) => x + b.amount, 0);
      expect(s.balances[i] + mine).toBe(start[i]);
    }
    // and each deck's own view agrees
    await sleep(100);
    for (let i = 0; i < 6; i++) {
      const v = [...decks[i].messages].reverse().find((m) => m.type === "view")!.payload.view;
      expect(v.balance).toBe(s.balances[i]);
    }
  });

  it("survives a game whose rules crash: the move is refused, the table and the game go on", async () => {
    const dir = await mkdtemp(join(tmpdir(), "games-"));
    await cp(join(import.meta.dirname, "..", "games", "coin-flip"), join(dir, "coin-flip"), { recursive: true });
    await mkdir(join(dir, "crashy"));
    await writeFile(
      join(dir, "crashy", "manifest.json"),
      JSON.stringify({ id: "crashy", name: "Crashy", version: "1", sdk: "^0.1", players: { min: 1, max: 2 }, turnModel: "simultaneous", seatLayouts: [2, 4], edges: ["north", "south"] }),
    );
    await writeFile(
      join(dir, "crashy", "rules.js"),
      `export default {
        setup: () => ({ n: 0 }),
        onIntent(s, seat, i) {
          if (i.name === "boom") throw new Error("rules bug");
          if (i.name === "inc") return { state: { n: s.n + 1 } };
          return { reject: "unknown" };
        },
        view: (s) => s, boardView: (s) => s,
        isOver: (s) => (s.n >= 2 ? { text: "done" } : null),
      };\n`,
    );
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => errors.push(a);
    try {
      const t = await host({ gamesDir: dir });
      const a = await t.joinDeck("A");
      await t.ok("POST", "/game/select", { gameId: "crashy" });
      await a.request("lobby", "ready", { ready: true });
      await t.ok("POST", "/game/start");
      const boom = await a.request("game", "intent", { name: "boom" });
      expect(boom.type).toBe("error");
      expect(boom.payload.message).not.toMatch(/rules bug/); // internals stay on the table
      expect(t.host.table.phase).toBe("active");
      expect((await a.request("game", "intent", { name: "inc" })).type).toBe("ack");
      expect((await a.request("game", "intent", { name: "inc" })).type).toBe("ack");
      await sleep(50);
      expect(t.host.table.phase).toBe("finished");
      expect(errors.length).toBeGreaterThan(0); // logged for whoever maintains the game
    } finally {
      console.error = orig;
    }
  });
});
