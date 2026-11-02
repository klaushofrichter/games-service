// Starts a Game Table from an installed package (D-256): Windows, macOS and Linux alike. The package brings Node.js and
// games-service's runtime (the table host, the SDK, the built-in games, the runtime packages); this launcher copies that
// runtime into the user's own folder, downloads extra-games and the private game repositories the user names (with
// the GitHub CLI's sign-in), puts all games in one folder and starts the table host without the Game Table service.
// With --service it joins the service instead (remote players; approval in the console or an access code, D-113).
//
//   game-table [--repos "a b" | --repos none] [--no-update] [--port 8080] [--no-open] [--branch production]
//              [--sign-in] [--service [--code ABCD-EFGH]] [--home DIR] [--smoke-test --expect-games a,b]
//
// No npm packages beyond games-service's own runtime ones, no git: repositories come as tarballs of their branch.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createSocket } from "node:dgram";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, platform as osPlatform, arch as osArch } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import JSZip from "jszip";
import { readTarGz } from "../../packages/protocol/src/bundle.ts";

const OWNER = "klaushofrichter";
const PUBLIC_REPOS = [`${OWNER}/extra-games`];
const SERVICE_URL = "https://games.skylar.technology";
const CONSOLE_URL = "https://games-console.skylar.technology";
const UA = { "User-Agent": "game-table-launcher" };
/** Repositories anyone can see: games.json links them; private ones are named only. */
const PUBLIC_LINKS: Record<string, string> = {
  "games-service": `https://github.com/${OWNER}/games-service`,
  [`${OWNER}/extra-games`]: `https://github.com/${OWNER}/extra-games`,
};

/** Where a downloaded repository's games came from: <reposDir>/<name>.json. */
interface Download {
  repository: string;
  branch: string;
  commit: string;
  downloaded: string;
}

const isWin = osPlatform() === "win32";
const isMac = osPlatform() === "darwin";
/** The runtime this launcher came with: <runtime>/scripts/package/launch.ts. */
const bundled = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// --- Options -----------------------------------------------------------------------------------------------------
interface Options {
  repos?: string;
  noUpdate: boolean;
  port: number;
  open: boolean;
  branch: string;
  signIn: boolean;
  service: boolean;
  code?: string;
  home?: string;
  smokeTest: boolean;
  expectGames: string[];
  showVersion?: boolean;
}

function parseArgs(argv: string[]): Options {
  const o: Options = { noUpdate: false, port: 8080, open: true, branch: "production", signIn: false, service: false, smokeTest: false, expectGames: [] };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].includes("=") ? [argv[i].slice(0, argv[i].indexOf("=")), argv[i].slice(argv[i].indexOf("=") + 1)] : [argv[i], undefined];
    const value = () => {
      if (inline !== undefined) return inline;
      if (i + 1 >= argv.length) fail(`${flag} needs a value`);
      return argv[++i];
    };
    // Windows' starter passes PowerShell-style names too (-NoUpdate): one spelling for every platform's docs.
    switch (flag.replace(/^-+/, "").toLowerCase().replace(/-/g, "")) {
      case "repos": o.repos = value(); break;
      case "noupdate": o.noUpdate = true; break;
      case "port": o.port = Number(value()); break;
      case "noopen": o.open = false; break;
      case "branch": o.branch = value(); break;
      case "signin": o.signIn = true; break;
      case "service": o.service = true; break;
      case "code": o.code = value(); o.service = true; break;
      case "home": o.home = value(); break;
      case "version": case "v": o.showVersion = true; break;
      case "smoketest": o.smokeTest = true; o.open = false; break;
      case "expectgames": o.expectGames = value().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "help": case "h": case "?":
        console.log(readmeText());
        process.exit(0);
      default: fail(`unknown option ${argv[i]} (see --help)`);
    }
  }
  if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) fail("--port needs a port number");
  if (!/^[A-Za-z0-9._/-]+$/.test(o.branch)) fail("--branch needs a branch name");
  return o;
}

function readmeText() {
  return [
    "Game Table on this computer (D-256)",
    "  --repos \"a b\"     the private game repositories (owner/name or name), without asking; --repos none: none",
    "  --no-update       start what was downloaded last time",
    "  --port 8081       another port (default 8080)",
    "  --no-open         don't open the board in the browser",
    "  --branch main     another branch of the game repositories (default production)",
    "  --sign-in         download the public repositories with your GitHub sign-in too",
    "  --service         join the Game Table service (remote players); approve the table in the console",
    "  --code ABCD-EFGH  join the service with an access code from the console",
    "  --home DIR        another folder for downloads and data",
    "  --version         the package's version and the games on the table (MANIFEST.json, games.json)",
  ].join("\n");
}

