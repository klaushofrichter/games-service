// Hold'em: hand evaluation, betting rules, side pots, privacy of hole cards, AI simulation, host play.
import { beforeAll, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bestHand, compareScores, evaluate5, newDeck, shuffle } from "../packages/sdk/src/cards.ts";
import { createRng } from "../packages/sdk/src/index.ts";
import { legalActions, pot, type State } from "../games/holdem/rules.ts";
import { loadGame, start } from "./harness.ts";
import { runSimulation } from "../apps/table-host/src/simulation.ts";
import { LogStore } from "../apps/table-host/src/logs.ts";
import { replay } from "../apps/table-host/src/runtime.ts";
import { Deck, testHost } from "./helpers.ts";

let game: Awaited<ReturnType<typeof loadGame>>;
beforeAll(async () => {
  game = await loadGame("holdem");
});

const hand = (s: string) => s.split(" ");
const beats = (a: string, b: string) => compareScores(evaluate5(hand(a)), evaluate5(hand(b)));

describe("cards", () => {
  it("has 52 distinct cards and shuffles deterministically per seed", () => {
    expect(new Set(newDeck()).size).toBe(52);
    expect(shuffle(newDeck(), createRng(3))).toEqual(shuffle(newDeck(), createRng(3)));
    expect(shuffle(newDeck(), createRng(3))).not.toEqual(shuffle(newDeck(), createRng(4)));
  });

  it("ranks the hand categories in order", () => {
    const ladder = [
      "2c 7d 9h Jc Ks", // high card
      "2c 2d 9h Jc Ks", // pair
      "2c 2d 9h 9c Ks", // two pair
      "2c 2d 2h 9c Ks", // trips
      "5c 6d 7h 8c 9s", // straight
      "2c 7c 9c Jc Kc", // flush
      "2c 2d 2h 9c 9s", // full house
      "2c 2d 2h 2s 9s", // quads
      "5h 6h 7h 8h 9h", // straight flush
    ];
    ladder.forEach((h, i) => expect(evaluate5(hand(h))[0]).toBe(i));
    for (let i = 1; i < ladder.length; i++) expect(beats(ladder[i], ladder[i - 1])).toBeGreaterThan(0);
  });

  it("handles kickers, the wheel and ties", () => {
    expect(beats("Ac Ad 9h 7c 3s", "Ah As 9d 6c 4s")).toBeGreaterThan(0); // kicker 7 beats 6
    expect(beats("Ac 2d 3h 4c 5s", "2c 3d 4h 5c 6s")).toBeLessThan(0); // wheel is the lowest straight
    expect(evaluate5(hand("Ac 2d 3h 4c 5s"))).toEqual([4, 5]);
    expect(beats("Kc Kd 9h 9c 2s", "Kh Ks 9d 9s 2c")).toBe(0);
    expect(beats("9h 9s 9c 2c 2d", "8h 8s 8c Ac Ad")).toBeGreaterThan(0); // full houses compare the trips first
  });

  it("finds the best five of seven", () => {
    const h = bestHand(hand("Ah Kh 2c 3d Qh Jh Th"));
    expect(h.name).toBe("Straight flush");
    expect(h.score).toEqual([8, 14]);
    expect(bestHand(hand("2c 2d 5h 5s 9c 9d Ks")).score).toEqual([2, 9, 5, 13]);
  });
});

// Put a hand into a fixed position for rule tests.
function fixed(st: State, patch: Partial<State>): State {
  return { ...st, ...patch } as State;
}

