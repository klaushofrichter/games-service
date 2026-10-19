// Read a Game Table log from the command line (D-120): what happened at move 43, the moves around it, the state before
// and after. For developers and LLMs; needs no table, only the zip (or its unpacked folder) and, for states and the games'
// own descriptions, the game's rules (built-in games always; others with --games).
//
//   node scripts/game-log.ts <log.zip|folder> [info]            the game, players, how it ended, moves per game
//   node scripts/game-log.ts <log> moves [N[-M]]                 the move list, or moves N to M (with what is between)
//   node scripts/game-log.ts <log> move N                       move N in full: text, intent, events, AI, state before/after
//   node scripts/game-log.ts <log> line L                       the record on line L of game-NNN.jsonl in full, like move
//   node scripts/game-log.ts <log> state N [--before]           only the state after (or before) move N, as JSON
//
// Options: --game G (a simulation's game, default 1) · --games DIR (more game folders, repeatable, e.g.
// ../my-games/games) · --seat S, --moves-only, --problems (filter the move list) · --json (machine-readable).
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { loadGames, type InstalledGame } from "../apps/table-host/src/games.ts";
import { LogStore, type RunMeta } from "../apps/table-host/src/logs.ts";
import { buildMoves, isProblem, packedList, stateAt, type MoveList, type MoveRow } from "../apps/table-host/src/moves.ts";
import type { LogRecord } from "../apps/table-host/src/runtime.ts";

const USAGE = `usage: node scripts/game-log.ts <log.zip|folder> [info | moves [N[-M]] | move N | line L | state N [--before]]
  options: --game G  --games DIR  --seat S  --moves-only  --problems  --json`;

function parseArgs(argv: string[]) {
  const o = { file: "", cmd: "info", args: [] as string[], game: 1, gameDirs: [] as string[], seat: undefined as number | undefined, movesOnly: false, problems: false, json: false, before: false };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--game") o.game = Number(argv[++i]);
    else if (a === "--games") o.gameDirs.push(argv[++i]);
    else if (a === "--seat") o.seat = Number(argv[++i]);
    else if (a === "--moves-only") o.movesOnly = true;
    else if (a === "--problems") o.problems = true;
    else if (a === "--json") o.json = true;
    else if (a === "--before") o.before = true;
    else if (a === "-h" || a === "--help") (console.log(USAGE), process.exit(0));
    else rest.push(a);
  }
  [o.file = "", o.cmd = "info", ...o.args] = rest;
  if (!o.file) (console.error(USAGE), process.exit(2));
  return o;
}

/** A zip, or a folder with run.json and game-NNN.jsonl (an unpacked zip). */
async function readLog(path: string): Promise<{ meta: RunMeta; games: LogRecord[][]; moves: (MoveRow[] | null)[] }> {
  if ((await stat(path)).isDirectory()) {
    const meta = JSON.parse(await readFile(join(path, "run.json"), "utf8")) as RunMeta;
    const names = (await readdir(path)).filter((n) => /^game-\d+\.jsonl$/.test(n)).sort();
    const lines = (t: string) => t.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const games: LogRecord[][] = [];
    const moves: (MoveRow[] | null)[] = [];
    for (const n of names) {
      games.push(lines(await readFile(join(path, n), "utf8")));
      moves.push(await readFile(join(path, n.replace(/\.jsonl$/, ".moves.jsonl")), "utf8").then(lines, () => null));
    }
    return { meta, games, moves };
  }
  return LogStore.unzip(await readFile(path));
}

async function rules(meta: RunMeta, dirs: string[]): Promise<{ game?: InstalledGame; note?: string }> {
  const all = new Map<string, InstalledGame>();
  for (const d of [join(import.meta.dirname, "..", "games"), ...dirs, ...(process.env.GAMES_DIRS?.split(":").filter(Boolean) ?? [])]) {
    for (const [id, g] of await loadGames(d).catch(() => new Map<string, InstalledGame>())) all.set(id, g);
  }
  const g = all.get(meta.gameId);
  if (!g) return { note: `${meta.gameId}'s rules are not here (add its folder with --games): generic lines, no states` };
  if (g.manifest.version !== meta.gameVersion) return { note: `the log is from ${meta.gameId} ${meta.gameVersion}, the rules here are ${g.manifest.version}: generic lines, no states` };
  return { game: g };
}

function clock(meta: RunMeta, start: number, at: number): string {
  if (meta.kind === "simulation" || meta.simulation || at < 1e12) return `+${((at - start) / 1000).toFixed(1)}s`;
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: meta.timeZone ?? "UTC", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(at);
  } catch {
    return new Date(at).toISOString().slice(11, 19);
  }
}

