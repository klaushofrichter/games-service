// Remote play (phase 1c): invite → cloud signaling → WebRTC data channel → the table's own handlers.
// A werift peer plays the remote browser, speaking the same frames as apps/cloud/public/remote.html.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { RTCPeerConnection, type RTCDataChannel } from "werift";
import { startCloud } from "../apps/cloud/src/server.ts";
import { pairTable, sleep, testHost, until } from "./helpers.ts";
import { PROTOCOL_VERSION } from "../packages/protocol/src/index.ts";

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
    /** The window closes (a closed tab): the virtual socket closes from this side. */
    const close = () => this.ch.send(JSON.stringify({ k: "ws", sid, op: "close", code: 1001 }));
    return { s, send, next, close, lastState: () => [...s.msgs].reverse().find((m) => m.ch === "lobby" && m.type === "state")?.payload };
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
    // ... also with a name for the player (D-155), and the invite page answers with the name in the link
    const named = `${inv.url}?${new URLSearchParams({ name: "Zoë 日本 😀" })}`;
    expect((await t.api("GET", `/qr?text=${encodeURIComponent(named)}`)).body.toString()).toContain("<svg");
    expect((await t.api("GET", `/qr?text=${encodeURIComponent(inv.url + "?name=<script>")}`)).status).toBe(400);
    expect((await fetch(`${base}/i/${inv.token}?name=Zo%C3%AB`)).status).toBe(200);

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
    // Advanced › Versions on a remote board (D-182): the platform's version and protocol, like /health.
    expect((await peer.json("GET", "/api/v1/version")).body).toEqual({ version: process.env.APP_VERSION || "dev", protocol: PROTOCOL_VERSION });
    for (const p of ["/api/v1/join", "/api/v1/logs", "/api/v1/saves", "/api/v1/qr?text=https://x.y/"]) expect((await peer.request("GET", p)).status).toBe(403);
    expect((await peer.request("POST", "/api/v1/invites")).status).toBe(403);
    expect((await peer.request("POST", "/api/v1/simulation", { gameId: "roulette" })).status).toBe(403);
    expect((await peer.request("POST", "/api/v1/developer", { allowNoLocalPlayer: true })).status).toBe(403); // D-118: the table's own board only
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
    // the table knows which invite brought Rita, so the board's invite dialog can close (D-164)
    expect(t.host.table.state().remote.joined).toEqual([{ invite: inv.token, name: "Rita" }]);
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
      ["POST", "/api/v1/game/save", {}],
      ["POST", "/api/v1/game/resume", {}],
    ] as const) {
      const r = await peer.json(m, p, b);
      expect(r.status, `${m} ${p}`).toBe(403);
      expect(r.body.error).toMatch(/only players at the table/);
    }
    // With board control a remote board operates the settings too (D-159): the players' colours.
    expect((await peer.json("POST", `/api/v1/players/${ana.id}/color`, { color: "#f08a3c" })).status).toBe(200);
    expect(t.host.table.state().players.map((p) => p.name).sort()).toEqual(["Ana", "Rita"]);
    expect((await peer.json("POST", "/api/v1/game/select", { gameId: "coin-flip", settings: { rounds: 1, roundSeconds: 0 } })).status).toBe(200);
    await a.request("lobby", "ready", { ready: true });
    deck.send("lobby", "ready", { ready: true }, 2);
    await until(() => t.host.table.state().players.every((p) => p.ready));
    await t.ok("POST", "/game/start");
    await deck.next((m) => m.ch === "game" && m.type === "view");
    // An open exchange for a remote player (D-159): its invite as a QR code on the table's board and on a remote
    // board with board control, which sees the link anyway (D-166); never a seat's join code.
    const seat = t.host.table.state().players.find((p) => p.name === "Ana")!.seat!;
    t.host.table.exchange(seat, "remote", "https://games.example/i/QRQRQRQR");
    const qrLocal = await fetch(`${t.base}/qr.svg?exchange=1`);
    expect(qrLocal.status).toBe(200);
    expect(await qrLocal.text()).toContain("<svg");
    const qrRemote = await peer.request("GET", "/qr.svg?exchange=1");
    expect(qrRemote.status).toBe(200);
    expect(qrRemote.body.toString()).toContain("<svg");
    await t.ok("POST", "/remote", { boardControl: false });
    expect((await peer.request("GET", "/qr.svg?exchange=1")).status).toBe(403);
    await t.ok("POST", "/remote", { boardControl: true });
    await t.ok("DELETE", "/exchange");
    t.host.table.exchange(seat, "local");
    expect((await peer.request("GET", "/qr.svg?exchange=1")).status).toBe(403); // a seat's join code stays on the table
    expect((await fetch(`${t.base}/qr.svg?exchange=1`)).status).toBe(200);
    await t.ok("DELETE", "/exchange");
    await a.request("game", "intent", { name: "guess", payload: "heads" });
    deck.send("game", "intent", { name: "guess", payload: "tails" }, 3);
    await until(() => t.host.table.phase === "finished");

    // the invite is used up: a second browser can't claim it, but the session can reconnect
    await expect(RemotePeer.connect(inv.token)).rejects.toThrow(/404/);
  });

  it("lets the table switch off board control for remote players", async () => {
    const t = await pairedHost();
    const peer = await RemotePeer.connect((await t.ok("POST", "/invites")).token);
    await (await peer.socket({ name: "Rita" })).next((m) => m.type === "welcome"); // board control is for players (D-167)
    expect((await peer.json("POST", "/api/v1/layout", { seats: 6 })).status).toBe(200);
    // "Play now" for an AI out of time (D-112) is open to remote boards with control: here nobody is waited for (409)
    expect((await peer.json("POST", "/api/v1/game/play-now")).status).toBe(409);
    // so is skipping a game's wait (D-136): allowed through, and here no game runs (409)
    expect((await peer.json("POST", "/api/v1/game/skip-timer", { id: "next" })).status).toBe(409);
    await t.ok("POST", "/remote", { boardControl: false });
    expect(t.host.table.state().remote.boardControl).toBe(false);
    const denied = await peer.json("POST", "/api/v1/layout", { seats: 4 });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toMatch(/switched off/);
    expect((await peer.json("POST", "/api/v1/game/play-now")).status).toBe(403);
    expect((await peer.json("POST", "/api/v1/game/skip-timer", { id: "next" })).status).toBe(403);
    expect((await peer.json("GET", "/api/v1/state")).status).toBe(200); // reading still works
    // the Game Viewer (D-120) is for remote players with board control only, and read-only
    expect((await peer.json("GET", "/api/v1/history")).status).toBe(403);
    // and remote players can't switch it back on themselves
    expect((await peer.request("POST", "/api/v1/remote", { boardControl: true })).status).toBe(403);
    await t.ok("POST", "/remote", { boardControl: true });
    expect((await peer.json("POST", "/api/v1/layout", { seats: 4 })).status).toBe(200);
    expect((await peer.json("GET", "/api/v1/history")).status).toBe(200);
    expect((await peer.json("POST", "/api/v1/history")).status).toBe(405);
    expect((await peer.request("GET", "/api/v1/logs/x.zip")).status).toBe(403); // the zips themselves stay on the table
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
    const [i1, i2] = [await t.ok("POST", "/invites"), await t.ok("POST", "/invites")];
    const p1 = await RemotePeer.connect(i1.token);
    await (await p1.socket({ name: "One" })).next((m) => m.type === "welcome");
    expect((await t.api("POST", "/invites")).status).toBe(409); // full: no more invites (D-168)
    const p2 = await RemotePeer.connect(i2.token);
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

  it("hands both ends the same Cloudflare TURN relays, with credentials the key never leaves the service for (D-209)", async () => {
    await cloud.close();
    const cfFetch = (async () =>
      new Response(JSON.stringify({ iceServers: [{ urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp"], username: "u9", credential: "c9" }] }), { status: 201 })) as unknown as typeof fetch;
    cloud = await startCloud({ port: 0, host: "127.0.0.1", adminToken: ADMIN, publicUrl: "https://games.skylar.technology", iceServers: [], cloudflareTurn: { keyId: "k", apiToken: "secret-key-token", fetch: cfFetch } });
    base = `http://127.0.0.1:${cloud.port}`;
    const t = await pairedHost();
    const seen: unknown[] = [];
    const answer = t.host.gateway!.answer.bind(t.host.gateway);
    t.host.gateway!.answer = (session, sdp, ice, invite) => (seen.push(ice), answer(session, sdp, ice, invite));
    const { token } = await t.ok("POST", "/invites");
    const ws = new WebSocket(`${base.replace("http", "ws")}/api/remote/ws?invite=${token}`);
    cleanup.push(() => ws.close());
    const hello = await new Promise<any>((r) => ws.once("message", (m) => r(JSON.parse(String(m)))));
    const relay = [{ urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "u9", credential: "c9" }];
    expect(hello.iceServers).toEqual(relay);
    expect(JSON.stringify(hello)).not.toContain("secret-key-token");
    ws.send(JSON.stringify({ type: "offer", sdp: "v=0 not really" }));
    await until(() => seen.length === 1);
    expect(seen[0]).toEqual(relay);
  });

  it("tells the service how many remote players are connected and how many watch, without names (D-214)", async () => {
    const t = await pairedHost();
    const adminApi = async (path: string) => (await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${ADMIN}` } })).json();
    const row = async () => (await adminApi("/admin/api/tables")).find((x: any) => x.status === "approved");
    await until(async () => (await row())?.presence);
    expect((await row()).presence).toEqual({ remote: 0, remoteConnected: 0, watchers: 0 });
    const { token } = await t.ok("POST", "/invites");
    const peer = await RemotePeer.connect(token);
    const deck = await peer.socket({ name: "Rita" });
    await until(async () => (await row()).presence?.remoteConnected === 1);
    expect((await row()).presence).toEqual({ remote: 1, remoteConnected: 1, watchers: 0 });
    expect(JSON.stringify(await row())).not.toContain("Rita");
    const m = await adminApi("/admin/api/metrics");
    expect(m).toMatchObject({ remoteNow: 1, watchersNow: 0 });
    // A watcher counts apart from the players.
    const w = await t.ok("POST", "/invites", { watch: true });
    const watcher = await RemotePeer.connect(w.token);
    await (await watcher.socket({ role: "board", name: "Wanda" })).next((x) => x.type === "welcome");
    await until(async () => (await row()).presence?.watchers === 1);
    expect((await row()).presence).toEqual({ remote: 1, remoteConnected: 1, watchers: 1 });
    expect(await adminApi("/admin/api/metrics")).toMatchObject({ remoteNow: 1, watchersNow: 1 });
    // Rita's deck drops: she keeps her seat, away, and the console counts her so.
    deck.close();
    await until(async () => (await row()).presence?.remoteConnected === 0);
    expect((await row()).presence).toEqual({ remote: 1, remoteConnected: 0, watchers: 1 });
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

  it("takes board control from a remote board whose player is gone: it keeps watching, read-only (D-167)", async () => {
    const t = await pairedHost();
    const peer = await RemotePeer.connect((await t.ok("POST", "/invites")).token);
    const rb = await peer.socket({ role: "board" });
    await rb.next((m) => m.type === "welcome");
    // before the remote player has joined, the board does not operate the table
    expect((await peer.json("POST", "/api/v1/layout", { seats: 6 })).status).toBe(403);
    const deck = await peer.socket({ name: "Rita" });
    await deck.next((m) => m.type === "welcome");
    await until(() => rb.lastState()?.remote.boardControl === true);
    expect((await peer.json("POST", "/api/v1/layout", { seats: 6 })).status).toBe(200);
    expect((await peer.json("GET", "/api/v1/history")).status).toBe(200);
    // Rita is removed (in a game: exchanged, D-159): her browser keeps the board, without control
    const rita = t.host.table.state().players.find((p) => p.name === "Rita")!;
    await t.ok("DELETE", `/players/${rita.id}`);
    await until(() => rb.lastState()?.remote.boardControl === false);
    const denied = await peer.json("POST", "/api/v1/layout", { seats: 4 });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toMatch(/no longer a player/);
    expect((await peer.json("POST", "/api/v1/game/select", { gameId: "coin-flip" })).status).toBe(403);
    expect((await peer.json("GET", "/api/v1/history")).status).toBe(403);
    expect((await peer.json("GET", "/api/v1/state")).body.remote).toMatchObject({ boardControl: false, watching: true });
    expect(t.host.table.state().remote.boardControl).toBe(true); // the table's switch is unchanged
  });

  it("serves one board per remote player: a newer window replaces the older one (D-133)", async () => {
    const t = await pairedHost();
    const peer = await RemotePeer.connect((await t.ok("POST", "/invites")).token);
    const first = await peer.socket({ role: "board" });
    await first.next((m) => m.type === "welcome");
    const second = await peer.socket({ role: "board" });
    await second.next((m) => m.type === "welcome");
    await until(() => first.s.closed);
    expect(first.s.msgs.some((m) => m.type === "replaced")).toBe(true);
    const c = await t.ok("GET", "/connections");
    expect(c).toMatchObject({ boards: 0, remoteBoards: 1, limits: { boards: 1, remoteBoards: 4, decks: 8 } });
  });

  it("serves no more remote boards than it has remote seats (D-133)", async () => {
    const t = await pairedHost({ maxRemotePlayers: 1 });
    const a = await RemotePeer.connect((await t.ok("POST", "/invites")).token);
    await (await a.socket({ role: "board" })).next((m) => m.type === "welcome");
    const b = await RemotePeer.connect((await t.ok("POST", "/invites")).token);
    const refused = await b.socket({ role: "board" });
    const err = await refused.next((m) => m.type === "error");
    expect(err.payload.message).toMatch(/no room for more remote players or watchers/);
    expect((await t.ok("GET", "/connections")).remoteBoards).toBe(1);
  });

  it("refuses unknown invites at the cloud", async () => {
    await pairedHost();
    await expect(RemotePeer.connect("NOPE1234")).rejects.toThrow(/404/);
    expect((await fetch(`${base}/i/NOPE1234`)).status).toBe(404);
  });

  describe("watchers (D-168)", () => {
    const helloError = (sock: Awaited<ReturnType<RemotePeer["socket"]>>) => sock.next((m) => m.type === "error");

    it("a watch invite shows the board without a seat; the deck is refused; a removed watcher can't come back", async () => {
      const t = await pairedHost();
      const inv = await t.ok("POST", "/invites", { watch: true });
      expect(inv.url).toMatch(/[?&]watch=1/);
      const peer = await RemotePeer.connect(inv.token);
      const rb = await peer.socket({ role: "board", name: "Wanda" });
      await rb.next((m) => m.type === "welcome");
      await until(() => t.host.table.state().watchers.length === 1);
      const [w] = t.host.table.state().watchers;
      expect(w.name).toBe("Wanda");
      expect(t.host.table.state().remote.joined.at(-1)).toEqual({ invite: inv.token, name: "Wanda" }); // the invite dialog closes
      await until(() => rb.lastState()?.remote.watching === true);
      expect(rb.lastState().remote).toMatchObject({ boardControl: false, watching: true, mayJoin: false });
      expect((await helloError(await peer.socket({ name: "Wanda" }))).payload.message).toMatch(/watching/);
      expect(t.host.table.state().players).toHaveLength(0);
      expect((await peer.json("POST", "/api/v1/layout", { seats: 6 })).status).toBe(403);
      // removed: the board is told and closed, the browser's connection ends, and the session can't reconnect
      await t.ok("DELETE", `/watchers/${w.id}`);
      await until(() => rb.s.closed);
      expect(rb.s.msgs.some((m) => m.type === "removed")).toBe(true);
      expect(t.host.table.state().watchers).toEqual([]);
      await expect(RemotePeer.reconnect(peer.session)).rejects.toThrow(/removed/);
      expect((await t.api("DELETE", `/watchers/${w.id}`)).status).toBe(404);
    });

    it("remote players and watchers together stay within the remote places", async () => {
      const t = await pairedHost({ maxRemotePlayers: 1 });
      const peer = await RemotePeer.connect((await t.ok("POST", "/invites", { watch: true })).token);
      await (await peer.socket({ role: "board", name: "Wanda" })).next((m) => m.type === "welcome");
      await until(() => t.host.table.state().watchers.length === 1);
      const full = await t.api("POST", "/invites");
      expect(full.status).toBe(409);
      expect((await t.api("POST", "/invites", { watch: true })).status).toBe(409);
    });

    it("a remote player who is removed keeps watching; in the lobby the table can let them play again", async () => {
      const t = await pairedHost();
      const peer = await RemotePeer.connect((await t.ok("POST", "/invites")).token);
      const rb = await peer.socket({ role: "board", name: "Rita" });
      await rb.next((m) => m.type === "welcome");
      await until(() => rb.lastState());
      expect(rb.lastState().remote.mayJoin).toBe(true); // invited to play: the page opens the deck
      expect(t.host.table.state().watchers).toEqual([]); // not a watcher while joining
      await (await peer.socket({ name: "Rita" })).next((m) => m.type === "welcome");
      const rita = t.host.table.state().players.find((p) => p.name === "Rita")!;
      await t.ok("DELETE", `/players/${rita.id}`);
      await until(() => t.host.table.state().watchers.length === 1);
      const [w] = t.host.table.state().watchers;
      expect(w.name).toBe("Rita");
      await until(() => rb.lastState()?.remote.mayJoin === false);
      expect((await helloError(await peer.socket({ name: "Rita" }))).payload.message).toMatch(/watching/);
      await t.ok("POST", `/watchers/${w.id}/play`);
      await until(() => rb.lastState()?.remote.mayJoin === true);
      await (await peer.socket({ name: "Rita" })).next((m) => m.type === "welcome");
      expect(t.host.table.state().players.find((p) => p.name === "Rita")).toMatchObject({ location: "remote" });
      expect(t.host.table.state().watchers).toEqual([]);
    });

    it("during a game a seat is exchanged for a watcher, and an exchanged remote player becomes a watcher", async () => {
      const t = await pairedHost();
      const ann = await t.joinDeck("Ann");
      await t.ok("POST", "/ai", {});
      await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds: 20, roundSeconds: 0 } });
      await ann.request("lobby", "ready", { ready: true });
      await t.ok("POST", "/game/start");
      const peer = await RemotePeer.connect((await t.ok("POST", "/invites", { watch: true })).token);
      const rb = await peer.socket({ role: "board", name: "Wanda" });
      await rb.next((m) => m.type === "welcome");
      await until(() => t.host.table.state().watchers.length === 1);
      const [w] = t.host.table.state().watchers;
      const aiSeat = t.host.table.state().players.find((p) => p.kind === "ai")!.seat!;
      const r = await t.ok("POST", "/exchange", { seat: aiSeat, kind: "watcher", watcher: w.id });
      expect(r.state.exchange).toMatchObject({ seat: aiSeat, kind: "remote", watcher: { id: w.id, name: "Wanda" } });
      await until(() => rb.lastState()?.remote.mayJoin === true);
      await (await peer.socket({ name: "Wanda" })).next((m) => m.type === "welcome");
      let s = t.host.table.state();
      expect(s.players.find((p) => p.seat === aiSeat)).toMatchObject({ name: "Wanda", location: "remote", kind: "human" });
      expect(s.watchers).toEqual([]);
      expect(s.exchange).toBeNull();
      // and back: an AI takes Wanda's seat, and Wanda watches again (her board stays, without control)
      await t.ok("POST", "/exchange", { seat: aiSeat, kind: "ai" });
      await until(() => t.host.table.state().watchers.length === 1);
      await until(() => rb.lastState()?.remote.mayJoin === false);
      expect(rb.lastState().remote).toMatchObject({ watching: true, boardControl: false });
    });

    // ---------- more of the watchers' lifecycle (D-170) ----------
    /** A remote browser with its board open: a player (`name` on a normal invite) or a watcher (watch invite). */
    async function remoteBoard(t: Awaited<ReturnType<typeof pairedHost>>, name: string, watch: boolean) {
      const peer = await RemotePeer.connect((await t.ok("POST", "/invites", watch ? { watch: true } : {})).token);
      const board = await peer.socket({ role: "board", name });
      await board.next((m) => m.type === "welcome");
      let deck: Awaited<ReturnType<RemotePeer["socket"]>> | null = null;
      if (!watch) {
        deck = await peer.socket({ name });
        await deck.next((m) => m.type === "welcome");
      }
      return { peer, board, deck };
    }
    const watcherNamed = (t: Awaited<ReturnType<typeof pairedHost>>, name: string) => t.host.table.state().watchers.find((w) => w.name === name);
    async function coinFlip(t: Awaited<ReturnType<typeof pairedHost>>, ready: (() => Promise<unknown>)[] = []) {
      await t.ok("POST", "/game/select", { gameId: "coin-flip", settings: { rounds: 20, roundSeconds: 0 } });
      for (const r of ready) await r();
      await until(() => t.host.table.state().players.every((p) => p.ready));
      await t.ok("POST", "/game/start");
    }

    it("a remote player who leaves from the phone becomes a watcher: in the lobby, and during a game (their seat waits)", async () => {
      const t = await pairedHost();
      // in the lobby the player is gone, the browser watches
      const rita = await remoteBoard(t, "Rita", false);
      rita.deck!.send("lobby", "leave", {}, 5);
      await until(() => watcherNamed(t, "Rita"));
      expect(t.host.table.state().players.some((p) => p.name === "Rita")).toBe(false);
      await until(() => rita.board.lastState()?.remote.mayJoin === false);
      // during a game the seat waits for an exchange; the browser watches, without control, counted once
      const ann = await t.joinDeck("Ann");
      const ruth = await remoteBoard(t, "Ruth", false);
      await coinFlip(t, [() => ann.request("lobby", "ready", { ready: true }), async () => ruth.deck!.send("lobby", "ready", { ready: true }, 6)]);
      const seat = t.host.table.state().players.find((p) => p.name === "Ruth")!.seat!;
      ruth.deck!.send("lobby", "leave", {}, 7);
      await until(() => watcherNamed(t, "Ruth"));
      expect(t.host.table.state().players.find((p) => p.name === "Ruth")).toMatchObject({ seat }); // the seat waits
      await until(() => ruth.board.lastState()?.remote.watching === true);
      expect(ruth.board.lastState().remote).toMatchObject({ boardControl: false, mayJoin: false });
      expect(t.host.table.state().remote.players).toBe(0);
      expect(t.host.table.remoteCount()).toBe(2); // Rita and Ruth, both watching
      expect((await ruth.peer.json("POST", "/api/v1/game/end")).status).toBe(403);
      // Ruth takes her seat back through an exchange for her as a watcher
      const w = watcherNamed(t, "Ruth")!;
      await t.ok("POST", "/exchange", { seat, kind: "watcher", watcher: w.id });
      await until(() => ruth.board.lastState()?.remote.mayJoin === true);
      await (await ruth.peer.socket({ name: "Ruth" })).next((m) => m.type === "welcome");
      await until(() => !watcherNamed(t, "Ruth"));
      expect(t.host.table.state().players.filter((p) => p.seat === seat)).toMatchObject([{ name: "Ruth", kind: "human", location: "remote" }]);
    }, 120_000);

    it("a watcher who closes the window is gone; the same browser coming back watches again", async () => {
      const t = await pairedHost({ maxRemotePlayers: 1 });
      const wanda = await remoteBoard(t, "Wanda", true);
      await until(() => watcherNamed(t, "Wanda"));
      const id = watcherNamed(t, "Wanda")!.id;
      expect((await t.api("POST", "/invites", { watch: true })).status).toBe(409); // the one place is taken
      wanda.board.close();
      await until(() => t.host.table.state().watchers.length === 0);
      expect(t.host.table.remoteCount()).toBe(0);
      // a reload: the same browser opens its board again and is the same watcher
      const again = await wanda.peer.socket({ role: "board", name: "Wanda" });
      await again.next((m) => m.type === "welcome");
      await until(() => watcherNamed(t, "Wanda"));
      expect(watcherNamed(t, "Wanda")!.id).toBe(id);
      // two windows of one browser are one watcher (the newer window replaces the older one, D-133)
      const third = await wanda.peer.socket({ role: "board", name: "Wanda" });
      await third.next((m) => m.type === "welcome");
      await until(() => again.s.closed);
      expect(t.host.table.state().watchers).toHaveLength(1);
      await sleep(100);
      expect(t.host.table.state().watchers).toHaveLength(1);
    });

    it("an exchange for a watcher is theirs alone; cancelled or with the watcher removed, it lets nobody in", async () => {
      const t = await pairedHost();
      const ann = await t.joinDeck("Ann");
      await t.ok("POST", "/ai", {});
      await coinFlip(t, [() => ann.request("lobby", "ready", { ready: true })]);
      const aiSeat = t.host.table.state().players.find((p) => p.kind === "ai")!.seat!;
      const wanda = await remoteBoard(t, "Wanda", true);
      await until(() => watcherNamed(t, "Wanda"));
      // another remote browser, invited before, cannot take the seat waiting for Wanda
      const other = await RemotePeer.connect((await t.ok("POST", "/invites", { watch: true })).token);
      const otherBoard = await other.socket({ role: "board", name: "Olga" });
      await otherBoard.next((m) => m.type === "welcome");
      await t.ok("POST", "/exchange", { seat: aiSeat, kind: "watcher", watcher: watcherNamed(t, "Wanda")!.id });
      await until(() => wanda.board.lastState()?.remote.mayJoin === true);
      expect(otherBoard.lastState().remote.mayJoin).toBe(false);
      expect((await (await other.socket({ name: "Olga" })).next((m) => m.type === "error")).payload.message).toMatch(/watching/);
      // cancelled: Wanda's page closes the deck again, and her deck is refused
      await t.ok("DELETE", "/exchange");
      await until(() => wanda.board.lastState()?.remote.mayJoin === false);
      expect((await (await wanda.peer.socket({ name: "Wanda" })).next((m) => m.type === "error")).payload.message).toMatch(/watching/);
      // open again and remove Wanda: the exchange closes with her
      await t.ok("POST", "/exchange", { seat: aiSeat, kind: "watcher", watcher: watcherNamed(t, "Wanda")!.id });
      await t.ok("DELETE", `/watchers/${watcherNamed(t, "Wanda")!.id}`);
      expect(t.host.table.state().exchange).toBeNull();
      expect(t.host.table.state().players.find((p) => p.seat === aiSeat)!.kind).toBe("ai");
      // an exchange for someone who is not watching is refused
      expect((await t.api("POST", "/exchange", { seat: aiSeat, kind: "watcher", watcher: "w-nobody" })).status).toBe(404);
    }, 120_000);

    it("Let play is for the lobby with a free seat", async () => {
      const t = await pairedHost();
      await t.ok("POST", "/layout", { seats: 2 });
      const ann = await t.joinDeck("Ann");
      await t.ok("POST", "/ai", {});
      const wanda = await remoteBoard(t, "Wanda", true); // a watch invite needs no free seat
      await until(() => watcherNamed(t, "Wanda"));
      expect((await t.api("POST", "/invites")).status).toBe(409); // a player's invite does
      const id = watcherNamed(t, "Wanda")!.id;
      expect((await t.api("POST", `/watchers/${id}/play`)).status).toBe(409); // every seat taken
      await coinFlip(t, [() => ann.request("lobby", "ready", { ready: true })]);
      const inGame = await t.api("POST", `/watchers/${id}/play`);
      expect(inGame.status).toBe(409);
      expect(inGame.body.error).toMatch(/exchange/);
      await t.ok("POST", "/game/end");
      await until(() => t.host.table.phase !== "active");
      if (t.host.table.phase !== "idle") await t.ok("POST", "/game/close");
      // a watcher stays through the end of the game, still without control
      expect(watcherNamed(t, "Wanda")).toBeTruthy();
      expect(wanda.board.lastState().remote).toMatchObject({ watching: true, boardControl: false });
      await t.ok("DELETE", `/players/${t.host.table.state().players.find((p) => p.kind === "ai")!.id}`);
      await t.ok("POST", `/watchers/${id}/play`);
      await until(() => wanda.board.lastState()?.remote.mayJoin === true);
      await (await wanda.peer.socket({ name: "Wanda" })).next((m) => m.type === "welcome");
      expect(t.host.table.state().players.find((p) => p.name === "Wanda")).toMatchObject({ location: "remote" });
      expect((await t.api("POST", `/watchers/${id}/play`)).status).toBe(404); // a player now
    }, 120_000);

    it("the table's board and remote players with board control manage watchers; watchers and players without control don't", async () => {
      const t = await pairedHost();
      const rita = await remoteBoard(t, "Rita", false);
      const wanda = await remoteBoard(t, "Wanda", true);
      const wilma = await remoteBoard(t, "Wilma", true);
      await until(() => t.host.table.state().watchers.length === 2);
      // a watcher can't remove another one, or let one play
      expect((await wanda.peer.json("DELETE", `/api/v1/watchers/${watcherNamed(t, "Wilma")!.id}`)).status).toBe(403);
      expect((await wanda.peer.json("POST", `/api/v1/watchers/${watcherNamed(t, "Wilma")!.id}/play`)).status).toBe(403);
      // a remote player without board control can't either
      await t.ok("POST", "/remote", { boardControl: false });
      expect((await rita.peer.json("DELETE", `/api/v1/watchers/${watcherNamed(t, "Wilma")!.id}`)).status).toBe(403);
      // with it, they can
      await t.ok("POST", "/remote", { boardControl: true });
      expect((await rita.peer.json("DELETE", `/api/v1/watchers/${watcherNamed(t, "Wilma")!.id}`)).status).toBe(200);
      await until(() => wilma.board.s.closed);
      expect(t.host.table.state().watchers.map((w) => w.name)).toEqual(["Wanda"]);
      // the state never carries a remote browser's session
      const text = JSON.stringify(t.host.table.state());
      for (const p of [rita.peer, wanda.peer, wilma.peer]) expect(text).not.toContain(p.session);
    }, 120_000);

    it("four remote places: players and watchers fill them together", async () => {
      const t = await pairedHost({ maxRemotePlayers: 3 });
      await remoteBoard(t, "Rita", false);
      await remoteBoard(t, "Ruth", false);
      const spare = await t.ok("POST", "/invites", { watch: true }); // made while a place is free
      await remoteBoard(t, "Wanda", true);
      await until(() => t.host.table.state().watchers.length === 1);
      expect(t.host.table.remoteCount()).toBe(3);
      expect((await t.api("POST", "/invites")).body.code).toBe("remote-full");
      expect((await t.api("POST", "/invites", { watch: true })).body.code).toBe("remote-full");
      // the invite made earlier can't bring a fourth one in
      const late = await RemotePeer.connect(spare.token);
      const lateBoard = await late.socket({ role: "board", name: "Wilma" });
      expect((await lateBoard.next((m) => m.type === "error")).payload.message).toMatch(/no room for more remote players or watchers/);
      expect(t.host.table.state().watchers.map((w) => w.name)).toEqual(["Wanda"]);
      // letting the watcher play keeps the count: one place changes from watching to playing
      await t.ok("POST", `/watchers/${watcherNamed(t, "Wanda")!.id}/play`);
    }, 120_000);

    it("a remote exchange's invite reaches remote boards that may exchange, not watchers (D-166)", async () => {
      const t = await pairedHost();
      const ann = await t.joinDeck("Ann");
      await t.ok("POST", "/ai", {});
      const rita = await remoteBoard(t, "Rita", false);
      const wanda = await remoteBoard(t, "Wanda", true);
      await coinFlip(t, [() => ann.request("lobby", "ready", { ready: true }), async () => rita.deck!.send("lobby", "ready", { ready: true }, 6)]);
      const aiSeat = t.host.table.state().players.find((p) => p.kind === "ai")!.seat!;
      t.host.table.exchange(aiSeat, "remote", "https://games.skylar.technology/i/ABCDEFGH");
      await until(() => rita.board.lastState()?.exchange?.seat === aiSeat && wanda.board.lastState()?.exchange?.seat === aiSeat);
      expect(rita.board.lastState().exchange.url).toBe("https://games.skylar.technology/i/ABCDEFGH");
      expect(wanda.board.lastState().exchange.url).toBe("");
      expect((await rita.peer.request("GET", "/qr.svg?exchange=1")).status).toBe(200);
      expect((await wanda.peer.request("GET", "/qr.svg?exchange=1")).status).toBe(403);
      // board control switched off: Rita's board loses the link too
      await t.ok("POST", "/remote", { boardControl: false });
      await until(() => rita.board.lastState()?.exchange?.url === "");
      expect((await rita.peer.request("GET", "/qr.svg?exchange=1")).status).toBe(403);
    }, 120_000);
  });
});
