// AI players at the board's pace (D-141): with the table's board connected, an AI moves only once the board has
// shown everything sent so far, or the board stayed silent for the timeout. No board, or pacing off: no waiting.
import { afterEach, describe, expect, it } from "vitest";
import { Deck, testHost, until } from "./helpers.ts";

let t: Awaited<ReturnType<typeof testHost>> | null = null;
const open: Deck[] = [];
afterEach(async () => {
  for (const d of open.splice(0)) d.close();
  await t?.close();
  t = null;
});

const aiMoves = () => t!.host.table.runtime!.log.filter((r) => r.t === "intent" && r.by === "ai").length;

async function start(o: Record<string, unknown>) {
  t = await testHost({ allowNoLocalPlayer: true, ...o });
  await t.ok("POST", "/ai", {});
  await t.ok("POST", "/ai", {});
  await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds: 3, roundSeconds: 0 } });
}

async function board(ack: boolean) {
  const b = await Deck.connect(t!.base, { role: "board", key: "test-key" } as never);
  open.push(b);
  if (ack)
    b.ws.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      if (m.ch === "game" && m.type === "board" && m.payload.seq) b.send("game", "idle", { seq: m.payload.seq });
    });
  return b;
}

describe("AI players at the board's pace", () => {
  it("wait for a board that has not shown the last move, until the timeout", async () => {
    await start({ boardPacing: true, boardPaceTimeoutMs: 600 });
    await board(false);
    await t!.ok("POST", "/game/start");
    await new Promise((r) => setTimeout(r, 300));
    expect(aiMoves()).toBe(0); // the board has not answered: nobody moves yet
    await until(() => aiMoves() > 0, 3000); // the board stayed silent: they go on after the timeout
  });

  it("go on as soon as the board has shown each move, and the game finishes", async () => {
    await start({ boardPacing: true, boardPaceTimeoutMs: 60_000 });
    await board(true);
    await t!.ok("POST", "/game/start");
    await until(() => t!.host.table.state().phase === "finished", 5000);
    expect(aiMoves()).toBe(6);
  });

  it("don't wait without a local board, or with pacing off", async () => {
    await start({ boardPacing: true, boardPaceTimeoutMs: 60_000 });
    await t!.ok("POST", "/game/start");
    await until(() => t!.host.table.state().phase === "finished", 5000);
    await t!.close();
    t = null;
    await start({ boardPacing: false, boardPaceTimeoutMs: 60_000 });
    await board(false);
    await t!.ok("POST", "/game/start");
    await until(() => t!.host.table.state().phase === "finished", 5000);
  });

  it("a board that goes away stops holding the game up", async () => {
    await start({ boardPacing: true, boardPaceTimeoutMs: 60_000 });
    const b = await board(false);
    await t!.ok("POST", "/game/start");
    await new Promise((r) => setTimeout(r, 200));
    expect(aiMoves()).toBe(0);
    b.close();
    await until(() => t!.host.table.state().phase === "finished", 5000);
  });

  it("a deck sees an AI player's move once the board has shown it; its own moves at once (D-143)", async () => {
    t = await testHost({ boardPacing: true, boardPaceTimeoutMs: 60_000 });
    const ann = await t.joinDeck("Ann");
    open.push(ann);
    await t.ok("POST", "/ai", {});
    await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds: 3, roundSeconds: 0 } });
    const b = await board(false);
    const seqs: number[] = [];
    b.ws.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      if (m.ch === "game" && m.type === "board" && m.payload.seq) seqs.push(m.payload.seq);
    });
    await ann.request("lobby", "ready", { ready: true });
    await t!.ok("POST", "/game/start");
    const views = () => ann.messages.filter((m) => m.ch === "game" && m.type === "view").length;
    await until(() => views() > 0 && seqs.length > 0);
    const before = views();
    b.send("game", "idle", { seq: seqs.at(-1) }); // the board has shown the start: the AI guesses
    await until(() => aiMoves() === 1);
    await until(() => seqs.length >= 2);
    await new Promise((r) => setTimeout(r, 150));
    expect(views()).toBe(before); // the board has not shown the AI's guess yet: the phone doesn't have it either
    b.send("game", "idle", { seq: seqs.at(-1) });
    await until(() => views() === before + 1);
    // Marked as shown on the board already, so a game's phone need not stage it again (D-157).
    expect(ann.messages.filter((m) => m.ch === "game" && m.type === "view").at(-1)!.payload.afterBoard).toBe(true);
    // Ann's own guess reaches her at once, whatever the board is doing.
    const r = await ann.request("game", "intent", { name: "guess", payload: "heads" });
    expect(r.type).toBe("ack");
    await until(() => views() === before + 2);
    expect(ann.messages.filter((m) => m.ch === "game" && m.type === "view").at(-1)!.payload.afterBoard).toBeUndefined();
    // The live status (D-157): the board's progress, the AI players, what each phone is held back.
    const d = await t!.ok("GET", "/debug");
    expect(d.pacing).toMatchObject({ on: true, localBoard: true });
    expect(Array.isArray(d.ai) && Array.isArray(d.decks) && Array.isArray(d.trace)).toBe(true);
    expect(d.trace.some((x: { what: string }) => /^moves: guess/.test(x.what))).toBe(true);
  });
});
