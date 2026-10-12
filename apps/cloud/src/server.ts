// Cloud service skeleton (games.skylar.technology): table enrollment, heartbeat and metrics,
// log upload with admin and token downloads, invite tokens. In-memory store for phase 1a;
// PostgreSQL replaces it before production (see architecture doc).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ADMIN_PAGE = fileURLToPath(new URL("../public/admin.html", import.meta.url));

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = (n: number) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
const secret = () => randomBytes(24).toString("base64url");

export interface CloudOptions {
  port: number;
  host?: string;
  adminToken: string;
  publicUrl: string; // https://games.skylar.technology
  logRetentionDays?: number;
}

interface TableRecord {
  tableId: string;
  name: string;
  status: "pending" | "approved" | "revoked";
  pairingCode: string;
  tableToken: string | null;
  lastSeen: number | null;
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
  const logs = new Map<string, { meta: LogRecordMeta; data: Buffer }>();
  const invites = new Map<string, { tableId: string; expiresAt: number; used: boolean }>();
  const downloadTokens = new Map<string, { gameId: string | null; expiresAt: number }>();
  const settings = { logRetentionDays: o.logRetentionDays ?? 90 };
  const lookups = new Map<string, { n: number; reset: number }>(); // invite lookup rate limit per IP

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const bearer = (req: IncomingMessage) => (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const isAdmin = (req: IncomingMessage) => same(bearer(req), o.adminToken);
  const tableFor = (req: IncomingMessage) => {
    const t = bearer(req);
    return [...tables.values()].find((x) => x.status === "approved" && x.tableToken && same(x.tableToken, t));
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
  };
  const pruneTimer = setInterval(prune, 3600_000);
  pruneTimer.unref();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://cloud");
    const p = url.pathname;
    const m = req.method ?? "GET";
    let match: RegExpMatchArray | null;
    try {
      if (p === "/health") return json(res, 200, { ok: true });
      if (m === "GET" && (p === "/admin" || p === "/admin/")) {
        // The page itself is public; everything it shows comes from /admin/api with the admin token.
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", "x-frame-options": "DENY", "referrer-policy": "no-referrer" });
        return res.end(await readFile(ADMIN_PAGE));
      }

      // ----- tables -----
      if (m === "POST" && p === "/api/tables/hello") {
        const b = await jsonBody(req);
        const tableId = String(b.tableId ?? "");
        if (!/^[A-Za-z0-9_-]{8,64}$/.test(tableId)) return json(res, 400, { error: "tableId required" });
        let t = tables.get(tableId);
        if (!t) {
          t = { tableId, name: String(b.name ?? "Game Table").slice(0, 60), status: "pending", pairingCode: code(6), tableToken: null, lastSeen: null, metrics: {}, createdAt: Date.now() };
          tables.set(tableId, t);
        }
        if (t.status === "revoked") return json(res, 403, { status: "revoked" });
        if (t.status === "pending") return json(res, 202, { status: "pending", pairingCode: t.pairingCode });
        // Approved: the token is handed out once, on the first hello after approval.
        if (!t.tableToken) t.tableToken = secret();
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
        const data = await body(req, 50 * 1024 * 1024);
        const gameId = String(url.searchParams.get("gameId") ?? "");
        logs.set(match[1], { meta: { id: match[1], tableId: t.tableId, gameId, simulation: url.searchParams.get("simulation") === "1", bytes: data.length, uploadedAt: Date.now() }, data });
        return json(res, 201, { ok: true });
      }
      if (m === "POST" && p === "/api/tables/invites") {
        const t = tableFor(req);
        if (!t) return json(res, 401, { error: "unknown or revoked table" });
        const b = await jsonBody(req);
        const ttl = Math.min(Number(b.ttlMinutes ?? 120), 24 * 60) * 60_000;
        let token = code(8);
        while (invites.has(token)) token = code(8);
        invites.set(token, { tableId: t.tableId, expiresAt: Date.now() + ttl, used: false });
        return json(res, 201, { token, url: `${o.publicUrl}/i/${token}`, expiresAt: new Date(Date.now() + ttl).toISOString() });
      }
      if (m === "GET" && (match = p.match(/^\/i\/([A-Za-z0-9]{1,12})$/))) {
        const ip = req.socket.remoteAddress ?? "?";
        const l = lookups.get(ip) ?? { n: 0, reset: Date.now() + 60_000 };
        if (Date.now() > l.reset) Object.assign(l, { n: 0, reset: Date.now() + 60_000 });
        l.n++;
        lookups.set(ip, l);
        if (l.n > 20) return json(res, 429, { error: "too many attempts; wait a minute" });
        const inv = invites.get(match[1].toUpperCase());
        if (!inv || inv.used || inv.expiresAt < Date.now()) return json(res, 404, { error: "invite not found or expired" });
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Game Table invite</title>
          <body style="font-family:system-ui;background:#0f2a24;color:#f3eee2;display:grid;place-items:center;min-height:100vh;margin:0">
          <div style="max-width:420px;padding:24px;text-align:center"><h1>You're invited</h1><p>Remote play connects you directly to the table. It arrives in phase 1c.</p></div></body>`);
      }

      // ----- admin -----
      if (p.startsWith("/admin/api/")) {
        if (!isAdmin(req)) return json(res, 401, { error: "admin token required" });
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
          t.tableToken = null;
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
          res.writeHead(200, { "content-type": "application/zip" });
          return res.end(l.data);
        }
        if (m === "POST" && p === "/admin/api/download-tokens") {
          const b = await jsonBody(req);
          const token = secret();
          const hours = Math.min(Number(b.expiresInHours ?? 24), 24 * 90);
          downloadTokens.set(token, { gameId: b.gameId ? String(b.gameId) : null, expiresAt: Date.now() + hours * 3600_000 });
          return json(res, 201, { token, url: `${o.publicUrl}/dl/${token}`, expiresAt: new Date(Date.now() + hours * 3600_000).toISOString() });
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
        res.writeHead(200, { "content-type": "application/zip" });
        return res.end(l.data);
      }

      json(res, 404, { error: "not found" });
    } catch (err) {
      const status = (err as { status?: number }).status ?? (err instanceof SyntaxError ? 400 : 500);
      if (status === 500) console.error(err);
      json(res, status, { error: status === 500 ? "internal error" : (err as Error).message });
    }
  });

  return new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
    server.listen(o.port, o.host ?? "0.0.0.0", () => {
      const a = server.address();
      resolve({
        port: typeof a === "object" && a ? a.port : o.port,
        close: () => new Promise((r) => (clearInterval(pruneTimer), server.closeAllConnections(), server.close(() => r()))),
      });
    });
  });
}