function say(text = "") { console.log(text); }
function note(text: string) { console.log(`\x1b[33m${text}\x1b[0m`); }
function fail(text: string): never {
  console.error(`\n\x1b[31m${text}\x1b[0m`);
  process.exit(1);
}

// --- Where things live -------------------------------------------------------------------------------------------
function defaultHome(): string {
  if (isWin) return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "GameTable");
  if (isMac) return join(homedir(), "Library", "Application Support", "Game Table");
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "game-table");
}

// --- Downloads ---------------------------------------------------------------------------------------------------
async function get(url: string, headers: Record<string, string> = {}): Promise<Buffer> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { ...UA, ...headers }, redirect: "follow" });
      if (r.status === 401 || r.status === 403 || r.status === 404) throw Object.assign(new Error(`HTTP ${r.status}`), { final: true });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      last = e;
      if ((e as { final?: boolean }).final) break;
      await new Promise((ok) => setTimeout(ok, 2000 * attempt));
    }
  }
  throw last;
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

// --- The GitHub CLI, for private repositories --------------------------------------------------------------------
function onPath(name: string): string | null {
  const exts = isWin ? [".exe", ".cmd"] : [""];
  for (const dir of (process.env.PATH || "").split(delimiter)) {
    for (const ext of exts) {
      const f = join(dir, name + ext);
      if (dir && existsSync(f)) return f;
    }
  }
  return null;
}

async function ensureGh(tools: string): Promise<string> {
  const found = onPath("gh");
  if (found) return found;
  const exe = join(tools, "gh", "bin", isWin ? "gh.exe" : "gh");
  if (existsSync(exe)) return exe;
  const cpu = osArch() === "arm64" ? "arm64" : "amd64";
  say(`Installing the GitHub CLI into ${join(tools, "gh")} ...`);
  // The newest version from the release page's redirect, not the API: anonymous API calls are limited per address.
  const latest = await fetch("https://github.com/cli/cli/releases/latest", { headers: UA, redirect: "manual" });
  const tag = (latest.headers.get("location") ?? "").match(/\/tag\/v(\d+\.\d+\.\d+)$/)?.[1];
  if (!tag) throw new Error(`no latest release found (HTTP ${latest.status})`);
  const asset = { name: `gh_${tag}${isWin ? `_windows_${cpu}.zip` : isMac ? `_macOS_${cpu}.zip` : `_linux_${cpu}.tar.gz`}` };
  const base = `https://github.com/cli/cli/releases/download/v${tag}`;
  const archive = await get(`${base}/${asset.name}`);
  const line = (await get(`${base}/gh_${tag}_checksums.txt`)).toString("utf8").split("\n").find((l) => l.trim().endsWith(` ${asset.name}`) || l.trim().endsWith(`*${asset.name}`));
  if (!line || line.slice(0, 64).toLowerCase() !== sha256(archive)) fail(`Checksum mismatch for ${asset.name}: the download is damaged or not the published file.`);
  // The archives hold one top folder (gh_<v>_<os>_<cpu>/bin/gh) or bin/ at their top (Windows): keep what is under it.
  const files = new Map<string, { data: Buffer; exec: boolean }>();
  if (asset.name.endsWith(".zip")) {
    const zip = await JSZip.loadAsync(archive);
    for (const f of Object.values(zip.files)) if (!f.dir) files.set(f.name, { data: await f.async("nodebuffer"), exec: f.name.endsWith("/bin/gh") || f.name === "bin/gh" });
  } else {
    for (const [name, data] of readTarGz(archive, 512 * 1024 * 1024)) files.set(name, { data, exec: name.endsWith("/bin/gh") });
  }
  const dest = join(tools, "gh");
  await rm(dest, { recursive: true, force: true });
  for (const [name, f] of files) {
    const parts = name.split("/");
    const rel = parts[0] === "bin" ? parts : parts.slice(1);
    if (!rel.length || rel.some((p) => p === ".." || p === "")) continue;
    const out = join(dest, ...rel);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, f.data);
    if (f.exec) await chmod(out, 0o755);
  }
  if (!existsSync(exe)) fail(`The GitHub CLI was unpacked, but ${exe} is not there.`);
  return exe;
}

