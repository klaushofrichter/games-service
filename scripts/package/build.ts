// Builds the folder of one platform's package (D-256): node scripts/package/build.ts --os windows|macos|linux --out DIR
// From this checkout: the table host, the SDK, the protocol, the built-in games and their runtime packages
// (npm ci --omit=dev, pure JavaScript, the same on every platform), the launcher, and Node.js 26 for x64 and arm64
// from nodejs.org (checksums checked). The workflow wraps the folder: an Inno Setup installer (Windows), a .pkg with
// "Game Table.app" (macOS), a .tar.gz (Linux).
//   DIR/windows:  game-table.cmd, runtime/, node/win-x64/node.exe, node/win-arm64/node.exe
//   DIR/macos:    Game Table.app/Contents/{Info.plist, MacOS/game-table, Resources/{game-table.command, runtime/, node/darwin-*/node}}
//   DIR/linux:    game-table/{game-table, runtime/, node/linux-*/node}
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { readTarGz } from "../../packages/protocol/src/bundle.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const os = opt("os");
const out = resolve(opt("out") ?? "dist");
if (os !== "windows" && os !== "macos" && os !== "linux") throw new Error("--os windows|macos|linux");
const NODE_MAJOR = 26;

const git = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }).trim();
const commit = git("rev-parse", "--short", "HEAD");
const date = new Date().toISOString().slice(0, 10);
const version = process.env.PACKAGE_VERSION || `${date} (${commit})`;

