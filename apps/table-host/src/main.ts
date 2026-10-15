// Table Host entry point. Configuration comes from environment variables (see README).
import { startHost } from "./host.ts";

const env = process.env;
// Unset values fall back to the defaults in host.ts.
const num = (v: string | undefined) => (v ? Number(v) : undefined);
/** --name value or --name=value from the command line. */
const arg = (name: string) => {
  const a = process.argv.slice(2);
  const i = a.findIndex((x) => x === `--${name}` || x.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  return a[i].includes("=") ? a[i].slice(a[i].indexOf("=") + 1) : a[i + 1];
};
// A pre-approved access code from the Game Table console (D-113): the table is approved at once, without a pairing
// code. The environment wins over the command line, and both win over a code typed in the board's settings.
const accessCode = env.TABLE_CODE || arg("code") || undefined;

const host = await startHost({
  port: num(env.PORT),
  tableName: env.TABLE_NAME,
  tableKey: env.TABLE_KEY,
  publicUrl: env.PUBLIC_URL,
  gamesDir: env.GAMES_DIR,
  dataDir: env.DATA_DIR,
  graceMs: num(env.GRACE_MS),
  aiDelayMs: num(env.AI_DELAY_MS),
  requireCloud: env.REQUIRE_CLOUD === "1",
  allowRemoteBoard: env.ALLOW_REMOTE_BOARD === "1",
  maxRemotePlayers: num(env.MAX_REMOTE_PLAYERS),
  cloudUrl: env.CLOUD_URL,
  showTestGames: env.SHOW_TEST_GAMES === "1",
  accessCode,
});

console.log(`[table-host] ${host.table.config.tableName} on port ${host.port}`);
console.log(`[table-host] board:  http://localhost:${host.port}/board/`);
console.log(`[table-host] join:   ${host.table.currentJoin().url}`);
{
  // Test games (manifest "test": true, today only quartet) exist for the automated tests; the board shows them only
  // with SHOW_TEST_GAMES=1.
  const all = [...host.table.games.values()].map((g) => g.manifest);
  const shown = all.filter((m) => !m.test || env.SHOW_TEST_GAMES === "1").map((m) => m.id);
  const hidden = all.filter((m) => m.test && env.SHOW_TEST_GAMES !== "1").map((m) => m.id);
  console.log(`[table-host] games:  ${shown.join(", ") || "(none)"}${hidden.length ? `   (test games hidden: ${hidden.join(", ")}; SHOW_TEST_GAMES=1 shows them)` : ""}`);
}
if (!env.CLOUD_URL) console.log("[table-host] CLOUD_URL not set: running without the cloud service (development mode)");
let lastCloud = "";
host.table.on("state", (s) => {
  const c = s.cloud;
  const line =
    c.status === "pending"
      ? `[table-host] waiting for admin approval, pairing code ${c.pairingCode}${c.code ? ` (access code ${c.code.hint}…: ${c.code.status})` : ""}`
      : c.code && c.code.status !== "waiting"
        ? `[table-host] service ${c.status}; access code ${c.code.hint}…: ${c.code.status}`
        : "";
  if (line && line !== lastCloud) console.log(line);
  lastCloud = line;
});
if (!process.env.TABLE_KEY) console.log(`[table-host] TABLE_KEY not set; generated key for this run: ${host.tableKey}`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await host.close();
    process.exit(0);
  });
}