async function githubToken(tools: string): Promise<string> {
  let gh: string;
  try {
    gh = await ensureGh(tools);
  } catch (e) {
    fail(`The GitHub CLI, needed for private repositories, could not be installed: ${(e as Error).message}. Check the network, or answer '-' for no private repositories.`);
  }
  const version = spawnSync(gh, ["--version"], { encoding: "utf8" });
  if (version.status !== 0) fail(`The GitHub CLI (${gh}) does not start.`);
  say(version.stdout.split("\n")[0]);
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN; // the automated test: no browser
  if (spawnSync(gh, ["auth", "status", "--hostname", "github.com"], { stdio: "ignore" }).status !== 0) {
    say("");
    say("Sign in to GitHub, so the private repositories can be downloaded. The GitHub CLI shows a code and opens");
    say("the browser; enter the code there.");
    // ssh without a key: nothing here runs git, so gh does not set up git's credentials (git isn't needed).
    const login = spawnSync(gh, ["auth", "login", "--hostname", "github.com", "--git-protocol", "ssh", "--skip-ssh-key", "--web"], { stdio: "inherit" });
    if (login.status !== 0) fail("GitHub sign-in did not finish. Start again to retry, or answer '-' for no private repositories.");
  }
  const t = spawnSync(gh, ["auth", "token", "--hostname", "github.com"], { encoding: "utf8" });
  if (t.status !== 0 || !t.stdout.trim()) fail("The GitHub CLI is signed in but gives no token.");
  return t.stdout.trim();
}

// --- Which private repositories ----------------------------------------------------------------------------------
function repoName(text: string): string {
  let t = text.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/+$/, "");
  if (!t.includes("/")) t = `${OWNER}/${t}`;
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(t)) fail(`'${text}' is not a repository name (owner/name or name).`);
  return t;
}

async function choosePrivate(o: Options, savedFile: string): Promise<string[]> {
  const known = existsSync(savedFile) ? (await readFile(savedFile, "utf8")).split(/\s+/).filter(Boolean) : [];
  let answer: string;
  if (o.repos !== undefined) answer = o.repos;
  else if (o.noUpdate || !process.stdin.isTTY) answer = known.join(" ");
  else {
    say("");
    say(`Private game repositories: type the names of those your GitHub account can read, e.g. my-game or`);
    say(`${OWNER}/my-game, separated by spaces or commas.`);
    say(known.length ? `Last time: ${known.join(", ")}. Press Enter to keep them, or type '-' for none.` : "Press Enter for none (only the public games).");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    answer = await rl.question("Repositories: ");
    rl.close();
    if (!answer.trim() && known.length) answer = known.join(" ");
  }
  const list: string[] = [];
  for (const p of answer.split(/[\s,;]+/)) {
    if (!p || p === "-" || p === "none") continue;
    const r = repoName(p);
    if (!PUBLIC_REPOS.includes(r) && !list.includes(r)) list.push(r);
  }
  await writeFile(savedFile, list.join("\n") + (list.length ? "\n" : ""));
  return list;
}

// --- Game repositories -------------------------------------------------------------------------------------------
/** The commit a GitHub tarball was made from: its first entry, a pax global header, says "comment=<sha>". */
function tarCommit(gz: Buffer): string {
  const head = gunzipSync(gz).subarray(0, 2048);
  if (String.fromCharCode(head[156]) !== "g") return "";
  return head.subarray(512, 1024).toString("utf8").match(/comment=([0-9a-f]{40})/)?.[1] ?? "";
}

