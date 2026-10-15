// The deck's seat badge is filled with the player's colour (D-101); its letters must stay readable on every colour.
import { describe, expect, it } from "vitest";
import { testHost, until } from "./helpers.ts";
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

  it("uses the player's colour from the table, else the seat's (D-106)", () => {
    expect(playerColor({ players: [{ id: "p1", seat: 2 }] }, 2)).toBe(SEAT_COLORS[2]);
    expect(playerColor({ players: [{ id: "p1", seat: 2, color: "#5fe0c8" }] }, 2)).toBe("#5fe0c8");
    expect(playerColor({ players: [{ id: "p1", seat: 2, color: "javascript:x" }] }, 2)).toBe(SEAT_COLORS[2]);
    expect(playerColor({ players: [] }, 5)).toBe(SEAT_COLORS[5]); // an empty seat
    // a game's prefs no longer carry colours
    expect(playerColor({ players: [{ id: "p1", seat: 2 }], prefs: { colors: { p1: "#5fe0c8" } } }, 2)).toBe(SEAT_COLORS[2]);
  });
});

describe("player colours on the table (D-106)", () => {
  const colorOf = (t: Awaited<ReturnType<typeof testHost>>, name: string) => t.host.table.state().players.find((p) => p.name === name)!.color;

  it("gives every seated player their seat's colour by default, all different", async () => {
    const t = await testHost();
    try {
      await t.joinDeck("Ann");
      await t.joinDeck("Ben");
      await t.ok("POST", "/ai", {});
      const st = t.host.table.state();
      for (const p of st.players) expect(p.color).toBe(SEAT_COLORS[p.seat!]);
      expect(new Set(st.players.map((p) => p.color)).size).toBe(3);
    } finally {
      await t.close();
    }
  });

  it("sets a colour from the palette and swaps with whoever had it", async () => {
    const t = await testHost();
    try {
      const ann = await t.joinDeck("Ann");
      await t.joinDeck("Ben");
      const ids = Object.fromEntries(t.host.table.state().players.map((p) => [p.name, p.id]));
      const benBefore = colorOf(t, "Ben");
      const annBefore = colorOf(t, "Ann");
      await t.ok("POST", `/players/${ids.Ann}/color`, { color: SEAT_COLORS[6] });
      expect(colorOf(t, "Ann")).toBe(SEAT_COLORS[6]);
      await t.ok("POST", `/players/${ids.Ben}/color`, { color: SEAT_COLORS[6].toUpperCase() });
      expect(colorOf(t, "Ben")).toBe(SEAT_COLORS[6]);
      expect(colorOf(t, "Ann")).toBe(benBefore); // swapped
      expect(annBefore).not.toBe(benBefore);
      // the phones hear about it
      await ann.waitState((s) => s.players.find((p) => p.name === "Ann")?.color === benBefore);
      // only palette colours, only seated players, only known players
      expect((await t.api("POST", `/players/${ids.Ann}/color`, { color: "#123456" })).status).toBe(400);
      expect((await t.api("POST", `/players/${ids.Ann}/color`, { color: "red" })).status).toBe(400);
      expect((await t.api("POST", `/players/nobody/color`, { color: SEAT_COLORS[0] })).status).toBe(404);
      expect((await t.api("POST", `/players/${ids.Ann}/color`, { color: SEAT_COLORS[0] }, "wrong-key")).status).toBe(401);
    } finally {
      await t.close();
    }
  });

  it("keeps a chosen colour when the player moves seat or a game starts, and frees it when they leave", async () => {
    const t = await testHost();
    try {
      const ann = await t.joinDeck("Ann");
      const ben = await t.joinDeck("Ben");
      const ids = Object.fromEntries(t.host.table.state().players.map((p) => [p.name, p.id]));
      await t.ok("POST", `/players/${ids.Ann}/color`, { color: SEAT_COLORS[4] });
      await t.ok("POST", "/seats/move", { playerId: ids.Ann, seat: 3 });
      expect(colorOf(t, "Ann")).toBe(SEAT_COLORS[4]);
      // a player who takes a seat whose colour is taken gets a free one
      await t.ok("POST", `/players/${ids.Ben}/color`, { color: SEAT_COLORS[3] }); // seat 3's colour, but Ann sits there now
      expect(colorOf(t, "Ben")).toBe(SEAT_COLORS[3]);
      expect(colorOf(t, "Ann")).toBe(SEAT_COLORS[4]);
      // in a game, the game's players carry the same colours
      await t.ok("POST", "/game/select", { gameId: "pachisi", settings: { turnSeconds: 0, tokens: 1 } });
      await ann.request("lobby", "ready", { ready: true });
      await ben.request("lobby", "ready", { ready: true });
      await t.ok("POST", "/game/start");
      expect(colorOf(t, "Ann")).toBe(SEAT_COLORS[4]);
      // changing a colour during a game is allowed (display only)
      await t.ok("POST", `/players/${ids.Ann}/color`, { color: SEAT_COLORS[7] });
      expect(colorOf(t, "Ann")).toBe(SEAT_COLORS[7]);
      await t.ok("POST", "/game/end", {});
      await t.ok("DELETE", `/players/${ids.Ann}`);
      const cleo = await t.joinDeck("Cleo");
      await until(() => t.host.table.state().players.find((p) => p.name === "Cleo")?.seat !== null);
      const c = colorOf(t, "Cleo");
      expect(c).toBe(SEAT_COLORS[t.host.table.state().players.find((p) => p.name === "Cleo")!.seat!]);
      cleo.close();
    } finally {
      await t.close();
    }
  });
});
