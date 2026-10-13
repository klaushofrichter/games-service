// Cloud service (games.skylar.technology): table enrollment, heartbeat and metrics, log upload with admin and token
// downloads, invites and remote-play signaling. State is in memory, so the service runs as exactly one replica
// (D-036, D-071); a persistent store is the next step.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { BlockList, isIPv4, isIPv6 } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { createAdminAuth, esc, HTML_HEADERS, randomToken, same, sendPage, type GoogleAuthOptions } from "./auth.ts";

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

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = (n: number) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
const MAX_PENDING = 500;
const PENDING_TTL_MS = 10 * 60_000;
/** Total bytes of stored logs; the oldest are dropped to make room for a new upload. */
const MAX_LOG_BYTES = 256 * 1024 * 1024;

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
  /** Cap on the total size of stored logs (default 256 MB). */
  maxLogBytes?: number;
}

interface TableRecord {
  tableId: string;
  name: string;
  status: "pending" | "approved" | "revoked";
  pairingCode: string;
  tableToken: string | null;
  lastSeen: number | null;
  /** Last hello while pending: waiting tables poll every 5 s; one gone quiet for 10 minutes is dropped. */
  lastHello?: number;
  metrics: Record<string, number>;
  createdAt: number;
}

interface LogRecordMeta {
  id: string;
  tableId: string;
  gameId: string;
  simulation: boolean;
  bytes: number;
  uploadedAt: number;
}

