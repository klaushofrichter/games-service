// Card Sling: an EXPERIMENT for card animations (games-service experiment/card-sling), not a game to ship. Everyone
// holds UNO-like cards and may play any card onto the pile at any time, or draw one; there are no matching rules and
// no winner. AI players take turns, one every few seconds, so their cards fly in from their seats too.
import { defineGame, type GameContext } from "../../packages/sdk/src/index.ts";

export const COLORS = ["red", "yellow", "green", "blue"] as const;
export interface Card {
  id: number;
  color: (typeof COLORS)[number];
  value: number;
}
interface Pile extends Card {
  /** Angle on the pile, in degrees, and a small offset: picked when the card lands, so the pile looks thrown. */
  angle: number;
  dx: number;
  dy: number;
  seat: number;
}
interface State {
  seats: number[];
  names: Record<number, string>;
  hands: Record<number, Card[]>;
  pile: Pile[];
  nextId: number;
  /** The seat whose turn it is for AI players; people play whenever they like. */
  aiTurn: number;
  lastAi: number;
  aiMs: number;
  played: number;
  plays: number;
}

const HAND = 7;
const MAX_HAND = 12;
const SHOWN = 10; // pile cards kept for the board

function deal(state: State, ctx: GameContext): Card {
  const card: Card = { id: state.nextId, color: COLORS[ctx.randomInt(0, 3)], value: ctx.randomInt(0, 9) };
  state.nextId += 1;
  return card;
}

function nextAiTurn(state: State, ctx: GameContext): State {
  const i = Math.max(0, state.seats.indexOf(state.lastAi));
  const aiTurn = state.seats[(i + 1) % state.seats.length];
  ctx.setTimer("ai", state.aiMs);
  return { ...state, aiTurn, lastAi: aiTurn };
}

export default defineGame<State>({
  setup(ctx, settings) {
    const seats = ctx.seats.map((s) => s.seat);
    const state: State = {
      seats,
      names: Object.fromEntries(ctx.seats.map((s) => [s.seat, s.name])),
      hands: {},
      pile: [],
      nextId: 1,
      aiTurn: -1,
      lastAi: seats.at(-1)!,
      aiMs: Number(settings.aiSeconds ?? 3) * 1000,
      played: 0,
      plays: Number(settings.plays ?? 100),
    };
    for (const s of seats) state.hands[s] = Array.from({ length: HAND }, () => deal(state, ctx));
    ctx.setTimer("ai", state.aiMs);
    return state;
  },

  onIntent(state, seat, intent, ctx) {
    if (state.played >= state.plays) return { reject: "The game is over" };
    const hand = state.hands[seat];
    if (!hand) return { reject: "You are not playing" };
    if (intent.name === "play") {
      const id = Number((intent.payload as { id?: unknown })?.id);
      const card = hand.find((c) => c.id === id);
      if (!card) return { reject: "That card is not in your hand" };
      const landed: Pile = { ...card, seat, angle: ctx.randomInt(-25, 25), dx: ctx.randomInt(-18, 18), dy: ctx.randomInt(-18, 18) };
      let next: State = { ...state, hands: { ...state.hands, [seat]: hand.filter((c) => c.id !== id) }, pile: [...state.pile, landed].slice(-SHOWN), played: state.played + 1 };
      // A player with an empty hand gets a fresh one, so the experiment goes on.
      if (!next.hands[seat].length) {
        const copy = { ...next, hands: { ...next.hands } };
        copy.hands[seat] = Array.from({ length: HAND }, () => deal(copy, ctx));
        next = copy;
      }
      if (seat === next.aiTurn) next = { ...next, aiTurn: -1 }; // one move per AI turn
      return { state: next, events: [{ name: "played", data: { seat, card: landed } }] };
    }
    if (intent.name === "draw") {
      if (hand.length >= MAX_HAND) return { reject: `${MAX_HAND} cards are enough` };
      const next = { ...state, hands: { ...state.hands } };
      const card = deal(next, ctx);
      next.hands[seat] = [...hand, card];
      if (seat === next.aiTurn) next.aiTurn = -1;
      return { state: next, events: [{ name: "drew", data: { seat } }] };
    }
    return { reject: `unknown intent ${intent.name}` };
  },

  onTimer(state, id, ctx) {
    if (id !== "ai" || state.played >= state.plays) return { state };
    return { state: nextAiTurn(state, ctx) };
  },

  onSeatChanged(state, seat) {
    return { state: { ...state, names: { ...state.names, [seat.seat]: seat.name } } };
  },

  view(state, seat) {
    return {
      hand: state.hands[seat] ?? [],
      top: state.pile.at(-1) ?? null,
      played: state.played,
      plays: state.plays,
      aiTurn: state.aiTurn === seat,
      canDraw: (state.hands[seat]?.length ?? MAX_HAND) < MAX_HAND,
    };
  },

  boardView(state) {
    return {
      pile: state.pile,
      counts: Object.fromEntries(state.seats.map((s) => [s, state.hands[s]?.length ?? 0])),
      played: state.played,
      plays: state.plays,
    };
  },

  isOver(state) {
    if (state.played < state.plays) return null;
    return { text: `${state.played} cards slung. The experiment is over.`, highlights: { played: state.played } };
  },

  // An AI player on its turn: plays a random card, or draws when it holds few.
  ai(view, _seat, ctx) {
    const v = view as { hand: Card[]; aiTurn: boolean; canDraw: boolean; played: number; plays: number };
    if (!v.aiTurn || v.played >= v.plays) return null;
    if (v.hand.length <= 3 && v.canDraw && ctx.random() < 0.6) return { name: "draw", payload: null };
    return { name: "play", payload: { id: v.hand[ctx.randomInt(0, v.hand.length - 1)].id } };
  },
});
