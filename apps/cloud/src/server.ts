// Cloud service (games.skylar.technology): table enrollment (pairing codes and pre-approved access codes, D-113),
// heartbeat and metrics, log upload with admin and token downloads, invites and remote-play signaling. The working set
// is in memory and every change is written through to the store (D-114): SQLite in DATA_DIR, so pairings, codes,
// repository ticks, logs and invites survive restarts. One process owns the database and the table sockets, so the
// service still runs as exactly one replica (D-071).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { BlockList, isIPv4, isIPv6 } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { createAdminAuth, esc, HTML_HEADERS, randomToken, same, sendPage, type GoogleAuthOptions } from "./auth.ts";
import { GameRepoStore, type GameRepo } from "./game-repos.ts";
import { Store } from "./store.ts";
import { filterFrom, matches, readRunMeta, type LogFilter, type LogRecordMeta } from "./log-meta.ts";
import { check, CODE_ALPHABET, codeState, expiryFor, formatCode, hashCode, isExpired, newCode, newCodeId, normalizeCode, parseScope, stale, VALIDITIES, type AccessCode, type CodeScope, type CodeStatus, type Validity } from "./access-codes.ts";

const ADMIN_PAGE = fileURLToPath(new URL("../public/admin.html", import.meta.url));
const REMOTE_PAGE = fileURLToPath(new URL("../public/remote.html", import.meta.url));
const REMOTE_SW = fileURLToPath(new URL("../public/remote-sw.js", import.meta.url));
const FAVICON = fileURLToPath(new URL("../public/favicon.svg", import.meta.url));
export const REPO_URL = "https://github.com/klaushofrichter/games-service";

/** The running version (APP_VERSION, stamped at build time; "dev" otherwise), as shown in the top bar and on "/". */
const appVersion = () => process.env.APP_VERSION || "dev";
/**
 * The version as a label: bare, never "v"-prefixed (kube-setup convention: tags carry the v, displayed values don't).
 * A release version links to its GitHub release; "main" links to the main branch's history; anything else is plain.
 */
