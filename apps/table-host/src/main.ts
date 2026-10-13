// Table Host entry point. Configuration comes from environment variables (see README).
import { startHost } from "./host.ts";

const env = process.env;
// Unset values fall back to the defaults in host.ts.
const num = (v: string | undefined) => (v ? Number(v) : undefined);

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
});

console.log(`[table-host] ${host.table.config.tableName} on port ${host.port}`);
console.log(`[table-host] board:  http://localhost:${host.port}/board/`);
console.log(`[table-host] join:   ${host.table.currentJoin().url}`);
console.log(`[table-host] games:  ${[...host.table.games.keys()].join(", ") || "(none)"}`);
if (!env.CLOUD_URL) console.log("[table-host] CLOUD_URL not set: running without the cloud service (development mode)");
host.table.on("state", (s) => {
  if (s.cloud.status === "pending") console.log(`[table-host] waiting for admin approval, pairing code ${s.cloud.pairingCode}`);
});
if (!process.env.TABLE_KEY) console.log(`[table-host] TABLE_KEY not set; generated key for this run: ${host.tableKey}`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await host.close();
    process.exit(0);
  });
}