async function get(url: string): Promise<Buffer> {
  const r = await fetch(url, { headers: { "User-Agent": "game-table-build" } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/** The runtime: what the table host needs, nothing for development. */
async function runtime(dest: string) {
  await rm(dest, { recursive: true, force: true });
  for (const p of ["apps/table-host", "packages", "games", "package.json", "package-lock.json", "LICENSE", "scripts/package/launch.ts"]) {
    try {
      await cp(join(repo, p), join(dest, p), { recursive: true, filter: (src) => !/[\\/](node_modules|data)([\\/]|$)/.test(src.slice(repo.length)) });
    } catch (e) {
      if (p !== "LICENSE") throw e;
    }
  }
  await writeFile(join(dest, "VERSION"), version + "\n");
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], {
    cwd: dest,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

/** Node.js NODE_MAJOR's newest release for a platform ("win-x64", "darwin-arm64", "linux-x64", ...), its binary only. */
async function node(platform: string, dest: string) {
  const index = JSON.parse((await get("https://nodejs.org/dist/index.json")).toString("utf8")) as { version: string; files: string[] }[];
  const zip = platform.startsWith("win");
  const key = zip ? `${platform}-zip` : platform.startsWith("darwin") ? `osx-${platform.split("-")[1]}-tar` : platform;
  const rel = index.find((r) => r.version.startsWith(`v${NODE_MAJOR}.`) && r.files.includes(key));
  if (!rel) throw new Error(`no Node.js ${NODE_MAJOR} for ${platform}`);
  const name = `node-${rel.version}-${platform}.${zip ? "zip" : "tar.gz"}`;
  const archive = await get(`https://nodejs.org/dist/${rel.version}/${name}`);
  const sums = (await get(`https://nodejs.org/dist/${rel.version}/SHASUMS256.txt`)).toString("utf8");
  const line = sums.split("\n").find((l) => l.trim().endsWith(`  ${name}`));
  if (!line || line.slice(0, 64) !== createHash("sha256").update(archive).digest("hex")) throw new Error(`checksum mismatch for ${name}`);
  const want = zip ? "node.exe" : "bin/node";
  let bin: Buffer | undefined;
  if (zip) {
    const z = await JSZip.loadAsync(archive);
    const f = Object.values(z.files).find((f) => f.name.endsWith(`/${want}`) && f.name.split("/").length === 2);
    bin = f && (await f.async("nodebuffer"));
  } else {
    for (const [p, data] of readTarGz(archive, 1024 * 1024 * 1024)) if (p.endsWith(`/${want}`) && p.split("/").length === 3) bin = data;
  }
  if (!bin) throw new Error(`${want} not found in ${name}`);
  const file = join(dest, zip ? "node.exe" : "node");
  await mkdir(dest, { recursive: true });
  await writeFile(file, bin);
  await chmod(file, 0o755);
  console.log(`${platform}: Node.js ${rel.version}`);
}

async function exec(file: string, text: string) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
  await chmod(file, 0o755);
}

const root = join(out, os);
await rm(root, { recursive: true, force: true });
if (os === "windows") {
  await runtime(join(root, "runtime"));
  for (const cpu of ["x64", "arm64"]) await node(`win-${cpu}`, join(root, "node", `win-${cpu}`));
  await writeFile(
    join(root, "game-table.cmd"),
    [
      "@echo off",
      "rem Starts Game Table (games-service scripts\\package\\launch.ts, D-256). Options go to it, e.g. --no-update.",
      "setlocal",
      'set "NODE=%~dp0node\\win-x64\\node.exe"',
      'if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "NODE=%~dp0node\\win-arm64\\node.exe"',
      '"%NODE%" "%~dp0runtime\\scripts\\package\\launch.ts" %*',
      "if errorlevel 1 if not defined CI pause",
      "",
    ].join("\r\n"),
  );
} else if (os === "macos") {
  const contents = join(root, "Game Table.app", "Contents");
  const res = join(contents, "Resources");
  await runtime(join(res, "runtime"));
  for (const cpu of ["x64", "arm64"]) await node(`darwin-${cpu}`, join(res, "node", `darwin-${cpu}`));
  await exec(
    join(res, "game-table.command"),
    `#!/bin/bash
# Starts Game Table (games-service scripts/package/launch.ts, D-256). Options go to it, e.g. --no-update.
DIR="$(cd "$(dirname "$0")" && pwd)"
case "$(uname -m)" in arm64) N=darwin-arm64 ;; *) N=darwin-x64 ;; esac
exec "$DIR/node/$N/node" "$DIR/runtime/scripts/package/launch.ts" "$@"
`,
  );
  // The app opens a Terminal window with the table's log; closing it stops the table.
  await exec(join(contents, "MacOS", "game-table"), `#!/bin/bash\nopen -a Terminal "$(cd "$(dirname "$0")/../Resources" && pwd)/game-table.command"\n`);
  await writeFile(
    join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Game Table</string>
  <key>CFBundleDisplayName</key><string>Game Table</string>
  <key>CFBundleIdentifier</key><string>technology.skylar.game-table</string>
  <key>CFBundleVersion</key><string>${date.replace(/-/g, ".")}</string>
  <key>CFBundleShortVersionString</key><string>${date.replace(/-/g, ".")}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>game-table</string>
  <key>LSMinimumSystemVersion</key><string>13.5</string>
</dict>
</plist>
`,
  );
} else {
  const top = join(root, "game-table");
  await runtime(join(top, "runtime"));
  for (const cpu of ["x64", "arm64"]) await node(`linux-${cpu}`, join(top, "node", `linux-${cpu}`));
  await exec(
    join(top, "game-table"),
    `#!/bin/sh
# Starts Game Table (games-service scripts/package/launch.ts, D-256). Options go to it, e.g. --no-update.
DIR="$(cd "$(dirname "$0")" && pwd)"
case "$(uname -m)" in x86_64|amd64) N=linux-x64 ;; aarch64|arm64) N=linux-arm64 ;; *) echo "Game Table runs on x64 and arm64 Linux, not $(uname -m)." >&2; exit 1 ;; esac
exec "$DIR/node/$N/node" "$DIR/runtime/scripts/package/launch.ts" "$@"
`,
  );
}
console.log(`${os}: ${root} (${version})`);
