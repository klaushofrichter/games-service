// Table → cloud link: enrollment with a pairing code or a pre-approved access code (D-113), heartbeat with platform
// metrics, retention setting sync, and log upload. Outbound HTTPS only.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import WebSocket from "ws";
import { TableError, type Table } from "./table.ts";
import type { LogStore } from "./logs.ts";
import type { RemoteGateway } from "./remote.ts";
import type { BundleRef, ExtraGames } from "./extra-games.ts";
import type { AccessCodeStatus } from "../../../packages/protocol/src/index.ts";

/** The access code alphabet (D-026, D-113): no 0/O, no 1/I. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** "abcd-efgh" or "ABCD EFGH" as ABCDEFGH; null if it can't be an access code. */
export function normalizeAccessCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.toUpperCase().replace(/[\s-]/g, "");
  return s.length === 8 && [...s].every((c) => CODE_ALPHABET.includes(c)) ? s : null;
}

/** What the service says about a code it was shown. */
type ServiceCodeStatus = Exclude<AccessCodeStatus["status"], "waiting">;
const SERVICE_CODE_STATUSES: ServiceCodeStatus[] = ["accepted", "unknown", "expired", "revoked", "in-use"];

/** What the service sends with every approved hello and heartbeat. */
interface TableConfigMsg {
  logRetentionDays: number;
  /** Extra-game bundles this table gets (D-097); absent from services older than that. */
  gameBundles?: BundleRef[];
}

export interface CloudLinkOptions {
  cloudUrl: string;
  dataDir: string;
  /** TABLE_CODE or --code at start: wins over a code typed on the board, which then can't change it. */
  accessCode?: string;
  pollMs?: number;
  heartbeatMs?: number;
}

export class CloudLink {
  private timer: NodeJS.Timeout | null = null;
  /** table.json: the table's identity, its token once approved, and an access code typed on the board (D-113). */
  private identity: { tableId: string; tableToken: string | null; accessCode?: string | null } = { tableId: "", tableToken: null };
  /** What the service last said about the current code; null until it has answered. */
  private codeStatus: ServiceCodeStatus | null = null;
  private ticking = false;
  private tickAgain = false;
  private stopped = false;
  private o: CloudLinkOptions;
  private table: Table;
  private logs: LogStore;

  constructor(table: Table, logs: LogStore, o: CloudLinkOptions) {
    this.table = table;
    this.logs = logs;
    this.o = o;
  }

  private get file() {
    return join(this.o.dataDir, "table.json");
  }

  async start() {
    await mkdir(this.o.dataDir, { recursive: true });
    try {
      this.identity = JSON.parse(await readFile(this.file, "utf8"));
    } catch {
      this.identity = { tableId: `t_${randomBytes(12).toString("hex")}`, tableToken: null };
      await this.save();
    }
    if (this.o.accessCode !== undefined && !normalizeAccessCode(this.o.accessCode)) {
      console.warn("[table-host] TABLE_CODE / --code is not an access code (8 characters from A–Z and 2–9, e.g. ABCD-EFGH); ignoring it");
      this.o.accessCode = undefined;
    }
    this.table.tableId = this.identity.tableId;
    // Logs go to the service from a queue on disk (D-116): now, and after every heartbeat until the service has them.
    this.table.on("logSaved", () => void this.flushUploads());
    await this.tick();
  }

  // ----- the access code (D-113) -----

  /** The code in use: the one given at start wins over one typed on the board. */
  get accessCode(): { code: string; source: "start" | "board" } | null {
    const start = normalizeAccessCode(this.o.accessCode);
    if (start) return { code: start, source: "start" };
    const board = normalizeAccessCode(this.identity.accessCode);
    return board ? { code: board, source: "board" } : null;
  }

  private codeInfo(): AccessCodeStatus | null {
    const c = this.accessCode;
    return c ? { hint: c.code.slice(0, 2), source: c.source, status: this.codeStatus ?? "waiting" } : null;
  }

  /**
   * Set or clear the code typed on the board. It is kept in table.json and presented at once: a table waiting for
   * approval is approved by a valid code; an approved table is linked to it (its repositories then follow the code).
   */
  async setAccessCode(v: unknown): Promise<AccessCodeStatus | null> {
    if (this.accessCode?.source === "start") throw new TableError(409, "this table's access code was given when it started (TABLE_CODE or --code)");
    const empty = v === null || v === undefined || v === "";
    const code = empty ? null : normalizeAccessCode(v);
    if (!empty && !code) throw new TableError(400, "an access code is 8 characters from A–Z and 2–9, like ABCD-EFGH");
    this.identity.accessCode = code;
    this.codeStatus = null;
    await this.save();
    this.publish(this.table.cloud.status === "pending" ? { status: "pending", pairingCode: this.table.cloud.pairingCode } : { status: this.table.cloud.status as "online" | "offline" | "revoked" });
    void this.kick();
    return this.codeInfo();
  }