export function versionLabel(v = appVersion()): string {
  const href = /^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(v) ? `${REPO_URL}/releases/tag/v${v}` : v === "main" ? `${REPO_URL}/commits/main` : "";
  return href ? `<a class="version" href="${href}" target="_blank" rel="noopener noreferrer">${esc(v)}</a>` : `<span class="version">${esc(v)}</span>`;
}

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Pairing and invite codes use the access codes' easy-to-read alphabet (D-026). */
const code = (n: number) => Array.from({ length: n }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
const MAX_PENDING = 500;
const PENDING_TTL_MS = 10 * 60_000;
/** Total bytes of stored logs; the oldest are dropped to make room for a new upload. */
const MAX_LOG_BYTES = 256 * 1024 * 1024;
/**
 * Free space the service always leaves in its budget: the larger of 100 MB and 15 %. Logs are the only thing that grows;
 * the oldest go before this reserve is touched, so the database, its snapshot and SQLite's write-ahead log have room.
 */
const reserveFor = (total: number) => Math.max(100 * 1024 * 1024, Math.round(total * 0.15));
const MAX_CODES = 1000;
/** Wrong access codes per client address and minute before hellos with a code are refused (a waiting table retries every 5 s). */
const MAX_CODE_FAILURES = 30;

export interface CloudOptions {
  port: number;
  host?: string;
  /** Optional bearer token for scripts and pipelines (ADMIN_TOKEN). People sign in with Google. */
  adminToken?: string;
  /** Google sign-in for the admin portal; null only for local development (the portal then asks for ADMIN_TOKEN). */
  google?: GoogleAuthOptions | null;
  publicUrl: string; // https://games.skylar.technology
  logRetentionDays?: number;
  /** STUN/TURN servers handed to both ends of a remote connection. */
  iceServers?: IceServer[];
  /**
   * Behind a reverse proxy (the cluster's Traefik): take the client address from X-Forwarded-For, but only when the
   * direct peer is one of these networks. A CIDR list, never a hop count (default: loopback and the k3s pod and
   * service networks).
   */
  trustProxy?: boolean | string[];
  /** Cap on the total size of stored logs (default 256 MB; LOG_STORAGE_MB). */
  maxLogBytes?: number;
  /**
   * The service's storage budget in DATA_DIR (DATA_LIMIT_MB, default 1 GiB: the PVC's size). It is counted from the
   * service's own files, because a local-path volume has no quota of its own: statfs reports the node's whole disk.
   */
  dataLimitBytes?: number;
  /** The budget's size and free space; tests pass a fake. */
  statVolume?: () => { total: number; free: number } | null;
  /** Extra-game repositories every start lists ("owner/name" or "owner/name@ref"): deploy/game-repos.json and GAME_REPOS. */
  gameRepos?: string[];
  /** Read token for private extra-game repositories (GAME_REPO_TOKEN). */
  gameRepoToken?: string;
  /** GitHub's REST API (tests use a fake). */
  githubApiUrl?: string;
  /** How often every repository is fetched again (default hourly; 0 = only on add and on Refresh). */
  gameRepoRefreshMs?: number;
  /** DATA_DIR: where the state database, its snapshot and uploaded logs live (D-114). Unset = in memory only. */
  dataDir?: string;
  /** How often the database snapshot is written (default hourly). */
  snapshotMs?: number;
}

interface TableRecord {
  tableId: string;
  name: string;
  status: "pending" | "approved" | "revoked";
  pairingCode: string;
  /** sha256 of the table's bearer token: the plain token is handed to the table once and never kept (D-114). */
  tokenHash: string | null;
  lastSeen: number | null;
  /** Last hello while pending: waiting tables poll every 5 s; one gone quiet for 10 minutes is dropped. */
  lastHello?: number;
  metrics: Record<string, number>;
  createdAt: number;
  /** Extra-game repositories this table gets (D-097), by repository id. Kept across Disconnect and Reconnect. */
  repos: string[];
  /** The access code that approved this table (D-113); while it exists, its scope decides the repositories. */
  codeId: string | null;
}

/** A table as the store keeps it: repositories by owner/name@ref, which stays stable when ids would not. */
interface StoredTable extends Omit<TableRecord, "repos" | "pairingCode" | "lastHello"> {
  repos: string[];
}

interface DownloadToken {
  id: string;
  gameId: string | null;
  /** The token's other bounds (D-116): one table, and games started from / to a day. */
  tableId?: string | null;
  from?: string | null;
  to?: string | null;
  label: string;
  expiresAt: number;
  createdAt: number;
  createdBy: string;
}


export function startCloud(o: CloudOptions) {
  const store = new Store({ dataDir: o.dataDir, snapshotMs: o.snapshotMs });
  /** Secrets (table tokens, invite codes, download tokens, remote sessions) are kept and looked up by their hash only. */
  const tokenKey = (token: string) => createHash("sha256").update(token).digest("hex");
  const tables = new Map<string, TableRecord>();
  const tokenIndex = new Map<string, string>(); // sha256(table token) hex -> tableId
  /** Uploaded logs; the bytes are in memory only without DATA_DIR, else in DATA_DIR/logs. */
  const logs = new Map<string, { meta: LogRecordMeta; data: Buffer | null }>();
  const invites = new Map<string, { tableId: string; expiresAt: number; used: boolean }>(); // by sha256(code)
  /** Download tokens by sha256(token); `id` names one in the console without revealing it (D-115). */
  const downloadTokens = new Map<string, DownloadToken>();
  const codes = new Map<string, AccessCode>(); // by id
  const codeByHash = new Map<string, string>(); // code hash -> id
  const settings = { logRetentionDays: o.logRetentionDays ?? 90 };
  const gameRepos = new GameRepoStore({ token: o.gameRepoToken, apiUrl: o.githubApiUrl });
  for (const spec of o.gameRepos ?? []) {
    try {
      gameRepos.add(spec, "deploy");
    } catch (e) {
      console.warn(`[cloud] deploy-time game repository skipped: ${(e as Error).message}`);
    }
  }
  const specOf = (r: GameRepo) => `${r.repo}@${r.ref}`;
  const repoIdOf = (spec: string) => [...gameRepos.repos.values()].find((r) => specOf(r).toLowerCase() === spec.toLowerCase())?.id;
  const repoSpecs = (ids: string[]) => ids.map((id) => gameRepos.repos.get(id)).filter((r): r is GameRepo => !!r).map(specOf);

  // ----- persistence: write-through helpers -----
  const saveTable = (t: TableRecord) => {
    if (t.status === "pending") return; // waiting tables say hello again; only decisions are kept
    const { repos, pairingCode, lastHello, ...rest } = t;
    store.put("table", t.tableId, { ...rest, repos: repoSpecs(repos) } satisfies StoredTable);
  };
  const saveCode = (c: AccessCode) => store.put("code", c.id, c);
  const saveSettings = () => store.put("setting", "service", settings);
  const saveRemote = (key: string, s: { tableId: string; expiresAt: number }) => store.put("session", key, { tableId: s.tableId, expiresAt: s.expiresAt });

  // ----- load what the store has (D-114) -----
  const now0 = Date.now();
  for (const { key: spec, value } of store.all<{ id: string; addedAt: number }>("repo")) {
    // A repository later added to the deploy list is that list's now; one that fails to parse is dropped.
    if (repoIdOf(spec)) {
      store.delete("repo", spec);
      continue;
    }
    try {
      gameRepos.add(spec, "console", value);
    } catch {
      store.delete("repo", spec);
    }
  }
  const savedSettings = store.all<{ logRetentionDays?: number }>("setting").find((x) => x.key === "service")?.value;
  if (Number.isInteger(savedSettings?.logRetentionDays) && savedSettings!.logRetentionDays! >= 1) settings.logRetentionDays = savedSettings!.logRetentionDays!;
  for (const { value: c } of store.all<AccessCode>("code")) {
    codes.set(c.id, c);
    codeByHash.set(c.hash, c.id);
  }
  for (const { value: s } of store.all<StoredTable>("table")) {
    const t: TableRecord = { ...s, pairingCode: "", repos: (s.repos ?? []).map(repoIdOf).filter((x): x is string => !!x), codeId: s.codeId ?? null };
    tables.set(t.tableId, t);
    if (t.tokenHash) tokenIndex.set(t.tokenHash, t.tableId);
  }
  for (const { key, value: meta } of store.all<LogRecordMeta>("log")) {
    // A restore from an older snapshot can leave a record without its file (and the other way round, cleaned below).
    if (store.persistent && !store.hasLog(key)) store.delete("log", key);
    else logs.set(key, { meta, data: null });
  }
  if (store.removeOrphanLogs(new Set(logs.keys()))) console.log("[cloud] removed log files that no record mentions");
  for (const { key, value } of store.all<{ tableId: string; expiresAt: number; used: boolean }>("invite")) value.expiresAt < now0 ? store.delete("invite", key) : invites.set(key, value);
  // Tokens saved before D-115 have only gameId and expiresAt.
  for (const { key, value } of store.all<Partial<DownloadToken> & { expiresAt: number }>("download")) {
    if (value.expiresAt < now0) store.delete("download", key);
    else downloadTokens.set(key, { gameId: value.gameId ?? null, tableId: value.tableId ?? null, from: value.from ?? null, to: value.to ?? null, label: value.label ?? "", createdAt: value.createdAt ?? 0, createdBy: value.createdBy ?? "", expiresAt: value.expiresAt, id: value.id ?? `d_${key.slice(0, 12)}` });
  }
  if (store.persistent) {
    const n = (k: Parameters<typeof store.all>[0]) => store.all(k).length;
    console.log(`[cloud] state ${store.opened.how} in ${store.dataDir}: ${tables.size} tables, ${codes.size} access codes, ${logs.size} logs, ${n("repo")} console repositories`);
  }

  void gameRepos.refreshAll();
  const repoTimer = o.gameRepoRefreshMs === 0 ? null : setInterval(() => void gameRepos.refreshAll(), o.gameRepoRefreshMs ?? 3600_000);
  repoTimer?.unref();

  // ----- access codes (D-113) -----
  /** Repository ids for a code's scope; "all" is every repository listed now, so new ones arrive too. */
  const scopeRepos = (s: CodeScope) =>
    s.kind === "none" ? [] : s.kind === "all" ? [...gameRepos.repos.keys()] : [...gameRepos.repos.values()].filter((r) => s.repos.includes(r.repo.toLowerCase())).map((r) => r.id);
  const codeOf = (t: TableRecord) => (t.codeId ? codes.get(t.codeId) : undefined);
  /** A table's repositories: its code's scope while it has one, else the ones ticked on its row. */
  const reposFor = (t: TableRecord) => {
    const c = codeOf(t);
    return c ? scopeRepos(c.scope) : t.repos;
  };
  const codeFor = (presented: unknown) => {
    const n = normalizeCode(presented);
    return n ? codes.get(codeByHash.get(hashCode(n)) ?? "") : undefined;
  };
  /** Bind a code to a table on first use, and note the use. */
  const useCode = (c: AccessCode, t: TableRecord) => {
    const now = Date.now();
    if (!c.tableId) Object.assign(c, { tableId: t.tableId, boundAt: now });
    c.lastUsedAt = now;
    saveCode(c);
  };
  const refuseCode = (c: AccessCode | undefined) => {
    if (!c) return;
    c.lastRefusedAt = Date.now();
    saveCode(c);
  };
  /** Free a code for the next board. */
  const unbindCode = (c: AccessCode) => {
    Object.assign(c, { tableId: null, boundAt: null });
    saveCode(c);
  };
  /** Whether a hello or heartbeat body presents an access code at all. */
  const presentsCode = (v: unknown) => v !== undefined && v !== null && v !== "";
  /** Wrong codes per client address; a hello with a code is refused once a client has too many in a minute. */
  const codeFailures = new Map<string, { n: number; reset: number }>();
  const codeBlocked = (ip: string) => {
    const f = codeFailures.get(ip);
    return !!f && f.reset > Date.now() && f.n >= MAX_CODE_FAILURES;
  };
  const codeFailed = (ip: string) => {
    const f = codeFailures.get(ip);
    if (!f || f.reset <= Date.now()) codeFailures.set(ip, { n: 1, reset: Date.now() + 60_000 });
    else f.n++;
  };
  /** Disconnect: the table stops using the service until an admin reconnects it. */
  const disconnect = (t: TableRecord) => {
    t.status = "revoked";
    if (t.tokenHash) tokenIndex.delete(t.tokenHash);
    t.tokenHash = null;
    tableSockets.get(t.tableId)?.close(4001, "revoked");
    saveTable(t);
  };
  const online = (t: TableRecord) => !!t.lastSeen && Date.now() - t.lastSeen < 60_000;
  /** A code as the console shows it: never the code itself, which exists only in the answer that created it. */
  const codeView = (c: AccessCode) => {
    const t = c.tableId ? tables.get(c.tableId) : undefined;
    const used = Math.max(c.lastUsedAt ?? 0, t?.codeId === c.id ? (t.lastSeen ?? 0) : 0) || null;
    return {
      id: c.id,
      hint: c.hint,
      label: c.label,
      validity: c.validity,
      expiresAt: c.expiresAt,
      scope: c.scope,
      createdAt: c.createdAt,
      createdBy: c.createdBy,
      revokedAt: c.revokedAt,
      state: codeState(c),
      table: t ? { tableId: t.tableId, name: t.name, status: t.status, online: online(t), lastSeen: t.lastSeen } : null,
      boundAt: c.boundAt,
      lastUsedAt: used,
      lastRefusedAt: c.lastRefusedAt,
      // A table still connected through a code past its validity: the console highlights it so an admin can decide.
      pastValidity: !!t && t.status === "approved" && t.codeId === c.id && isExpired(c),
    };
  };
  /** Scope from a request: well formed, and every named repository one the service lists. */
  const scopeFrom = (v: unknown) => {
    const s = parseScope(v);
    if (s.kind === "repos") {
      const known = new Set([...gameRepos.repos.values()].map((r) => r.repo.toLowerCase()));
      const unknown = s.repos.filter((r) => !known.has(r));
      if (unknown.length) throw Object.assign(new Error(`unknown repositories: ${unknown.join(", ")}`), { status: 400 });
    }
    return s;
  };
  const validityFrom = (v: unknown): Validity => {
    if (!VALIDITIES.includes(v as Validity)) throw Object.assign(new Error(`validity must be one of ${VALIDITIES.join(", ")}`), { status: 400 });
    return v as Validity;
  };
  const labelFrom = (v: unknown) => String(v ?? "").trim().slice(0, 60);
  const createdBy = (who: { via: "google"; email: string } | { via: "token" }) => (who.via === "google" ? who.email : "admin token");

  /** What the table should run besides its built-in games: its repositories' current bundles. */
  const tableConfig = (t: TableRecord) => ({ ...settings, gameBundles: gameRepos.forTable(reposFor(t)), accessCode: codeValidity(t) });
  /**
   * The validity of the code that approved this table, for its board (D-112): its hint, and the time left in ms
   * (null = forever, 0 or less = past its validity, while the table keeps working). Relative, so the table's clock
   * does not matter. Null when no code speaks for the table.
   */
  const codeValidity = (t: TableRecord) => {
    const c = codeOf(t);
    return c ? { hint: c.hint, expiresInMs: c.expiresAt === null ? null : c.expiresAt - Date.now() } : null;
  };
  /** Repository ids from a request body, each one known: unknown ids are an error, not silently dropped. */
  const repoIds = (v: unknown): string[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw Object.assign(new Error("repos must be a list of repository ids"), { status: 400 });
    const unknown = v.filter((id) => !gameRepos.repos.has(id));
    if (unknown.length) throw Object.assign(new Error(`unknown repositories: ${unknown.join(", ")}`), { status: 400 });
    return [...new Set(v as string[])];
  };
  const maxLogBytes = o.maxLogBytes ?? MAX_LOG_BYTES;
  const dataLimit = o.dataLimitBytes ?? 1024 * 1024 * 1024;
  /** The budget: the smaller of DATA_LIMIT_MB and the disk, less what the service's files take (and never more than the disk has free). */
  const statVolume =
    o.statVolume ??
    (() => {
      const vol = store.volume();
      const use = store.usage();
      if (!vol || !use) return null;
      const own = use.database + use.snapshot + use.logs + use.aside;
      const total = Math.min(dataLimit, vol.total);
      return { total, free: Math.max(0, Math.min(vol.free, total - own)) };
    });
  const logBytes = () => {
    let n = 0;
    for (const l of logs.values()) n += l.meta.bytes;
    return n;
  };
  /** Storage for the console: the volume, the service's own files, and the log cap. Null without DATA_DIR. */
  const storage = () => {
    const vol = statVolume();
    const use = store.usage();
    if (!vol || !use) return null;
    return { ...vol, reserve: reserveFor(vol.total), ...use, logCap: maxLogBytes, logBytes: logBytes(), low: vol.free < reserveFor(vol.total) * 1.5 };
  };
  const lookups = new Map<string, { n: number; reset: number }>(); // invite lookup rate limit per IP
  const iceServers = o.iceServers ?? [{ urls: "stun:stun.l.google.com:19302" }];
  // Remote play signaling (D-020): tables hold a socket here; remote browsers get a session per invite.
  const tableSockets = new Map<string, WebSocket>();
  const remoteSessions = new Map<string, { tableId: string; expiresAt: number; ws: WebSocket | null }>(); // by sha256(session id)
  for (const { key, value } of store.all<{ tableId: string; expiresAt: number }>("session")) value.expiresAt < now0 ? store.delete("session", key) : remoteSessions.set(key, { ...value, ws: null });
  /** The client's address; behind the ingress, the last X-Forwarded-For entry (the one the ingress added). */
  const proxies = new BlockList();
  if (o.trustProxy) {
    for (const c of o.trustProxy === true ? ["127.0.0.0/8", "::1/128", "10.42.0.0/16", "10.43.0.0/16"] : o.trustProxy) {
      const [net, bits] = c.split("/");
      proxies.addSubnet(net, Number(bits), isIPv6(net) ? "ipv6" : "ipv4");
    }
  }
  const fromProxy = (addr: string | undefined) => {
    if (!o.trustProxy || !addr) return false;
    const a = addr.replace(/^::ffff:/, "");
    return isIPv4(a) ? proxies.check(a, "ipv4") : isIPv6(a) && proxies.check(a, "ipv6");
  };
  const auth = createAdminAuth(o.google ?? null, o.publicUrl);
  const ownOrigin = new URL(o.publicUrl).origin;
  const clientIp = (req: IncomingMessage) => {
    const xff = fromProxy(req.socket.remoteAddress) ? String(req.headers["x-forwarded-for"] ?? "").split(",").map((x) => x.trim()).filter(Boolean).pop() : "";
    return xff || req.socket.remoteAddress || "?";
  };
  const limited = (ip: string, max = 20) => {
    const l = lookups.get(ip) ?? { n: 0, reset: Date.now() + 60_000 };
    if (Date.now() > l.reset) Object.assign(l, { n: 0, reset: Date.now() + 60_000 });
    l.n++;
    lookups.set(ip, l);
    return l.n > max;
  };

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const bearer = (req: IncomingMessage) => (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const tokenAdmin = (req: IncomingMessage) => !!o.adminToken && same(bearer(req), o.adminToken);
  /**
   * The signed-in admin (Google session) or a script holding ADMIN_TOKEN. A cookie-authenticated change must also come
   * from our own origin: SameSite=Lax already keeps cross-site POSTs cookieless, this is the second layer.
   */
  const admin = (req: IncomingMessage): { via: "google"; email: string } | { via: "token" } | null => {
    if (tokenAdmin(req)) return { via: "token" };
    const email = auth.session(req);
    if (!email) return null;
    const m = req.method ?? "GET";
    if (m !== "GET" && m !== "HEAD" && req.headers.origin !== ownOrigin) return null;
    return { via: "google", email };
  };
  /** A lifetime from a request: positive and finite, else the default; never above the cap. */
  const lifetime = (v: unknown, fallback: number, cap: number) => {
    const n = Number(v);
    return Math.min(Number.isFinite(n) && n > 0 ? n : fallback, cap);
  };
  const tableFor = (req: IncomingMessage) => {
    const key = tokenKey(bearer(req));
    const id = tokenIndex.get(key);
    const x = id ? tables.get(id) : undefined;
    return x && x.status === "approved" && x.tokenHash && same(x.tokenHash, key) ? x : undefined;
  };
  const body = async (req: IncomingMessage, limit = 64 * 1024): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    let n = 0;
    for await (const c of req) {
      n += (c as Buffer).length;
      if (n > limit) throw Object.assign(new Error("too large"), { status: 413 });
      chunks.push(c as Buffer);
    }
    return Buffer.concat(chunks);
  };
  const jsonBody = async (req: IncomingMessage) => {
    const b = await body(req);
    return b.length ? JSON.parse(b.toString("utf8")) : {};
  };
  const dropLog = (id: string) => {
    logs.delete(id);
    store.delete("log", id);
    if (store.persistent) store.deleteLog(id);
  };
  const logData = (id: string) => {
    const l = logs.get(id);
    return l ? (l.data ?? store.readLog(id)) : null;
  };
  const prune = () => {
    const now = Date.now();
    const cutoff = now - settings.logRetentionDays * 86400_000;
    for (const [id, l] of logs) if (l.meta.uploadedAt < cutoff) dropLog(id);
    for (const [k, i] of invites) if (i.expiresAt < now) (invites.delete(k), store.delete("invite", k));
    for (const [k, d] of downloadTokens) if (d.expiresAt < now) (downloadTokens.delete(k), store.delete("download", k));
    for (const [k, r] of remoteSessions) if (r.expiresAt < now) (r.ws?.close(4002, "expired"), remoteSessions.delete(k), store.delete("session", k));
    for (const [ip, l] of lookups) if (l.reset < now) lookups.delete(ip);
    for (const [ip, f] of codeFailures) if (f.reset < now) codeFailures.delete(ip);
    // Codes expired or revoked more than a year ago go, unless a table still uses one (D-113).
    for (const c of [...codes.values()]) {
      const t = c.tableId ? tables.get(c.tableId) : undefined;
      if (!stale(c, t?.status === "approved" && t.codeId === c.id, now)) continue;
      removeCode(c);
    }
    prunePending();
  };
  const removeCode = (c: AccessCode) => {
    codes.delete(c.id);
    codeByHash.delete(c.hash);
    store.delete("code", c.id);
    for (const t of tables.values()) if (t.codeId === c.id) (t.codeId = null, saveTable(t));
  };
  const prunePending = () => {
    for (const [id, t] of tables) if (t.status === "pending" && (t.lastHello ?? t.createdAt) < Date.now() - PENDING_TTL_MS) tables.delete(id);
  };
  const pendingCount = () => {
    let n = 0;
    for (const t of tables.values()) if (t.status === "pending") n++;
    return n;
  };
  const zip = (res: ServerResponse, data: Buffer) => {
    res.writeHead(200, { "content-type": "application/zip" });
    res.end(data);
  };
  /** A lifetime from now: the stored and the reported expiry are the same instant. */
  const expiry = (ms: number) => {
    const at = Date.now() + ms;
    return { at, iso: new Date(at).toISOString() };
  };
  const pruneTimer = setInterval(prune, 600_000);
  pruneTimer.unref();

  /** A request target URL can't parse (e.g. "//[") must answer 400, not throw: an unhandled rejection exits Node. */
  const parseUrl = (req: IncomingMessage) => {
    try {
      return new URL(req.url ?? "/", "http://cloud");
    } catch {
      return null;
    }
  };

  const server = createServer(async (req, res) => {
    const url = parseUrl(req);
    if (!url) return json(res, 400, { error: "bad request target" });
    const p = url.pathname;
    // HEAD is answered like GET (Node drops the body): uptime monitors on this cluster can only send HEAD.
    const m = req.method === "HEAD" ? "GET" : (req.method ?? "GET");
    let match: RegExpMatchArray | null;
    try {
      // {status, version}: the deploy smoke test and the cluster's version-exporter read the version (APP_VERSION, "dev" outside a release build).
      if (p === "/health") return json(res, 200, { status: "ok", version: appVersion() });
      if (m === "GET" && p === "/favicon.svg") {
        res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" });
        return res.end(await readFile(FAVICON));
      }
      if (await auth.handle(req, res, p)) return;
      if (m === "GET" && p === "/") {
        // Public landing page; also where logout lands (200, with a Sign in link, never a bounce to Google).
        const signedIn = auth.session(req);
        const note = url.searchParams.has("signed-out") ? `<p class="muted">You are signed out.</p>` : "";
        const action = signedIn
          ? `<p class="muted">Signed in as ${esc(signedIn)}.</p><p><a class="btn" href="/admin">Open the admin portal</a></p>`
          : auth.enabled
            ? `<p><a class="btn" href="/auth/google/login">Administrators: sign in with Google</a></p>`
            : `<p><a class="btn" href="/admin">Admin portal</a></p>`;
        // The version label is part of the public page (and checked by the deploy's smoke test).
        return sendPage(res, 200, "Game Table", `<p class="muted">The service behind Game Table: it pairs tables, relays invites for remote players and keeps game logs.</p>${note}${action}<p class="faint">${versionLabel()}</p>`);
      }
      if (m === "GET" && (p === "/admin" || p === "/admin/")) {
        // With Google sign-in configured the portal is for signed-in admins only; anonymous visitors go to the public
        // page with its Sign in link (the deploy smoke test asserts this 302 as an auth-enforcement check).
        if (auth.enabled && !auth.session(req)) {
          res.writeHead(302, { location: "/", "cache-control": "no-store" });
          return res.end();
        }
        res.writeHead(200, HTML_HEADERS);
        return res.end((await readFile(ADMIN_PAGE, "utf8")).replace("{{version}}", versionLabel()).replaceAll("{{repo}}", REPO_URL));
      }

      // ----- tables -----
      if (m === "POST" && p === "/api/tables/hello") {
        // Unauthenticated, so bounded: per address (a waiting table polls 12 times a minute; several may share a
        // home's address) and in total, or a flood of invented table ids would fill the pod's memory.
        const ip = clientIp(req);
        if (limited(`hello:${ip}`, 60)) return json(res, 429, { error: "too many requests; wait a minute" });
        const b = await jsonBody(req);
        const tableId = String(b.tableId ?? "");
        if (!/^[A-Za-z0-9_-]{8,64}$/.test(tableId)) return json(res, 400, { error: "tableId required" });
        const name = String(b.name ?? "Game Table").slice(0, 60);
        let t = tables.get(tableId);
        // A pre-approved access code (D-113) approves a new or waiting table at once. A disconnected table stays
        // disconnected (only Reconnect in the console undoes that), and an approved one already has what it needs.
        const presented = presentsCode(b.accessCode);
        let codeStatus: CodeStatus | undefined;
        if (presented && (!t || t.status === "pending")) {
          if (codeBlocked(ip)) return json(res, 429, { error: "too many wrong access codes; wait a minute" });
          const c = codeFor(b.accessCode);
          codeStatus = check(c, tableId);
          if (codeStatus === "accepted") {
            t ??= { tableId, name, status: "pending", pairingCode: "", tokenHash: null, lastSeen: null, metrics: {}, createdAt: Date.now(), repos: [], codeId: null };
            tables.set(tableId, t);
            Object.assign(t, { name, status: "approved", pairingCode: "", lastHello: undefined, repos: [], codeId: c!.id });
            useCode(c!, t);
            saveTable(t);
          } else {
            refuseCode(c);
            codeFailed(ip);
          }
        }
        // A disconnected table still hears about its code (say, that it was revoked), but the code changes nothing.
        if (presented && t?.status === "revoked" && !codeBlocked(ip)) {
          codeStatus = check(codeFor(b.accessCode), tableId);
          if (codeStatus !== "accepted") codeFailed(ip);
        }
        const withCode = (x: Record<string, unknown>) => (codeStatus ? { ...x, code: { status: codeStatus } } : x);
        if (!t) {
          if (pendingCount() >= MAX_PENDING) {
            prunePending();
            if (pendingCount() >= MAX_PENDING) return json(res, 503, { error: "too many tables waiting for approval; try again later" });
          }
          t = { tableId, name, status: "pending", pairingCode: code(6), tokenHash: null, lastSeen: null, metrics: {}, createdAt: Date.now(), repos: [], codeId: null };
          tables.set(tableId, t);
        }
        if (t.status === "revoked") return json(res, 403, withCode({ status: "revoked" }));
        if (t.status === "pending") {
          t.lastHello = Date.now();
          return json(res, 202, withCode({ status: "pending", pairingCode: t.pairingCode }));
        }
        // Approved: the token is handed out once, on the first hello after approval. Only its hash is kept.
        if (!t.tokenHash) {
          const token = randomToken();
          t.tokenHash = tokenKey(token);
          tokenIndex.set(t.tokenHash, t.tableId);
          saveTable(t);
          return json(res, 200, withCode({ status: "approved", tableToken: token, config: tableConfig(t) }));
        }
        if (!same(tokenKey(bearer(req)), t.tokenHash)) return json(res, 200, withCode({ status: "approved", tokenIssued: true }));
        // The table proved it holds the token, so it may hear it again.
        return json(res, 200, withCode({ status: "approved", tableToken: bearer(req), config: tableConfig(t) }));
      }
      if (m === "POST" && p === "/api/tables/heartbeat") {
        const t = tableFor(req);
        if (!t) return json(res, 401, { error: "unknown or revoked table" });
        const b = await jsonBody(req);
        t.lastSeen = Date.now();
        if (b.metrics && typeof b.metrics === "object") t.metrics = b.metrics;
        // An approved table may present an access code too (typed on its board later): it then belongs to that code,
        // which decides its repositories from now on (D-113). A code it had before is freed.
        let codeStatus: CodeStatus | undefined;
        if (presentsCode(b.accessCode) && !codeBlocked(clientIp(req))) {
          const c = codeFor(b.accessCode);
          codeStatus = check(c, t.tableId);
          if (codeStatus === "accepted") {
            const old = codeOf(t);
            if (old && old.id !== c!.id && old.tableId === t.tableId) unbindCode(old);
            t.codeId = c!.id;
            useCode(c!, t);
          } else {
            refuseCode(c);
            codeFailed(clientIp(req));
          }
        }
        saveTable(t);
        return json(res, 200, { config: tableConfig(t), ...(codeStatus ? { code: { status: codeStatus } } : {}) });
      }
      if (m === "GET" && (match = p.match(/^\/api\/tables\/bundles\/([0-9a-f]{64})$/))) {
        // Only the bundles of this table's repositories: a table can't fetch games it was not given.
        const t = tableFor(req);
        if (!t) return json(res, 401, { error: "unknown or revoked table" });
        const data = gameRepos.payloadFor(reposFor(t), match[1]);
        if (!data) return json(res, 404, { error: "no such bundle for this table" });
        res.writeHead(200, { "content-type": "application/gzip", "cache-control": "no-store" });
        return res.end(data);
      }
      if (m === "PUT" && (match = p.match(/^\/api\/tables\/logs\/([\w-]+)$/))) {
        const t = tableFor(req);
        if (!t) return json(res, 401, { error: "unknown or revoked table" });
        const existing = logs.get(match[1]);
        if (existing && existing.meta.tableId !== t.tableId) return json(res, 409, { error: "a log with this id belongs to another table" });
        const data = await body(req, 50 * 1024 * 1024);
        const gameId = String(url.searchParams.get("gameId") ?? "");
        // Bounded in total, and on disk by the volume's free space: the oldest logs make room for the new one, and the
        // reserve stays free for the database (D-114). Re-uploading the same id replaces it.
        if (existing) dropLog(match[1]);
        let total = logBytes();
        const vol = statVolume();
        let free = vol ? vol.free : Infinity;
        const reserve = vol ? reserveFor(vol.total) : 0;
        const fits = () => total + data.length <= maxLogBytes && free - data.length >= reserve;
        // Larger than all the room there could be: refuse before dropping anything. The table keeps its copy.
        if (data.length > maxLogBytes || free + total - data.length < reserve) {
          console.warn(`[cloud] log ${match[1]} (${data.length} bytes) refused: not enough room on the volume`);
          return json(res, 507, { error: "the service's storage is full; the table keeps its own copy" });
        }
        for (const l of [...logs.values()].sort((a, b) => a.meta.uploadedAt - b.meta.uploadedAt)) {
          if (fits()) break;
          dropLog(l.meta.id);
          total -= l.meta.bytes;
          free += l.meta.bytes;
        }

        // What the log says about itself (D-116); logs in the old format have only the query's game and kind.
        const run = await readRunMeta(data);
        const meta: LogRecordMeta = {
          ...run,
          id: match[1],
          tableId: t.tableId,
          gameId: run.gameId ?? gameId,
          simulation: run.simulation ?? url.searchParams.get("simulation") === "1",
          bytes: data.length,
          uploadedAt: Date.now(),
        };
        if (store.persistent) store.writeLog(meta.id, data); // the file first: a record never points at a missing file
        store.put("log", meta.id, meta);
        logs.set(meta.id, { meta, data: store.persistent ? null : data });
        return json(res, 201, { ok: true });
      }
      if (m === "POST" && p === "/api/tables/invites") {
        const t = tableFor(req);
        if (!t) return json(res, 401, { error: "unknown or revoked table" });
        const b = await jsonBody(req);
        const exp = expiry(lifetime(b.ttlMinutes, 120, 24 * 60) * 60_000);
        let token = code(8);
        while (invites.has(tokenKey(token))) token = code(8);
        const inv = { tableId: t.tableId, expiresAt: exp.at, used: false };
        invites.set(tokenKey(token), inv);
        store.put("invite", tokenKey(token), inv);
        return json(res, 201, { token, url: `${o.publicUrl}/i/${token}`, expiresAt: exp.iso });
      }
      if (m === "GET" && (match = p.match(/^\/i\/([A-Za-z0-9]{1,12})$/))) {
        if (limited(clientIp(req))) return json(res, 429, { error: "too many attempts; wait a minute" });
        const inv = invites.get(tokenKey(match[1].toUpperCase()));
        // A used invite still serves the page: the player who claimed it reconnects with their session.
        if (!inv || inv.expiresAt < Date.now()) return sendPage(res, 404, "Invite not found", `<p>This invite has expired or the code is wrong. Ask for a new one.</p>`);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" });
        return res.end(await readFile(REMOTE_PAGE));
      }
      if (m === "GET" && p === "/remote-sw.js") {
        // The remote page's service worker routes board and deck files over the WebRTC channel.
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "service-worker-allowed": "/", "cache-control": "no-cache" });
        return res.end(await readFile(REMOTE_SW));
      }

      // ----- admin -----
      if (p.startsWith("/admin/api/")) {
        const who = admin(req);
        if (!who) return json(res, 401, { error: "sign in required", signIn: auth.enabled ? "/auth/google/login" : null });
        if (m === "GET" && p === "/admin/api/me") return json(res, 200, who);
        if (m === "GET" && p === "/admin/api/tables") {
          return json(
            res,
            200,
            [...tables.values()].map((t) => {
              const { tokenHash, lastHello, ...shown } = t;
              const c = codeOf(t);
              return {
                ...shown,
                repos: reposFor(t),
                // "code": the access code's scope decides, and the console shows the ticks read-only (D-113).
                reposFrom: c ? "code" : "table",
                code: c ? { id: c.id, hint: c.hint, label: c.label, state: codeState(c), pastValidity: t.status === "approved" && isExpired(c) } : null,
                online: online(t),
              };
            }),
          );
        }
        if (m === "POST" && (match = p.match(/^\/admin\/api\/tables\/pair\/([A-Z0-9]{6})$/))) {
          // The console ticks the extra-game repositories this table gets as it approves it (D-097).
          const repos = repoIds((await jsonBody(req)).repos);
          const t = [...tables.values()].find((x) => x.status === "pending" && x.pairingCode === match![1]);
          if (!t) return json(res, 404, { error: "no table waiting with that pairing code" });
          t.status = "approved";
          t.repos = repos;
          t.codeId = null;
          saveTable(t);
          return json(res, 200, { tableId: t.tableId, status: t.status, repos: t.repos });
        }
        if (m === "PUT" && (match = p.match(/^\/admin\/api\/tables\/([\w-]+)\/repos$/))) {
          const t = tables.get(match[1]);
          if (!t) return json(res, 404, { error: "no such table" });
          const c = codeOf(t);
          if (c) return json(res, 409, { error: `this table's games come from its access code ${c.label ? `"${c.label}"` : c.hint + "…"}; change the code's scope instead` });
          t.repos = repoIds((await jsonBody(req)).repos);
          saveTable(t);
          return json(res, 200, { tableId: t.tableId, repos: t.repos });
        }
        if (m === "GET" && p === "/admin/api/repos") return json(res, 200, { repos: gameRepos.list(), token: !!o.gameRepoToken });
        if (m === "POST" && p === "/admin/api/repos") {
          const b = await jsonBody(req);
          let r;
          try {
            r = gameRepos.add(String(b.repo ?? "") + (b.ref ? `@${String(b.ref)}` : ""));
          } catch (e) {
            throw Object.assign(e as Error, { status: (e as { status?: number }).status ?? 400 });
          }
          store.put("repo", specOf(r), { id: r.id, addedAt: r.addedAt });
          await gameRepos.refresh(r.id); // the console shows at once whether it worked; the repository stays listed either way
          return json(res, 201, gameRepos.list().find((x) => x.id === r.id));
        }
        if (m === "POST" && (match = p.match(/^\/admin\/api\/repos\/([\w-]+)\/refresh$/))) {
          await gameRepos.refresh(match[1]);
          return json(res, 200, gameRepos.list().find((x) => x.id === match![1]));
        }
        if (m === "DELETE" && (match = p.match(/^\/admin\/api\/repos\/([\w-]+)$/))) {
          const gone = gameRepos.repos.get(match[1]);
          if (!gameRepos.remove(match[1])) return json(res, 404, { error: "no such repository" }); // a deploy-time one throws 409
          store.delete("repo", specOf(gone!));
          // Tables lose its games at their next heartbeat.
          for (const t of tables.values()) {
            if (!t.repos.includes(match[1])) continue;
            t.repos = t.repos.filter((id) => id !== match![1]);
            saveTable(t);
          }
          return json(res, 200, { ok: true });
        }
        if (m === "POST" && (match = p.match(/^\/admin\/api\/tables\/([\w-]+)\/revoke$/))) {
          const t = tables.get(match[1]);
          if (!t) return json(res, 404, { error: "no such table" });
          disconnect(t);
          return json(res, 200, { tableId: t.tableId, status: t.status });
        }
        if (m === "DELETE" && (match = p.match(/^\/admin\/api\/tables\/([\w-]+)$/))) {
          // Remove a table for good (D-115): only one that is disconnected or still waiting, never one that is online.
          // Its access code is freed; its logs stay unless ?logs=1. If that PC says hello again, it is a new table.
          const t = tables.get(match[1]);
          if (!t) return json(res, 404, { error: "no such table" });
          if (t.status === "approved") return json(res, 409, { error: "disconnect the table first" });
          for (const x of codes.values()) if (x.tableId === t.tableId) unbindCode(x);
          for (const [k, i] of invites) if (i.tableId === t.tableId) (invites.delete(k), store.delete("invite", k));
          for (const [k, r] of remoteSessions) if (r.tableId === t.tableId) (r.ws?.close(4002, "table deleted"), remoteSessions.delete(k), store.delete("session", k));
          let logsDeleted = 0;
          if (url.searchParams.get("logs") === "1") for (const l of [...logs.values()]) if (l.meta.tableId === t.tableId) (dropLog(l.meta.id), logsDeleted++);
          tables.delete(t.tableId);
          store.delete("table", t.tableId);
          return json(res, 200, { ok: true, logsDeleted });
        }
        if (m === "POST" && (match = p.match(/^\/admin\/api\/tables\/([\w-]+)\/reconnect$/))) {
          // Undo a disconnect: the same table, approved again. It picks up a new token at its next hello (D-085).
          const t = tables.get(match[1]);
          if (!t) return json(res, 404, { error: "no such table" });
          if (t.status !== "revoked") return json(res, 409, { error: `the table is ${t.status}, not disconnected` });
          t.status = "approved";
          // A revoked code no longer speaks for the table: it comes back with its own ticks (none until an admin ticks some).
          if (codeOf(t)?.revokedAt) t.codeId = null;
          saveTable(t);
          return json(res, 200, { tableId: t.tableId, status: t.status });
        }
        if (m === "GET" && p === "/admin/api/metrics") {
          const all = [...tables.values()];
          const sum = (k: string) => all.reduce((a, t) => a + (t.metrics[k] ?? 0), 0);
          return json(res, 200, { tables: all.length, gamesPlayed: sum("gamesPlayed"), gamesTerminated: sum("gamesTerminated"), totalGameMs: sum("totalGameMs"), simulations: sum("simulations"), storage: storage() });
        }
        if (m === "GET" && p === "/admin/api/settings") return json(res, 200, settings);
        if (m === "PUT" && p === "/admin/api/settings") {
          const b = await jsonBody(req);
          const d = Number(b.logRetentionDays);
          if (!Number.isInteger(d) || d < 1 || d > 3650) return json(res, 400, { error: "logRetentionDays must be 1–3650" });
          settings.logRetentionDays = d;
          saveSettings();
          prune();
          return json(res, 200, settings);
        }
        if (m === "GET" && p === "/admin/api/logs") {
          // Filters (D-116): gameId, tableId, from and to (dates the games started), simulation (1 or 0).
          const f = filterFrom((k) => url.searchParams.get(k));
          return json(res, 200, [...logs.values()].filter((l) => matches(l.meta, f)).map((l) => ({ ...l.meta, tableName: tables.get(l.meta.tableId)?.name ?? l.meta.tableName ?? null })));
        }
        if (m === "DELETE" && (match = p.match(/^\/admin\/api\/logs\/([\w-]+)$/))) {
          if (!logs.has(match[1])) return json(res, 404, { error: "no such log" });
          dropLog(match[1]);
          return json(res, 200, { ok: true });
        }
        if (m === "POST" && p === "/admin/api/logs/delete") {
          // Bulk delete (D-115): by kind and/or table; at least one filter, so "everything" is never one click.
          const b = await jsonBody(req);
          const sim = b.simulation === true ? true : b.simulation === false ? false : undefined;
          const tableId = typeof b.tableId === "string" && b.tableId ? b.tableId : undefined;
          if (sim === undefined && !tableId) return json(res, 400, { error: "give simulation (true/false) and/or tableId" });
          let deleted = 0;
          for (const l of [...logs.values()]) {
            if (sim !== undefined && l.meta.simulation !== sim) continue;
            if (tableId && l.meta.tableId !== tableId) continue;
            dropLog(l.meta.id);
            deleted++;
          }
          return json(res, 200, { deleted });
        }
        if (m === "GET" && (match = p.match(/^\/admin\/api\/logs\/([\w-]+)\.zip$/))) {
          const data = logData(match[1]);
          if (!data) return json(res, 404, { error: "no such log" });
          return zip(res, data);
        }
        if (m === "POST" && p === "/admin/api/download-tokens") {
          const b = await jsonBody(req);
          const token = randomToken();
          const exp = expiry(lifetime(b.expiresInHours, 24, 24 * 90) * 3600_000);
          const scope = filterFrom((k) => (b[k] === undefined || b[k] === null ? null : String(b[k]).trim())); // 400 on a bad date
          const d: DownloadToken = {
            id: `d_${randomBytes(6).toString("hex")}`,
            gameId: scope.gameId ?? null,
            tableId: scope.tableId ?? null,
            from: scope.from ?? null,
            to: scope.to ?? null,
            label: labelFrom(b.label),
            expiresAt: exp.at,
            createdAt: Date.now(),
            createdBy: createdBy(who),
          };
          downloadTokens.set(tokenKey(token), d);
          store.put("download", tokenKey(token), d);
          return json(res, 201, { id: d.id, token, url: `${o.publicUrl}/dl/${token}`, expiresAt: exp.iso });
        }
        if (m === "GET" && p === "/admin/api/download-tokens") {
          // The active tokens, never the tokens themselves (only their hashes are kept).
          const now = Date.now();
          return json(res, 200, [...downloadTokens.values()].filter((d) => d.expiresAt > now).sort((a, b) => b.createdAt - a.createdAt));
        }
        if (m === "DELETE" && (match = p.match(/^\/admin\/api\/download-tokens\/(d_[0-9a-f]{12})$/))) {
          const k = [...downloadTokens].find(([, d]) => d.id === match![1])?.[0];
          if (!k) return json(res, 404, { error: "no such download token" });
          downloadTokens.delete(k);
          store.delete("download", k);
          return json(res, 200, { ok: true });
        }

        // ----- access codes (D-113) -----
        if (m === "GET" && p === "/admin/api/codes") {
          return json(res, 200, [...codes.values()].sort((a, b) => b.createdAt - a.createdAt).map(codeView));
        }
        if (m === "POST" && p === "/admin/api/codes") {
          const b = await jsonBody(req);
          const c0 = { label: labelFrom(b.label), validity: validityFrom(b.validity), scope: scopeFrom(b.scope ?? { kind: "none" }) };
          if (codes.size >= MAX_CODES) return json(res, 409, { error: `at most ${MAX_CODES} codes; delete old ones first` });
          let plain = newCode();
          while (codeByHash.has(hashCode(plain))) plain = newCode();
          const now = Date.now();
          const c: AccessCode = {
            id: newCodeId(),
            hash: hashCode(plain),
            hint: plain.slice(0, 2),
            ...c0,
            expiresAt: expiryFor(c0.validity, now),
            createdAt: now,
            createdBy: createdBy(who),
            revokedAt: null,
            tableId: null,
            boundAt: null,
            lastUsedAt: null,
            lastRefusedAt: null,
          };
          codes.set(c.id, c);
          codeByHash.set(c.hash, c.id);
          saveCode(c);
          // The only time the code itself leaves the service.
          return json(res, 201, { ...codeView(c), code: formatCode(plain) });
        }
        if ((match = p.match(/^\/admin\/api\/codes\/(c_[0-9a-f]{12})(?:\/(revoke|release))?$/))) {
          const c = codes.get(match[1]);
          if (!c) return json(res, 404, { error: "no such code" });
          const bound = c.tableId ? tables.get(c.tableId) : undefined;
          const holds = bound && bound.codeId === c.id ? bound : undefined;
          if (m === "PATCH" && !match[2]) {
            const b = await jsonBody(req);
            if (b.label !== undefined) c.label = labelFrom(b.label);
            // A new validity counts from now: "one more month" for a code that is about to run out.
            if (b.validity !== undefined) {
              const validity = validityFrom(b.validity);
              Object.assign(c, { validity, expiresAt: expiryFor(validity) });
            }
            // The bound table follows a new scope at its next heartbeat (within 15 s, between games).
            if (b.scope !== undefined) c.scope = scopeFrom(b.scope);
            saveCode(c);
            return json(res, 200, codeView(c));
          }
          if (m === "POST" && match[2] === "revoke") {
            // Revoking stops the code and disconnects the table it approved; Reconnect in the console still works.
            c.revokedAt ??= Date.now();
            saveCode(c);
            if (holds?.status === "approved") disconnect(holds);
            return json(res, 200, codeView(c));
          }
          if (m === "POST" && match[2] === "release") {
            // For a table PC that lost its identity (reinstalled): the code is free for the next board. The table it
            // was bound to is disconnected, so the code never serves two boards.
            if (holds) {
              if (holds.status === "approved") disconnect(holds);
              holds.codeId = null;
              saveTable(holds);
            }
            unbindCode(c);
            return json(res, 200, codeView(c));
          }
          if (m === "DELETE" && !match[2]) {
            if (holds?.status === "approved") disconnect(holds);
            removeCode(c);
            return json(res, 200, { ok: true });
          }
        }
      }

      // ----- token downloads for pipelines (no login) -----
      if (m === "GET" && (match = p.match(/^\/dl\/([\w-]+)(?:\/([\w-]+)\.zip)?$/))) {
        const d = downloadTokens.get(tokenKey(match[1]));
        if (!d || d.expiresAt < Date.now()) return json(res, 404, { error: "token not found or expired" });
        const scope: LogFilter = { gameId: d.gameId ?? undefined, tableId: d.tableId ?? undefined, from: d.from ?? undefined, to: d.to ?? undefined };
        if (!match[2]) return json(res, 200, [...logs.values()].filter((l) => matches(l.meta, scope)).map((l) => l.meta));
        const l = logs.get(match[2]);
        const data = l && matches(l.meta, scope) && logData(l.meta.id);
        if (!data) return json(res, 404, { error: "no such log for this token" });
        return zip(res, data);
      }

      json(res, 404, { error: "not found" });
    } catch (err) {
      const status = (err as { status?: number }).status ?? (err instanceof SyntaxError ? 400 : 500);
      if (status === 500) console.error(err);
      json(res, status, { error: status === 500 ? "internal error" : (err as Error).message });
    }
  });

  // ----- signaling sockets -----
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  const sendJson = (ws: WebSocket | null | undefined, v: unknown) => ws && ws.readyState === ws.OPEN && ws.send(JSON.stringify(v));

  server.on("upgrade", (req, socket, head) => {
    const reject = (code: number) => {
      socket.write(`HTTP/1.1 ${code} No\r\n\r\n`);
      socket.destroy();
    };
    const url = parseUrl(req);
    if (!url) return reject(400);
    if (url.pathname === "/api/tables/ws") {
      const t = tableFor(req as IncomingMessage);
      if (!t) return reject(401);
      return wss.handleUpgrade(req, socket, head, (ws) => onTableSocket(ws, t));
    }
    if (url.pathname === "/api/remote/ws") {
      if (limited(clientIp(req))) return reject(429);
      const sessionId = url.searchParams.get("session");
      let session = sessionId ? remoteSessions.get(tokenKey(sessionId)) : undefined;
      let id = sessionId ?? "";
      if (!session || session.expiresAt < Date.now()) {
        const key = tokenKey((url.searchParams.get("invite") ?? "").toUpperCase());
        const inv = invites.get(key);
        if (!inv || inv.used || inv.expiresAt < Date.now()) return reject(404);
        // Claimed now, not when the table answers: a second tab or a forwarded link can't open another session.
        inv.used = true;
        store.put("invite", key, inv);
        id = randomToken();
        session = { tableId: inv.tableId, expiresAt: inv.expiresAt + 12 * 3600_000, ws: null };
        remoteSessions.set(tokenKey(id), session);
        saveRemote(tokenKey(id), session);
      }
      const s = session;
      return wss.handleUpgrade(req, socket, head, (ws) => onRemoteSocket(ws, id, s));
    }
    reject(404);
  });

  function onTableSocket(ws: WebSocket, t: TableRecord) {
    tableSockets.get(t.tableId)?.close(4000, "replaced");
    tableSockets.set(t.tableId, ws);
    ws.on("message", (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      const s = remoteSessions.get(tokenKey(String(msg.session)));
      if (!s || s.tableId !== t.tableId) return;
      if (msg.type === "answer" && typeof msg.sdp === "string") {
        sendJson(s.ws, { type: "answer", sdp: msg.sdp });
      } else if (msg.type === "error") sendJson(s.ws, { type: "error", message: String(msg.message ?? "the table refused the connection") });
    });
    ws.on("close", () => tableSockets.get(t.tableId) === ws && tableSockets.delete(t.tableId));
  }

  function onRemoteSocket(ws: WebSocket, id: string, s: { tableId: string; expiresAt: number; ws: WebSocket | null }) {
    s.ws?.close(4000, "replaced");
    s.ws = ws;
    const t = tables.get(s.tableId);
    sendJson(ws, { type: "hello", session: id, iceServers, tableName: t?.name ?? "Game Table" });
    ws.on("message", (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type !== "offer" || typeof msg.sdp !== "string" || msg.sdp.length > 100_000) return;
      const tws = tableSockets.get(s.tableId);
      if (!tws || t?.status !== "approved") return sendJson(ws, { type: "error", message: "The table is not connected right now. Try again in a moment." });
      sendJson(tws, { type: "offer", session: id, sdp: msg.sdp, iceServers });
    });
    ws.on("close", () => s.ws === ws && (s.ws = null));
  }

  return new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
    server.listen(o.port, o.host ?? "0.0.0.0", () => {
      const a = server.address();
      resolve({
        port: typeof a === "object" && a ? a.port : o.port,
        close: () =>
          new Promise((r) => {
            clearInterval(pruneTimer);
            if (repoTimer) clearInterval(repoTimer);
            store.close(); // writes the snapshot
            for (const c of wss.clients) c.terminate();
            wss.close();
            server.closeAllConnections();
            server.close(() => r());
          }),
      });
    });
  });
}
