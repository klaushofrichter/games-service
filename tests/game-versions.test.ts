// D-127: scripts/check-game-versions.ts, run against throwaway git repositories: a game's version changes exactly when
// something in its folder does.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "..", "scripts", "check-game-versions.ts");
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll("-", ".");
let dir = "";

function repo(games: Record<string, { version: string; rules?: string }>) {
  dir = mkdtempSync(join(tmpdir(), "game-versions-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  for (const [id, g] of Object.entries(games)) write(id, g);
  git("add", "-A");
  git("commit", "-qm", "base");
  git("branch", "base");
  return git;
}
function write(id: string, g: { version: string; rules?: string; description?: string }) {
  mkdirSync(join(dir, "games", id), { recursive: true });
  writeFileSync(join(dir, "games", id, "manifest.json"), `${JSON.stringify({ id, name: id, version: g.version, description: g.description ?? "d" }, null, 2)}\n`);
  writeFileSync(join(dir, "games", id, "rules.ts"), g.rules ?? "export default {};\n");
}
function check(...extra: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, "--base", "base", ...extra], { cwd: dir, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const version = (id: string) => JSON.parse(readFileSync(join(dir, "games", id, "manifest.json"), "utf8")).version;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("game versions (D-127)", () => {
  it("passes when nothing changed, and when only things outside the game folders changed", () => {
    const git = repo({ chess: { version: "2026.01.02.1" } });
    expect(check().code).toBe(0);
    writeFileSync(join(dir, "lobby.ts"), "// a lobby change\n");
    git("add", "-A");
    git("commit", "-qm", "lobby");
    expect(check().code).toBe(0);
  });

  it("fails when a game's files changed without a new version, and --fix sets today's", () => {
    repo({ chess: { version: "2026.01.02.1" }, dice: { version: "2026.01.02.1" } });
    write("chess", { version: "2026.01.02.1", rules: "export default { changed: true };\n" });
    // A manifest formatted its own way (one line, arrays inline): --fix changes only the version's value.
    const compact = (v: string) => `{ "id": "chess", "name": "chess", "version": "${v}", "description": "d", "seatLayouts": [2, 4] }\n`;
    writeFileSync(join(dir, "games", "chess", "manifest.json"), compact("2026.01.02.1"));
    const r = check();
    expect(r.code).toBe(1);
    expect(r.out).toContain(`games/chess changed but its version is still 2026.01.02.1: set it to ${today}.1`);
    expect(r.out).not.toContain("games/dice");
    expect(check("--fix").code).toBe(0);
    expect(version("chess")).toBe(`${today}.1`);
    expect(readFileSync(join(dir, "games", "chess", "manifest.json"), "utf8")).toBe(compact(`${today}.1`));
    expect(version("dice")).toBe("2026.01.02.1"); // untouched game keeps its version

  });

  it("counts a manifest change other than the version as a game change", () => {
    repo({ chess: { version: "2026.01.02.1" } });
    write("chess", { version: "2026.01.02.1", description: "new words" });
    expect(check().out).toContain("changed but its version is still");
  });

  it("the second change on one day takes N + 1", () => {
    repo({ chess: { version: `${today}.1` } });
    write("chess", { version: `${today}.1`, rules: "// again\n" });
    expect(check("--fix").code).toBe(0);
    expect(version("chess")).toBe(`${today}.2`);
  });

  it("fails when a version changes although nothing else in the game did", () => {
    repo({ chess: { version: "2026.01.02.1" } });
    write("chess", { version: "2026.01.03.1" });
    expect(check().out).toContain("version changed from 2026.01.02.1 to 2026.01.03.1 although nothing else in the game changed");
  });

  it("fails on a version that does not go up, a malformed one, or one dated in the future", () => {
    repo({ chess: { version: "2026.01.02.3" } });
    write("chess", { version: "2026.01.02.2", rules: "// x\n" });
    expect(check().out).toContain("must be later than 2026.01.02.3");
    write("chess", { version: "1.2.0", rules: "// x\n" });
    expect(check().out).toContain('version "1.2.0" is not YYYY.MM.DD.N');
    write("chess", { version: "2026.02.30.1", rules: "// x\n" });
    expect(check().out).toContain("is not YYYY.MM.DD.N with a real date");
    write("chess", { version: "2999.01.01.1", rules: "// x\n" });
    expect(check().out).toContain("dated in the future");
  });

  it("accepts a new game with a calendar version, and the one-time switch from semver", () => {
    repo({ chess: { version: "0.2.0" } });
    write("chess", { version: "2026.01.02.1" }); // adoption: only the format changes
    write("dice", { version: "2026.01.02.1" });
    expect(check().code).toBe(0);
  });
});
