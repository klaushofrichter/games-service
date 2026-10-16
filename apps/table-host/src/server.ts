// HTTP + WebSocket server of the Table Host: board and deck pages, board control API, live updates.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import QRCode from "qrcode";
import { envelope, PROTOCOL_VERSION, type AccessCodeStatus, type Envelope } from "../../../packages/protocol/src/index.ts";
import type { GameEvent } from "../../../packages/sdk/src/index.ts";
import { Table, TableError } from "./table.ts";
import { runSimulation } from "./simulation.ts";
import { verifyStoredLog } from "./game-log.ts";
import type { LogStore } from "./logs.ts";

export interface ServerOptions {
  port: number;
  host?: string;
  tableKey: string;
  publicDir: string;
  allowRemoteBoard: boolean;
  /** Ask the cloud for an invite (remote play); absent when the table runs without the cloud. */
  createInvite?: () => Promise<{ token: string; url: string; expiresAt: string }>;
  /** Set or clear the access code typed on the board (D-113); absent when the table runs without the cloud. */
  setAccessCode?: (code: unknown) => Promise<AccessCodeStatus | null>;
}

/** A request or socket that arrived over a remote player's WebRTC channel (see remote.ts). */
export interface RemoteContext {
  session: string;
}
export const remoteOf = (req: IncomingMessage): RemoteContext | undefined => (req as IncomingMessage & { gtRemote?: RemoteContext }).gtRemote;

type Client = ({ ws: WebSocket; role: "board" } | { ws: WebSocket; role: "deck"; playerId: string } | { ws: WebSocket; role: "pending" }) & { remote?: boolean };

/** Reads a remote client may make: lobby and game state, never logs, saves, simulations or local join codes. */
const REMOTE_DENIED = /^\/(join|simulation|logs|saves|invites|remote|qr|cloud|developer)(\/|$)/;
/**
 * Changes a remote client may make (an allowlist): seat layout and running games. Never turn the table's
 * board (remote boards face their own seat), remove or move players, add AI seats, change AI options,
 * save, or resume — those stay with the people at the table. "Play now" for an AI that is out of time (D-112) is a
 * move of the running game, so remote players with board control may tap it too.
 */
const REMOTE_ACTIONS = /^\/(layout|game\/(select|start|end|close|play-now))$/;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json",
};
/** Images and rules a game ships are data, never pages: an SVG opened on its own must not run script (D-099). */
const ASSET_HEADERS = { "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox" };

