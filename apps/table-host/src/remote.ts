// Remote play (phase 1c, D-020): a remote browser connects peer-to-peer to this table over a WebRTC
// data channel, brokered by the cloud. Everything it loads and every live update travels over that
// channel; the table stays the only game server. Frames on the channel (JSON text):
//
//   page → table  {k:"req", id, method, path, body?}              an HTTP request (board/deck files, API)
//   table → page  {k:"res", id, status, type, part, parts, b64}   the response, base64 in chunks
//   both ways     {k:"ws", sid, op:"open"|"msg"|"close", data?}   a virtual WebSocket (board or deck)
//   table → page  {k:"ping"}  and  page → table {k:"pong"}         liveness: a browser that vanishes
//                                                                  without closing is dropped
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { RTCPeerConnection, type RTCDataChannel } from "werift";
import type { RemoteContext } from "./server.ts";

const CHUNK = 16 * 1024; // base64 characters per frame, well under SCTP message limits
/** The largest WebSocket message a remote session may send, as for the table's own sockets. */
const MAX_MESSAGE = 64 * 1024;
const MAX_SESSIONS = 16;
const OPEN_TIMEOUT_MS = 30_000;

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<unknown>;
type Attach = (ws: any, req: IncomingMessage) => void;

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Just enough of IncomingMessage for the server's handler. */
function fakeRequest(method: string, path: string, body: string | undefined, remote: RemoteContext): IncomingMessage {
  const req = Readable.from(body ? [Buffer.from(body)] : []) as unknown as IncomingMessage & { gtRemote: RemoteContext };
  Object.assign(req, {
    method,
    url: path,
    headers: { "content-type": "application/json" },
    socket: { remoteAddress: `remote:${remote.session}` },
    gtRemote: remote,
  });
  return req;
}

/** Just enough of ServerResponse: collects status, content type and body. */
function fakeResponse(done: (status: number, type: string, body: Buffer) => void): ServerResponse {
  let status = 200;
  let type = "application/octet-stream";
  return {
    writeHead(s: number, headers: Record<string, string> = {}) {
      status = s;
      type = headers["content-type"] ?? type;
      return this;
    },
    end(data?: string | Buffer) {
      done(status, type, data === undefined ? Buffer.alloc(0) : Buffer.isBuffer(data) ? data : Buffer.from(data));
    },
  } as unknown as ServerResponse;
}

/** A WebSocket look-alike over the data channel, handed to the server's normal socket handling. */
class ChannelSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  private readonly sid: number;
  private readonly out: (frame: object) => void;
  constructor(sid: number, out: (frame: object) => void) {
    super();
    this.sid = sid;
    this.out = out;
  }
  send(data: string) {
    if (this.readyState === 1) this.out({ k: "ws", sid: this.sid, op: "msg", data: String(data) });
  }
  close(code = 1000, reason = "") {
    if (this.readyState !== 1) return;
    this.out({ k: "ws", sid: this.sid, op: "close", code, reason });
    this.closed(code);
  }
  terminate() {
    this.close(1006);
  }
  ping() {
    setImmediate(() => this.emit("pong")); // liveness is the data channel's job
  }
  closed(code = 1000) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close", code);
  }
  receive(data: string) {
    if (this.readyState === 1) this.emit("message", Buffer.from(data));
  }
}

class Session {
  readonly sockets = new Map<number, ChannelSocket>();
  channel: RTCDataChannel | null = null;
  openTimer: NodeJS.Timeout | undefined;
  private pingTimer: NodeJS.Timeout | undefined;
  private lastSeen = Date.now();
  readonly id: string;
  readonly pc: RTCPeerConnection;
  /** sha256 of the invite this session came through (D-164), when the service says. */
  readonly invite: string | undefined;
  private readonly gw: RemoteGateway;
  constructor(id: string, pc: RTCPeerConnection, gw: RemoteGateway, invite?: string) {
    this.id = id;
    this.pc = pc;
    this.gw = gw;
    this.invite = invite;
  }

  send(frame: object) {
    if (this.channel?.readyState === "open") this.channel.send(JSON.stringify(frame));
  }

