// The phones at the table rest with the board (D-328): the table's own board says when its screensaver starts and
// ends, and the lobby state carries it to the phones (the browser check `scripts/e2e/screensaver.py` follows a phone).
import { afterEach, describe, expect, it } from "vitest";
import { testHost } from "./helpers.ts";

let t: Awaited<ReturnType<typeof testHost>> | undefined;
afterEach(async () => { await t?.close(); t = undefined; });

describe("the board resting", () => {
  it("is told by the table's own board, and reaches the phones with the lobby state", async () => {
    t = await testHost();
    await t.joinDeck("Ann");
    expect((await t.ok("GET", "/state")).boardResting).toBeUndefined();
    await t.ok("POST", "/board/resting", { on: true });
    expect((await t.ok("GET", "/state")).boardResting).toBe(true);
    await t.ok("POST", "/board/resting", { on: false });
    expect((await t.ok("GET", "/state")).boardResting).toBeUndefined();
    // without the table key: refused
    expect((await t.api("POST", "/board/resting", { on: true }, "wrong")).status).toBe(401);
  });

  it("ends when the table's last own board goes", async () => {
    t = await testHost();
    t.host.table.setLocalBoard(true);
    await t.ok("POST", "/board/resting", { on: true });
    t.host.table.setLocalBoard(false);
    expect((await t.ok("GET", "/state")).boardResting).toBeUndefined();
  });
});
