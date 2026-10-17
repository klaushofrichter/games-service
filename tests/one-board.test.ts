// One board window at the table PC (D-132): a second window is told the board is elsewhere and gets nothing, until it
// takes over; the same tab coming back (a reload, a dropped connection) gets the board at once; remote boards are free.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Deck, testHost, until } from "./helpers.ts";

type Host = Awaited<ReturnType<typeof testHost>>;
let t: Host;
const open: Deck[] = [];
const board = async (hello: Record<string, unknown>) => {
  const d = await Deck.connect(t.base, { role: "board", key: "test-key", ...hello } as never);
  open.push(d);
  return d;
};

beforeEach(async () => {
  t = await testHost();
});
afterEach(async () => {
  for (const d of open.splice(0)) d.close();
  await t.close();
});

describe("one board window", () => {
  it("a second window is told the board is elsewhere, and gets no state", async () => {
    const first = await board({ tab: "tab-a" });
    expect(first.answer).toBe("welcome");
    const second = await board({ tab: "tab-b" });
    expect(second.answer).toBe("elsewhere");
    await t.ok("POST", "/ai", {});
    await until(() => first.messages.filter((m) => m.ch === "lobby" && m.type === "state").length >= 2);
    expect(second.messages.some((m) => m.ch === "lobby")).toBe(false);
    expect(first.closeCode).toBeNull();
  });

  it("says which game runs in the other window", async () => {
    await board({ tab: "tab-a" });
    const ann = await t.joinDeck("Ann");
    await t.ok("POST", "/ai", {});
    await t.ok("POST", "/game/select", { gameId: "pachisi", settings: { turnSeconds: 0 } });
    await ann.request("lobby", "ready", { ready: true });
    await t.ok("POST", "/game/start");
    const second = await board({ tab: "tab-b" });
    const msg = second.messages.find((m) => m.type === "elsewhere")!;
    expect(msg.payload.phase).toBe("active");
    expect(msg.payload.game).toBeTruthy();
    ann.close();
  });

  it("taking over moves the board: the old window is told and closed", async () => {
    const first = await board({ tab: "tab-a" });
    const second = await board({ tab: "tab-b", takeover: true });
    expect(second.answer).toBe("welcome");
    await until(() => first.closeCode === 4009);
    expect(first.messages.some((m) => m.ch === "system" && m.type === "replaced")).toBe(true);
    await t.ok("POST", "/ai", {});
    await until(() => second.messages.some((m) => m.ch === "lobby" && m.type === "state" && m.payload.players.length === 1));
  });

  it("the same tab coming back gets the board at once", async () => {
    const first = await board({ tab: "tab-a" });
    const again = await board({ tab: "tab-a" }); // a reload whose old socket the host still counts as open
    expect(again.answer).toBe("welcome");
    await until(() => first.closeCode === 4009);
  });

  it("a board that no longer answers (a dead connection) does not count", async () => {
    const first = await board({ tab: "tab-a" });
    (first.ws as unknown as { _socket: { pause(): void } })._socket.pause(); // reads nothing, so no pong
    const next = await board({ tab: "tab-b" });
    expect(next.answer).toBe("welcome");
  });

  it("a board that closed frees the table for the next window", async () => {
    const first = await board({ tab: "tab-a" });
    first.close();
    await until(() => first.closeCode !== null);
    await new Promise((r) => setTimeout(r, 50));
    const next = await board({ tab: "tab-b" });
    expect(next.answer).toBe("welcome");
  });
});