/** Downloads a repository's branch and keeps its games/ folder: <reposDir>/<name>/games, and <name>.json. */
async function fetchGames(repo: string, branch: string, reposDir: string, token: string | null) {
  // With a token through the API; without one from codeload, which anonymous API limits don't count.
  const gz = token
    ? await get(`https://api.github.com/repos/${repo}/tarball/${encodeURIComponent(branch)}`, { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` })
    : await get(`https://codeload.github.com/${repo}/tar.gz/refs/heads/${encodeURIComponent(branch)}`);
  const entries = readTarGz(gz, 2 * 1024 * 1024 * 1024);
  const name = repo.split("/")[1];
  const staging = join(reposDir, `${name}.new`);
  await rm(staging, { recursive: true, force: true });
  let top = "";
  let count = 0;
  for (const [path, data] of entries) {
    const slash = path.indexOf("/");
    if (slash < 0) continue;
    top ||= path.slice(0, slash); // GitHub wraps everything in "<owner>-<name>-<short sha>/"
    const rel = path.slice(slash + 1);
    if (!rel.startsWith("games/")) continue;
    const parts = rel.split("/");
    if (parts.some((p) => p === ".." || p === "" || p.includes("\\") || p.includes(":"))) continue;
    const out = join(staging, ...parts);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, data);
    count++;
  }
  if (!count) throw new Error(`no games/ folder on ${branch}`);
  const target = join(reposDir, name);
  await rm(target, { recursive: true, force: true });
  await rename(staging, target);
  // The API names the folder <owner>-<name>-<sha>; both keep the full commit in the global header.
  const commit = tarCommit(gz) || (token ? (top.split("-").at(-1) ?? "") : "");
  const info: Download = { repository: repo, branch, commit, downloaded: new Date().toISOString().replace(/\.\d+Z$/, "Z") };
  await writeFile(join(reposDir, `${name}.json`), JSON.stringify(info, null, 2) + "\n");
  await rm(join(reposDir, `${name}.commit`), { force: true }); // before games.json, the commit alone
  return commit.slice(0, 7) || "an unknown commit";
}

// --- The table host ----------------------------------------------------------------------------------------------
/** The address of the interface the default route uses (what phones on the WiFi reach); no packet is sent. */
function routeAddress(): Promise<string | null> {
  return new Promise((done) => {
    const s = createSocket("udp4");
    s.on("error", () => { s.close(); done(null); });
    s.connect(53, "192.0.2.1", () => {
      const a = s.address().address;
      s.close();
      done(a && a !== "0.0.0.0" ? a : null);
    });
  });
}

function portFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const srv = createServer();
    srv.once("error", () => done(false));
    srv.listen(port, () => srv.close(() => done(true)));
  });
}

async function health(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

function openBrowser(url: string) {
  const [cmd, args] = isWin ? ["cmd", ["/c", "start", "", url]] : isMac ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args as string[], { stdio: "ignore", detached: true }).unref();
  } catch {
    note(`Open ${url} in a browser.`);
  }
}

interface PackageManifest {
  package: { version: string; platform: string; built: string };
  gamesService: { repository: string; commit: string; commitDate: string };
  node: Record<string, string>;
  games: { id: string; name: string; version: string; test?: boolean }[];
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * games.json in the user's folder: every game on the table this start, with its version and where it came from (the
 * package, or a repository's branch, commit and download time). Public repositories are linked, private ones named.
 */
async function writeGamesList(home: string, gamesDir: string, from: Map<string, string>, reposDir: string) {
  const pkg = await readJson<PackageManifest>(join(bundled, "MANIFEST.json"));
  const games = [];
  for (const [id, label] of [...from].sort(([a], [b]) => a.localeCompare(b))) {
    const m = await readJson<{ name: string; version: string; test?: boolean }>(join(gamesDir, id, "manifest.json"));
    let source: Record<string, string>;
    if (label === "games-service") {
      source = { repository: PUBLIC_LINKS["games-service"], package: pkg?.package.version ?? "dev", commit: pkg?.gamesService.commit ?? "" };
    } else {
      const d = await readJson<Download>(join(reposDir, `${label.split("/")[1]}.json`));
      source = { repository: PUBLIC_LINKS[label] ?? label, branch: d?.branch ?? "", commit: d?.commit ?? "", downloaded: d?.downloaded ?? "" };
    }
    games.push({ id, name: m?.name ?? id, version: m?.version ?? "", ...(m?.test ? { test: true } : {}), ...source });
  }
  const list = { format: "game-table-games/1", package: pkg?.package ?? null, written: new Date().toISOString().replace(/\.\d+Z$/, "Z"), games };
  await writeFile(join(home, "games.json"), JSON.stringify(list, null, 2) + "\n");
  return list;
}

async function showVersion(home: string) {
  const pkg = await readJson<PackageManifest>(join(bundled, "MANIFEST.json"));
  if (pkg) {
    say(`Game Table ${pkg.package.version} for ${pkg.package.platform}, built ${pkg.package.built}`);
    say(`  games-service ${pkg.gamesService.commit.slice(0, 7)} (${pkg.gamesService.commitDate}) ${pkg.gamesService.repository}`);
    say(`  Node.js ${[...new Set(Object.values(pkg.node))].join(", ")}`);
  } else say("Game Table (no MANIFEST.json: not an installed package)");
  const list = await readJson<{ written: string; games: { id: string; version: string; repository: string; commit?: string; test?: boolean }[] }>(join(home, "games.json"));
  if (!list) {
    say("No games.json yet: start the table once.");
    return;
  }
  say(`Games on the table at the last start (${list.written}):`);
  for (const g of list.games.filter((g) => !g.test)) say(`  ${g.id.padEnd(16)} ${g.version.padEnd(14)} ${g.repository}${g.commit ? ` @ ${g.commit.slice(0, 7)}` : ""}`);
  say(`Details: ${join(home, "games.json")}`);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 26) fail(`Node.js 26 is needed (this is ${process.versions.node}).`);
  const home = resolve(o.home || defaultHome());
  if (o.showVersion) {
    await showVersion(home);
    return;
  }
  const tools = join(home, "tools");
  const reposDir = join(home, "repos");
  const dataDir = join(home, "data");
  for (const d of [home, tools, reposDir, dataDir]) await mkdir(d, { recursive: true });

