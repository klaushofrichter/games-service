// The Game Viewer's side on the table (D-120): finished games' logs as lists of moves, a page at a time, and one step in
// full with the state before and after it. Read-only; the board, remote players with board control, scripts and LLMs use
// the same endpoints (GET /api/v1/history…).
import type { InstalledGame } from "./games.ts";
import type { LogStore, RunMeta } from "./logs.ts";
import { buildMoves, packedList, pageMoves, stateAt, type MoveList, type MoveQuery, type MoveRow } from "./moves.ts";
import type { LogRecord } from "./runtime.ts";
import { withStatistics } from "./stats.ts";

/** A log in the viewer's list. */
export interface HistoryEntry {
  id: string;
  gameId: string;
  gameName: string;
  gameVersion: string;
  kind: "game" | "simulation";
  startedAt: string;
  endedAt: string;
  durationMs: number | null;
  endReason: string | null;
  endReasons: Record<string, number> | null;
  result: string | null;
  games: number;
  players: { seat: number; name: string; kind: "human" | "ai" }[];
  counts: RunMeta["counts"] | null;
}

export function entryOf(id: string, m: RunMeta): HistoryEntry {
  return {
    id,
    gameId: m.gameId,
    gameName: m.gameName ?? m.gameId,
    gameVersion: m.gameVersion,
    kind: m.kind ?? (m.simulation ? "simulation" : "game"),
    startedAt: m.startedAt,
    endedAt: m.endedAt,
    durationMs: m.durationMs ?? null,
    endReason: m.endReason ?? null,
    endReasons: m.endReasons ?? null,
    result: m.result ?? null,
    games: m.games,
    players: (m.players ?? []).map((p) => ({ seat: p.seat, name: p.name, kind: p.kind })),
    counts: m.counts ?? null,
  };
}

export class History {
  private logs: LogStore;
  private games: () => Map<string, InstalledGame>;
  /** Move lists built here (logs without one in the zip, e.g. simulations), by log id, game and modification. */
  private built = new Map<string, MoveList>();

  constructor(logs: LogStore, games: () => Map<string, InstalledGame>) {
    this.logs = logs;
    this.games = games;
  }

  async list(): Promise<HistoryEntry[]> {
    return (await this.logs.listWithMeta()).map((l) => entryOf(l.id, l.meta));
  }

  /** The game's rules if they are installed in the version the log was written with. */
  private rules(meta: RunMeta): InstalledGame | undefined {
    const g = this.games().get(meta.gameId);
    return g && g.manifest.version === meta.gameVersion ? g : undefined;
  }

  private async load(id: string, game: number) {
    const log = await this.logs.open(id);
    if (!log) return null;
    const records = log.games[game - 1];
    if (!records) return null;
    const key = `${id}#${game}`;
    let list: MoveList | undefined;
    const packed = log.moves[game - 1];
    if (packed) list = packedList(packed);
    else {
      list = this.built.get(key);
      if (!list) {
        list = buildMoves(records, this.rules(log.meta));
        this.built.set(key, list);
        while (this.built.size > 8) this.built.delete(this.built.keys().next().value!);
      }
    }
    return { meta: log.meta, records, list, games: log.games.length };
  }

  /** The viewer's columns: the game's own (manifest `viewer.columns`), else whatever keys the rows carry. */
  private columns(meta: RunMeta, rows: MoveRow[]) {
    const g = this.games().get(meta.gameId);
    if (g?.manifest.viewer.columns.length) return g.manifest.viewer.columns;
    const keys = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r.columns ?? {})) keys.add(k);
    return [...keys].slice(0, 4).map((key) => ({ key, label: key }));
  }

  /** One log: its metadata and, per game, how many moves and rows it has and how it ended. */
  async info(id: string) {
    const log = await this.logs.open(id);
    if (!log) return null;
    const out = [];
    for (let g = 1; g <= log.games.length; g++) {
      const l = (await this.load(id, g))!;
      const end = l.records.at(-1);
      out.push({
        game: g,
        moves: l.list.moves,
        rows: l.list.rows.length,
        described: l.list.described,
        endReason: end?.t === "end" ? end.reason : null,
        result: end?.t === "end" ? (end.summary?.text ?? null) : null,
        ...(l.list.note ? { note: l.list.note } : {}),
      });
    }
    return { ...entryOf(id, log.meta), meta: log.meta, rulesInstalled: !!this.rules(log.meta), columns: this.columns(log.meta, out.length ? (await this.load(id, 1))!.list.rows : []), gameList: out };
  }

  /** A finished game's statistics window (D-140): its summary with the statistics, read from the log; null without one. */
  async statistics(id: string, game: number) {
    const l = await this.load(id, game);
    if (!l) return null;
    const end = l.records.at(-1);
    return end?.t === "end" ? withStatistics(end.summary, l.records) : null;
  }

  async page(id: string, game: number, q: MoveQuery) {
    const l = await this.load(id, game);
    if (!l) return null;
    return { logId: id, game, columns: this.columns(l.meta, l.list.rows), described: l.list.described, ...pageMoves(l.list, q) };
  }

  /** One row in full: the raw record, its events, and the state before and after it when the rules are installed. */
  async step(id: string, game: number, ref: { line?: number; move?: number }) {
    const l = await this.load(id, game);
    if (!l) return null;
    const row = ref.move !== undefined ? l.list.rows.find((r) => r.n === ref.move) : l.list.rows.find((r) => r.line === ref.line && r.kind !== "gap");
    if (!row) return null;
    const record: LogRecord | undefined = l.records[row.line - 1];
    const rules = this.rules(l.meta);
    let state: { before: unknown; after: unknown } | null = null;
    let stateNote: string | undefined;
    if (rules) {
      try {
        state = stateAt(l.records, rules, row.line);
      } catch (e) {
        stateNote = `the state could not be rebuilt: ${(e as Error).message}`;
      }
    } else stateNote = this.games().has(l.meta.gameId) ? `this table has another version of ${l.meta.gameId} than the log (${l.meta.gameVersion})` : `${l.meta.gameId} is not installed on this table`;
    const moves = l.list.rows.filter((r) => r.n !== null);
    const i = moves.findIndex((r) => r.line >= row.line);
    const prev = moves.filter((r) => r.line < row.line).at(-1)?.n ?? null;
    const next = moves[i]?.line === row.line ? (moves[i + 1]?.n ?? null) : (moves[i]?.n ?? null);
    return {
      logId: id,
      game,
      reference: `${id}${l.games > 1 ? ` game ${game}` : ""} ${row.n !== null ? `#${row.n}` : `line ${row.line}`}`,
      row,
      record: record ?? null,
      prevMove: prev,
      nextMove: next,
      state,
      ...(stateNote ? { stateNote } : {}),
    };
  }
}
