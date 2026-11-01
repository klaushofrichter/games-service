// Where a local table's games come from (D-251): the git checkouts of their folders, with branch and commit.
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkoutsOf } from "../apps/table-host/src/checkouts.ts";
import type { InstalledGame } from "../apps/table-host/src/games.ts";

const game = (id: string, dir: string, source?: InstalledGame["source"]) =>
  [id, { manifest: { id }, dir, ...(source ? { source } : {}) } as unknown as InstalledGame] as const;

describe("a local table's checkouts (D-251)", () => {
  it("names this repository's checkout once, with its branch and commit, for every game in it", async () => {
    const games = new Map([game("coin-flip", resolve("games/coin-flip")), game("pachisi", resolve("games/pachisi"))]);
    const list = await checkoutsOf(games);
    expect(list).toHaveLength(1);
    expect(list[0].games).toEqual(["coin-flip", "pachisi"]);
    expect(list[0].branch).not.toBe("");
    expect(list[0].commit).toMatch(/^[0-9a-f]{4,}$/);
    expect(typeof list[0].changed).toBe("boolean");
  });

  it("leaves out games the service delivered and folders outside any checkout", async () => {
    const outside = await mkdtemp(join(tmpdir(), "no-checkout-"));
    await mkdir(join(outside, "dice"));
    await writeFile(join(outside, "dice", "manifest.json"), "{}");
    const games = new Map([
      game("dice", join(outside, "dice")),
      game("coin-flip", resolve("games/coin-flip"), { repo: "someone/games", commit: "abc", hash: "h" } as InstalledGame["source"]),
    ]);
    expect(await checkoutsOf(games)).toEqual([]);
  });
});
