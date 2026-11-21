// The packages' starter (scripts/package/launch.ts): `--repos all` (D-314) finds the game repositories instead of
// being told them. The starter as a whole is checked by the packages' workflow, on clean computers.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allGameRepos, downloadedGameRepos } from "../scripts/package/launch.ts";

afterEach(() => vi.unstubAllGlobals());
const repo = (full: string, extra: Record<string, unknown> = {}) => ({ full_name: full, name: full.split("/")[1], owner: { login: full.split("/")[0] }, ...extra });

describe("the starter's --repos all", () => {
  it("takes the owner's repositories named …-game or …-games that the sign-in can read, without the public ones the table has anyway", async () => {
    const asked: { url: string; auth: string | null }[] = [];
    const pages = [
      [...Array.from({ length: 97 }, (_, i) => repo(`klaushofrichter/notes-${i}`)), repo("klaushofrichter/traders-game"), repo("klaushofrichter/extra-games"), repo("someone-else/other-game")],
      [repo("klaushofrichter/loopy-game"), repo("klaushofrichter/old-game", { archived: true }), repo("KlausHofrichter/ge150pro-game"), repo("klaushofrichter/games-service"), repo("klaushofrichter/gameplan")],
    ];
    vi.stubGlobal("fetch", async (url: string, init: { headers: Record<string, string> }) => {
      asked.push({ url, auth: init.headers.Authorization ?? null });
      const page = Number(new URL(url).searchParams.get("page"));
      return new Response(JSON.stringify(pages[page - 1] ?? []), { status: 200 });
    });
    expect(await allGameRepos("tok")).toEqual(["KlausHofrichter/ge150pro-game", "klaushofrichter/loopy-game", "klaushofrichter/traders-game"]);
    expect(asked.map((a) => new URL(a.url).searchParams.get("page"))).toEqual(["1", "2"]); // a short page is the last
    expect(asked.every((a) => a.auth === "Bearer tok" && a.url.startsWith("https://api.github.com/user/repos?"))).toBe(true);
  });

  it("says so when GitHub refuses, so the starter can fall back on what it has", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
    await expect(allGameRepos("bad")).rejects.toThrow(/401/);
  });

  it("without the network: the game repositories downloaded before", async () => {
    const dir = mkdtempSync(join(tmpdir(), "starter-repos-"));
    for (const [name, games] of [["traders-game", true], ["loopy-game", true], ["half-game", false], ["notes", true], ["extra-games", true]] as const) {
      mkdirSync(join(dir, "klaushofrichter", name, games ? "games" : "other"), { recursive: true });
    }
    writeFileSync(join(dir, "klaushofrichter", "traders-game.json"), "{}");
    expect(await downloadedGameRepos(dir)).toEqual(["klaushofrichter/loopy-game", "klaushofrichter/traders-game"]);
    expect(await downloadedGameRepos(join(dir, "nothing-here"))).toEqual([]);
  });
});
