// Test helpers: a real Table Host on a random port, a board control API client, and fake decks.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { startHost, type HostOptions } from "../apps/table-host/src/host.ts";
import type { Envelope, LobbyState } from "../packages/protocol/src/index.ts";

export async function testHost(o: HostOptions = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "gametable-"));
  const host = await startHost({ port: 0, host: "127.0.0.1", tableKey: "test-key", dataDir, graceMs: 300, aiDelayMs: 5, ...o });
  const base = `http://127.0.0.1:${host.port}`;
  const decks: Deck[] = [];

  async function api<T = any>(method: string, path: string, body?: unknown, key = "test-key"): Promise<{ status: number; body: T }> {
    const res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { "x-table-key": key, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const type = res.headers.get("content-type") ?? "";
    return { status: res.status, body: (type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer())) as T };
  }

  async function ok<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await api<T>(method, path, body);
    if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }

  /** Join a new deck with the current QR join token. */
  async function joinDeck(name: string): Promise<Deck> {
    const { token } = await ok<{ token: string }>("GET", "/join");
    const d = await Deck.connect(base, { joinToken: token, name });
    decks.push(d);
    return d;
  }

  async function close() {
    for (const d of decks) d.close();
    await host.close();
    await rm(dataDir, { recursive: true, force: true });
  }

  return { host, base, api, ok, joinDeck, close, decks };
}

export class Deck {
  messages: Envelope<any>[] = [];
  playerId = "";
  sessionToken = "";
  closeCode: number | null = null;
  /** The answer to hello: "welcome", or "elsewhere" for a second board window (D-132). */
  answer = "";
  private waiters: { pred: (m: Envelope<any>) => boolean; resolve: (m: Envelope<any>) => void }[] = [];
  private seq = 0;
  ws!: WebSocket;

  static async connect(base: string, hello: { joinToken?: string; name?: string; sessionToken?: string }): Promise<Deck> {
    const d = new Deck();
    await d.open(base, hello);
    return d;
  }

  async open(base: string, hello: Record<string, unknown>) {
    this.ws = new WebSocket(base.replace("http", "ws") + "/ws");
    this.closeCode = null;
    this.ws.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      this.messages.push(m);
      for (const w of [...this.waiters]) {
        if (w.pred(m)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(m);
        }
      }
    });
    this.ws.on("close", (code) => (this.closeCode = code));
    await new Promise<void>((res, rej) => {
      this.ws.once("open", () => res());
      this.ws.once("error", rej);
    });
    const welcome = this.next((m) => m.ch === "system" && (m.type === "welcome" || m.type === "error" || m.type === "elsewhere"));
    this.send("system", "hello", hello);
    const w = await welcome;
    this.answer = w.type;
    if (w.type === "error") throw new Error(w.payload.message);
    this.playerId = w.payload.playerId;
    if (w.payload.sessionToken) this.sessionToken = w.payload.sessionToken;
  }

  send(ch: string, type: string, payload?: unknown) {
    const seq = ++this.seq;
    this.ws.send(JSON.stringify({ v: 1, ch, type, seq, payload }));
    return seq;
  }

  /** Resolve with the first message (already received or future) matching pred. */
  next(pred: (m: Envelope<any>) => boolean, timeoutMs = 3000): Promise<Envelope<any>> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timed out waiting for message")), timeoutMs);
      this.waiters.push({ pred, resolve: (m) => (clearTimeout(t), resolve(m)) });
    });
  }

  /** Send and wait for the matching ack / reject / error. */
  async request(ch: string, type: string, payload?: unknown) {
    const seq = this.seq + 1;
    const p = this.next((m) => m.ch === "system" && m.seq === seq);
    this.send(ch, type, payload);
    return p;
  }

  lastState(): LobbyState | undefined {
    return [...this.messages].reverse().find((m) => m.ch === "lobby" && m.type === "state")?.payload;
  }

  waitState(pred: (s: LobbyState) => boolean) {
    const now = this.lastState();
    if (now && pred(now)) return Promise.resolve(now);
    return this.next((m) => m.ch === "lobby" && m.type === "state" && pred(m.payload)).then((m) => m.payload as LobbyState);
  }

  waitView(pred: (v: any) => boolean) {
    const last = [...this.messages].reverse().find((m) => m.ch === "game" && m.type === "view");
    if (last && pred(last.payload)) return Promise.resolve(last.payload);
    return this.next((m) => m.ch === "game" && m.type === "view" && pred(m.payload)).then((m) => m.payload);
  }

  close() {
    this.ws?.close();
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until fn returns something truthy and return it; throw if that takes longer than ms. */
export async function until<T>(fn: () => T | Promise<T>, ms = 5000): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() > end) throw new Error("condition not met in time");
    await sleep(25);
  }
}

/** Pair a table started with `cloudUrl` through the cloud admin API and wait until it is online. Returns the pair answer. */
export async function pairTable(t: Awaited<ReturnType<typeof testHost>>, cloudUrl: string, adminToken: string) {
  const code = await until(() => t.host.table.cloud.pairingCode);
  const r = await fetch(`${cloudUrl}/admin/api/tables/pair/${code}`, { method: "POST", headers: { authorization: `Bearer ${adminToken}` } });
  if (r.status !== 200) throw new Error(`pairing ${code} -> ${r.status}`);
  await until(() => t.host.table.cloud.status === "online");
  return (await r.json()) as { tableId: string };
}
