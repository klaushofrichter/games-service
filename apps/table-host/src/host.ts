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
    joinTokenTtlMs: o.joinTokenTtlMs ?? 5 * 60_000,
    requireCloud: o.requireCloud ?? false,
    maxRemotePlayers: o.maxRemotePlayers ?? 4,
    showTestGames: o.showTestGames ?? true,
  };
  const table = new Table(config, games, logs);
  const server = await startServer(table, logs, {
    port: o.port ?? 8080,
    host: o.host,
    tableKey,
    publicDir: resolve(join(here, "../public")),
    allowRemoteBoard: o.allowRemoteBoard ?? false,
  });
  if (!config.publicUrl) config.publicUrl = `http://${lanAddress()}:${server.port}`;
  await logs.prune();
  let cloud: CloudLink | null = null;
  if (o.cloudUrl) {
    cloud = new CloudLink(table, logs, { cloudUrl: o.cloudUrl.replace(/\/$/, ""), dataDir, pollMs: o.cloudPollMs, heartbeatMs: o.cloudHeartbeatMs });
    await cloud.start();
  }
  const close = async () => {
    cloud?.stop();
    await server.close();
  };
  return { table, logs, tableKey, port: server.port, close, cloud };
}