  /** Ping while the channel is open; drop the session when the page stops answering. */
  startLiveness() {
    this.lastSeen = Date.now();
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.lastSeen > this.gw.timeoutMs) return this.gw.drop(this.id, this);
      this.send({ k: "ping" });
    }, this.gw.pingMs);
    this.pingTimer.unref?.();
  }

  async onFrame(raw: string) {
    this.lastSeen = Date.now();
    let f: any;
    try {
      f = JSON.parse(raw);
    } catch {
      return;
    }
    if (f?.k === "pong") return;
    const ctx: RemoteContext = { session: this.id, invite: this.invite };
    if (f.k === "req" && typeof f.path === "string" && Number.isInteger(f.id)) {
      const method = String(f.method ?? "GET").toUpperCase();
      // Only the paths a remote board or deck needs; everything else stays on the table.
      // Plus /qr.svg, which the host answers for a remote board only with an open remote exchange's invite (D-166).
      if (!/^\/((board|deck|shared|games|api\/v1)(\/|$)|qr\.svg(\?|$))/.test(f.path)) return this.reply(f.id, 404, "application/json", Buffer.from('{"error":"not found"}'));
      await new Promise<void>((resolve) => {
        const res = fakeResponse((status, type, body) => {
          this.reply(f.id, status, type, body);
          resolve();
        });
        this.gw.handler(fakeRequest(method, f.path, typeof f.body === "string" ? f.body : undefined, ctx), res).catch(() => resolve());
      });
    } else if (f.k === "ws" && Number.isInteger(f.sid)) {
      if (f.op === "open" && !this.sockets.has(f.sid) && this.sockets.size < 8) {
        const s = new ChannelSocket(f.sid, (fr) => this.send(fr));
        s.on("close", () => this.sockets.delete(f.sid));
        this.sockets.set(f.sid, s);
        this.gw.attach(s, fakeRequest("GET", "/ws", undefined, ctx));
        this.send({ k: "ws", sid: f.sid, op: "open" });
      } else if (f.op === "msg") {
        // The same limit as the table's own WebSockets (maxPayload, 64 KiB, D-202): a larger message is dropped.
        const data = String(f.data ?? "");
        if (data.length <= MAX_MESSAGE) this.sockets.get(f.sid)?.receive(data);
      }
      else if (f.op === "close") this.sockets.get(f.sid)?.closed(f.code ?? 1000);
    }
  }

  private reply(id: number, status: number, type: string, body: Buffer) {
    const b64 = body.toString("base64");
    const parts = Math.max(1, Math.ceil(b64.length / CHUNK));
    for (let i = 0; i < parts; i++) this.send({ k: "res", id, status, type, part: i, parts, b64: b64.slice(i * CHUNK, (i + 1) * CHUNK) });
  }

  close() {
    clearTimeout(this.openTimer);
    clearInterval(this.pingTimer);
    for (const s of this.sockets.values()) s.closed(1001);
    this.sockets.clear();
    try {
      this.pc.close();
    } catch {}
  }
}

export class RemoteGateway {
  private sessions = new Map<string, Session>();
  /** Liveness over the data channel (a closed laptop sends no goodbye). */
  pingMs = 5_000;
  timeoutMs = 20_000;
  readonly handler: Handler;
  readonly attach: Attach;

  constructor(handler: Handler, attach: Attach) {
    this.handler = handler;
    this.attach = attach;
  }

  get count() {
    return this.sessions.size;
  }

  /** Answer a remote browser's offer (relayed by the cloud). Non-trickle ICE: the answer carries all candidates. */
  async answer(session: string, offerSdp: string, iceServers: IceServer[] = [], invite?: string): Promise<string> {
    const old = this.sessions.get(session);
    if (old) this.drop(session, old); // a reconnect replaces its own earlier connection
    if (this.sessions.size >= MAX_SESSIONS) throw new Error("too many remote connections");
    if (!/^m=application .*webrtc-datachannel/m.test(offerSdp)) throw new Error("the offer has no data channel");
    const pc = new RTCPeerConnection({ iceServers: iceServers as any });
    const s = new Session(session, pc, this, invite);
    this.sessions.set(session, s);
    try {
      pc.onDataChannel.subscribe((ch) => {
        if (s.channel) return; // one channel per connection
        s.channel = ch;
        clearTimeout(s.openTimer);
        s.startLiveness();
        ch.onMessage.subscribe((m) => void s.onFrame(typeof m === "string" ? m : m.toString("utf8")).catch(() => {}));
        ch.stateChanged.subscribe((st) => st === "closed" && this.drop(session, s));
      });
      pc.connectionStateChange.subscribe((st) => (st === "failed" || st === "closed") && this.drop(session, s));
      await pc.setRemoteDescription({ type: "offer", sdp: offerSdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") return resolve();
        const t = setTimeout(resolve, 6000);
        pc.iceGatheringStateChange.subscribe((g) => g === "complete" && (clearTimeout(t), resolve()));
      });
      // An offer whose channel never opens (abandoned page, unreachable peer) must not hold a slot.
      s.openTimer = setTimeout(() => !s.channel && this.drop(session, s), OPEN_TIMEOUT_MS);
      s.openTimer.unref?.();
      return pc.localDescription!.sdp;
    } catch (err) {
      this.drop(session, s);
      throw err;
    }
  }

  drop(id: string, s: Session) {
    if (this.sessions.get(id) !== s) return;
    this.sessions.delete(id);
    s.close();
  }

  /** End one browser's connection (a removed watcher, D-168). */
  end(session: string) {
    const s = this.sessions.get(session);
    if (s) setTimeout(() => this.drop(session, s), 500); // the board's "removed" message goes first
  }

  close() {
    for (const s of this.sessions.values()) s.close();
    this.sessions.clear();
  }
}
