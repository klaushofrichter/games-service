// A player an AI took over from gets the seat back (D-222): the board exchanged Ann for an AI player ("Ann (AI)", D-159);
// Ann joining again with her name sits where she sat, as Ann, during the game and after it.
import { afterEach, describe, expect, it } from "vitest";
import { testHost } from "./helpers.ts";

let t: Awaited<ReturnType<typeof testHost>>;
afterEach(async () => {
  await t?.close();
});

const state = () => t.ok("GET", "/state");
const named = async (name: string) => (await state()).players.find((p: any) => p.name === name);

async function game() {
  t = await testHost();
  const ann = await t.joinDeck("Ann");
  const ben = await t.joinDeck("Ben");
  await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds: 3, roundSeconds: 0 } });
  await ann.request("lobby", "ready", { ready: true });
  await ben.request("lobby", "ready", { ready: true });
  await t.ok("POST", "/game/start");
  const seat = (await named("Ann")).seat;
  await t.ok("POST", "/exchange", { seat, kind: "ai" });
  expect((await named("Ann (AI)")).seat).toBe(seat);
  return seat;
}

describe("the seat back from the AI player that took it (D-222)", () => {
  it("during the game: Ann joins with her name and takes her seat from Ann (AI)", async () => {
    const seat = await game();
    await t.joinDeck("Ann");
    const s = await state();
    expect(s.phase).toBe("active");
    expect(s.players.find((p: any) => p.name === "Ann")).toMatchObject({ seat, kind: "human" });
    expect(s.players.some((p: any) => p.name === "Ann (AI)")).toBe(false);
  });

  it("after the game: the seat, the name and the colour come back", async () => {
    const seat = await game();
    const color = (await named("Ann (AI)")).color;
    await t.ok("POST", "/game/end");
    await t.joinDeck("ann");
    const s = await state();
    expect(s.players.find((p: any) => p.name === "ann")).toMatchObject({ seat, kind: "human", color });
    expect(s.players.some((p: any) => p.kind === "ai")).toBe(false);
  });

  it("someone with another name doesn't get it", async () => {
    const seat = await game();
    await t.ok("POST", "/game/end");
    await t.joinDeck("Cleo");
    const s = await state();
    expect((await named("Ann (AI)")).seat).toBe(seat);
    expect(s.players.find((p: any) => p.name === "Cleo").seat).not.toBe(seat);
  });
});