export function startCloud(o: CloudOptions) {
  const tables = new Map<string, TableRecord>();
  const tokenIndex = new Map<string, string>(); // sha256(table token) hex -> tableId
  const tokenKey = (token: string) => createHash("sha256").update(token).digest("hex");
  const logs = new Map<string, { meta: LogRecordMeta; data: Buffer }>();
  const invites = new Map<string, { tableId: string; expiresAt: number; used: boolean }>();
  const downloadTokens = new Map<string, { gameId: string | null; expiresAt: number }>();
  const settings = { logRetentionDays: o.logRetentionDays ?? 90 };
  const maxLogBytes = o.maxLogBytes ?? MAX_LOG_BYTES;
  const lookups = new Map<string, { n: number; reset: number }>(); // invite lookup rate limit per IP
  const iceServers = o.iceServers ?? [{ urls: "stun:stun.l.google.com:19302" }];
  // Remote play signaling (D-020): tables hold a socket here; remote browsers get a session per invite.
  const tableSockets = new Map<string, WebSocket>();
  const remoteSessions = new Map<string, { tableId: string; expiresAt: number; ws: WebSocket | null }>();
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
    const t = bearer(req);
    const id = tokenIndex.get(tokenKey(t));
    const x = id ? tables.get(id) : undefined;
    return x && x.status === "approved" && x.tableToken && same(x.tableToken, t) ? x : undefined;
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
  const prune = () => {
    const cutoff = Date.now() - settings.logRetentionDays * 86400_000;
    for (const [id, l] of logs) if (l.meta.uploadedAt < cutoff) logs.delete(id);
    for (const [t, i] of invites) if (i.expiresAt < Date.now()) invites.delete(t);
    for (const [t, d] of downloadTokens) if (d.expiresAt < Date.now()) downloadTokens.delete(t);
    for (const [id, r] of remoteSessions) if (r.expiresAt < Date.now()) (r.ws?.close(4002, "expired"), remoteSessions.delete(id));
    for (const [ip, l] of lookups) if (l.reset < Date.now()) lookups.delete(ip);
    prunePending();
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
        if (limited(`hello:${clientIp(req)}`, 60)) return json(res, 429, { error: "too many requests; wait a minute" });
        const b = await jsonBody(req);
        const tableId = String(b.tableId ?? "");
        if (!/^[A-Za-z0-9_-]{8,64}$/.test(tableId)) return json(res, 400, { error: "tableId required" });
        let t = tables.get(tableId);
        if (!t) {
          if (pendingCount() >= MAX_PENDING) {
            prunePending();
            if (pendingCount() >= MAX_PENDING) return json(res, 503, { error: "too many tables waiting for approval; try again later" });
          }
          t = { tableId, name: String(b.name ?? "Game Table").slice(0, 60), status: "pending", pairingCode: code(6), tableToken: null, lastSeen: null, metrics: {}, createdAt: Date.now() };
          tables.set(tableId, t);
        }
        if (t.status === "revoked") return json(res, 403, { status: "revoked" });
        if (t.status === "pending") {
          t.lastHello = Date.now();
          return json(res, 202, { status: "pending", pairingCode: t.pairingCode });
        }
        // Approved: the token is handed out once, on the first hello after approval.
        if (!t.tableToken) {
          t.tableToken = randomToken();
          tokenIndex.set(tokenKey(t.tableToken), t.tableId);
        }
        else if (!same(bearer(req), t.tableToken)) return json(res, 200, { status: "approved", tokenIssued: true });
        return json(res, 200, { status: "approved", tableToken: t.tableToken, config: settings });
      }
      if (m === "POST" && p === "/api/tables/heartbeat") {
        const t = tableFor(req);
        if (!t) return json(res, 401, { error: "unknown or revoked table" });
        const b = await jsonBody(req);
        t.lastSeen = Date.now();
        if (b.metrics && typeof b.metrics === "object") t.metrics = b.metrics;
        return json(res, 200, { config: settings });
      }
      if (m === "PUT" && (match = p.match(/^\/api\/tables\/logs\/([\w-]+)$/))) {
        const t = tableFor(req);
        if (!t) return json(res, 401, { error: "unknown or revoked table" });
        const existing = logs.get(match[1]);
        if (existing && existing.meta.tableId !== t.tableId) return json(res, 409, { error: "a log with this id belongs to another table" });
        const data = await body(req, 50 * 1024 * 1024);
        const gameId = String(url.searchParams.get("gameId") ?? "");
        // Bounded in total too: the oldest logs make room for the new one.
        logs.delete(match[1]);
        let total = 0;
        for (const l of logs.values()) total += l.data.length;
        for (const l of [...logs.values()].sort((a, b) => a.meta.uploadedAt - b.meta.uploadedAt)) {
          if (total + data.length <= maxLogBytes) break;
          logs.delete(l.meta.id);
          total -= l.data.length;
        }
        logs.set(match[1], { meta: { id: match[1], tableId: t.tableId, gameId, simulation: url.searchParams.get("simulation") === "1", bytes: data.length, uploadedAt: Date.now() }, data });
        return json(res, 201, { ok: true });
      }
      if (m === "POST" && p === "/api/tables/invites") {
        const t = tableFor(req);
        if (!t) return json(res, 401, { error: "unknown or revoked table" });
        const b = await jsonBody(req);
        const exp = expiry(lifetime(b.ttlMinutes, 120, 24 * 60) * 60_000);
        let token = code(8);
        while (invites.has(token)) token = code(8);
        invites.set(token, { tableId: t.tableId, expiresAt: exp.at, used: false });
        return json(res, 201, { token, url: `${o.publicUrl}/i/${token}`, expiresAt: exp.iso });
      }
      if (m === "GET" && (match = p.match(/^\/i\/([A-Za-z0-9]{1,12})$/))) {
        if (limited(clientIp(req))) return json(res, 429, { error: "too many attempts; wait a minute" });
        const inv = invites.get(match[1].toUpperCase());
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
          return json(res, 200, [...tables.values()].map(({ tableToken, ...t }) => ({ ...t, online: !!t.lastSeen && Date.now() - t.lastSeen < 60_000 })));
        }
        if (m === "POST" && (match = p.match(/^\/admin\/api\/tables\/pair\/([A-Z0-9]{6})$/))) {
          const t = [...tables.values()].find((x) => x.status === "pending" && x.pairingCode === match![1]);
          if (!t) return json(res, 404, { error: "no table waiting with that pairing code" });
          t.status = "approved";
          return json(res, 200, { tableId: t.tableId, status: t.status });
        }
        if (m === "POST" && (match = p.match(/^\/admin\/api\/tables\/([\w-]+)\/revoke$/))) {
          const t = tables.get(match[1]);
          if (!t) return json(res, 404, { error: "no such table" });
          t.status = "revoked";
          if (t.tableToken) tokenIndex.delete(tokenKey(t.tableToken));
          t.tableToken = null;
          tableSockets.get(t.tableId)?.close(4001, "revoked");
          return json(res, 200, { tableId: t.tableId, status: t.status });
        }
        if (m === "GET" && p === "/admin/api/metrics") {
          const all = [...tables.values()];
          const sum = (k: string) => all.reduce((a, t) => a + (t.metrics[k] ?? 0), 0);
          return json(res, 200, { tables: all.length, gamesPlayed: sum("gamesPlayed"), gamesTerminated: sum("gamesTerminated"), totalGameMs: sum("totalGameMs"), simulations: sum("simulations") });
        }
        if (m === "GET" && p === "/admin/api/settings") return json(res, 200, settings);
        if (m === "PUT" && p === "/admin/api/settings") {
          const b = await jsonBody(req);
          const d = Number(b.logRetentionDays);
          if (!Number.isInteger(d) || d < 1 || d > 3650) return json(res, 400, { error: "logRetentionDays must be 1–3650" });
          settings.logRetentionDays = d;
          prune();
          return json(res, 200, settings);
        }
        if (m === "GET" && p === "/admin/api/logs") return json(res, 200, [...logs.values()].map((l) => l.meta));
        if (m === "GET" && (match = p.match(/^\/admin\/api\/logs\/([\w-]+)\.zip$/))) {
          const l = logs.get(match[1]);
          if (!l) return json(res, 404, { error: "no such log" });
          return zip(res, l.data);
        }
        if (m === "POST" && p === "/admin/api/download-tokens") {
          const b = await jsonBody(req);
          const token = randomToken();
          const exp = expiry(lifetime(b.expiresInHours, 24, 24 * 90) * 3600_000);
          downloadTokens.set(token, { gameId: b.gameId ? String(b.gameId) : null, expiresAt: exp.at });
          return json(res, 201, { token, url: `${o.publicUrl}/dl/${token}`, expiresAt: exp.iso });
        }
      }

      // ----- token downloads for pipelines (no login) -----
      if (m === "GET" && (match = p.match(/^\/dl\/([\w-]+)(?:\/([\w-]+)\.zip)?$/))) {
        const d = downloadTokens.get(match[1]);
        if (!d || d.expiresAt < Date.now()) return json(res, 404, { error: "token not found or expired" });
        const visible = [...logs.values()].filter((l) => !d.gameId || l.meta.gameId === d.gameId);
        if (!match[2]) return json(res, 200, visible.map((l) => l.meta));
        const l = visible.find((x) => x.meta.id === match![2]);
        if (!l) return json(res, 404, { error: "no such log for this token" });
        return zip(res, l.data);
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
      let session = sessionId ? remoteSessions.get(sessionId) : undefined;
      let id = sessionId ?? "";
      if (!session || session.expiresAt < Date.now()) {
        const code = (url.searchParams.get("invite") ?? "").toUpperCase();
        const inv = invites.get(code);
        if (!inv || inv.used || inv.expiresAt < Date.now()) return reject(404);
        // Claimed now, not when the table answers: a second tab or a forwarded link can't open another session.
        inv.used = true;
        id = randomToken();
        session = { tableId: inv.tableId, expiresAt: inv.expiresAt + 12 * 3600_000, ws: null };
        remoteSessions.set(id, session);
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
      const s = remoteSessions.get(String(msg.session));
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
            for (const c of wss.clients) c.terminate();
            wss.close();
            server.closeAllConnections();
            server.close(() => r());
          }),
      });
    });
  });
}
