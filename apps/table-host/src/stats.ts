// The statistics window's data (D-140): a game's own summary, with its awards checked, plus what the platform reads
// from the game log for every game: the players, their moves and their thinking time, and two awards for that.
import type { GameAward, GameSummary } from "../../../packages/protocol/src/index.ts";
import { leastAward, mostAward } from "../../../packages/sdk/src/index.ts";
import type { LogRecord } from "./runtime.ts";

const MIN_MOVES_FOR_TIMES = 3; // fewer moves say nothing about someone's pace

const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

/**
 * The summary the board shows, with the statistics: `players` and `play` from the log, the game's awards checked
 * (unknown seats removed; an award nobody or every player holds is dropped) and the platform's pace awards added.
 * Pure: the same log gives the same statistics, on the table and in the Game Viewer.
 */
export function withStatistics(summary: GameSummary | null, log: readonly LogRecord[]): GameSummary | null {
  if (!summary) return null;
  const players = playersOf(log);
  const seats = new Set(players.map((p) => p.seat));
  const own = (summary.awards ?? []).map((a) => checkAward(a, seats)).filter((a): a is GameAward => a !== null);
  const pace = paceOf(log, players);
  const awards = [...own, ...pace.awards.filter((a) => !own.some((o) => o.id === a.id))];
  return {
    ...summary,
    players,
    ...(pace.table ? { play: pace.table } : {}),
    awards,
  };
}

function playersOf(log: readonly LogRecord[]) {
  const out = new Map<number, { seat: number; name: string; ai: boolean }>();
  for (const r of log) {
    if (r.t === "start") for (const s of r.seats) out.set(s.seat, { seat: s.seat, name: s.name, ai: s.kind === "ai" });
    else if (r.t === "seatJoined") out.set(r.seat.seat, { seat: r.seat.seat, name: r.seat.name, ai: r.seat.kind === "ai" });
  }
  return [...out.values()].sort((a, b) => a.seat - b.seat);
}

function checkAward(a: GameAward, seats: Set<number>): GameAward | null {
  if (!a || typeof a !== "object") return null;
  const holders = [...new Set((Array.isArray(a.seats) ? a.seats : []).filter((s) => Number.isInteger(s) && seats.has(s)))];
  if (holders.length === 0 || holders.length >= seats.size) return null;
  const title = clip(a.title, 60);
  if (!title) return null;
  return {
    id: clip(a.id, 40) || title,
    icon: clip(a.icon, 8) || "🏅",
    title,
    ...(a.blurb ? { blurb: clip(a.blurb, 140) } : {}),
    seats: holders.sort((x, y) => x - y),
    ...(a.value !== undefined && a.value !== null ? { value: clip(String(a.value), 40) } : {}),
  };
}

/**
 * Moves and thinking time per player. A move's thinking time is the time since the game's previous step (a move, a
 * timer, a seat change, the start), without the time the game stood paused; times are shown for people, not AI players.
 */
function paceOf(log: readonly LogRecord[], players: { seat: number; name: string; ai: boolean }[]) {
  const moves = new Map<number, number[]>();
  let last: number | null = null;
  let pausedSince: number | null = null;
  let paused = 0; // paused time since `last`
  for (const r of log) {
    if (r.t === "pause") {
      if (pausedSince === null) pausedSince = r.at;
      continue;
    }
    if (r.t === "resume") {
      if (pausedSince !== null) paused += Math.max(0, r.at - Math.max(pausedSince, last ?? pausedSince));
      pausedSince = null;
      continue;
    }
    if (r.t === "start" || r.t === "timer" || r.t === "seatJoined" || r.t === "seatLeft") {
      last = r.at;
      paused = 0;
      continue;
    }
    if (r.t !== "intent" || !r.accepted) continue;
    if (last !== null) {
      const list = moves.get(r.seat) ?? [];
      list.push(Math.max(0, r.at - last - paused));
      moves.set(r.seat, list);
    }
    last = r.at;
    paused = 0;
  }
  const rows: (string | number)[][] = [];
  const timed: { seat: number; avg: number; longest: number }[] = [];
  for (const p of players) {
    const m = moves.get(p.seat) ?? [];
    if (!m.length) continue;
    const avg = m.reduce((a, b) => a + b, 0) / m.length;
    const longest = Math.max(...m);
    rows.push([p.name, m.length, p.ai ? "–" : seconds(avg), p.ai ? "–" : seconds(longest)]);
    if (!p.ai && m.length >= MIN_MOVES_FOR_TIMES) timed.push({ seat: p.seat, avg, longest });
  }
  const awards: GameAward[] = [];
  if (timed.length >= 2) {
    const quick = leastAward(
      { id: "quick-draw", icon: "⚡", title: "Quick Draw", blurb: "Took the least time per move." },
      timed.map((t) => ({ seat: t.seat, score: Math.round(t.avg / 100) })),
      (v) => `${seconds(v * 100)} per move`,
    );
    const deep = mostAward(
      { id: "deep-thinker", icon: "🤔", title: "Deep Thinker", blurb: "Took the longest over a single move." },
      timed.map((t) => ({ seat: t.seat, score: Math.round(t.longest / 1000) })),
      (v) => `${v} s`,
    );
    for (const a of [quick, deep]) if (a) awards.push(a);
  }
  return { table: rows.length ? { columns: ["Player", "Moves", "Time per move", "Longest move"], rows } : null, awards };
}
