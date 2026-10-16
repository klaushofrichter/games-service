// Remote play (phase 1c): invite → cloud signaling → WebRTC data channel → the table's own handlers.
// A werift peer plays the remote browser, speaking the same frames as apps/cloud/public/remote.html.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { RTCPeerConnection, type RTCDataChannel } from "werift";
import { startCloud } from "../apps/cloud/src/server.ts";
import { pairTable, sleep, testHost, until } from "./helpers.ts";

const ADMIN = "admin-token-for-tests-123";
let cloud: Awaited<ReturnType<typeof startCloud>>;
let base: string;
const cleanup: (() => unknown)[] = [];

/** A table paired with the cloud and online. */
async function pairedHost(o: Parameters<typeof testHost>[0] = {}) {
  const t = await testHost({ cloudUrl: base, cloudPollMs: 30, cloudHeartbeatMs: 50, ...o });
  cleanup.push(() => t.close());
  await pairTable(t, base, ADMIN);
  await until(() => t.host.gateway && (t.host.cloud as any)?.socket?.readyState === WebSocket.OPEN);
  return t;
}

interface Res {
  status: number;
  type: string;
  body: Buffer;
}

/** The remote browser: signaling over the cloud, then requests and virtual sockets over the channel. */
class RemotePeer {
  pc = new RTCPeerConnection({ iceServers: [] });
  ch!: RTCDataChannel;
  session = "";
  answerPings = true;
  private reqId = 0;
  private sid = 0;
  private pending = new Map<number, { parts: string[]; resolve: (r: Res) => void }>();
  private sockets = new Map<number, { open: boolean; msgs: any[]; closed: boolean }>();

  static async connect(invite: string) {
    const p = new RemotePeer();
    cleanup.push(() => p.pc.close());
    await p.signal(`invite=${invite}`);
    return p;
  }

  /** A new connection for an existing session (the invite is used up by then). */
  static async reconnect(session: string) {
    const p = new RemotePeer();
    cleanup.push(() => p.pc.close());
    await p.signal(`session=${session}`);
    return p;
  }

  private signal(query: string) {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${base.replace("http", "ws")}/api/remote/ws?${query}`);
      ws.on("error", reject);
      ws.on("unexpected-response", (_req, res) => reject(new Error(`signaling refused: ${res.statusCode}`)));
      ws.on("message", async (raw) => {
        const m = JSON.parse(String(raw));
        if (m.type === "hello") {
          this.session = m.session;
          this.ch = this.pc.createDataChannel("gt");
          this.ch.onMessage.subscribe((d) => this.onFrame(String(d)));
          this.ch.stateChanged.subscribe((s) => s === "open" && (ws.close(), resolve()));
          await this.pc.setLocalDescription(await this.pc.createOffer());
          await until(() => this.pc.iceGatheringState === "complete", 4000).catch(() => {});
          ws.send(JSON.stringify({ type: "offer", sdp: this.pc.localDescription!.sdp }));
        } else if (m.type === "answer") await this.pc.setRemoteDescription({ type: "answer", sdp: m.sdp });
        else if (m.type === "error") reject(new Error(m.message));
      });
    });
  }

  private onFrame(raw: string) {
    const f = JSON.parse(raw);
    if (f.k === "ping" && this.answerPings) return void this.ch.send(JSON.stringify({ k: "pong" }));
    if (f.k === "res") {
      const p = this.pending.get(f.id)!;
      p.parts[f.part] = f.b64;
      if (p.parts.filter((x) => x !== undefined).length === f.parts) {
        this.pending.delete(f.id);
        p.resolve({ status: f.status, type: f.type, body: Buffer.from(p.parts.join(""), "base64") });
      }
    } else if (f.k === "ws") {
      const s = this.sockets.get(f.sid)!;
      if (f.op === "open") s.open = true;
      else if (f.op === "msg") s.msgs.push(JSON.parse(f.data));
      else if (f.op === "close") s.closed = true;
    }
  }

  request(method: string, path: string, body?: unknown): Promise<Res> {
    const id = ++this.reqId;
    return new Promise((resolve) => {
      this.pending.set(id, { parts: [], resolve });
      this.ch.send(JSON.stringify({ k: "req", id, method, path, body: body === undefined ? undefined : JSON.stringify(body) }));
    });
  }

  async json(method: string, path: string, body?: unknown) {
    const r = await this.request(method, path, body);
    return { status: r.status, body: JSON.parse(r.body.toString() || "{}") };
  }

  /** Open a virtual socket and say hello; resolves with helpers to read what arrives. */
  async socket(hello: object) {
    const sid = ++this.sid;
    const s = { open: false, msgs: [] as any[], closed: false };
    this.sockets.set(sid, s);
    this.ch.send(JSON.stringify({ k: "ws", sid, op: "open" }));
    await until(() => s.open);
    const send = (ch: string, type: string, payload: unknown, seq?: number) =>
      this.ch.send(JSON.stringify({ k: "ws", sid, op: "msg", data: JSON.stringify({ v: 1, ch, type, seq, payload }) }));
    send("system", "hello", hello, 1);
    const next = (pred: (m: any) => boolean) => until(() => s.msgs.find(pred));
    return { s, send, next, lastState: () => [...s.msgs].reverse().find((m) => m.ch === "lobby" && m.type === "state")?.payload };
  }
}

beforeEach(async () => {
  cloud = await startCloud({ port: 0, host: "127.0.0.1", adminToken: ADMIN, publicUrl: "https://games.skylar.technology", iceServers: [] });
  base = `http://127.0.0.1:${cloud.port}`;
});
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
  await cloud.close();
});

