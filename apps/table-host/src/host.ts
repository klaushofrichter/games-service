// Assembles a Table Host from config. Used by main.ts and by the tests.
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { loadGames } from "./games.ts";
import { LogStore } from "./logs.ts";
import { startServer } from "./server.ts";
import { Table, type TableConfig } from "./table.ts";
import { CloudLink } from "./cloud.ts";
import { RemoteGateway } from "./remote.ts";
import { ExtraGames } from "./extra-games.ts";

const here = fileURLToPath(new URL(".", import.meta.url));

export interface HostOptions extends Partial<TableConfig> {
  port?: number;
  host?: string;
  tableKey?: string;
  gamesDir?: string;
  dataDir?: string;
  allowRemoteBoard?: boolean;
  logRetentionDays?: number;
  cloudUrl?: string;
  cloudPollMs?: number;
  cloudHeartbeatMs?: number;
  /** A pre-approved access code (TABLE_CODE or --code, D-113); it wins over one typed on the board. */
  accessCode?: string;
}

export function lanAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  }
  return "127.0.0.1";
}

export async function startHost(o: HostOptions = {}) {
  const gamesDir = resolve(o.gamesDir ?? join(here, "../../../games"));
  const dataDir = resolve(o.dataDir ?? join(here, "../../../data"));
  const tableKey = o.tableKey ?? randomBytes(16).toString("hex");
  const games = await loadGames(gamesDir);
  const logs = new LogStore(join(dataDir, "logs"), o.logRetentionDays ?? 90);
  const config: TableConfig = {
    tableName: o.tableName ?? "Game Table",
    publicUrl: o.publicUrl ?? "",
    graceMs: o.graceMs ?? 60_000,
    aiDelayMs: o.aiDelayMs ?? 800,
    boardPacing: o.boardPacing ?? true,
    boardPaceTimeoutMs: o.boardPaceTimeoutMs ?? 20_000,
    joinTokenTtlMs: o.joinTokenTtlMs ?? 0, // no expiry: a new code at every start, or "New code" on the board (D-066)
    requireCloud: o.requireCloud ?? false,
    maxRemotePlayers: o.maxRemotePlayers ?? 4,
    showTestGames: o.showTestGames ?? true,
    logSnapshotEvery: o.logSnapshotEvery ?? 0,
    allowNoLocalPlayer: o.allowNoLocalPlayer ?? false,
    boardDeck: o.boardDeck ?? false,
  };
  const table = new Table(config, games, logs);
  const server = await startServer(table, logs, {
    port: o.port ?? 8080,
    host: o.host,
    tableKey,
    publicDir: resolve(join(here, "../public")),
    allowRemoteBoard: o.allowRemoteBoard ?? false,
    createInvite: o.cloudUrl ? () => cloud!.createInvite() : undefined,
    setAccessCode: o.cloudUrl ? (code) => cloud!.setAccessCode(code) : undefined,
  });
  const gateway = new RemoteGateway(server.handler, server.attachSocket);
  table.on("remote-evict", (session: string) => gateway.end(session)); // a removed watcher (D-168)
  if (!config.publicUrl) config.publicUrl = `http://${lanAddress()}:${server.port}`;
  await logs.prune();
  // Tables run for weeks: prune once a day too, not only at start.
  const pruneTimer = setInterval(() => void logs.prune().catch(() => {}), 24 * 3600_000);
  pruneTimer.unref();
  let cloud: CloudLink | null = null;
  if (o.cloudUrl) {
    cloud = new CloudLink(table, logs, { cloudUrl: o.cloudUrl.replace(/\/$/, ""), dataDir, pollMs: o.cloudPollMs, heartbeatMs: o.cloudHeartbeatMs, accessCode: o.accessCode || undefined });
    cloud.gateway = gateway;
    // Extra games come only through the service (D-016, D-097): without CLOUD_URL a table has its built-in games.
    const link = cloud;
    cloud.extras = new ExtraGames(table, dataDir, (hash) => link.downloadBundle(hash));
    await cloud.extras.restore();
  }
  // Games the table stopped in the middle of last time (D-116): after the extra games are back, so they can be replayed.
  await table.recoverInterrupted();
  await cloud?.start();
  const close = async () => {
    clearInterval(pruneTimer);
    cloud?.stop();
    gateway.close();
    await server.close();
  };
  return { table, logs, tableKey, port: server.port, close, cloud, gateway };
}
