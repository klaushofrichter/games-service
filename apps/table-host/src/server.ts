// HTTP + WebSocket server of the Table Host: board and deck pages, board control API, live updates.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import QRCode from "qrcode";
import { envelope, type AccessCodeStatus, type Envelope } from "../../../packages/protocol/src/index.ts";
import type { GameEvent } from "../../../packages/sdk/src/index.ts";
import { REMOTE_FULL, Table, TableError } from "./table.ts";
import { runSimulation } from "./simulation.ts";
import { platformMeta, verifyStoredLog } from "./game-log.ts";
import { History } from "./history.ts";
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
  /** sha256 of the invite the session came through (D-164). */
  invite?: string;
}
export const remoteOf = (req: IncomingMessage): RemoteContext | undefined => (req as IncomingMessage & { gtRemote?: RemoteContext }).gtRemote;

type Client = ({ ws: WebSocket; role: "board" } | { ws: WebSocket; role: "deck"; playerId: string } | { ws: WebSocket; role: "pending" }) & {
  remote?: boolean;
  tab?: string;
  session?: string;
  alive?: boolean;
  /** A remote board counted against the remote places (D-133). */
  counted?: boolean;
  lastGesture?: number;
  /** Intents this connection may still send now (a token bucket, D-202). */
  tokens?: number;
  tokensAt?: number;
};

/** Connections one table serves at most (D-133): one local board, a deck per player (eight seats at most), and a board per remote player. */
const MAX_DECKS = 8;
/** Connections that have not said hello yet: at most this many, each for at most HELLO_MS (D-202). */
const MAX_PENDING = 16;
const HELLO_MS = 10_000;
/** Intents per connection: a burst of INTENT_BURST, then INTENT_RATE a second (D-202). People and boards stay far below. */
const INTENT_BURST = 40;
export const INTENT_RATE = 20;

/**
 * A sling gesture as the boards may see it (D-189, D-202): only the fields the sling uses, each of its kind, so a phone
 * can pass nothing else to the boards (no markup, no large objects). `item`, the face a game may show while dragging, is
 * a flat object of short strings, numbers and booleans.
 */
export function cleanGesture(p: unknown): Record<string, unknown> | null {
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const g = p as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if ((typeof g.id === "string" && g.id.length <= 64) || (typeof g.id === "number" && Number.isFinite(g.id))) out.id = g.id;
  for (const k of ["f", "x", "a"]) if (typeof g[k] === "number" && Number.isFinite(g[k])) out[k] = g[k];
  if (g.end === true) out.end = true;
  if (g.item && typeof g.item === "object" && !Array.isArray(g.item)) {
    const item: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(g.item).slice(0, 12)) {
      if (!/^[A-Za-z_][\w-]{0,19}$/.test(k)) continue;
      if ((typeof v === "string" && v.length <= 40) || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) item[k] = v;
    }
    out.item = item;
  }
  return out;
}

/** Reads a remote client may make: lobby and game state, never logs, saves, simulations or local join codes. */
const REMOTE_DENIED = /^\/(join|simulation|logs|saves|invites|remote|qr|cloud|developer)(\/|$)/;
/**
 * Changes a remote client may make (an allowlist): seat layout and running games. Never turn the table's
 * board (remote boards face their own seat), remove or move players, add AI seats, change AI options,
 * save, or resume — those stay with the people at the table. "Play now" for an AI that is out of time (D-112) and
 * skipping a game's wait (D-136) are moves of the running game, so remote players with board control may tap them too.
 */
const REMOTE_ACTIONS = /^\/(layout|exchange|game\/(select|start|end|close|play-now|skip-timer|settings)|players\/[\w-]+\/(color|ai-options)|watchers\/[\w-]+(\/play)?)$/;

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
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json",
};
/** Images and rules a game ships are data, never pages: an SVG opened on its own must not run script (D-099). */
const ASSET_HEADERS = { "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox" };