describe("betting rules", () => {
  it("deals two private cards each and posts the blinds (heads-up: dealer is the small blind)", () => {
    const { rt, state } = start(game, 2, { turnSeconds: 0, startPoints: 100, smallBet: 10 });
    const s = state() as State;
    expect(Object.values(s.holes).every((h) => h.length === 2)).toBe(true);
    expect(s.deck).toHaveLength(48);
    expect(s.contrib[s.dealer]).toBe(5);
    expect(s.toAct).toBe(s.dealer);
    expect(pot(s)).toBe(15);
    // nobody sees anyone else's cards, the board view shows none
    const other = s.seats.find((x) => x !== s.dealer)!;
    expect(JSON.stringify(rt.view(s.dealer))).not.toContain(s.holes[other][0]);
    expect(JSON.stringify(rt.boardView())).not.toContain(s.holes[other][0]);
    expect(JSON.stringify(rt.boardView())).not.toContain(s.holes[s.dealer][1]);
  });

  it("gives the big blind an option, then deals the flop", () => {
    const { rt, state } = start(game, 3, { turnSeconds: 0 });
    let s = state() as State;
    const order = [s.toAct!];
    rt.submit(s.toAct!, { name: "call" }, "human");
    order.push(state().toAct);
    rt.submit(state().toAct, { name: "call" }, "human"); // small blind completes
    s = state();
    expect(s.street).toBe(0);
    expect(legalActions(s, s.toAct!)).toMatchObject({ check: true, fold: false });
    rt.submit(s.toAct!, { name: "check" }, "human"); // big blind checks his option
    expect(state().street).toBe(1);
    expect(state().board).toHaveLength(3);
    expect(new Set(order).size).toBe(2);
  });

  it("caps betting at four bets per street and doubles the bet size on the turn", () => {
    const { rt, state } = start(game, 2, { turnSeconds: 0, startPoints: 1000, smallBet: 10 });
    for (let i = 0; i < 3; i++) expect(rt.submit(state().toAct, { name: "raise" }, "human").ok).toBe(true);
    expect(rt.submit(state().toAct, { name: "raise" }, "human")).toMatchObject({ ok: false, reason: /capped/ });
    rt.submit(state().toAct, { name: "call" }, "human");
    expect(state().street).toBe(1);
    rt.submit(state().toAct, { name: "check" }, "human");
    rt.submit(state().toAct, { name: "check" }, "human");
    expect(state().street).toBe(2);
    const before = state().stacks[state().toAct];
    rt.submit(state().toAct, { name: "bet" }, "human");
    expect(before - state().stacks[state().lastAction.seat]).toBe(20);
  });

  it("awards the pot when everyone else folds, without showing cards", () => {
    const { rt, state, clock } = start(game, 3, { turnSeconds: 0, startPoints: 200 });
    rt.submit(state().toAct, { name: "fold" }, "human");
    rt.submit(state().toAct, { name: "fold" }, "human");
    const s = state() as State;
    expect(s.phase).toBe("handOver");
    expect(s.result!.byFold).toBe(true);
    expect(s.result!.shown).toEqual({});
    expect(Object.values(s.stacks).reduce((a, b) => a + b, 0)).toBe(600);
    clock.advance(); // next hand
    expect(state()).toMatchObject({ phase: "betting", hand: 2 });
  });

  it("shows down: the best hand wins, ties split", () => {
    const { rt, state } = start(game, 2, { turnSeconds: 0, startPoints: 100 });
    const base = state() as State;
    const [a, b] = base.seats;
    const common = { street: 3, currentBet: 0, roundBet: {}, bets: 0, contrib: { [a]: 20, [b]: 20 }, stacks: { [a]: 80, [b]: 80 }, inHand: [a, b], needToAct: [a, b], toAct: a } as Partial<State>;
    rt.state = fixed(base, { ...common, board: hand("2c 7d 9h Jc Ks"), holes: { [a]: hand("Ah Ad"), [b]: hand("Qh Qd") } });
    rt.submit(a, { name: "check" }, "human");
    rt.submit(b, { name: "check" }, "human");
    expect(state().result.winners).toEqual([{ seat: a, amount: 40, hand: "Pair" }]);
    expect(state().result.shown[b]).toEqual(["Qh", "Qd"]);
    rt.state = fixed(state(), { ...common, phase: "betting", board: hand("As Ks Qs Js Ts"), holes: { [a]: hand("2h 3d"), [b]: hand("4h 5d") } });
    rt.submit(a, { name: "check" }, "human");
    rt.submit(b, { name: "check" }, "human");
    expect(state().result.winners.map((w: any) => w.amount)).toEqual([20, 20]);
  });

  it("builds side pots for all-in players", () => {
    const { rt, state } = start(game, 3, { turnSeconds: 0, startPoints: 1000 });
    const base = state() as State;
    const [a, b, c] = base.seats;
    // a is all-in for 30 with the best hand; b and c each put 100 in; c beats b.
    rt.state = fixed(base, {
      street: 3, currentBet: 0, roundBet: {}, bets: 0, toAct: b, needToAct: [b, c], inHand: [a, b, c],
      contrib: { [a]: 30, [b]: 100, [c]: 100 }, stacks: { [a]: 0, [b]: 900, [c]: 900 }, allIn: { [a]: true },
      board: hand("2c 7d 9h Jc 3s"), holes: { [a]: hand("Ah Ad"), [b]: hand("4h 5d"), [c]: hand("Kh Kd") },
    });
    rt.submit(b, { name: "check" }, "human");
    rt.submit(c, { name: "check" }, "human");
    const won = Object.fromEntries(state().result.winners.map((w: any) => [w.seat, w.amount]));
    expect(won).toEqual({ [a]: 90, [c]: 140 });
    expect(Object.values(state().stacks).reduce((x: number, y: any) => x + y, 0)).toBe(1800 + 230); // stacks plus the pot, nothing lost
  });

  it("checks or folds for a player whose time runs out", () => {
    const { rt, clock, state } = start(game, 2, { turnSeconds: 5 });
    const first = state().toAct;
    clock.advance();
    expect(rt.log.at(-1)).toMatchObject({ t: "timer", id: "turn" });
    expect(state().phase).toBe("handOver"); // the small blind faced a bet, so the timeout folded
    expect(state().result.winners[0].seat).not.toBe(first);
  });

  it("continues when a player leaves mid-hand, and ends when one remains", () => {
    const { rt, state } = start(game, 3, { turnSeconds: 0 });
    const s = state() as State;
    const notActing = s.seats.find((x) => x !== s.toAct)!;
    const acting = s.toAct;
    expect(rt.seatLeft(notActing)).toBe(false);
    expect(state().toAct).toBe(acting); // the turn did not jump
    expect(rt.seatLeft(acting!)).toBe(true);
  });
});