  // The runtime, copied into the user's folder once per package version: the package may be read-only
  // (/Applications), and the built-in games reach the SDK by a relative path, so all games sit inside this copy.
  const version = (await readFile(join(bundled, "VERSION"), "utf8").catch(() => "dev")).trim();
  const runtime = join(home, "runtime");
  const stamp = join(runtime, ".package-version");
  if (!existsSync(stamp) || (await readFile(stamp, "utf8")).trim() !== version) {
    say(`Setting up Game Table ${version} in ${runtime} ...`);
    await rm(runtime, { recursive: true, force: true });
    await cp(bundled, runtime, { recursive: true });
    await writeFile(stamp, version + "\n");
  }

  const priv = await choosePrivate(o, join(home, "private-repos.txt"));
  const repos = [...PUBLIC_REPOS, ...priv];
  let token: string | null = null;
  if ((priv.length || o.signIn) && !o.noUpdate) token = await githubToken(tools);
  const have: string[] = [];
  for (const r of repos) {
    const name = r.split("/")[1];
    const present = existsSync(join(reposDir, name, "games"));
    if (o.noUpdate) {
      if (present) have.push(r);
      else note(`${r} was never downloaded; start without --no-update.`);
      continue;
    }
    try {
      const commit = await fetchGames(r, o.branch, reposDir, token);
      say(`${r} (${o.branch}) at ${commit}`);
      have.push(r);
    } catch (e) {
      const why = (e as Error).message;
      if (present) {
        note(`${r} could not be downloaded (${why}); using the copy from last time.`);
        have.push(r);
      } else {
        note(`${r} could not be downloaded (${why}): no access with this GitHub account, no branch ${o.branch}, or no network. Its games are left out.`);
      }
    }
  }

