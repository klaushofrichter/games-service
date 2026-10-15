// Pre-approved table codes (D-112). An administrator creates a code in the console; a board that starts with it (or
// has it typed into its settings) is approved at its first hello, without a pairing code. A code serves one board: the
// first table that uses it is bound to it, and any other table using it is refused until an administrator releases it.
// Validity only matters for binding: a bound table keeps working after its code expires, and the console flags it.
// Only a hash of each code is kept; the code itself is shown once, when it is created.
import { createHash, randomBytes, randomInt } from "node:crypto";

/** The same easy-to-read alphabet as join and invite codes (D-026): no 0/O, no 1/I. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;

export type Validity = "week" | "month" | "year" | "forever";
export const VALIDITIES: Validity[] = ["week", "month", "year", "forever"];

/**
 * Which extra-game repositories a table approved with this code gets (D-097):
 *   none: the built-in games only;  all: every repository the service lists, also ones added later;
 *   repos: the repositories with these names (owner/name), whatever branch the list has them at.
 */
export type CodeScope = { kind: "none" } | { kind: "all" } | { kind: "repos"; repos: string[] };

export interface AccessCode {
  id: string;
  /** sha256 of the normalised code, hex. */
  hash: string;
  /** The first two characters, so a person can tell codes apart in the console and on the board. */
  hint: string;
  label: string;
  validity: Validity;
  /** null = forever. */
  expiresAt: number | null;
  scope: CodeScope;
  createdAt: number;
  createdBy: string;
  revokedAt: number | null;
  /** The table this code is bound to (the first one that used it), or null. */
  tableId: string | null;
  boundAt: number | null;
  /** The last hello or heartbeat that presented this code successfully. */
  lastUsedAt: number | null;
  /** The last time another table, or a table after expiry or revocation, was refused with it. */
  lastRefusedAt: number | null;
}

/** What a table hears about the code it presented. */
export type CodeStatus = "accepted" | "unknown" | "expired" | "revoked" | "in-use";

export const newCode = () => Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
export const newCodeId = () => `c_${randomBytes(6).toString("hex")}`;

/** Upper case, without spaces and dashes, so "abcd-efgh" and "ABCD EFGH" are the same code. Null if it can't be one. */
export function normalizeCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.toUpperCase().replace(/[\s-]/g, "");
  return s.length === CODE_LENGTH && [...s].every((c) => CODE_ALPHABET.includes(c)) ? s : null;
}

/** ABCD-EFGH: easier to read out and type. */
export const formatCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;

export const hashCode = (c: string) => createHash("sha256").update(`gametable-access-code:${c}`).digest("hex");

/** One week, one calendar month or one calendar year from `from` (UTC); null for forever. */
export function expiryFor(validity: Validity, from = Date.now()): number | null {
  if (validity === "forever") return null;
  if (validity === "week") return from + 7 * 86400_000;
  const d = new Date(from);
  if (validity === "month") d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.getTime();
}

export const isExpired = (c: AccessCode, now = Date.now()) => c.expiresAt !== null && c.expiresAt <= now;

/** "active", "expired" or "revoked", for the console. */
export const codeState = (c: AccessCode, now = Date.now()) => (c.revokedAt ? "revoked" : isExpired(c, now) ? "expired" : "active");

/**
 * Whether this code may approve or keep `tableId`: refused if revoked, bound to another table, or (for a new binding)
 * expired. A code already bound to this table stays good after it expires.
 */
export function check(c: AccessCode | undefined, tableId: string, now = Date.now()): CodeStatus {
  if (!c) return "unknown";
  if (c.revokedAt) return "revoked";
  if (c.tableId && c.tableId !== tableId) return "in-use";
  if (!c.tableId && isExpired(c, now)) return "expired";
  return "accepted";
}

/** Housekeeping: a code expired or revoked more than a year ago goes, unless a table still uses it. */
export function stale(c: AccessCode, tableActive: boolean, now = Date.now()) {
  const ended = c.revokedAt ?? (isExpired(c, now) ? c.expiresAt : null);
  return ended !== null && ended < now - 365 * 86400_000 && !tableActive;
}

/** A scope from a request body; repository names are checked against the known ones by the caller. */
export function parseScope(v: unknown): CodeScope {
  const bad = () => Object.assign(new Error('scope must be {"kind":"none"}, {"kind":"all"} or {"kind":"repos","repos":["owner/name", …]}'), { status: 400 });
  if (!v || typeof v !== "object") throw bad();
  const s = v as { kind?: unknown; repos?: unknown };
  if (s.kind === "none" || s.kind === "all") return { kind: s.kind };
  if (s.kind !== "repos" || !Array.isArray(s.repos) || s.repos.some((r) => typeof r !== "string" || !/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(r))) throw bad();
  const repos = [...new Set((s.repos as string[]).map((r) => r.toLowerCase()))];
  return repos.length ? { kind: "repos", repos } : { kind: "none" };
}