describe("AI simulation", () => {
  it("never creates or loses points, finishes, and replays exactly, for 2 to 6 players", async () => {
    const logs = new LogStore(await mkdtemp(join(tmpdir(), "holdem-")));
    for (const n of [2, 3, 6]) {
      const r = await runSimulation({ ...game, dir: "" }, { players: n, games: 8, seed: n * 7, settings: { hands: 30, startPoints: 300, turnSeconds: 0 }, aiOptions: n === 3 ? [{ style: "tight" }, { style: "loose" }, { style: "tight" }] : { style: "loose" } }, logs, "t");
      expect(r.games.every((g) => g.reason === "finished")).toBe(true);
      const { games } = await LogStore.unzip((await logs.read(r.logId))!);
      for (const log of games) {
        const end = log.at(-1) as any;
        const stacks = Object.values(end.summary.highlights.stacks) as number[];
        expect(stacks.reduce((a, b) => a + b, 0)).toBe(n * 300);
        expect(replay(game.manifest, game.def, log)).toBe(end.stateHash);
      }
    }
  });
});

describe("through the table host", () => {
  it("keeps each player's cards on their own deck until showdown", async () => {
    const t = await testHost();
    try {
      const a = await t.joinDeck("Ann");
      const b = await t.joinDeck("Ben");
      await t.ok("POST", "/game/select", { gameId: "holdem", settings: { turnSeconds: 0, hands: 1, showdownSeconds: 2 } });
      await a.request("lobby", "ready", { ready: true });
      await b.request("lobby", "ready", { ready: true });
      await t.ok("POST", "/game/start");
      const va = await a.waitView((v) => v.view.myCards.length === 2);
      const vb = await b.waitView((v) => v.view.myCards.length === 2);
      const annCards: string[] = va.view.myCards;
      expect(vb.view.myCards).not.toEqual(annCards);
      // Both check/call down to the river.
      for (let i = 0; i < 20; i++) {
        const board = (await t.ok("GET", "/game/board")).view;
        if (board.phase !== "betting") break;
        const deck: Deck = board.toAct === va.seat ? a : b;
        const legal = (deck === a ? await a.waitView((v) => v.view.myTurn) : await b.waitView((v) => v.view.myTurn)).view.legal;
        await deck.request("game", "intent", { name: legal.check ? "check" : "call" });
      }
      // Before the showdown, Ben never received Ann's cards, and the board never did either.
      const shownAt = b.messages.findIndex((m) => m.ch === "game" && m.payload?.events?.some((e: any) => e.name === "showdown"));
      const before = JSON.stringify(b.messages.slice(0, shownAt));
      for (const c of annCards) expect(before).not.toContain(`"${c}"`);
      const final = await b.waitView((v) => v.view.result !== null);
      expect(final.view.result.shown[va.seat]).toEqual(annCards);
    } finally {
      await t.close();
    }
  });
});