  // All games in one folder inside the runtime: games-service's own first, then each repository's.
  const gamesDir = join(runtime, "table-games");
  await rm(gamesDir, { recursive: true, force: true });
  await mkdir(gamesDir, { recursive: true });
  const from = new Map<string, string>();
  const sources: [string, string][] = [["games-service", join(runtime, "games")], ...have.map((r): [string, string] => [r, join(reposDir, r.split("/")[1], "games")])];
  for (const [label, dir] of sources) {
    const ids: string[] = [];
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory() || !existsSync(join(dir, e.name, "manifest.json"))) continue;
      if (from.has(e.name)) note(`${e.name} is in ${from.get(e.name)} and in ${label}; the one from ${label} is used.`);
      await rm(join(gamesDir, e.name), { recursive: true, force: true });
      await cp(join(dir, e.name), join(gamesDir, e.name), { recursive: true });
      from.set(e.name, label);
      ids.push(e.name);
    }
    say(`Games from ${label}: ${ids.join(", ") || "(none)"}`);
  }
  const gamesList = await writeGamesList(home, gamesDir, from, reposDir);

  const keyFile = join(dataDir, "table-key");
  if (!existsSync(keyFile)) await writeFile(keyFile, randomBytes(16).toString("hex") + "\n", { mode: 0o600 });
  if (!(await portFree(o.port))) fail(`Port ${o.port} is in use (another table still running?). Close it, or start with --port ${o.port + 1}.`);
  const ip = await routeAddress();

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(o.port),
    DATA_DIR: dataDir,
    GAMES_DIR: gamesDir,
    TABLE_KEY: (await readFile(keyFile, "utf8")).trim(),
    TABLE_NAME: process.env.TABLE_NAME || (isWin ? process.env.COMPUTERNAME : undefined) || "Game Table",
    SHOW_TEST_GAMES: "0",
    LOCAL_TABLE: "1",
    APP_VERSION: version,
  };
  delete env.CLOUD_URL;
  delete env.TABLE_CODE;
  if (o.service) env.CLOUD_URL = SERVICE_URL;
  if (o.code) env.TABLE_CODE = o.code;
  if (ip) env.PUBLIC_URL = `http://${ip}:${o.port}`;
  else delete env.PUBLIC_URL;

  say("");
  say(`Game Table ${version} on this computer`);
  say(`  board:   http://localhost:${o.port}/board/`);
  if (ip) say(`  phones:  scan the QR code on the board (http://${ip}:${o.port}), on this computer's WiFi, not mobile data`);
  if (o.service) {
    say(`  service: ${SERVICE_URL}: remote players can join once the table is approved`);
    if (!o.code) say(`           If the board shows a pairing code, approve it in the console at ${CONSOLE_URL}.`);
  } else {
    say("  service: none: players here only, no remote players (--service joins the Game Table service)");
  }
  say(`  data:    ${home}`);
  if (isWin) say("If Windows asks whether Node.js may communicate on networks, allow Private networks, or phones cannot join.");
  if (isMac) say("If macOS asks whether \"node\" may accept incoming connections, allow it, or phones cannot join.");
  say("Stop with Ctrl+C or by closing this window.");
  say("");

  const child: ChildProcess = spawn(process.execPath, [join(runtime, "apps", "table-host", "src", "main.ts")], {
    cwd: runtime,
    env,
    stdio: o.smokeTest ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  let output = "";
  child.stdout?.on("data", (d) => (output += d));
  child.stderr?.on("data", (d) => (output += d));
  let exited = false;
  child.on("exit", () => (exited = true));
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig));

  let up = false;
  for (let i = 0; i < 120 && !exited && !up; i++) {
    up = await health(o.port);
    if (!up) await new Promise((ok) => setTimeout(ok, 500));
  }

  if (o.smokeTest) {
    const problems: string[] = [];
    if (!up) problems.push("the table did not answer on /health");
    else {
      try {
        const b = await fetch(`http://127.0.0.1:${o.port}/board/`);
        if (!b.ok) problems.push(`/board/ answered ${b.status}`);
      } catch (e) {
        problems.push(`/board/ failed: ${(e as Error).message}`);
      }
      let line: string | undefined;
      for (let i = 0; i < 20 && !line; i++) {
        line = output.split("\n").find((l) => /table-host\] games:/.test(l));
        if (!line) await new Promise((ok) => setTimeout(ok, 500));
      }
      if (!line) problems.push("the host printed no games line");
      else {
        const listed = line.replace(/^.*?games:\s*/, "").replace(/\s+\(.*$/, "").split(/,\s*/);
        for (const g of o.expectGames) if (!listed.includes(g)) problems.push(`game ${g} is not on the table`);
      }
      for (const g of o.expectGames) {
        const entry = gamesList.games.find((x) => x.id === g);
        if (!entry || !entry.version || !("commit" in entry) || !entry.commit) problems.push(`games.json has no version and commit for ${g}`);
      }
      if (!existsSync(join(bundled, "MANIFEST.json"))) problems.push("the package has no MANIFEST.json");
    }
    child.kill();
    say("--- table host output ---");
    say(output.trimEnd());
    if (problems.length) fail(`SMOKE TEST FAILED: ${problems.join("; ")}`);
    say("SMOKE TEST PASSED");
    process.exit(0);
  }

  if (!up) {
    if (exited) fail(`The table host stopped (exit ${child.exitCode}); see the messages above.`);
    note(`The table host does not answer yet; open http://localhost:${o.port}/board/ yourself when it does.`);
  } else if (o.open) {
    openBrowser(`http://localhost:${o.port}/board/`);
  }
  child.on("exit", (code) => process.exit(code ?? 0));
}

await main().catch((e: Error) => fail(`Game Table could not start: ${e.message}`));