// werift waits up to 5 s for its STUN probe (unreachable in CI), on both sides of every connection.
describe("remote play", { timeout: 60_000 }, () => {
  it("needs the cloud to create an invite", async () => {
    const t = await testHost();
    cleanup.push(() => t.close());
    expect((await t.api("POST", "/invites")).status).toBe(409);
  });

  it("joins a remote player through an invite, peer to peer, with the table as the only server", async () => {
    const t = await pairedHost();
    const inv = await t.ok("POST", "/invites");
    expect(inv.token).toMatch(/^[A-Z0-9]{1,8}$/);
    expect(inv.url).toBe(`https://games.skylar.technology/i/${inv.token}`);
    expect((await fetch(`${base}/i/${inv.token}`)).status).toBe(200);
    // the local board can render a QR code for the invite
    const qr = await t.api("GET", `/qr?text=${encodeURIComponent(inv.url)}`);
    expect(qr.body.toString()).toContain("<svg");

    const peer = await RemotePeer.connect(inv.token);

    // the board page comes over the channel, without the table key
    const board = await peer.request("GET", "/board/?remote=1");
    expect(board.status).toBe(200);
    expect(board.type).toContain("text/html");
    expect(board.body.toString()).toContain("window.REMOTE_BOARD = true");
    expect(board.body.toString()).not.toContain("test-key");
    expect((await peer.request("GET", "/shared/board-kit.js")).status).toBe(200);
    expect((await peer.request("GET", "/games/roulette/board.js")).status).toBe(200);

    // API: lobby reads and controls work, the local join code and table-only paths do not
    const st = await peer.json("GET", "/api/v1/state");
    expect(st.status).toBe(200);
    expect(st.body.joinUrl).toBe("");
    for (const p of ["/api/v1/join", "/api/v1/logs", "/api/v1/saves", "/api/v1/qr?text=https://x.y/"]) expect((await peer.request("GET", p)).status).toBe(403);
    expect((await peer.request("POST", "/api/v1/invites")).status).toBe(403);
    expect((await peer.request("POST", "/api/v1/simulation", { gameId: "roulette" })).status).toBe(403);
    expect((await peer.request("POST", "/api/v1/developer", { allowNoLocalPlayer: true })).status).toBe(403); // D-117: the table's own board only
    expect((await peer.request("GET", "/admin")).status).toBe(404); // nothing outside the board and deck

    // the remote deck takes a seat with just a name
    const deck = await peer.socket({ name: "Rita" });
    const welcome = await deck.next((m) => m.type === "welcome");
    expect(welcome.payload.sessionToken).toBeTruthy();
    const rita = t.host.table.state().players.find((p) => p.name === "Rita")!;
    expect(rita).toMatchObject({ kind: "human", location: "remote", connected: true });
    expect(rita.seat).not.toBeNull();
    await until(() => deck.lastState()?.players.some((p: any) => p.name === "Rita"));
    expect(deck.lastState().joinUrl).toBe("");
    expect(t.host.table.state().remote).toMatchObject({ players: 1, maxPlayers: 4, boardControl: true });
    expect(JSON.stringify(t.host.table.state())).not.toContain(peer.session); // the cloud session stays private

    // one invite seats one player: another hello on the same connection gets Rita back, not a new seat
    const again = await peer.socket({ name: "Rita's friend" });
    expect((await again.next((m) => m.type === "welcome")).payload.playerId).toBe(rita.id);
    expect(t.host.table.state().players.filter((p) => p.location === "remote")).toHaveLength(1);

    // the remote board connects without a key and sees the lobby
    const rb = await peer.socket({ role: "board" });
    expect((await rb.next((m) => m.type === "welcome")).payload).toEqual({ role: "board", remote: true });
    await until(() => rb.lastState());
    expect(rb.lastState().joinUrl).toBe("");

    // a local deck and the remote deck play a round of coin flip
    const a = await t.joinDeck("Ana");
    // seating, AI seats and saves stay with the people at the table
    const ana = t.host.table.state().players.find((p) => p.name === "Ana")!;
    for (const [m, p, b] of [
      ["DELETE", `/api/v1/players/${ana.id}`, undefined],
      ["POST", "/api/v1/ai", {}],
      ["POST", "/api/v1/seats/move", { playerId: ana.id, seat: 3 }],
      ["POST", `/api/v1/players/${ana.id}/color`, { color: "#5fe0c8" }], // colours are the table's settings (D-106)
      ["POST", "/api/v1/game/save", {}],
      ["POST", "/api/v1/game/resume", {}],
      ["POST", `/api/v1/players/${ana.id}/ai-options`, { options: {} }],
    ] as const) {
      const r = await peer.json(m, p, b);
      expect(r.status, `${m} ${p}`).toBe(403);
      expect(r.body.error).toMatch(/only players at the table/);
    }
    expect(t.host.table.state().players.map((p) => p.name).sort()).toEqual(["Ana", "Rita"]);
    expect((await peer.json("POST", "/api/v1/game/select", { gameId: "coin-flip", settings: { rounds: 1, roundSeconds: 0 } })).status).toBe(200);
    await a.request("lobby", "ready", { ready: true });
    deck.send("lobby", "ready", { ready: true }, 2);
    await until(() => t.host.table.state().players.every((p) => p.ready));
    await t.ok("POST", "/game/start");
    await deck.next((m) => m.ch === "game" && m.type === "view");
    await a.request("game", "intent", { name: "guess", payload: "heads" });
    deck.send("game", "intent", { name: "guess", payload: "tails" }, 3);
    await until(() => t.host.table.phase === "finished");

    // the invite is used up: a second browser can't claim it, but the session can reconnect
    await expect(RemotePeer.connect(inv.token)).rejects.toThrow(/404/);
  });

  it("lets the table switch off board control for remote players", async () => {
    const t = await pairedHost();
    const peer = await RemotePeer.connect((await t.ok("POST", "/invites")).token);
    expect((await peer.json("POST", "/api/v1/layout", { seats: 6 })).status).toBe(200);
    // "Play now" for an AI out of time (D-112) is open to remote boards with control: here nobody is waited for (409)
    expect((await peer.json("POST", "/api/v1/game/play-now")).status).toBe(409);
    await t.ok("POST", "/remote", { boardControl: false });
    expect(t.host.table.state().remote.boardControl).toBe(false);
    const denied = await peer.json("POST", "/api/v1/layout", { seats: 4 });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toMatch(/switched off/);
    expect((await peer.json("POST", "/api/v1/game/play-now")).status).toBe(403);
    expect((await peer.json("GET", "/api/v1/state")).status).toBe(200); // reading still works
    // and remote players can't switch it back on themselves
    expect((await peer.request("POST", "/api/v1/remote", { boardControl: true })).status).toBe(403);
    await t.ok("POST", "/remote", { boardControl: true });
    expect((await peer.json("POST", "/api/v1/layout", { seats: 4 })).status).toBe(200);
    // settings stay with the table (D-088): a remote board can't change a game's display choices, even with control on
    await t.ok("POST", "/game/select", { gameId: "pachisi" });
    expect((await peer.json("POST", "/api/v1/game/prefs", { prefs: { colors: {} } })).status).toBe(403);
    expect((await peer.json("POST", "/api/v1/display", { sound: false })).status).toBe(403);
    // ...but a remote board follows the table's sound setting
    await t.ok("POST", "/display", { sound: false });
    expect((await peer.json("GET", "/api/v1/state")).body.display).toEqual({ sound: false });
  });

  it("limits the number of remote players", async () => {
    const t = await pairedHost({ maxRemotePlayers: 1 });
    const p1 = await RemotePeer.connect((await t.ok("POST", "/invites")).token);
    await (await p1.socket({ name: "One" })).next((m) => m.type === "welcome");
    const p2 = await RemotePeer.connect((await t.ok("POST", "/invites")).token);
    const d2 = await p2.socket({ name: "Two" });
    const err = await d2.next((m) => m.type === "error");
    expect(err.payload.message).toMatch(/no room for more remote players/);
    expect(t.host.table.state().players.map((p) => p.name)).toEqual(["One"]);
  });

  it("drops a connection whose offer is broken, so it doesn't hold a slot", async () => {
    const t = await testHost();
    cleanup.push(() => t.close());
    await expect(t.host.gateway.answer("s1", "not an sdp")).rejects.toThrow();
    expect(t.host.gateway.count).toBe(0);
  });

  it("claims an invite on the first connection, before the table answers", async () => {
    const t = await pairedHost();
    const { token } = await t.ok("POST", "/invites");
    const first = new WebSocket(`${base.replace("http", "ws")}/api/remote/ws?invite=${token}`);
    cleanup.push(() => first.close());
    await new Promise((r) => first.once("message", r)); // hello: session created, invite claimed
    await expect(RemotePeer.connect(token)).rejects.toThrow(/404/);
  });

  it("reconnects a dropped remote player through their session, to the same seat", async () => {
    const t = await pairedHost({ graceMs: 60_000 });
    t.host.gateway.pingMs = 100;
    t.host.gateway.timeoutMs = 400;
    const { token } = await t.ok("POST", "/invites");
    const first = await RemotePeer.connect(token);
    const deck = await first.socket({ name: "Rita" });
    const welcome = (await deck.next((m) => m.type === "welcome")).payload;
    const seat = t.host.table.state().players.find((p) => p.id === welcome.playerId)!.seat;

    await sleep(600);
    expect(t.host.table.state().players[0].connected).toBe(true); // answering pings keeps the player in
    first.answerPings = false; // the laptop lid closes: no goodbye, just silence
    await until(() => !t.host.table.state().players.find((p) => p.id === welcome.playerId)?.connected, 3000);
    expect(t.host.gateway.count).toBe(0);
    first.pc.close();
    await expect(RemotePeer.connect(token)).rejects.toThrow(/404/); // the invite can't be reused

    const again = await RemotePeer.reconnect(first.session);
    expect(again.session).toBe(first.session);
    const d2 = await again.socket({ sessionToken: welcome.sessionToken }); // the deck resumes with its token
    expect((await d2.next((m) => m.type === "welcome")).payload.playerId).toBe(welcome.playerId);
    const rita = t.host.table.state().players.find((p) => p.id === welcome.playerId)!;
    expect(rita).toMatchObject({ connected: true, seat, location: "remote" });
    expect(t.host.table.state().players).toHaveLength(1);
  });

  it("carries large files over the channel in chunks, byte for byte", async () => {
    const t = await pairedHost();
    const peer = await RemotePeer.connect((await t.ok("POST", "/invites")).token);
    for (const path of ["/games/holdem/board.js", "/board/board.js", "/shared/theme.css"]) {
      const direct = Buffer.from(await (await fetch(`${t.base}${path}`)).arrayBuffer());
      const viaChannel = await peer.request("GET", path);
      expect(viaChannel.status, path).toBe(200);
      expect(viaChannel.body.equals(direct), path).toBe(true);
    }
    expect((await fetch(`${t.base}/board/board.js`).then((r) => r.arrayBuffer())).byteLength).toBeGreaterThan(12 * 1024); // more than one chunk
    // and many requests at once stay matched to their answers
    const paths = ["/shared/theme.css", "/deck/deck.js", "/board/board.css", "/games/roulette/deck.js", "/api/v1/state"];
    const results = await Promise.all(paths.map((p) => peer.request("GET", p)));
    results.forEach((r, i) => expect(r.status, paths[i]).toBe(200));
    expect(JSON.parse(results[4].body.toString()).tableName).toBeTruthy();
  });

  it("keeps the join QR code and the board's key away from remote players", async () => {
    const t = await pairedHost();
    const peer = await RemotePeer.connect((await t.ok("POST", "/invites")).token);
    expect((await peer.request("GET", "/qr.svg")).status).not.toBe(200);
    expect((await peer.request("GET", "/j/ABCD1234")).status).toBe(404); // outside the paths a remote page needs
    const board = (await peer.request("GET", "/board/index.html")).body.toString();
    expect(board).not.toContain("test-key");
    const s = await peer.socket({ role: "board", key: "test-key" }); // even with the key, it's a remote board
    expect((await s.next((m) => m.type === "welcome")).payload.remote).toBe(true);
    await until(() => s.lastState());
    expect(s.lastState().joinUrl).toBe("");
  });

  it("refuses unknown invites at the cloud", async () => {
    await pairedHost();
    await expect(RemotePeer.connect("NOPE1234")).rejects.toThrow(/404/);
    expect((await fetch(`${base}/i/NOPE1234`)).status).toBe(404);
  });
});
