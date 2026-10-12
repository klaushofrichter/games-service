// Table → cloud link: enrollment with a pairing code, heartbeat with platform metrics,
// retention setting sync, and log upload. Outbound HTTPS only.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Table } from "./table.ts";
import type { LogStore } from "./logs.ts";

export interface CloudLinkOptions {
  cloudUrl: string;
  dataDir: string;
  pollMs?: number;
  heartbeatMs?: number;
}

export class CloudLink {
  private timer: NodeJS.Timeout | null = null;
  private identity: { tableId: string; tableToken: string | null } = { tableId: "", tableToken: null };
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
    this.table.on("logSaved", (id: string) => void this.upload(id));
    await this.tick();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
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
    try {
      if (!this.identity.tableToken) {
        const r = await this.req("POST", "/api/tables/hello", { tableId: this.identity.tableId, name: this.table.config.tableName });
        const b = (await r.json()) as { status: string; pairingCode?: string; tableToken?: string; config?: { logRetentionDays: number } };
        if (b.status === "pending") {
          this.table.setCloud({ status: "pending", pairingCode: b.pairingCode });
          return this.schedule(this.o.pollMs ?? 5000);
        }
        if (b.status === "revoked") {
          this.table.setCloud({ status: "revoked" });
          return this.schedule((this.o.pollMs ?? 5000) * 6);
        }
        if (b.tableToken) {
          this.identity.tableToken = b.tableToken;
          await this.save();
        }
        if (b.config) this.applyConfig(b.config);
      }
      const r = await this.req("POST", "/api/tables/heartbeat", { metrics: this.table.metrics, phase: this.table.phase });
      if (r.status === 401) {
        // Revoked by an admin: forget the token and go back to pairing.
        this.identity.tableToken = null;
        await this.save();
        this.table.setCloud({ status: "revoked" });
        return this.schedule(this.o.pollMs ?? 5000);
      }
      const b = (await r.json()) as { config?: { logRetentionDays: number } };
      if (b.config) this.applyConfig(b.config);
      this.table.setCloud({ status: "online" });
    } catch {
      this.table.setCloud({ status: "offline" });
    }
    this.schedule(this.o.heartbeatMs ?? 15_000);
  }

  private applyConfig(c: { logRetentionDays: number }) {
    if (Number.isInteger(c.logRetentionDays)) this.logs.retentionDays = c.logRetentionDays;
  }

  async upload(id: string) {
    if (!this.identity.tableToken) return;
    const data = await this.logs.read(id);
    if (!data) return;
    const gameId = id.split("-").slice(1, -1).join("-").replace(/-sim$/, "");
    try {
      await fetch(`${this.o.cloudUrl}/api/tables/logs/${id}?gameId=${encodeURIComponent(gameId)}&simulation=${id.includes("-sim-") ? 1 : 0}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${this.identity.tableToken}`, "content-type": "application/zip" },
        body: new Uint8Array(data),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      // Upload is retried by a later phase's sync job; the local copy stays for the retention period.
    }
  }
}
