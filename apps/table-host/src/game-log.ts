// What a log says about itself (D-116): metadata for run.json, counts, and verification by replay.
import { PROTOCOL_VERSION } from "../../../packages/protocol/src/index.ts";
import { replayLog, type LogRecord } from "./runtime.ts";
import { sourceMeta, type InstalledGame } from "./games.ts";
import { LogStore, type LogCounts, type PlayerMeta, type RunMeta, type VerifySummary } from "./logs.ts";

const timeZone = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
})();

export function platformMeta() {
  return { version: process.env.APP_VERSION || "dev", protocol: PROTOCOL_VERSION };
}

/** The fields every log of this game has, before it ends. */
export function baseMeta(o: {
  id: string;
  game: InstalledGame;
  tableName: string;
  tableId: string | null;
  simulation: boolean;
  startedAt: number;
  settings: Record<string, unknown>;
  players: PlayerMeta[];
  /** Developer settings in force when the game started (D-117); only those that are on. */
  developer?: { allowNoLocalPlayer?: boolean };
  games?: number;
  seed?: number;
}): RunMeta {
  const m = o.game.manifest;
  return {
    id: o.id,
    format: "gametable-log/2",
    kind: o.simulation ? "simulation" : "game",
    tableName: o.tableName,
    tableId: o.tableId,
    gameId: m.id,
    gameName: m.name,
    gameVersion: m.version,
    ...sourceMeta(o.game),
    platform: platformMeta(),
    simulation: o.simulation,
    startedAt: new Date(o.startedAt).toISOString(),
    endedAt: "",
    timeZone,
    games: o.games ?? 1,
    ...(o.seed === undefined ? {} : { seed: o.seed }),
    settings: o.settings,
    players: o.players,
    ...(o.developer && Object.values(o.developer).some(Boolean) ? { developer: o.developer } : {}),
  };
}

export function countRecords(log: LogRecord[], into: LogCounts = { intents: 0, rejected: 0, timers: 0, errors: 0 }): LogCounts {
  for (const r of log) {
    if (r.t === "intent") {
      into.intents++;
      if (!r.accepted && !r.error) into.rejected++;
    }
    if (r.t === "timer") into.timers++;
    if (r.t === "error" || ("error" in r && r.error)) into.errors++;
  }
  return into;
}

/** Replay one game's log and compare with the hash it ended with. null: nothing to compare (no end hash). */
export function verifyGame(game: InstalledGame, log: LogRecord[]): { ok: boolean; expected: string | null; got: string | null; error?: string } | null {
  const end = log.at(-1);
  if (!end || end.t !== "end" || !end.stateHash) return null;
  try {
    const got = replayLog(game.manifest, game.def, log).hash;
    return { ok: got === end.stateHash, expected: end.stateHash, got };
  } catch (e) {
    return { ok: false, expected: end.stateHash, got: null, error: (e as Error).message };
  }
}

export function verifySummary(results: (ReturnType<typeof verifyGame>)[]): VerifySummary {
  const v: VerifySummary = { checked: 0, ok: 0, failed: [] };
  results.forEach((r, i) => {
    if (!r) return;
    v.checked++;
    if (r.ok) v.ok++;
    else v.failed.push(i + 1);
  });
  return v;
}

/** The state a log leads to, rebuilt by replay: for logs of games the table stopped in. */
export function rebuild(game: InstalledGame | undefined, log: LogRecord[]): { state: unknown; hash: string } | null {
  if (!game) return null;
  try {
    return replayLog(game.manifest, game.def, log);
  } catch {
    return null;
  }
}

/** POST /logs/{id}/verify: replay every game of a stored log with the game installed now. */
export async function verifyStoredLog(games: Map<string, InstalledGame>, logs: LogStore, id: string) {
  const buf = await logs.read(id);
  if (!buf) return null;
  const { meta, games: records } = await LogStore.unzip(buf);
  const game = games.get(meta.gameId);
  if (!game) return { logId: id, ok: false, games: [], reason: `${meta.gameId} is not installed on this table` };
  const versionNote = game.manifest.version === meta.gameVersion ? {} : { note: `the log is from version ${meta.gameVersion}; this table has ${game.manifest.version}` };
  const results = records.map((log, i) => {
    const r = verifyGame(game, log);
    return r ? { game: i + 1, ...r } : { game: i + 1, ok: false, expected: null, got: null, error: "the log has no final state hash (interrupted)" };
  });
  return { logId: id, ok: results.length > 0 && results.every((r) => r.ok), games: results, ...versionNote };
}
