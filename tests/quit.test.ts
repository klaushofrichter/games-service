// Quit the table from its own board (D-315): only a table started to allow it (TABLE_QUIT=1, as the packages' starter
// does), where the browser may show nothing but the board and a page cannot close it.
import { afterEach, describe, expect, it } from "vitest";
import { testHost, until } from "./helpers.ts";

let t: Awaited<ReturnType<typeof testHost>>;
afterEach(async () => t?.close());

describe("quit the table from its board (D-315)", () => {
  it("a table not started for it can't be quit, and its state does not offer it", async () => {
    t = await testHost();
    expect((await t.ok("GET", "/state")).canQuit).toBeUndefined();
    const r = await t.api("POST", "/quit");
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/can't be quit from its board/);
  });

  it("a table started for it says so, answers first, then ends; only with the table's key", async () => {
    let quit = 0;
    t = await testHost({ onQuit: () => void quit++ });
    expect((await t.ok("GET", "/state")).canQuit).toBe(true);
    expect((await t.api("POST", "/quit", undefined, "wrong-key")).status).toBe(401);
    expect(quit).toBe(0);
    expect((await t.api("POST", "/quit")).body).toEqual({ ok: true, quitting: true });
    expect(quit).toBe(0); // (the answer is out before the table goes)
    await until(() => quit === 1);
  });
});
