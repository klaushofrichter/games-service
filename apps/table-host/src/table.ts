// The table: players, seats, orientation, game selection and the running game.
// The lobby owns the table; the running game owns everything inside it.
import { EventEmitter } from "node:events";
import { randomBytes, randomInt } from "node:crypto";
import {
  allowedPlayerCounts,
  rotateEdge,
  seatEdges,
  type Edge,
  type GameAvailability,
  type GameSummary,
  type LobbyState,
  type Phase,
  type PlayerInfo,
  type SeatLayout,
  type CloudStatus,
} from "../../../packages/protocol/src/index.ts";
import { createRng, type GameEvent, type Intent, type SeatInfo } from "../../../packages/sdk/src/index.ts";
import { settingsWithDefaults, type InstalledGame } from "./games.ts";
import { GameRuntime, realClock } from "./runtime.ts";
import type { LogStore } from "./logs.ts";

export class TableError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface TableConfig {
  tableName: string;
  publicUrl: string; // e.g. http://192.168.1.20:8080
  graceMs: number; // how long a disconnected seat is held
  aiDelayMs: number; // pause before an AI acts, so people can follow
  joinTokenTtlMs: number;
  requireCloud: boolean; // phase 1a dev mode may run without the cloud
  maxRemotePlayers: number;
}

interface Player extends PlayerInfo {
  sessionToken: string | null; // null for AI players
  graceTimer?: NodeJS.Timeout;
  aiSeed?: number;
}

// Join tokens avoid look-alike characters so they can be read out loud.
const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function shortToken(len = 8): string {
  let s = "";
  for (let i = 0; i < len; i++) s += TOKEN_ALPHABET[randomInt(TOKEN_ALPHABET.length)];
  return s;
}

