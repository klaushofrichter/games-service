// The deck's seat badge is filled with the player's colour (D-101); its letters must stay readable on every colour.
import { describe, expect, it } from "vitest";
// @ts-expect-error plain browser module without type declarations
import { INK_DARK, INK_LIGHT, SEAT_COLORS, contrast, inkOn, playerColor } from "../apps/table-host/public/shared/board-kit.js";

describe("player colour on the deck badge", () => {
  it("computes WCAG contrast ratios", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#777777")).toBeCloseTo(1, 5);
  });

  it("every seat colour (also Pachisi's swatches) gets letters with at least 4.5:1 contrast", () => {
    for (const c of SEAT_COLORS) expect(contrast(c, inkOn(c)), c).toBeGreaterThanOrEqual(4.5);
  });

  it("picks the ink that reads better: light letters on dark colours, dark on light", () => {
    expect(inkOn("#ffffff")).toBe(INK_DARK);
    expect(inkOn("#e8e15f")).toBe(INK_DARK);
    expect(inkOn("#1a237e")).toBe(INK_LIGHT);
    expect(inkOn("#000000")).toBe(INK_LIGHT);
  });

  it("uses the game's chosen colour over the seat's", () => {
    const players = [{ id: "p1", seat: 2 }];
    expect(playerColor({ players, prefs: {} }, 2)).toBe(SEAT_COLORS[2]);
    expect(playerColor({ players, prefs: { colors: { p1: "#5fe0c8" } } }, 2)).toBe("#5fe0c8");
  });
});
