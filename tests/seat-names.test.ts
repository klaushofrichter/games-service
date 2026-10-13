// Compass names for seats (D-087): what players see instead of seat numbers.
import { describe, expect, it } from "vitest";
import { seatEdges } from "../packages/protocol/src/index.ts";
// @ts-expect-error plain browser module, no types
import { seatName, seatTitle } from "../apps/table-host/public/shared/board-kit.js";

const names = (layout: 2 | 4 | 6 | 8) => seatEdges(layout).map((_, i, e) => seatName(e, i));

describe("seat names", () => {
  it("names each seat by its place at the table, unique in every layout", () => {
    expect(names(2)).toEqual(["south", "north"]);
    expect(names(4)).toEqual(["south", "west", "north", "east"]);
    expect(names(6)).toEqual(["southwest", "southeast", "northeast", "northwest", "east", "west"]);
    expect(names(8)).toEqual(["southwest", "south", "southeast", "northeast", "north", "northwest", "east", "west"]);
    for (const l of [2, 4, 6, 8] as const) expect(new Set(names(l)).size).toBe(l);
  });

  it("gives a heading for the deck", () => {
    expect(seatTitle(seatEdges(6), 0)).toBe("Southwest seat");
    expect(seatTitle(seatEdges(4), 2)).toBe("North seat");
  });
});