export function startServer(table: Table, logs: LogStore, opts: ServerOptions) {
  const clients = new Set<Client>();
  const history = new History(logs, () => table.games);

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
  // Another screen for the board (D-190): an iPad or a TV on the same network, given the board's link once (it carries
  // the table key). The table then remembers that browser by a cookie derived from the key; only private addresses.
  const address = (req: IncomingMessage) => (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
  const isPrivate = (req: IncomingMessage) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|127\.|::1$|f[cd]|fe80:)/i.test(address(req));
  const SCREEN_COOKIE = "gt_screen";
  const screenToken = createHash("sha256").update(`board-screen:${opts.tableKey}`).digest("hex").slice(0, 40);
  const screenCookieOk = (req: IncomingMessage) => (req.headers.cookie ?? "").split(/;\s*/).includes(`${SCREEN_COOKIE}=${screenToken}`);
  // Never over remote play (D-202): a remote browser gets its own board, without the key, from the board route itself.
  const boardAllowed = (req: IncomingMessage) => !remoteOf(req) && (opts.allowRemoteBoard || isLoopback(req) || (isPrivate(req) && screenCookieOk(req)));

  // ---------- broadcasting ----------

  const sendText = (ws: WebSocket, text: string) => {
    if (ws.readyState === ws.OPEN) ws.send(text);
  };
  const send = (ws: WebSocket, e: Envelope) => sendText(ws, JSON.stringify(e));

  // Remote clients never see the local join code (it would let them join as if they sat at the table).
  // Remote boards get no local join codes: neither the table's nor a local seat exchange's (D-159); a remote exchange's
  // invite only a remote board that may exchange (D-166), not a watcher's or a phone's.
  // A remote board whose browser has no player at the table (exchanged, left, removed) sees board control as off (D-167).
  const forClient = (remote: boolean | undefined, state: ReturnType<Table["state"]>, session?: string) => {
    if (!remote) return state;
    const hideLink = state.exchange && (state.exchange.kind === "local" || session === undefined || !table.remoteControlAllowed(session));
    const s = { ...state, joinUrl: "", exchange: hideLink ? { ...state.exchange!, url: "" } : state.exchange };
    if (session === undefined) return s;
    const mayJoin = table.mayJoin(session);
    return table.hasRemotePlayer(session) ? { ...s, remote: { ...s.remote, mayJoin } } : { ...s, remote: { ...s.remote, boardControl: false, watching: true, mayJoin } };
  };
  /** The serialised state is shared by clients that see the same: the table's, remote decks, remote boards by their rights. */
  const stateKind = (c: Client) =>
    !c.remote ? "local" : c.session === undefined ? "remote" : `board:${table.hasRemotePlayer(c.session) ? "p" : "w"}${table.mayJoin(c.session) ? "j" : ""}`;

  table.on("state", (state) => {
    // Serialised once per kind of client (at the table, remote), not once per client.
    const text = new Map<string, string>();
    for (const c of clients) {
      if (c.role === "pending") continue;
      const kind = stateKind(c);
      let t = text.get(kind);
      if (t === undefined) text.set(kind, (t = JSON.stringify(envelope("lobby", "state", forClient(!!c.remote, state, c.session), { stateRev: state.stateRev }))));
      sendText(c.ws, t);
    }
  });

  /** The running game to these clients: the public board view to boards, each player's own view to their deck. */
  const sendGame = (targets: Iterable<Client>, events: GameEvent[]) => {
    const rt = table.runtime;
    if (!rt) return;
    const views = new Map(table.views().map((v) => [v.playerId, v]));
    // Timer deadlines plus the host's clock let clients draw countdowns without trusting their own clock.
    const timing = { timers: rt.timerDeadlines(), now: Date.now() };
    // A number the local board answers with "idle" once it has shown the message: AI players wait for it (D-141).
    const list = [...targets];
    const seq = list.some((c) => c.role === "board" && !c.remote) ? table.nextBoardMessage() : 0;
    const board = JSON.stringify(envelope("game", "board", { view: rt.boardView(), events, over: rt.over, seq, ...timing }));
    // An AI player's move reaches the decks once the local board has shown it (D-143), so a phone says "Waiting for
    // Rosa" while the board shows Rosa's move, not the move before. Everything else goes at once, after what is held.
    const hold = seq > 0 && table.changeByAi && table.pacedByBoard && !rt.over;
    for (const c of list) {
      if (c.role === "board") sendText(c.ws, board);
      if (c.role === "deck") {
        const v = views.get(c.playerId);
        if (!v) continue;
        // afterBoard: the phone gets this once the board has shown it, so it need not stage the moves again (D-157).
        const text = JSON.stringify(envelope("game", "view", { seat: v.seat, view: v.view, events, over: rt.over, ...(hold ? { afterBoard: true } : {}), ...timing }));
        if (hold) holdForBoard(c, seq, text);
        else {
          releaseHeld(c);
          sendText(c.ws, text);
        }
      }
    }
  };
  table.on("game", (events: GameEvent[]) => sendGame(clients, events));

  // ---------- decks follow the board (D-143) ----------
  const held = new Map<Client, { seq: number; at: number; text: string }[]>();
  let heldTimer: ReturnType<typeof setInterval> | undefined;
  /** Keep a deck's game message until the local board has shown board message `seq` (or stops answering). */
  function holdForBoard(c: Client, seq: number, text: string) {
    const q = held.get(c) ?? [];
    q.push({ seq, at: Date.now(), text });
    held.set(c, q);
    heldTimer ??= setInterval(releaseShown, 500); // the timeout for a board that does not answer
  }
  /** Send a deck everything held for it, in order. */
  function releaseHeld(c: Client) {
    const q = held.get(c);
    if (!q) return;
    held.delete(c);
    for (const m of q) sendText(c.ws, m.text);
  }
  /** Send what the board has shown by now; all of it when the game no longer goes at the board's pace. */
  function releaseShown() {
    const shown = table.shownOnBoard;
    const paced = table.pacedByBoard && table.runtime && !table.runtime.over;
    const late = Date.now() - table.boardPaceTimeoutMs;
    for (const [c, q] of held) {
      while (q.length && (!paced || q[0].seq <= shown || q[0].at < late)) sendText(c.ws, q.shift()!.text);
      if (!q.length) held.delete(c);
    }
    if (!held.size && heldTimer) {
      clearInterval(heldTimer);
      heldTimer = undefined;
    }
  }
  table.on("boardShown", releaseShown);

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
    // Inside root, not merely starting like it (a sibling folder "chess2" starts like "chess", D-202).
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) return json(res, 404, { error: "not found" });
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

  /** A new invite from the service (remote play), for a player, a watcher or an exchange. */
  const newInvite = async () => {
    if (!opts.createInvite) throw new TableError(409, "remote play needs the Game Table service (CLOUD_URL)");
    if (table.cloud.status !== "online") throw new TableError(409, "the table is not connected to the service right now");
    return await opts.createInvite();
  };
  const noControl = (session: string) =>
    table.hasRemotePlayer(session) ? "board control is switched off for remote players" : "you are no longer a player at this table";
  const api = async (req: IncomingMessage, res: ServerResponse, path: string, qs: URLSearchParams) => {
    const remote = remoteOf(req);
    const m = req.method ?? "GET";
    if (remote) {
      // Remote boards are authorised by their invite (checked by the cloud), not by the table key.
      // The Game Viewer (D-120): finished games, read-only, for remote players the table gives board control.
      if (/^\/history(\/|$)/.test(path)) {
        if (m !== "GET") return json(res, 405, { error: "the game viewer is read-only" });
        if (!table.remoteControlAllowed(remote.session)) return json(res, 403, { error: noControl(remote.session) });
      } else if (REMOTE_DENIED.test(path)) return json(res, 403, { error: "not available to remote players" });
      if (m !== "GET") {
        if (!REMOTE_ACTIONS.test(path)) return json(res, 403, { error: "only players at the table can do that" });
        if (!table.remoteControlAllowed(remote.session)) return json(res, 403, { error: noControl(remote.session) });
      }
    } else if (!keyOk(req.headers["x-table-key"])) return json(res, 401, { error: "missing or wrong X-Table-Key" });
    const body = m === "GET" || m === "DELETE" ? {} : await readBody(req);
    let match: RegExpMatchArray | null;

    if (m === "GET" && path === "/state") return json(res, 200, forClient(!!remote, table.state(), remote?.session));
    if (m === "GET" && path === "/connections" && !remote) return json(res, 200, connections());
    // Live status for finding problems (D-157): AI players, the board's pacing, what each phone is held back.
    if (m === "GET" && path === "/debug" && !remote) {
      const now = Date.now();
      const decks = [...held].map(([c, q]) => ({ player: c.role === "deck" ? (table.player(c.playerId)?.name ?? c.playerId) : "?", held: q.length, oldestSeq: q[0]?.seq ?? null, oldestMsAgo: q[0] ? now - q[0].at : null }));
      return json(res, 200, { ...table.debugStatus(), decks });
    }
    if (m === "POST" && path === "/developer") return (table.setDeveloper(body), json(res, 200, table.state()));
    if (m === "POST" && path === "/remote") return (table.setRemoteBoardControl(!!body.boardControl), json(res, 200, table.state()));
    if (m === "POST" && path === "/invites") {
      if (!opts.createInvite) throw new TableError(409, "remote play needs the Game Table service (CLOUD_URL)");
      const watch = body.watch === true; // an invite to watch (D-168): the board only, no seat
      const noSeat = table.noFreeSeat(); // an invite with no seat to offer only disappoints (D-129)
      if (noSeat && !watch) throw new TableError(409, noSeat, "no-seat");
      table.assertRemoteRoom(); // players and watchers together (D-168)
      const inv = await newInvite();
      table.inviteCreated(inv.token, watch); // so the board's invite dialog can close when it is used (D-164)
      if (!watch) return json(res, 201, inv);
      const u = new URL(inv.url);
      u.searchParams.set("watch", "1"); // only the page's wording: the table knows the invite is for watching
      return json(res, 201, { ...inv, url: u.toString(), watch: true });
    }
    // Remote watchers (D-168): remove one (their board closes for good), or let one play (in the lobby).
    if (m === "DELETE" && (match = path.match(/^\/watchers\/([\w-]+)$/))) return (table.removeWatcher(match[1]), json(res, 200, table.state()));
    if (m === "POST" && (match = path.match(/^\/watchers\/([\w-]+)\/play$/))) return (table.letWatcherPlay(match[1]), json(res, 200, table.state()));
    if (m === "POST" && path === "/cloud/code") {
      // The table's pre-approved access code (D-113), typed in the board's settings; "" removes it.
      if (!opts.setAccessCode) throw new TableError(409, "access codes need the Game Table service (CLOUD_URL)");
      await opts.setAccessCode(body.code ?? "");
      return json(res, 200, table.state());
    }
    if (m === "GET" && path === "/qr") {
      const text = qs.get("text") ?? "";
      // A URL, with a query for an invite's name (D-155: 12 characters, each up to 12 bytes percent-encoded).
      if (!/^https?:\/\/[\w.:/-]+(\?[\w.~%+=&-]*)?$/.test(text) || text.length > 400) throw new TableError(400, "text must be a URL");
      return await qrSvg(res, text);
    }
    if (m === "GET" && path === "/join") return json(res, 200, table.currentJoin());
    if (m === "POST" && path === "/join/new") return json(res, 200, table.newJoinCode());
    if (m === "GET" && path === "/games") return json(res, 200, table.availability());
    // The platform's version and protocol, as on /health, for the board's Advanced › Versions (D-182); remote boards too.
    if (m === "GET" && path === "/version") return json(res, 200, platformMeta());
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
    // Exchange a seat's player during a game (D-159): an AI at once, or open an exchange for a person (a local code or
    // a remote invite) that ends when they join; cancel it.
    if (m === "POST" && path === "/exchange") {
      const seat = Number(body.seat);
      const kind = String(body.kind);
      if (kind !== "ai" && kind !== "local" && kind !== "remote" && kind !== "watcher") throw new TableError(400, "kind must be ai, local, remote or watcher");
      if (remote && kind === "local") throw new TableError(403, "a remote board can exchange for a remote player or an AI");
      table.assertExchange(seat, kind); // before asking the service for an invite that could not be used
      const url = kind === "remote" ? (await newInvite()).url : undefined;
      return json(res, 200, { ...table.exchange(seat, kind, url, body.watcher), state: table.state() });
    }
    if (m === "DELETE" && path === "/exchange") return (table.cancelExchange(), json(res, 200, table.state()));
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
    // Skip a game's wait, e.g. Hold'em's "Next hand" (D-136): fire a timer the manifest lists in skipTimers now.
    if (m === "POST" && path === "/game/skip-timer") return (table.skipTimer(body.id), json(res, 200, table.state()));
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
    // The Game Viewer (D-120): finished games and their moves, read-only.
    if (m === "GET" && path === "/history") return json(res, 200, await history.list());
    if (m === "GET" && (match = path.match(/^\/history\/([\w-]+)$/))) {
      const info = await history.info(match[1]);
      return info ? json(res, 200, info) : json(res, 404, { error: "no such log" });
    }
    if (m === "GET" && (match = path.match(/^\/history\/([\w-]+)\/(\d{1,4})\/statistics$/))) {
      const st = await history.statistics(match[1], Number(match[2]));
      return st ? json(res, 200, st) : json(res, 404, { error: "no statistics for this game" });
    }
    if (m === "GET" && (match = path.match(/^\/history\/([\w-]+)\/(\d{1,4})\/moves$/))) {
      const num = (k: string) => (qs.has(k) && qs.get(k) !== "" && Number.isFinite(Number(qs.get(k))) ? Number(qs.get(k)) : undefined);
      const page = await history.page(match[1], Number(match[2]), {
        offset: num("offset"),
        limit: num("limit"),
        seat: num("seat"),
        move: num("move"),
        movesOnly: qs.get("movesOnly") === "1",
        problems: qs.get("problems") === "1",
        q: qs.get("q")?.slice(0, 80) || undefined,
      });
      return page ? json(res, 200, page) : json(res, 404, { error: "no such log or game" });
    }
    if (m === "GET" && (match = path.match(/^\/history\/([\w-]+)\/(\d{1,4})\/(moves|lines)\/(\d{1,7})$/))) {
      const n = Number(match[4]);
      const step = await history.step(match[1], Number(match[2]), match[3] === "moves" ? { move: n } : { line: n });
      return step ? json(res, 200, step) : json(res, 404, { error: `no ${match[3] === "moves" ? "move" : "line"} ${n} in this game` });
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
      if (path === "/health") return json(res, 200, { status: "ok", ...platformMeta() });
      if (path.startsWith("/api/v1/")) return await api(req, res, path.slice("/api/v1".length), url.searchParams);
      if (path === "/") {
        res.writeHead(302, { location: boardAllowed(req) ? "/board/" : "/deck/" });
        return res.end();
      }
      let match: RegExpMatchArray | null;
      // A phone that scanned the QR code asks first whether there is a seat for it (D-129); only with the current code.
      if ((match = path.match(/^\/j\/([A-Za-z0-9]{4,12})\/seat$/))) {
        if (!remoteOf(req) && table.isExchangeToken(match[1])) return json(res, 200, { free: true, message: null, exchange: true }); // D-159
        if (remoteOf(req) || match[1].toUpperCase() !== table.currentJoin().token) return json(res, 403, { error: "join code is invalid or expired; scan the QR code again" });
        const noSeat = table.noFreeSeat();
        return json(res, 200, { free: !noSeat, message: noSeat });
      }
      if ((match = path.match(/^\/j\/([A-Za-z0-9]{4,12})$/))) {
        res.writeHead(302, { location: `/deck/?t=${match[1].toUpperCase()}` });
        return res.end();
      }
      // The board's link for another screen (D-190): opened there, it remembers that browser and shows the board.
      if (path === "/board/screen") {
        if (remoteOf(req) || !isPrivate(req)) return json(res, 403, { error: "the board's link works only on the table's own network" });
        if (!keyOk(url.searchParams.get("key"))) return json(res, 403, { error: "this board link is not valid for this table" });
        res.writeHead(302, { location: "/board/#screen", "set-cookie": `${SCREEN_COOKIE}=${screenToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000` });
        return res.end();
      }
      if (path === "/qr.svg") {
        if (url.searchParams.get("screen") !== null) {
          if (!boardAllowed(req)) return json(res, 403, { error: "board only" });
          return await qrSvg(res, `${table.config.publicUrl}/board/screen?key=${encodeURIComponent(opts.tableKey)}`);
        }
        // ?exchange: the open exchange's code instead of the table's join code (D-159). A remote player's invite also
        // on a remote board with board control, which sees the link anyway (D-166); a seat's join code only here.
        const ex = table.state().exchange;
        if (url.searchParams.get("exchange") !== null && ex?.kind === "remote" && ex.url) {
          const r = remoteOf(req);
          if (r ? !table.remoteControlAllowed(r.session) : !boardAllowed(req)) return json(res, 403, { error: "board only" });
          return await qrSvg(res, ex.url);
        }
        if (!boardAllowed(req)) return json(res, 403, { error: "board only" });
        if (url.searchParams.get("exchange") !== null) return ex?.kind === "local" ? await qrSvg(res, ex.url) : json(res, 404, { error: "no exchange is open" });
        return await qrSvg(res, table.currentJoin().url);
      }
      // Play from the board (D-175): the board and one player's deck side by side, only on the table PC itself.
      if (path === "/board/play.html") {
        if (!boardAllowed(req)) return json(res, 403, { error: "the board is only served on the table PC" });
        return await serveFile(res, "board/play.html", (s) => s.replace("__TABLE_KEY__", opts.tableKey));
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
      // Browsers ask for these at the root (Safari shows no SVG favicon, iOS looks for its home-screen icon): D-212.
      if (path === "/favicon.ico" || path === "/apple-touch-icon.png") return await serveFile(res, `shared${path}`);
      if ((match = path.match(/^\/games\/([a-z0-9-]+)\/((?:board|deck)\.(?:js|css)|how-to-play\.md|assets\/[\w./-]+)$/))) {
        // A game's own board and deck UI and its assets; rules and manifest are not served.
        const g = table.games.get(match[1]);
        if (!g || match[2].includes("..")) return json(res, 404, { error: "not found" });
        return await serveFile(res, match[2], undefined, g.dir);
      }
      json(res, 404, { error: "not found" });
    } catch (err) {
      if (err instanceof TableError) return json(res, err.status, { error: err.message, ...(err.code ? { code: err.code } : {}) });
      console.error(err);
      json(res, 500, { error: "internal error" });
    }
  };
  const server = createServer(handler);

  // ---------- WebSocket ----------

  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024 });

  // A removed watcher's windows close (D-168); the host also ends their browser's connection.
  table.on("remote-evict", (session: string) => {
    for (const o of [...clients]) {
      if (o.session !== session) continue;
      send(o.ws, envelope("system", "removed", { reason: "removed", message: "you were removed from watching this table" }));
      o.ws.close(4010, "removed");
    }
  });
  /** Moves a client out because a newer window took its place (D-132, D-133): it is told so and closed. */
  const replaceClient = (o: Client, by?: IncomingMessage) => {
    // Where the board went (D-190): the table's own computer, or another screen on the network.
    send(o.ws, envelope("system", "replaced", by ? { from: address(by), local: isLoopback(by) } : {}));
    o.ws.close(4009, "opened in another window");
    clients.delete(o);
  };
  /** What the table serves right now (D-133). */
  const connections = () => {
    const all = [...clients];
    return {
      boards: all.filter((c) => c.role === "board" && !c.remote).length,
      remoteBoards: all.filter((c) => c.role === "board" && c.remote).length,
      decks: all.filter((c) => c.role === "deck").length,
      limits: { boards: 1, remoteBoards: table.config.maxRemotePlayers, decks: MAX_DECKS },
    };
  };

  const onConnection = (ws: WebSocket, req: IncomingMessage) => {
    const remoteCtx = remoteOf(req);
    const remote = !!remoteCtx;
    const client: Client = { ws, role: "pending", alive: true, remote };
    // A socket must say hello soon, and only a few may be waiting to (D-202): idle sockets cost memory and pings.
    if ([...clients].filter((o) => o.role === "pending").length >= MAX_PENDING) return void ws.close(1013, "too many connections");
    clients.add(client);
    const helloTimer = setTimeout(() => client.role === "pending" && ws.close(4008, "no hello"), HELLO_MS);
    // An intent costs a token; tokens come back at INTENT_RATE a second up to INTENT_BURST.
    const intentAllowed = () => {
      const now = Date.now();
      client.tokens = Math.min(INTENT_BURST, (client.tokens ?? INTENT_BURST) + ((now - (client.tokensAt ?? now)) / 1000) * INTENT_RATE);
      client.tokensAt = now;
      if (client.tokens < 1) return false;
      client.tokens -= 1;
      return true;
    };
    ws.on("pong", () => (client.alive = true));

    const reply = (type: string, payload: unknown, seq?: number) => send(ws, envelope("system", type, payload, seq === undefined ? {} : { seq }));

    ws.on("message", (raw) => {
      let msg: Envelope<any>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return reply("error", { message: "invalid JSON" });
      }
      const c = client as any; // the hello turns it into a board or a deck
      try {
        if (msg.ch === "system" && msg.type === "hello") {
          const p = msg.payload ?? {};
          if (p.role === "board") {
            if (!remote && !keyOk(p.key)) throw new TableError(401, "board needs the table key");
            const acceptBoard = () => {
              c.role = "board";
              if (!remote) table.setLocalBoard(true); // AI players pace themselves on it (D-141)
              reply("welcome", { role: "board", remote }, msg.seq);
              send(ws, envelope("lobby", "state", forClient(remote, table.state(), c.session)));
              if (table.phase === "active" || table.phase === "paused") sendGame([client], []);
            };
            if (remote) {
              // A board per remote player (D-133): the newest window of a remote session replaces its older one, and
              // the table serves no more remote boards than it has remote seats.
              c.session = remoteCtx!.session;
              const remoteBoards = [...clients].filter((o) => o !== client && o.role === "board" && o.remote);
              remoteBoards.filter((o) => o.session === c.session).forEach((o) => replaceClient(o));
              if (remoteBoards.filter((o) => o.session !== c.session).length >= table.config.maxRemotePlayers) throw new TableError(409, REMOTE_FULL, "remote-full");
              table.remoteBoardOpened(c.session, remoteCtx!.invite, p.name); // watchers are counted by their boards (D-168)
              c.counted = true;
              return acceptBoard();
            }
            // One board window at the table PC (D-132). A second one is told where the table is and gets nothing; it
            // takes over only when asked (takeover), or when it is the same browser tab coming back (a reload, a
            // dropped connection), and the window it replaces is told so. A board that does not answer a ping within
            // 1.5 s is gone (a closed window, a dead connection) and does not count. Remote boards: any number.
            const tab = typeof p.tab === "string" ? p.tab.slice(0, 64) : "";
            c.tab = tab;
            const others = () => [...clients].filter((o) => o !== client && o.role === "board" && !o.remote && o.ws.readyState === o.ws.OPEN);
            const replace = () => {
              others().forEach((o) => replaceClient(o, req));
              acceptBoard();
            };
            const live = others();
            if (!live.length || p.takeover || (tab !== "" && live.every((o) => o.tab === tab))) return replace();
            const answered = new Set<unknown>();
            for (const o of live) {
              o.ws.once("pong", () => answered.add(o));
              o.ws.ping();
            }
            setTimeout(() => {
              if (ws.readyState !== ws.OPEN) return;
              if (others().some((o) => answered.has(o))) {
                const st = table.state();
                return reply("elsewhere", { phase: st.phase, game: st.game?.name ?? null }, msg.seq);
              }
              for (const o of others()) (o.ws.terminate(), clients.delete(o));
              acceptBoard();
            }, 1500);
            return;
          } else if (p.sessionToken) {
            const info = table.resume(String(p.sessionToken));
            // One deck per player (D-133): the player's newest window replaces the older one, which is told so.
            [...clients].filter((o) => o !== client && o.role === "deck" && o.playerId === info.id).forEach((o) => replaceClient(o));
            if ([...clients].filter((o) => o.role === "deck").length >= MAX_DECKS) throw new TableError(409, "the table serves eight phones at most");
            c.role = "deck";
            c.playerId = info.id;
            reply("welcome", { role: "deck", playerId: info.id }, msg.seq);
          } else {
            if ([...clients].filter((o) => o.role === "deck").length >= MAX_DECKS) throw new TableError(409, "the table serves eight phones at most");
            // The deck played from the board (D-175) proves itself with the table key instead of a join code.
            const fromBoard = !remoteCtx && p.boardKey !== undefined;
            if (fromBoard && !keyOk(p.boardKey)) throw new TableError(401, "the deck played from the board needs the table key");
            const { playerId, sessionToken } = remoteCtx
              ? table.joinRemote(p.name, remoteCtx.session, remoteCtx.invite)
              : fromBoard
                ? table.joinFromBoard(p.name)
                : table.join(String(p.joinToken ?? ""), p.name);
            c.role = "deck";
            c.playerId = playerId;
            reply("welcome", { role: "deck", playerId, sessionToken }, msg.seq);
          }
          send(ws, envelope("lobby", "state", forClient(remote, table.state(), c.session)));
          if (table.phase === "active" || table.phase === "paused") sendGame([client], []);
          return;
        }
        if (c.role !== "deck" && c.role !== "board") throw new TableError(401, "say hello first");
        if (c.role === "deck" && msg.ch === "lobby" && msg.type === "rename") {
          // A player changes their own name (D-148).
          table.rename(c.playerId, msg.payload?.name);
          return reply("ack", {}, msg.seq);
        }
        if (c.role === "deck" && msg.ch === "lobby" && msg.type === "leave") {
          // A player leaves from their phone (D-158): the table, or the running game (the seat can go to an AI).
          reply("ack", {}, msg.seq);
          table.leave(c.playerId);
          return;
        }
        if (c.role === "deck" && msg.ch === "lobby" && msg.type === "ready") {
          table.setReady(c.playerId, !!msg.payload?.ready);
          return reply("ack", {}, msg.seq);
        }
        if (c.role === "board" && msg.ch === "game" && msg.type === "idle") {
          // The local board has shown game message `seq` (D-141); remote boards don't pace the game.
          if (!c.remote) table.boardIdle(Number(msg.payload?.seq));
          return;
        }
        if (c.role === "board" && msg.ch === "game" && msg.type === "intent") {
          if (!intentAllowed()) return reply("reject", { reason: "Too many moves at once" }, msg.seq);
          // A move made by touching the board (D-102): payload { playerId, name, payload }.
          const b = msg.payload ?? {};
          const r = table.boardIntent(b.playerId, { name: b.name, payload: b.payload }, remoteCtx ? remoteCtx.session : null);
          return r.ok ? reply("ack", {}, msg.seq) : reply("reject", { reason: r.reason }, msg.seq);
        }
        if (c.role === "deck" && msg.ch === "game" && msg.type === "gesture") {
          // A sling gesture (D-189): live and unlogged, from a phone (a card being dragged), passed to every board with
          // the player's seat. Not state: no answer, dropped when too fast or too big, or outside a game; only the
          // fields the sling uses reach the boards (cleanGesture, D-202).
          const now = Date.now();
          if (now - (c.lastGesture ?? 0) < 8) return;
          c.lastGesture = now;
          const seat = table.player(c.playerId)?.seat;
          if (seat === null || seat === undefined || table.phase !== "active") return;
          const gesture = cleanGesture(msg.payload);
          if (!gesture) return;
          const data = JSON.stringify(gesture);
          if (data.length > 512) return;
          const text = `{"v":1,"ch":"game","type":"gesture","payload":{"seat":${seat},"data":${data}}}`;
          for (const o of clients) if (o.role === "board") sendText(o.ws, text);
          return;
        }
        if (c.role === "deck" && msg.ch === "game" && msg.type === "intent") {
          if (!intentAllowed()) return reply("reject", { reason: "Too many moves at once" }, msg.seq);
          const r = table.intent(c.playerId, msg.payload);
          return r.ok ? reply("ack", {}, msg.seq) : reply("reject", { reason: r.reason }, msg.seq);
        }
        throw new TableError(400, `unexpected ${msg.ch}.${msg.type}`);
      } catch (err) {
        const message = err instanceof TableError ? err.message : "internal error";
        if (!(err instanceof TableError)) console.error(err);
        reply("error", { message, status: err instanceof TableError ? err.status : 500, ...(err instanceof TableError && err.code ? { code: err.code } : {}) }, msg.seq);
        if (msg.type === "hello") ws.close(4003, message);
      }
    });

    ws.on("close", () => {
      clearTimeout(helloTimer);
      const listed = clients.delete(client); // a replaced board was taken off the list already, its successor stays
      const c = client as Client;
      held.delete(c);
      if (listed && c.role === "board" && !c.remote && ![...clients].some((o) => o.role === "board" && !o.remote)) table.setLocalBoard(false);
      if (c.counted && c.session) table.remoteBoardClosed(c.session);
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
