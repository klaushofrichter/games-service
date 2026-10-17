// Game versions (D-127): a game's version is a calendar version, YYYY.MM.DD.N, in its manifest. It changes exactly
// when the game changes: any file in its folder (rules, board and phone UI, styles, assets, rules for players, the
// manifest's other fields). Changes outside the folder (the lobby, the board kit, the SDK, the table host) never change
// a game's version; logs record the platform version separately.
//
// This check compares every game folder with a base (the branch a PR goes into) and fails when
//   - a game's files changed but its version did not, or did not go up;
//   - a game's version changed although nothing else in its folder did;
//   - a version is not YYYY.MM.DD.N with a real date that is not in the future (America/Chicago).
//
//   node scripts/check-game-versions.ts [--base origin/main] [--dir games] [--fix]
//
// --fix writes the next version (today, N one past today's last) into every changed game's manifest. Other game
// repositories run this file from their games-service checkout: node .games-service/scripts/check-game-versions.ts.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const dir = opt("--dir", "games");
const base = opt("--base", process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main");
const fix = args.includes("--fix");

const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const tryGit = (...a: string[]) => {
  try {
    return git(...a);
  } catch {
    return null;
  }
};

const CAL = /^(\d{4})\.(\d{2})\.(\d{2})\.([1-9]\d*)$/;
type Cal = [number, number, number, number];
function parseVersion(v: unknown): Cal | null {
  const m = CAL.exec(String(v));
  if (!m) return null;
  const [y, mo, d, n] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return [y, mo, d, n];
}
function cmp(a: Cal, b: Cal): number {
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
/** Today in America/Chicago, as [y, m, d]. */
function today(): [number, number, number] {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [y, m, d] = s.split("-").map(Number);
  return [y, m, d];
}
const fmt = ([y, m, d, n]: Cal) => `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")}.${n}`;
/** The version after `old` for a change made today. */
function nextVersion(old: Cal | null, now = today()): string {
  const same = old && old[0] === now[0] && old[1] === now[1] && old[2] === now[2];
  return fmt([...now, same ? old![3] + 1 : 1]);
}

const mergeBase = tryGit("merge-base", "HEAD", base);
if (!mergeBase) {
  console.error(`check-game-versions: no common history with ${base}; fetch it first (git fetch origin <branch>, full depth)`);
  process.exit(2);
}

const problems: string[] = [];
const fixed: string[] = [];
const now = today();
for (const id of readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
  const path = join(dir, id, "manifest.json");
  if (!existsSync(path)) continue;
  const head = JSON.parse(readFileSync(path, "utf8"));
  const oldText = tryGit("show", `${mergeBase}:${dir}/${id}/manifest.json`);
  const old = oldText ? JSON.parse(oldText) : null;
  // What changed in the folder, committed or not; the manifest counts only for fields other than its version.
  const files = (tryGit("diff", "--name-only", mergeBase, "--", join(dir, id)) ?? "").split("\n").filter(Boolean);
  const untracked = (tryGit("ls-files", "--others", "--exclude-standard", "--", join(dir, id)) ?? "").split("\n").filter(Boolean);
  const strip = (m: Record<string, unknown> | null) => (m ? JSON.stringify({ ...m, version: undefined }) : null);
  const changed = !old || [...files, ...untracked].some((f) => !f.endsWith(`${id}/manifest.json`)) || strip(head) !== strip(old);
  const v = parseVersion(head.version);
  const ov = old ? parseVersion(old.version) : null;
  const where = `${dir}/${id}`;
  const suggest = nextVersion(ov, now);

  if (changed && old && head.version === old.version) {
    if (fix) {
      head.version = suggest;
      writeFileSync(path, `${JSON.stringify(head, null, 2)}\n`);
      fixed.push(`${where}: ${old.version} → ${suggest}`);
      continue;
    }
    problems.push(`${where} changed but its version is still ${head.version}: set it to ${suggest}`);
    continue;
  }
  if (!v) {
    problems.push(`${where}: version "${head.version}" is not YYYY.MM.DD.N with a real date${changed ? `; use ${suggest}` : ""}`);
    continue;
  }
  if (cmp(v, [...now, Number.MAX_SAFE_INTEGER] as Cal) > 0) problems.push(`${where}: version ${head.version} is dated in the future`);
  if (!changed && old && head.version !== old.version && ov) problems.push(`${where}: version changed from ${old.version} to ${head.version} although nothing else in the game changed`);
  if (changed && ov && cmp(v, ov) <= 0) problems.push(`${where}: version ${head.version} must be later than ${old.version}; use ${suggest}`);
}

for (const f of fixed) console.log(`set ${f}`);
if (problems.length) {
  console.error(`Game versions (D-127) against ${base}:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  console.error(`\nRun node ${process.argv[1].replace(process.cwd() + "/", "")} --fix to set the versions of changed games.`);
  process.exit(1);
}
console.log(`game versions ok against ${base}${fixed.length ? ` (${fixed.length} set)` : ""}`);
