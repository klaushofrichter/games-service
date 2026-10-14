// A fixture game in an extra-game repository's shape: it imports the SDK by name, which the table host maps.
import { defineGame, list } from "@game-table/sdk";

type S = { names: Record<number, string>; rolls: Record<number, number>; seats: number[] };

export default defineGame<S>({
  setup(ctx) {
    return { names: Object.fromEntries(ctx.seats.map((s) => [s.seat, s.name])), rolls: {}, seats: ctx.seats.map((s) => s.seat) };
  },
  onIntent(s, seat, intent, ctx) {
    if (intent.name !== "roll") return { reject: "roll is the only move" };
    if (s.rolls[seat]) return { reject: "you rolled already" };
    const n = ctx.randomInt(1, 6);
    return { state: { ...s, rolls: { ...s.rolls, [seat]: n } }, events: [{ name: "rolled", data: { seat, n } }] };
  },
  view(s, seat) {
    return { mine: s.rolls[seat] ?? null, rolls: s.rolls, names: s.names };
  },
  boardView(s) {
    return { rolls: s.rolls, names: s.names, seats: s.seats };
  },
  isOver(s) {
    if (!s.seats.every((x) => s.rolls[x])) return null;
    const top = Math.max(...Object.values(s.rolls));
    const winners = s.seats.filter((x) => s.rolls[x] === top).map((x) => s.names[x]);
    return { text: `${list(winners)} rolled ${top}.`, highlights: { winners, top } };
  },
  ai(view) {
    return (view as { mine: number | null }).mine ? null : { name: "roll" };
  },
});
