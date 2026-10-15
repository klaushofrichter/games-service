// What the service keeps about an uploaded game log (D-116): read from the log's own run.json, so the console can list
// and filter logs by game, table, date and how they ended, and download tokens can be scoped the same way.
import JSZip from "jszip";

export interface LogRecordMeta {
  id: string;
  tableId: string;
  gameId: string;
  simulation: boolean;
  bytes: number;
  uploadedAt: number;
  // From run.json (format 2); absent for older logs.
  format?: string;
  gameName?: string;
  gameVersion?: string;
  gameSource?: string;
  tableName?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  games?: number;
  endReason?: string;
  endReasons?: Record<string, number>;
  result?: string;
  players?: { seat: number; name: string; kind: string; location: string | null }[];
  errors?: number;
  /** Every game in the log replayed to its end state; null: nothing was checked. */
  verified?: boolean | null;
  platformVersion?: string;
}

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined);

/** The listing fields from run.json, checked and bounded. Nothing usable: {} (the upload is kept all the same). */
export async function readRunMeta(zipData: Buffer): Promise<Partial<LogRecordMeta>> {
  let run: Record<string, any>;
  try {
    const zip = await JSZip.loadAsync(zipData);
    const f = zip.file("run.json");
    if (!f) return {};
    const text = await f.async("string");
    if (text.length > 1_000_000) return {};
    run = JSON.parse(text);
    if (!run || typeof run !== "object") return {};
  } catch {
    return {};
  }
  const out: Partial<LogRecordMeta> = {};
  const set = <K extends keyof LogRecordMeta>(k: K, v: LogRecordMeta[K] | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set("format", str(run.format, 40));
  set("gameId", str(run.gameId, 64));
  set("gameName", str(run.gameName, 80));
  set("gameVersion", str(run.gameVersion, 40));
  set("gameSource", str(run.gameSource, 300));
  set("tableName", str(run.tableName, 80));
  set("startedAt", iso(run.startedAt));
  set("endedAt", iso(run.endedAt));
  set("durationMs", num(run.durationMs));
  set("games", num(run.games));
  set("endReason", str(run.endReason, 20));
  set("result", str(run.result, 300));
  set("platformVersion", str(run.platform?.version, 40));
  set("errors", num(run.counts?.errors));
  if (typeof run.simulation === "boolean") out.simulation = run.simulation;
  if (run.endReasons && typeof run.endReasons === "object") {
    const r: Record<string, number> = {};
    for (const [k, v] of Object.entries(run.endReasons).slice(0, 10)) if (typeof v === "number") r[k.slice(0, 20)] = v;
    out.endReasons = r;
  }
  if (Array.isArray(run.players)) {
    out.players = run.players.slice(0, 8).map((p: any) => ({
      seat: num(p?.seat) ?? -1,
      name: str(p?.name, 40) ?? "",
      kind: str(p?.kind, 10) ?? "",
      location: str(p?.location, 10) ?? null,
    }));
  }
  const v = run.verify;
  if (v && typeof v === "object" && typeof v.checked === "number") out.verified = v.checked > 0 ? v.ok === v.checked : null;
  return out;
}

export interface LogFilter {
  gameId?: string;
  tableId?: string;
  /** Logs of games started on or after this day or time (ISO). */
  from?: string;
  /** ... and before the end of this day (a date) or this time. */
  to?: string;
  simulation?: boolean;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A `from` or `to` value: an ISO date or date-time. null when absent; throws on anything else. */
export function parseBound(v: unknown, end: boolean): number | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) throw Object.assign(new Error(`${end ? "to" : "from"} must be a date like 2026-10-15`), { status: 400 });
  const t = Date.parse(DAY.test(v) ? `${v}T00:00:00Z` : v);
  return end && DAY.test(v) ? t + 86400_000 : t;
}

/** A filter from query parameters or a token's stored scope; throws (400) on a bad date. */
export function filterFrom(get: (k: string) => string | null | undefined): LogFilter {
  const f: LogFilter = {};
  const g = get("gameId");
  if (g) f.gameId = g;
  const t = get("tableId");
  if (t) f.tableId = t;
  const from = get("from");
  if (from) (parseBound(from, false), (f.from = from));
  const to = get("to");
  if (to) (parseBound(to, true), (f.to = to));
  const sim = get("simulation");
  if (sim === "1" || sim === "true") f.simulation = true;
  if (sim === "0" || sim === "false") f.simulation = false;
  return f;
}

export function matches(m: LogRecordMeta, f: LogFilter): boolean {
  if (f.gameId && m.gameId !== f.gameId) return false;
  if (f.tableId && m.tableId !== f.tableId) return false;
  if (f.simulation !== undefined && m.simulation !== f.simulation) return false;
  const when = m.startedAt ? Date.parse(m.startedAt) : m.uploadedAt;
  const from = parseBound(f.from, false);
  const to = parseBound(f.to, true);
  if (from !== null && when < from) return false;
  if (to !== null && when >= to) return false;
  return true;
}