describe("regressions from review", () => {
  it("gives the odd chip of a split pot to the first winner left of the dealer", () => {
    const { rt, state } = start(game, 3, { turnSeconds: 0, smallBet: 3 });
    const base = state() as State;
    const [a, b, c] = base.seats;
    rt.state = fixed(base, {
      dealer: a, street: 3, currentBet: 0, roundBet: {}, bets: 0, toAct: b, needToAct: [b, c], inHand: [a, b, c],
      contrib: { [a]: 3, [b]: 1, [c]: 3 }, stacks: { [a]: 100, [b]: 100, [c]: 100 },
      board: hand("As Ks Qs Js 2d"), holes: { [a]: hand("Th 3c"), [b]: hand("4c 5c"), [c]: hand("Td 3d") },
    });
    rt.submit(b, { name: "check" }, "human");
    rt.submit(c, { name: "check" }, "human");
    rt.submit(a, { name: "check" }, "human");
    const won = Object.fromEntries(state().result.winners.map((w: any) => [w.seat, w.amount]));
    // pot of 7: a (dealer) and c tie with a royal flush; b only matched 1. c sits left of the dealer.
    expect(won[c]).toBeGreaterThan(won[a]);
    expect(won[a] + won[c] + (won[b] ?? 0)).toBe(7);
  });

  it("treats a short all-in as a call that does not reopen betting", () => {
    const { rt, state } = start(game, 3, { turnSeconds: 0, smallBet: 10 });
    const s0 = state() as State;
    const [utg, sb] = [s0.toAct!, s0.seats.find((x) => x !== s0.toAct && x !== s0.dealer)!];
    rt.state = fixed(s0, { stacks: { ...s0.stacks, [sb]: 7 } });
    rt.submit(utg, { name: "call" }, "human");
    expect(state().toAct).toBe(sb);
    rt.submit(sb, { name: "raise" }, "human"); // all-in for 5 + 7 = 12, only 2 over the bet
    const s = state() as State;
    expect(s.bets).toBe(1);
    expect(s.currentBet).toBe(12);
    expect(s.needToAct).not.toContain(sb);
    expect(legalActions(s, s.toAct!)?.call).toBe(2);
  });

  it("passes the turn to the next seat after a player who leaves on their turn", () => {
    const { rt, state } = start(game, 4, { turnSeconds: 0, startPoints: 1000 });
    const s0 = state() as State;
    const leaver = s0.toAct!;
    const order = s0.seats;
    const expected = order[(order.indexOf(leaver) + 1) % order.length];
    rt.seatLeft(leaver);
    expect(state().toAct).toBe(expected);
  });

  it("never names a player who left as the winner", () => {
    const { rt, state } = start(game, 3, { turnSeconds: 0 });
    rt.state = fixed(state(), { stacks: { 0: 100, 1: 100, 2: 5000 } });
    rt.seatLeft(2);
    rt.seatLeft(1);
    expect(rt.summary?.text).not.toMatch(/Cleo/);
  });
});