function newId(prefix: string) {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

export class Table extends EventEmitter {
  private players = new Map<string, Player>();
  layout: SeatLayout = 4;
  frontEdge: Edge = "south";
  phase: Phase = "idle";
  private selected: { game: InstalledGame; settings: Record<string, unknown> } | null = null;
  runtime: GameRuntime | null = null;
  private summary: GameSummary | null = null;
  private stateRev = 0;
  private joinToken = "";
  private joinTokenExpires = 0;
  private gameStartedAt = 0;
  cloudOnline = true;
  cloud: CloudStatus = { status: "disabled" };
  readonly metrics = { gamesPlayed: 0, gamesTerminated: 0, totalGameMs: 0, simulations: 0 };
  lastLogId: string | null = null;

  readonly config: TableConfig;
  readonly games: Map<string, InstalledGame>;
  readonly logs: LogStore;

  constructor(config: TableConfig, games: Map<string, InstalledGame>, logs: LogStore) {
    super();
    this.config = config;
    this.games = games;
    this.logs = logs;
    this.rotateJoinToken();
    // Expired join codes are replaced proactively so the board's QR code always works.
    this.joinTimer = setInterval(() => {
      if (Date.now() > this.joinTokenExpires) {
        this.rotateJoinToken();
        this.changed();
      }
    }, 5000);
    this.joinTimer.unref();
  }

  private joinTimer: NodeJS.Timeout;

  // ---------- state ----------

  private changed() {
    this.stateRev++;
    this.emit("state", this.state());
  }

  state(): LobbyState {
    return {
      stateRev: this.stateRev,
      tableName: this.config.tableName,
      layout: this.layout,
      seatEdges: seatEdges(this.layout),
      frontEdge: this.frontEdge,
      players: [...this.players.values()].map(({ sessionToken, graceTimer, aiSeed, ...info }) => info),
      phase: this.phase,
      game: this.selected
        ? {
            id: this.selected.game.manifest.id,
            name: this.selected.game.manifest.name,
            version: this.selected.game.manifest.version,
            settings: this.selected.settings,
            lobbyButton: this.selected.game.manifest.lobbyButton,
            edges: this.selected.game.manifest.edges,
          }
        : null,
      summary: this.summary,
      joinUrl: this.currentJoin().url,
      cloud: this.cloud,
    };
  }

  player(id: string): PlayerInfo | undefined {
    return this.players.get(id);
  }

  setCloud(c: CloudStatus) {
    if (c.status === this.cloud.status && c.pairingCode === this.cloud.pairingCode) return;
    this.cloud = c;
    this.cloudOnline = c.status === "online";
    this.changed();
  }

  // ---------- joining ----------

  rotateJoinToken() {
    this.joinToken = shortToken();
    this.joinTokenExpires = Date.now() + this.config.joinTokenTtlMs;
  }

  currentJoin() {
    if (Date.now() > this.joinTokenExpires) this.rotateJoinToken();
    return { token: this.joinToken, url: `${this.config.publicUrl}/j/${this.joinToken}` };
  }

  join(joinToken: string, rawName: unknown, location: "local" | "remote" = "local") {
    if (!joinToken || joinToken.toUpperCase() !== this.currentJoin().token) throw new TableError(403, "join code is invalid or expired; scan the QR code again");
    if (location === "remote" && this.humans().filter((p) => p.location === "remote").length >= this.config.maxRemotePlayers)
      throw new TableError(409, "remote player limit reached");
    const name = this.cleanName(rawName);
    const id = newId("p");
    const sessionToken = randomBytes(24).toString("base64url");
    const p: Player = { id, name, kind: "human", location, seat: null, connected: true, ready: false, sessionToken };
    this.players.set(id, p);
    this.rotateJoinToken(); // one-time use
    this.seatNewcomer(p);
    this.changed();
    return { playerId: id, sessionToken };
  }

  private cleanName(raw: unknown): string {
    const n = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 24);
    if (n) return n;
    return `Player ${this.players.size + 1}`;
  }

  resume(sessionToken: string): PlayerInfo {
    const p = [...this.players.values()].find((x) => x.sessionToken && x.sessionToken === sessionToken);
    if (!p) throw new TableError(403, "session expired; scan the QR code to join again");
    if (p.graceTimer) clearTimeout(p.graceTimer);
    p.graceTimer = undefined;
    p.connected = true;
    this.changed();
    return p;
  }

  disconnected(playerId: string) {
    if (this.closed) return;
    const p = this.players.get(playerId);
    if (!p || p.kind !== "human" || !p.connected) return;
    p.connected = false;
    p.graceTimer = setTimeout(() => this.removePlayer(playerId, "left"), this.config.graceMs);
    this.changed();
  }

  // ---------- seats ----------

  private humans() {
    return [...this.players.values()].filter((p) => p.kind === "human");
  }

  private seated() {
    return [...this.players.values()].filter((p) => p.seat !== null).sort((a, b) => a.seat! - b.seat!);
  }

  private freeSeats(): number[] {
    const taken = new Set(this.seated().map((p) => p.seat));
    const edges = seatEdges(this.layout);
    // East/West seats are only offered if the running or selected game supports those edges.
    const m = this.selected?.game.manifest;
    return edges.map((_, i) => i).filter((i) => !taken.has(i) && (!m || m.edges.includes(edges[i])));
  }

  private seatNewcomer(p: Player) {
    if (this.phase === "active" && this.runtime) {
      if (!this.selected!.game.manifest.dynamicPlayers) return; // waits for the next game
      const seat = this.freeSeats()[0];
      if (seat === undefined) return;
      p.seat = seat;
      this.runtime.seatJoined(this.seatInfo(p));
      this.scheduleAi();
      return;
    }
    const seat = this.freeSeats()[0];
    p.seat = seat ?? null;
    if (this.phase === "ready" && this.selected) this.revalidateSelection();
  }

  private seatInfo(p: Player): SeatInfo {
    return { seat: p.seat!, playerId: p.id, name: p.name, kind: p.kind, edge: seatEdges(this.layout)[p.seat!] };
  }

  setLayout(n: number) {
    if (![2, 4, 6, 8].includes(n)) throw new TableError(400, "layout must be 2, 4, 6 or 8");
    this.assertNotPlaying("change the layout");
    const layout = n as SeatLayout;
    if (this.seated().length > layout) throw new TableError(409, `${this.seated().length} players are seated; remove some before choosing ${layout} seats`);
    this.layout = layout;
    // keep seats that still exist, move the others to free seats
    const overflow = this.seated().filter((p) => p.seat! >= layout);
    for (const p of overflow) p.seat = null;
    for (const p of overflow) p.seat = this.freeSeats()[0] ?? null;
    if (this.phase === "ready") this.revalidateSelection();
    this.changed();
  }

  rotate(degrees: number) {
    if (degrees !== 90 && degrees !== 180) throw new TableError(400, "degrees must be 90 or 180");
    const next = rotateEdge(this.frontEdge, degrees);
    const m = this.selected?.game.manifest;
    if (m && !m.edges.includes(next)) throw new TableError(409, `${m.name} cannot be shown facing ${next}`);
    this.frontEdge = next;
    this.changed();
  }

  moveSeat(playerId: string, seat: number) {
    this.assertNotPlaying("move players");
    const p = this.mustPlayer(playerId);
    const edges = seatEdges(this.layout);
    if (!Number.isInteger(seat) || seat < 0 || seat >= edges.length) throw new TableError(400, "no such seat");
    const m = this.selected?.game.manifest;
    if (m && !m.edges.includes(edges[seat])) throw new TableError(409, `${m.name} has no seats on the ${edges[seat]} edge`);
    const other = [...this.players.values()].find((x) => x.seat === seat && x.id !== playerId);
    if (other) other.seat = p.seat; // swap
    p.seat = seat;
    this.changed();
  }

  addAi(seat?: number) {
    this.assertNotPlaying("add AI players");
    const free = this.freeSeats();
    const target = seat ?? free[0];
    if (target === undefined || !free.includes(target)) throw new TableError(409, "no free seat");
    const n = [...this.players.values()].filter((p) => p.kind === "ai").length + 1;
    const p: Player = { id: newId("ai"), name: `AI ${n}`, kind: "ai", location: "local", seat: target, connected: true, ready: true, sessionToken: null, aiSeed: randomInt(2 ** 31) };
    this.players.set(p.id, p);
    if (this.phase === "ready") this.revalidateSelection();
    this.changed();
    return p.id;
  }

  /** Evict a human (revokes the session) or remove an AI. */
  removePlayer(playerId: string, reason: "evicted" | "left" = "evicted") {
    const p = this.mustPlayer(playerId);
    if (p.graceTimer) clearTimeout(p.graceTimer);
    this.players.delete(playerId);
    this.emit("removed", playerId, reason);
    if (this.phase === "active" && this.runtime && p.seat !== null) {
      this.runtime.seatLeft(p.seat); // may end the game -> onGameOver
    }
    if (this.phase === "ready") this.revalidateSelection();
    this.changed();
  }

  private mustPlayer(id: string): Player {
    const p = this.players.get(id);
    if (!p) throw new TableError(404, "no such player");
    return p;
  }

  setReady(playerId: string, ready: boolean) {
    const p = this.mustPlayer(playerId);
    if (this.phase !== "ready") throw new TableError(409, "no game is waiting to start");
    p.ready = !!ready;
    this.changed();
  }

  private assertNotPlaying(what: string) {
    if (this.phase === "active" || this.phase === "paused" || this.phase === "terminating")
      throw new TableError(409, `cannot ${what} while a game is running; open the lobby and end the game first`);
  }

  // ---------- games ----------

  availability(): GameAvailability[] {
    return [...this.games.values()].map(({ manifest: m }) => {
      const reasons = this.reasonsFor(m.id);
      return {
        id: m.id,
        name: m.name,
        version: m.version,
        description: m.description,
        selectable: reasons.length === 0,
        reasons,
        ai: m.ai.supported,
        simulation: m.simulation.supported && m.ai.supported,
        players: allowedPlayerCounts(m),
      };
    });
  }

  private reasonsFor(gameId: string): string[] {
    const g = this.games.get(gameId);
    if (!g) return ["not installed"];
    const m = g.manifest;
    const reasons: string[] = [];
    if (this.phase === "active" || this.phase === "paused" || this.phase === "terminating") reasons.push("a game is running");
    if (this.config.requireCloud && !this.cloudOnline) reasons.push("the table is offline");
    const seated = this.seated();
    const counts = allowedPlayerCounts(m);
    if (!counts.includes(seated.length)) reasons.push(`needs ${describeCounts(counts)} players (${seated.length} seated)`);
    if (!m.ai.supported && seated.some((p) => p.kind === "ai")) reasons.push("has no AI players; remove the AI seats");
    if (!seated.some((p) => p.kind === "human" && p.location === "local")) reasons.push("needs at least one player at the table");
    if (!m.seatLayouts.includes(this.layout)) reasons.push(`does not support ${this.layout} seats`);
    const edges = seatEdges(this.layout);
    if (seated.some((p) => !m.edges.includes(edges[p.seat!]))) reasons.push("has no seats on the east or west edge");
    if (!m.edges.includes(this.frontEdge)) reasons.push(`cannot be shown facing ${this.frontEdge}`);
    return reasons;
  }

  selectGame(gameId: string, settings: Record<string, unknown> = {}) {
    if (this.phase !== "idle" && this.phase !== "finished" && this.phase !== "ready")
      throw new TableError(409, "a game is running");
    const g = this.games.get(gameId);
    if (!g) throw new TableError(404, "no such game");
    const prevPhase = this.phase;
    this.phase = "idle"; // so a re-selection in 'ready' is judged on the seats alone
    const reasons = this.reasonsFor(gameId);
    if (reasons.length) {
      this.phase = prevPhase;
      throw new TableError(409, `${g.manifest.name} ${reasons.join("; ")}`);
    }
    let merged: Record<string, unknown>;
    try {
      merged = settingsWithDefaults(g.manifest, settings);
    } catch (e) {
      this.phase = prevPhase;
      throw new TableError(400, (e as Error).message);
    }
    this.phase = "loading";
    this.selected = { game: g, settings: merged };
    this.summary = null;
    for (const p of this.players.values()) p.ready = p.kind === "ai";
    this.phase = "ready";
    this.changed();
  }

  /** In 'ready', seat changes may break the selected game's constraints; then go back to idle. */
  private revalidateSelection() {
    if (!this.selected) return;
    const id = this.selected.game.manifest.id;
    this.phase = "idle";
    const ok = this.reasonsFor(id).length === 0;
    this.phase = ok ? "ready" : "idle";
    if (!ok) this.selected = null;
  }

  start() {
    if (this.phase !== "ready" || !this.selected) throw new TableError(409, "select a game first");
    this.phase = "idle"; // judge the seats as they are now, as selection did
    const reasons = this.reasonsFor(this.selected.game.manifest.id);
    this.phase = "ready";
    if (reasons.length) throw new TableError(409, `${this.selected.game.manifest.name} ${reasons.join("; ")}`);
    const notReady = this.seated().filter((p) => p.kind === "human" && (!p.ready || !p.connected));
    if (notReady.length) throw new TableError(409, `waiting for ${notReady.map((p) => p.name).join(", ")}`);
    const { game, settings } = this.selected;
    const seats = this.seated().map((p) => this.seatInfo(p));
    const aiOptions: Record<number, Record<string, unknown>> = {};
    for (const p of this.seated()) if (p.kind === "ai") aiOptions[p.seat!] = aiDefaults(game.manifest);
    const rt = new GameRuntime(game.manifest, game.def, randomInt(2 ** 31), settings, seats, realClock, { aiOptions });
    this.runtime = rt;
    this.gameStartedAt = Date.now();
    this.phase = "active";
    rt.onChange((kind, events) => {
      if (kind === "over") void this.onGameOver();
      else {
        this.emit("game", events);
        this.scheduleAi(); // timers and leaving players move games on too, not only intents
      }
    });
    this.changed();
    this.emit("game", []);
    this.scheduleAi();
    if (rt.over) void this.onGameOver();
  }

  end() {
    if (!this.runtime || (this.phase !== "active" && this.phase !== "paused")) throw new TableError(409, "no game is running");
    this.phase = "terminating";
    this.changed();
    this.runtime.finish("terminated", { text: "The game was ended from the lobby.", highlights: {} });
  }

  close() {
    this.assertNotPlaying("return to the lobby");
    this.selected = null;
    this.summary = null;
    this.phase = "idle";
    for (const p of this.players.values()) p.ready = p.kind === "ai";
    this.changed();
  }

  private async onGameOver() {
    const rt = this.runtime!;
    const terminated = rt.log.at(-1)?.t === "end" && (rt.log.at(-1) as { reason: string }).reason === "terminated";
    this.phase = "finished";
    this.summary = rt.summary;
    const ms = Date.now() - this.gameStartedAt;
    if (terminated) this.metrics.gamesTerminated++;
    else this.metrics.gamesPlayed++;
    this.metrics.totalGameMs += ms;
    this.emit("game", []);
    this.changed();
    const id = logId(rt.manifest.id);
    if (this.closed) return;
    const saving = this.logs.save(
      { id, tableName: this.config.tableName, gameId: rt.manifest.id, gameVersion: rt.manifest.version, simulation: false, startedAt: new Date(this.gameStartedAt).toISOString(), endedAt: new Date().toISOString(), games: 1, format: "gametable-log/1" },
      [rt.log],
    );
    this.pendingSaves.add(saving);
    try {
      await saving;
    } catch (err) {
      console.error(`[table] could not save game log: ${(err as Error).message}`);
      return;
    } finally {
      this.pendingSaves.delete(saving);
    }
    this.lastLogId = id;
    this.emit("logSaved", id);
  }

  intent(playerId: string, intent: Intent) {
    const p = this.mustPlayer(playerId);
    if (this.phase !== "active" || !this.runtime) throw new TableError(409, "no game is running");
    if (p.seat === null || !this.runtime.seats.some((s) => s.seat === p.seat)) throw new TableError(409, "you are not playing in this game");
    if (!intent || typeof intent.name !== "string") throw new TableError(400, "intent needs a name");
    const r = this.runtime.submit(p.seat, { name: intent.name, payload: intent.payload }, p.kind === "ai" ? "ai" : "human");
    return r;
  }

  private aiTimers = new Map<string, NodeJS.Timeout>(); // one pending move per AI player
  private aiRngs = new Map<string, () => number>();

  /**
   * Give every AI player a chance to act after any change to the game (an intent, a timer, a player
   * joining or leaving). Each AI has at most one pending move, replaced on every change, so it always
   * decides from the latest view. A rejected AI move is retried once after a pause.
   */
  private scheduleAi(retryMs?: number) {
    if (this.phase !== "active" || !this.runtime) return;
    for (const p of this.players.values()) {
      if (p.kind !== "ai" || p.seat === null) continue;
      const old = this.aiTimers.get(p.id);
      if (old) clearTimeout(old);
      const t = setTimeout(() => {
        this.aiTimers.delete(p.id);
        if (this.phase !== "active" || !this.runtime || !this.players.has(p.id) || this.runtime.over) return;
        let rng = this.aiRngs.get(p.id);
        if (!rng) this.aiRngs.set(p.id, (rng = createRng(p.aiSeed ?? 1)));
        const intent = this.runtime.aiIntent(p.seat!, rng);
        if (!intent) return;
        try {
          const r = this.intent(p.id, intent);
          if (!r.ok && retryMs === undefined) this.scheduleAi(this.config.aiDelayMs * 4 + 200);
        } catch {
          // the game moved on (ended, seat gone): nothing to do
        }
      }, retryMs ?? this.config.aiDelayMs);
      this.aiTimers.set(p.id, t);
    }
  }

  views(): { playerId: string; seat: number; view: unknown }[] {
    if (!this.runtime) return [];
    const out = [];
    for (const p of this.players.values()) {
      if (p.kind === "human" && p.seat !== null && this.runtime.seats.some((s) => s.seat === p.seat)) {
        out.push({ playerId: p.id, seat: p.seat, view: this.runtime.view(p.seat) });
      }
    }
    return out;
  }

  private closed = false;
  private pendingSaves = new Set<Promise<unknown>>();

  /** Wait for game logs that are still being written. */
  async flush() {
    await Promise.allSettled([...this.pendingSaves]);
  }

  shutdown() {
    this.closed = true;
    clearInterval(this.joinTimer);
    for (const t of this.aiTimers.values()) clearTimeout(t);
    for (const p of this.players.values()) if (p.graceTimer) clearTimeout(p.graceTimer);
    this.runtime?.clearAllTimers();
  }
}

/** AI options with manifest defaults. The AI configuration screen (later phase) will override these per seat. */
export function aiDefaults(m: InstalledGame["manifest"], given: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const o of m.ai.options) {
    const v = given[o.key];
    out[o.key] = v !== undefined && (!o.values || o.values.includes(String(v))) ? v : o.default;
  }
  return out;
}

function describeCounts(c: number[]): string {
  if (c.length === 1) return `exactly ${c[0]}`;
  const contiguous = c.every((n, i) => i === 0 || n === c[i - 1] + 1);
  return contiguous ? `${c[0]}–${c.at(-1)}` : c.join(", ");
}

export function logId(gameId: string) {
  const d = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `${d}-${gameId}-${randomBytes(2).toString("hex")}`;
}

export type { GameEvent };