function rowLines(meta: RunMeta, start: number, r: MoveRow, columns: { key: string; label: string }[]): string[] {
  const cols = columns.map((c) => r.columns?.[c.key]).filter((v) => v !== undefined && v !== null && v !== "");
  const ai = r.ai ? ` [AI ${r.ai.ms} ms${r.ai.fallback ? ", fallback" : ""}]` : r.by === "board" ? " [from the board]" : "";
  const flags = r.flags.filter((f) => f !== "described").map((f) => `{${f}}`).join(" ");
  const head = `${(r.n === null ? "" : `#${r.n}`).padStart(5)}  L${String(r.line).padEnd(4)} ${clock(meta, start, r.at)}  ${(r.player ?? (r.kind === "move" ? "?" : "·")).padEnd(12)} ${r.text}${cols.length ? `  (${columns.filter((c) => r.columns?.[c.key] !== undefined && r.columns?.[c.key] !== null && r.columns?.[c.key] !== "").map((c) => `${c.label} ${r.columns![c.key]}`).join(", ")})` : ""}${ai}${flags ? ` ${flags}` : ""}`;
  return [head, ...(r.steps ?? []).map((s) => `${" ".repeat(18)}↳ ${s.player ? `${s.player}: ` : ""}${s.text}${s.auto ? " (automatic)" : ""}`)];
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const log = await readLog(o.file);
  const records = log.games[o.game - 1];
  if (!records) throw new Error(`the log has ${log.games.length} game(s); there is no game ${o.game}`);
  const r = await rules(log.meta, o.gameDirs);
  const packed = log.moves[o.game - 1];
  const list: MoveList = packed ? packedList(packed) : buildMoves(records, r.game);
  const columns = r.game?.manifest.viewer.columns.length ? r.game.manifest.viewer.columns : [...new Set(list.rows.flatMap((x) => Object.keys(x.columns ?? {})))].map((key) => ({ key, label: key }));
  const start = records[0]?.at ?? 0;
  const out = (v: unknown) => console.log(JSON.stringify(v, null, 2));

  if (o.cmd === "info") {
    const m = log.meta;
    const info = {
      id: m.id,
      game: `${m.gameName ?? m.gameId} ${m.gameVersion}${m.gameSource ? ` (${m.gameSource})` : ""}`,
      kind: m.kind ?? (m.simulation ? "simulation" : "game"),
      table: m.tableName,
      started: m.startedAt,
      ended: m.endedAt,
      endReason: m.endReason ?? m.endReasons ?? null,
      result: m.result ?? null,
      players: (m.players ?? []).map((p) => `${p.seat}: ${p.name} (${p.kind}${p.aiOptions ? ` ${JSON.stringify(p.aiOptions)}` : ""})`),
      games: log.games.length,
      thisGame: { game: o.game, moves: list.moves, rows: list.rows.length, movesFile: packed ? "packed in the zip" : "built now", described: list.described },
      rules: r.game ? `${r.game.manifest.id} ${r.game.manifest.version} (states available)` : r.note,
    };
    if (o.json) return out(info);
    for (const [k, v] of Object.entries(info)) console.log(`${k.padEnd(10)} ${typeof v === "string" ? v : JSON.stringify(v)}`);
    return;
  }

  if (o.cmd === "moves") {
    let rows = list.rows.filter((x) => (o.seat === undefined || x.seat === o.seat) && (!o.movesOnly || x.kind === "move") && (!o.problems || isProblem(x)));
    if (o.args[0]) {
      const [a, b] = o.args[0].split("-").map(Number);
      const firstLine = list.rows.find((x) => x.n === a)?.line ?? Infinity;
      const lastLine = list.rows.find((x) => x.n === (b || a))?.line ?? -Infinity;
      // From move N up to (not including) the move after M: timers, pauses and the like between them are kept.
      const after = list.rows.find((x) => x.n === (b || a) + 1)?.line ?? Infinity;
      rows = rows.filter((x) => x.line >= firstLine && (x.line <= lastLine || x.line < after));
    }
    if (o.json) return out(rows);
    if (r.note) console.log(`(${r.note})`);
    for (const x of rows) for (const l of rowLines(log.meta, start, x, columns)) console.log(l);
    return;
  }

  if (o.cmd === "move" || o.cmd === "line" || o.cmd === "state") {
    const n = Number(o.args[0]);
    if (!Number.isInteger(n)) throw new Error(`${o.cmd} needs a number`);
    const row = o.cmd === "line" ? list.rows.find((x) => x.line === n && x.kind !== "gap") : list.rows.find((x) => x.n === n);
    if (!row) throw new Error(o.cmd === "line" ? `there is no line ${n}` : `there is no move ${n} (the game has ${list.moves})`);
    const state = r.game ? stateAt(records, r.game, row.line) : null;
    if (o.cmd === "state") {
      if (!state) throw new Error(r.note);
      return out(o.before ? state.before : state.after);
    }
    const detail = { reference: `${log.meta.id}${log.games.length > 1 ? ` game ${o.game}` : ""} ${row.n === null ? `line ${row.line}` : `#${row.n}`}`, row, record: records[row.line - 1], state: state ?? r.note };
    if (o.json) return out(detail);
    console.log(rowLines(log.meta, start, row, columns).join("\n"));
    console.log(`\nreference  ${detail.reference}`);
    console.log(`record     ${JSON.stringify(detail.record)}`);
    if (row.details) console.log(`details    ${JSON.stringify(row.details)}`);
    if (state) {
      console.log(`\nstate before:\n${JSON.stringify(state.before, null, 1)}`);
      console.log(`\nstate after:\n${JSON.stringify(state.after, null, 1)}`);
    } else console.log(`\n(${r.note})`);
    return;
  }
  throw new Error(`unknown command ${o.cmd}\n${USAGE}`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