  /** Note the service's answer about `code`, unless the board has changed the code in the meantime. */
  private noteCode(v: unknown, code: string) {
    if (this.accessCode?.code !== code) return;
    const st = (v as { status?: unknown } | undefined)?.status;
    if (SERVICE_CODE_STATUSES.includes(st as ServiceCodeStatus)) this.codeStatus = st as ServiceCodeStatus;
  }

  /** The table's cloud status as the board sees it, with the code's. */
  private publish(c: { status: "pending" | "online" | "offline" | "revoked"; pairingCode?: string }) {
    this.table.setCloud({ ...c, code: this.codeInfo() });
  }

  /** Talk to the service now instead of at the next scheduled tick. */
  private async kick() {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    await this.tick();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.socketRetry) clearTimeout(this.socketRetry);
    this.socket?.close();
  }

  // ----- signaling socket for remote play (opened once the table is approved) -----

  gateway: RemoteGateway | null = null;
  /** Installs extra games (D-097); set by host.ts. */
  extras: ExtraGames | null = null;

  /** Download one extra-game bundle over the table's own authenticated link. */
  async downloadBundle(hash: string): Promise<Buffer> {
    const r = await fetch(`${this.o.cloudUrl}/api/tables/bundles/${hash}`, {
      headers: { authorization: `Bearer ${this.identity.tableToken}` },
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) throw new Error(`the service refused bundle ${hash.slice(0, 12)} (${r.status})`);
    return Buffer.from(await r.arrayBuffer());
  }
  private socket: WebSocket | null = null;
  private socketRetry: NodeJS.Timeout | null = null;

  private openSocket() {
    if (this.stopped || this.socket || !this.identity.tableToken || !this.gateway) return;
    const url = this.o.cloudUrl.replace(/^http/, "ws") + "/api/tables/ws";
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${this.identity.tableToken}` } });
    this.socket = ws;
    ws.on("message", async (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type !== "offer" || !this.gateway) return;
      try {
        const sdp = await this.gateway.answer(String(msg.session), String(msg.sdp), msg.iceServers ?? []);
        ws.send(JSON.stringify({ type: "answer", session: msg.session, sdp }));
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", session: msg.session, message: (err as Error).message }));
      }
    });
    // Keep proxies (ingress idle timeouts) from closing the socket between invites.
    const keepAlive = setInterval(() => ws.readyState === WebSocket.OPEN && ws.ping(), 30_000);
    keepAlive.unref();
    ws.on("error", () => {});
    ws.on("close", () => {
      clearInterval(keepAlive);
      if (this.socket === ws) this.socket = null;
      if (!this.stopped) {
        this.socketRetry = setTimeout(() => this.openSocket(), 3000);
        this.socketRetry.unref();
      }
    });
  }

  /** Ask the service for an invite to this table (8 characters, read out loud). */
  async createInvite(): Promise<{ token: string; url: string; expiresAt: string }> {
    const r = await this.req("POST", "/api/tables/invites", {});
    if (!r.ok) throw new Error(`the service refused the invite (${r.status})`);
    return (await r.json()) as { token: string; url: string; expiresAt: string };
  }

  private async save() {
    await writeFile(this.file, JSON.stringify(this.identity, null, 2), { mode: 0o600 });
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), ms);
    this.timer.unref();
  }

  private async req(method: string, path: string, body?: unknown) {
    return fetch(`${this.o.cloudUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(this.identity.tableToken ? { authorization: `Bearer ${this.identity.tableToken}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  }

  async tick() {
    // One conversation with the service at a time: a tick asked for while one runs follows it.
    if (this.ticking) return void (this.tickAgain = true);
    this.ticking = true;
    try {
      await this.tickOnce();
    } finally {
      this.ticking = false;
      if (this.tickAgain && !this.stopped) {
        this.tickAgain = false;
        if (this.timer) clearTimeout(this.timer);
        void this.tick();
      }
    }
  }

  private async tickOnce() {
    const code = this.accessCode?.code;
    try {
      if (!this.identity.tableToken) {
        const r = await this.req("POST", "/api/tables/hello", { tableId: this.identity.tableId, name: this.table.config.tableName, ...(code ? { accessCode: code } : {}) });
        const b = (await r.json()) as { status: string; pairingCode?: string; tableToken?: string; config?: TableConfigMsg; code?: unknown };
        if (code) this.noteCode(b.code, code);
        if (r.status === 429) {
          this.publish({ status: "pending", pairingCode: this.table.cloud.pairingCode });
          return this.schedule(60_000); // too many wrong codes from this address: wait the minute out
        }
        if (b.status === "pending") {
          this.publish({ status: "pending", pairingCode: b.pairingCode });
          return this.schedule(this.o.pollMs ?? 5000);
        }
        if (b.status === "revoked") {
          this.publish({ status: "revoked" });
          return this.schedule((this.o.pollMs ?? 5000) * 2); // an admin may reconnect it
        }
        if (b.tableToken) {
          this.identity.tableToken = b.tableToken;
          await this.save();
        }
        if (b.config) this.applyConfig(b.config);
      }
      // An approved table presents a code only until the service has accepted it (say, one typed on the board later).
      const present = code && this.codeStatus !== "accepted" ? { accessCode: code } : {};
      const r = await this.req("POST", "/api/tables/heartbeat", { metrics: this.table.metrics, phase: this.table.phase, ...present });
      if (r.status === 401) {
        // Revoked by an admin: forget the token and go back to pairing. Extra games go too: they were given to this
        // table while it was approved, and come back with the admin's ticks when it is approved again (D-097).
        this.identity.tableToken = null;
        void this.extras?.sync([]);
        await this.save();
        this.codeStatus = null; // ask again: the hello says what became of the code
        this.publish({ status: "revoked" });
        return this.schedule(this.o.pollMs ?? 5000);
      }
      const b = (await r.json()) as { config?: TableConfigMsg; code?: unknown };
      if (b.config) this.applyConfig(b.config);
      if (code && "accessCode" in present) this.noteCode(b.code, code);
      this.publish({ status: "online" });
      this.openSocket();
      void this.flushUploads();
    } catch {
      this.publish({ status: "offline" });
    }
    this.schedule(this.o.heartbeatMs ?? 15_000);
  }

  private applyConfig(c: TableConfigMsg) {
    // Old services send no gameBundles: leave whatever is installed alone.
    if (Array.isArray(c.gameBundles)) void this.extras?.sync(c.gameBundles);
    if (!Number.isInteger(c.logRetentionDays) || c.logRetentionDays === this.logs.retentionDays) return;
    const shorter = c.logRetentionDays < this.logs.retentionDays;
    this.logs.retentionDays = c.logRetentionDays;
    if (shorter) void this.logs.prune().catch(() => {}); // a shorter period applies now, not at the next restart
  }

  private flushing = false;
  private flushAgain = false;

  /**
   * Upload the queued logs, oldest first, one at a time. A log leaves the queue when the service has it, or when the
   * service can never take it (400, 409, 413); otherwise it stays for the next heartbeat (D-116).
   */
  async flushUploads() {
    if (this.flushing) return void (this.flushAgain = true);
    this.flushing = true;
    try {
      do {
        this.flushAgain = false;
        for (const id of await this.logs.pendingUploads()) {
          if (this.stopped || !this.identity.tableToken) return;
          const r = await this.upload(id);
          if (r === "retry") return;
        }
      } while (this.flushAgain);
    } finally {
      this.flushing = false;
    }
  }

  async upload(id: string): Promise<"done" | "retry"> {
    const data = await this.logs.read(id);
    if (!data) {
      await this.logs.uploaded(id); // gone (retention): nothing to send
      return "done";
    }
    const gameId = id.split("-").slice(1, -1).join("-").replace(/-sim$/, "");
    try {
      const r = await fetch(`${this.o.cloudUrl}/api/tables/logs/${id}?gameId=${encodeURIComponent(gameId)}&simulation=${id.includes("-sim-") ? 1 : 0}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${this.identity.tableToken}`, "content-type": "application/zip" },
        body: new Uint8Array(data),
        signal: AbortSignal.timeout(60_000),
      });
      await r.arrayBuffer().catch(() => {});
      if (r.ok) {
        await this.logs.uploaded(id);
        return "done";
      }
      if ([400, 409, 413].includes(r.status)) {
        console.warn(`[table-host] the service refused log ${id} (${r.status}); it stays on this table only`);
        await this.logs.uploaded(id);
        return "done";
      }
      return "retry"; // 401, 507 (storage full), 5xx: later
    } catch {
      return "retry"; // offline: the next heartbeat tries again
    }
  }
}