export function startServer(table: Table, logs: LogStore, opts: ServerOptions) {
  const clients = new Set<Client & { alive?: boolean }>();

  const keyOk = (k: unknown) => {
    if (typeof k !== "string") return false;
    const a = Buffer.from(k);
    const b = Buffer.from(opts.tableKey);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const isLoopback = (req: IncomingMessage) => {
    const a = req.socket.remoteAddress ?? "";
    return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
  };
  const boardAllowed = (req: IncomingMessage) => opts.allowRemoteBoard || isLoopback(req);

  // ---------- broadcasting ----------

  const sendText = (ws: WebSocket, text: string) => {
    if (ws.readyState === ws.OPEN) ws.send(text);
  };
  const send = (ws: WebSocket, e: Envelope) => sendText(ws, JSON.stringify(e));

  // Remote clients never see the local join code (it would let them join as if they sat at the table).
  const forClient = (remote: boolean | undefined, state: ReturnType<Table["state"]>) => (remote ? { ...state, joinUrl: "" } : state);

  table.on("state", (state) => {
    for (const c of clients) if (c.role !== "pending") send(c.ws, envelope("lobby", "state", forClient(c.remote, state), { stateRev: state.stateRev }));
  });

  /** The running game to these clients: the public board view to boards, each player's own view to their deck. */
  const sendGame = (targets: Iterable<Client>, events: GameEvent[]) => {
    const rt = table.runtime;
    if (!rt) return;
    const views = new Map(table.views().map((v) => [v.playerId, v]));
    // Timer deadlines plus the host's clock let clients draw countdowns without trusting their own clock.
    const timing = { timers: rt.timerDeadlines(), now: Date.now() };
    const board = JSON.stringify(envelope("game", "board", { view: rt.boardView(), events, over: rt.over, ...timing }));
    for (const c of targets) {
      if (c.role === "board") sendText(c.ws, board);
      if (c.role === "deck") {
        const v = views.get(c.playerId);
        if (v) send(c.ws, envelope("game", "view", { seat: v.seat, view: v.view, events, over: rt.over, ...timing }));
      }
    }
  };
  table.on("game", (events: GameEvent[]) => sendGame(clients, events));

  table.on("removed", (playerId: string, reason: string) => {
    for (const c of clients) {
      if (c.role === "deck" && c.playerId === playerId) {
        send(c.ws, envelope("system", "removed", { reason }));
        c.ws.close(4001, reason);
      }
    }
  });

  // ---------- HTTP ----------

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };

  const qrSvg = async (res: ServerResponse, text: string) => {
    const svg = await QRCode.toString(text, { type: "svg", margin: 1, color: { dark: "#111111", light: "#ffffff" } });
    res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "no-store" });
    res.end(svg);
  };

  const readBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > 64 * 1024) throw new TableError(413, "body too large");
      chunks.push(c as Buffer);
    }
    if (!chunks.length) return {};
    try {
      const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      return v && typeof v === "object" ? v : {};
    } catch {
      throw new TableError(400, "body must be JSON");
    }
  };

  const serveFile = async (res: ServerResponse, rel: string, transform?: (s: string) => string, root = opts.publicDir) => {
    const file = normalize(join(root, rel));
    if (!file.startsWith(root)) return json(res, 404, { error: "not found" });
    try {
      let data: Buffer | string = await readFile(file);
      if (transform) data = transform(data.toString("utf8"));
      const asset = root !== opts.publicDir && !/\.(js|css)$/.test(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache", ...(asset ? ASSET_HEADERS : {}) });
      res.end(data);
    } catch {
      json(res, 404, { error: "not found" });
    }
  };

  const api = async (req: IncomingMessage, res: ServerResponse, path: string) => {
    const remote = remoteOf(req);
    const m = req.method ?? "GET";
    if (remote) {
      // Remote boards are authorised by their invite (checked by the cloud), not by the table key.
      if (REMOTE_DENIED.test(path)) return json(res, 403, { error: "not available to remote players" });
      if (m !== "GET") {
        if (!REMOTE_ACTIONS.test(path)) return json(res, 403, { error: "only players at the table can do that" });
        if (!table.remoteControlAllowed()) return json(res, 403, { error: "board control is switched off for remote players" });
      }
    } else if (!keyOk(req.headers["x-table-key"])) return json(res, 401, { error: "missing or wrong X-Table-Key" });
    const body = m === "GET" || m === "DELETE" ? {} : await readBody(req);
    let match: RegExpMatchArray | null;

    if (m === "GET" && path === "/state") return json(res, 200, forClient(!!remote, table.state()));
    if (m === "POST" && path === "/developer") return (table.setDeveloper(body), json(res, 200, table.state()));
    if (m === "POST" && path === "/remote") return (table.setRemoteBoardControl(!!body.boardControl), json(res, 200, table.state()));
    if (m === "POST" && path === "/invites") {
      if (!opts.createInvite) throw new TableError(409, "remote play needs the Game Table service (CLOUD_URL)");
      if (table.cloud.status !== "online") throw new TableError(409, "the table is not connected to the service right now");
      return json(res, 201, await opts.createInvite());
    }
    if (m === "POST" && path === "/cloud/code") {
      // The table's pre-approved access code (D-113), typed in the board's settings; "" removes it.
      if (!opts.setAccessCode) throw new TableError(409, "access codes need the Game Table service (CLOUD_URL)");
      await opts.setAccessCode(body.code ?? "");
      return json(res, 200, table.state());
    }
    if (m === "GET" && path === "/qr") {
      const text = new URL(req.url ?? "/", "http://t").searchParams.get("text") ?? "";
      if (!/^https?:\/\/[\w.:/-]+$/.test(text) || text.length > 200) throw new TableError(400, "text must be a URL");
      return await qrSvg(res, text);
    }
    if (m === "GET" && path === "/join") return json(res, 200, table.currentJoin());
    if (m === "POST" && path === "/join/new") return json(res, 200, table.newJoinCode());
    if (m === "GET" && path === "/games") return json(res, 200, table.availability());
    if (m === "GET" && path === "/metrics") return json(res, 200, table.metrics);
    if (m === "POST" && path === "/layout") return (table.setLayout(Number(body.seats)), json(res, 200, table.state()));
    if (m === "POST" && path === "/rotate") return (table.rotate(Number(body.degrees)), json(res, 200, table.state()));
    if (m === "POST" && path === "/face") return (table.face(String(body.edge)), json(res, 200, table.state()));
    if (m === "POST" && path === "/seats/move") return (table.moveSeat(String(body.playerId), Number(body.seat)), json(res, 200, table.state()));
    if (m === "POST" && path === "/ai") {
      const id = table.addAi(body.seat === undefined ? undefined : Number(body.seat));
      return json(res, 201, { playerId: id });
    }
    if (m === "POST" && (match = path.match(/^\/players\/([\w-]+)\/ai-options$/))) {
      table.setAiOptions(match[1], (body.options ?? {}) as Record<string, unknown>);
      return json(res, 200, table.state());
    }
    if (m === "POST" && (match = path.match(/^\/players\/([\w-]+)\/color$/))) return (table.setColor(match[1], body.color), json(res, 200, table.state()));
    if (m === "DELETE" && (match = path.match(/^\/players\/([\w-]+)$/))) return (table.removePlayer(match[1], "evicted"), json(res, 200, table.state()));
    if (m === "POST" && path === "/game/select") {
      table.selectGame(String(body.gameId), (body.settings as Record<string, unknown>) ?? {});
      return json(res, 200, table.state());
    }
    if (m === "POST" && path === "/game/start") return (table.start(), json(res, 200, table.state()));
    if (m === "POST" && path === "/game/end") return (table.end(), json(res, 200, table.state()));
    if (m === "POST" && path === "/display") return (table.setDisplay(body), json(res, 200, table.state()));
    if (m === "POST" && path === "/game/settings") return (table.updateSettings(body.settings), json(res, 200, table.state()));
    if (m === "POST" && path === "/game/prefs") return (table.setPrefs(body.prefs), json(res, 200, table.state()));
    if (m === "POST" && path === "/game/close") return (table.close(), json(res, 200, table.state()));
    if (m === "POST" && path === "/game/resume") return (table.resumeGame(), json(res, 200, table.state()));
    // An AI player is out of time (D-112): play the game's quick move for it instead of waiting.
    if (m === "POST" && path === "/game/play-now") return (table.playNow(), json(res, 200, table.state()));
    if (m === "POST" && path === "/game/save") return json(res, 200, { saveId: await table.saveAndExit(), state: table.state() });
    if (m === "GET" && path === "/saves") return json(res, 200, await logs.listSaves());
    if (m === "GET" && path === "/game/board") {
      if (!table.runtime) throw new TableError(409, "no game loaded");
      return json(res, 200, { view: table.runtime.boardView(), over: table.runtime.over, summary: table.runtime.summary });
    }
    if (m === "POST" && path === "/simulation") {
      const g = table.games.get(String(body.gameId));
      if (!g) throw new TableError(404, "no such game");
      const r = await runSimulation(
        g,
        { players: Number(body.players), games: Number(body.games ?? 1), seed: Number(body.seed ?? Date.now()), settings: body.settings as Record<string, unknown>, aiOptions: body.aiOptions as Record<string, unknown> },
        logs,
        table.config.tableName,
        { tableId: table.tableId, snapshotEvery: table.config.logSnapshotEvery },
      );
      table.metrics.simulations++;
      table.logSaved(r.logId); // to the service, like a played game's (D-116)
      return json(res, 200, r);
    }
    if (m === "GET" && path === "/logs") return json(res, 200, await logs.list());
    if (m === "POST" && (match = path.match(/^\/logs\/([\w-]+)\/verify$/))) {
      // Replay every game of a stored log with the game as installed now (D-116).
      const v = await verifyStoredLog(table.games, logs, match[1]);
      return v ? json(res, 200, v) : json(res, 404, { error: "no such log" });
    }
    if (m === "GET" && (match = path.match(/^\/logs\/([\w-]+)\.zip$/))) {
      const buf = await logs.read(match[1]);
      if (!buf) return json(res, 404, { error: "no such log" });
      res.writeHead(200, { "content-type": "application/zip", "content-disposition": `attachment; filename="${match[1]}.zip"` });
      return res.end(buf);
    }
    json(res, 404, { error: "unknown endpoint" });
  };

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://table");
    } catch {
      // A request target URL can't parse must answer 400, not throw: an unhandled rejection exits Node.
      return json(res, 400, { error: "bad request target" });
    }
    const path = url.pathname;
    try {
      // {status, version}: the version is stamped at build time (APP_VERSION) and reads "dev" outside a release build.
      if (path === "/health") return json(res, 200, { status: "ok", version: process.env.APP_VERSION || "dev", protocol: PROTOCOL_VERSION });
      if (path.startsWith("/api/v1/")) return await api(req, res, path.slice("/api/v1".length));
      if (path === "/") {
        res.writeHead(302, { location: boardAllowed(req) ? "/board/" : "/deck/" });
        return res.end();
      }
      let match: RegExpMatchArray | null;
      if ((match = path.match(/^\/j\/([A-Za-z0-9]{4,12})$/))) {
        res.writeHead(302, { location: `/deck/?t=${match[1].toUpperCase()}` });
        return res.end();
      }
      if (path === "/qr.svg") {
        if (!boardAllowed(req) || remoteOf(req)) return json(res, 403, { error: "board only" });
        return await qrSvg(res, table.currentJoin().url);
      }
      if (path === "/board" || path === "/board/" || path === "/board/index.html") {
        // Remote players get the same board, without the key: their channel is their authorisation.
        if (remoteOf(req)) return await serveFile(res, "board/index.html", (s) => s.replace(`window.TABLE_KEY = "__TABLE_KEY__";`, `window.TABLE_KEY = ""; window.REMOTE_BOARD = true;`));
        if (!boardAllowed(req)) return json(res, 403, { error: "the board is only served on the table PC" });
        // The board page talks to the board control API; it gets the key only on the table PC itself.
        return await serveFile(res, "board/index.html", (s) => s.replace("__TABLE_KEY__", opts.tableKey));
      }
      if (path === "/deck" || path === "/deck/") return await serveFile(res, "deck/index.html");
      if (path.startsWith("/board/") || path.startsWith("/deck/") || path.startsWith("/shared/")) return await serveFile(res, path.slice(1));
      if ((match = path.match(/^\/games\/([a-z0-9-]+)\/((?:board|deck)\.(?:js|css)|how-to-play\.md|assets\/[\w./-]+)$/))) {
        // A game's own board and deck UI and its assets; rules and manifest are not served.
        const g = table.games.get(match[1]);
        if (!g || match[2].includes("..")) return json(res, 404, { error: "not found" });
        return await serveFile(res, match[2], undefined, g.dir);
      }
      json(res, 404, { error: "not found" });
    } catch (err) {
      if (err instanceof TableError) return json(res, err.status, { error: err.message });
      console.error(err);
      json(res, 500, { error: "internal error" });
    }
  };
  const server = createServer(handler);

  // ---------- WebSocket ----------

  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024 });

  const onConnection = (ws: WebSocket, req: IncomingMessage) => {
    const remoteCtx = remoteOf(req);
    const remote = !!remoteCtx;
    const client: Client & { alive?: boolean } = { ws, role: "pending", alive: true, remote };
    clients.add(client);
    ws.on("pong", () => (client.alive = true));

    const reply = (type: string, payload: unknown, seq?: number) => send(ws, envelope("system", type, payload, seq === undefined ? {} : { seq }));

    ws.on("message", (raw) => {
      let msg: Envelope<any>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return reply("error", { message: "invalid JSON" });
      }
      const c = client as any;
      try {
        if (msg.ch === "system" && msg.type === "hello") {
          const p = msg.payload ?? {};
          if (p.role === "board") {
            if (!remote && !keyOk(p.key)) throw new TableError(401, "board needs the table key");
            c.role = "board";
            reply("welcome", { role: "board", remote }, msg.seq);
          } else if (p.sessionToken) {
            const info = table.resume(String(p.sessionToken));
            c.role = "deck";
            c.playerId = info.id;
            reply("welcome", { role: "deck", playerId: info.id }, msg.seq);
          } else {
            const { playerId, sessionToken } = remoteCtx ? table.joinRemote(p.name, remoteCtx.session) : table.join(String(p.joinToken ?? ""), p.name);
            c.role = "deck";
            c.playerId = playerId;
            reply("welcome", { role: "deck", playerId, sessionToken }, msg.seq);
          }
          send(ws, envelope("lobby", "state", forClient(remote, table.state())));
          if (table.phase === "active" || table.phase === "paused") sendGame([client], []);
          return;
        }
        if (c.role !== "deck" && c.role !== "board") throw new TableError(401, "say hello first");
        if (c.role === "deck" && msg.ch === "lobby" && msg.type === "ready") {
          table.setReady(c.playerId, !!msg.payload?.ready);
          return reply("ack", {}, msg.seq);
        }
        if (c.role === "board" && msg.ch === "game" && msg.type === "intent") {
          // A move made by touching the board (D-102): payload { playerId, name, payload }.
          const b = msg.payload ?? {};
          const r = table.boardIntent(b.playerId, { name: b.name, payload: b.payload }, remoteCtx ? remoteCtx.session : null);
          return r.ok ? reply("ack", {}, msg.seq) : reply("reject", { reason: r.reason }, msg.seq);
        }
        if (c.role === "deck" && msg.ch === "game" && msg.type === "intent") {
          const r = table.intent(c.playerId, msg.payload);
          return r.ok ? reply("ack", {}, msg.seq) : reply("reject", { reason: r.reason }, msg.seq);
        }
        throw new TableError(400, `unexpected ${msg.ch}.${msg.type}`);
      } catch (err) {
        const message = err instanceof TableError ? err.message : "internal error";
        if (!(err instanceof TableError)) console.error(err);
        reply("error", { message, status: err instanceof TableError ? err.status : 500 }, msg.seq);
        if (msg.type === "hello") ws.close(4003, message);
      }
    });

    ws.on("close", () => {
      clients.delete(client);
      const c = client as Client;
      if (c.role === "deck") {
        const id = c.playerId;
        const stillOpen = [...clients].some((o) => o.role === "deck" && o.playerId === id);
        if (!stillOpen) table.disconnected(id);
      }
    });
  };
  wss.on("connection", onConnection);

  const ping = setInterval(() => {
    for (const c of clients) {
      if (c.alive === false) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }, 10_000);

  return new Promise<{ port: number; close: () => Promise<void>; handler: typeof handler; attachSocket: typeof onConnection }>((resolve) => {
    server.listen(opts.port, opts.host ?? "0.0.0.0", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : opts.port;
      resolve({
        port,
        // Used by remote.ts: requests and sockets that arrive over a WebRTC channel take the same paths.
        handler,
        attachSocket: onConnection,
        close: async () => {
          await table.flush();
          await new Promise<void>((r) => {
            clearInterval(ping);
            table.shutdown();
            for (const c of clients) c.ws.terminate();
            wss.close();
            server.closeAllConnections();
            server.close(() => r());
          });
        },
      });
    });
  });
}
