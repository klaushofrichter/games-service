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
  type Manifest,
  type Phase,
  type PlayerInfo,
  type SeatLayout,
  type CloudStatus,
} from "../../../packages/protocol/src/index.ts";
import { createRng, type GameEvent, type Intent, type SeatInfo } from "../../../packages/sdk/src/index.ts";
import { settingsWithDefaults, sourceMeta, type InstalledGame } from "./games.ts";
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
  showTestGames: boolean; // stub games used by the automated tests
}

interface Player extends PlayerInfo {
  sessionToken: string | null; // null for AI players
  remoteSession?: string; // the cloud session a remote player came through: one player per invite
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
  /** Sound effects on the boards (D-092); on until someone turns them off in the board's settings. */
  private sound = true;
  /** Display choices per game id (D-088), set from the board's settings; in memory, so they last until a restart. */
  private prefs = new Map<string, Record<string, unknown>>();
  runtime: GameRuntime | null = null;
  private summary: GameSummary | null = null;
  private stateRev = 0;
  private joinToken = "";
  private joinTokenExpires = 0;
  private gameStartedAt = 0;
  cloud: CloudStatus = { status: "disabled" };
  readonly metrics = { gamesPlayed: 0, gamesTerminated: 0, totalGameMs: 0, simulations: 0 };

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
      players: [...this.players.values()].map(({ sessionToken, graceTimer, aiSeed, remoteSession, ...info }) => info),
      phase: this.phase,
      game: this.selected
        ? {
            id: this.selected.game.manifest.id,
            name: this.selected.game.manifest.name,
            version: this.selected.game.manifest.version,
            settings: this.selected.settings,
            lobbyButton: this.selected.game.manifest.lobbyButton,
            edges: this.selected.game.manifest.edges,
            players: allowedPlayerCounts(this.selected.game.manifest),
            needs: this.needsFor(this.selected.game.manifest),
            prefs: this.prefs.get(this.selected.game.manifest.id) ?? {},
          }
        : null,
      layouts: this.allowedLayouts(),
      summary: this.summary,
      joinUrl: this.currentJoin().url,
      cloud: this.cloud,
      pause: this.pause,
      display: { sound: this.sound },
      remote: { boardControl: this.remoteBoardControl, maxPlayers: this.config.maxRemotePlayers, players: this.humans().filter((p) => p.location === "remote").length },
    };
  }

  player(id: string): PlayerInfo | undefined {
    return this.players.get(id);
  }

  /** Online, or running without the cloud at all. */
  get cloudOnline() {
    return this.cloud.status === "online" || this.cloud.status === "disabled";
  }

  setCloud(c: CloudStatus) {
    if (c.status === this.cloud.status && c.pairingCode === this.cloud.pairingCode) return;
    const wasOnline = this.cloud.status === "online";
    this.cloud = c;
    // D-015: losing the service pauses a running game; it resumes by itself when the link returns.
    if (wasOnline && !this.cloudOnline && this.phase === "active") this.pauseGame("cloud");
    else if (this.cloudOnline && this.phase === "paused" && this.pause?.reason === "cloud") this.resumeGame();
    this.changed();
  }

  pause: LobbyState["pause"] = null;

  pauseGame(reason: "cloud") {
    if (this.phase !== "active" || !this.runtime) return;
    this.runtime.pause();
    for (const t of this.aiTimers.values()) clearTimeout(t);
    this.aiTimers.clear();
    this.phase = "paused";
    this.pause = { reason, since: Date.now(), canSave: !!this.selected?.game.manifest.saveGame };
    this.emit("game", [{ name: "paused", data: { reason } }]);
  }

  /** Resume a paused game (automatic when the cloud returns, or from the board once it is back). */
  resumeGame() {
    if (this.phase !== "paused" || !this.runtime) throw new TableError(409, "the game is not paused");
    if (!this.cloudOnline) throw new TableError(409, "still offline; the game resumes by itself when the connection returns");
    this.runtime.resume();
    this.phase = "active";
    this.pause = null;
    this.emit("game", [{ name: "resumed" }]);
    this.scheduleAi();
    this.changed();
  }

  /** Save the paused or running game to the table and end it. Resuming a save comes in a later phase. */
  async saveAndExit(): Promise<string> {
    if (!this.runtime || (this.phase !== "active" && this.phase !== "paused")) throw new TableError(409, "no game is running");
    const m = this.selected!.game.manifest;
    if (!m.saveGame) throw new TableError(409, `${m.name} cannot be saved`);
    const id = logId(`${m.id}-save`);
    const save = {
      id,
      format: "gametable-save/1",
      gameId: m.id,
      gameVersion: m.version,
      savedAt: new Date().toISOString(),
      players: this.seated().map((p) => ({ seat: p.seat, name: p.name, kind: p.kind })),
      // The log replays to the saved state exactly (D-032), so it is the whole save.
      log: [...this.runtime.log],
    };
    await this.logs.saveGame(id, save);
    this.phase = "terminating";
    this.runtime.finish("terminated", { text: `The game was saved (${id}) and can be resumed later.`, highlights: { saveId: id } });
    return id;
  }

  // ---------- joining ----------

  /**
   * One code for everyone at the table (D-066). It lives in memory only, so every start of the Table Host
   * makes a new one; otherwise it changes only when someone taps "New code" on the board.
   * (`joinTokenTtlMs` > 0 adds an expiry; off by default.)
   */
  rotateJoinToken() {
    let next = shortToken();
    while (next === this.joinToken) next = shortToken();
    this.joinToken = next;
    this.joinTokenExpires = this.config.joinTokenTtlMs > 0 ? Date.now() + this.config.joinTokenTtlMs : Infinity;
  }

  /** "New code" on the board: the old QR code stops working at once; players already in stay in. */
  newJoinCode() {
    this.rotateJoinToken();
    this.changed();
    return this.currentJoin();
  }

  currentJoin() {
    if (Date.now() > this.joinTokenExpires) this.rotateJoinToken();
    return { token: this.joinToken, url: `${this.config.publicUrl}/j/${this.joinToken}` };
  }

  /** Remote boards may act unless switched off at the table or by the running game's manifest (D-006). */
  remoteBoardControl = true;

  setRemoteBoardControl(on: boolean) {
    this.remoteBoardControl = !!on;
    this.changed();
  }

  remoteControlAllowed(): boolean {
    if (!this.remoteBoardControl) return false;
    const m = this.selected?.game.manifest;
    return !(m && (this.phase === "active" || this.phase === "paused") && !m.remoteBoardControl);
  }

  /**
   * A remote player arriving through an invite (already checked by the cloud): no join code needed.
   * One invite seats one player: a second hello from the same session gets that same player back.
   */
  joinRemote(rawName: unknown, remoteSession: string) {
    const existing = [...this.players.values()].find((p) => p.remoteSession === remoteSession);
    if (existing?.sessionToken) {
      this.resume(existing.sessionToken);
      return { playerId: existing.id, sessionToken: existing.sessionToken };
    }
    return this.join("", rawName, "remote", remoteSession);
  }

  join(joinToken: string, rawName: unknown, location: "local" | "remote" = "local", remoteSession?: string) {
    if (location === "local" && (!joinToken || joinToken.toUpperCase() !== this.currentJoin().token))
      throw new TableError(403, "join code is invalid or expired; scan the QR code again");
    if (location === "remote" && this.humans().filter((p) => p.location === "remote").length >= this.config.maxRemotePlayers)
      throw new TableError(409, "the table has no room for more remote players");
    const name = this.cleanName(rawName);
    const id = newId("p");
    const sessionToken = randomBytes(24).toString("base64url");
    const p: Player = { id, name, kind: "human", location, seat: null, connected: true, ready: false, sessionToken, remoteSession };
    this.players.set(id, p);
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
    if ((this.phase === "active" || this.phase === "paused") && this.runtime) {
      if (!this.selected!.game.manifest.dynamicPlayers) return; // waits for the next game
      const seat = this.freeSeats()[0];
      if (seat === undefined) return;
      p.seat = seat;
      this.runtime.seatJoined(this.seatInfo(p));
      this.scheduleAi();
      return;
    }
    // A chosen game that is full takes no more players: newcomers wait without a seat instead of cancelling it.
    const m = this.phase === "ready" ? this.selected?.game.manifest : undefined;
    const full = m !== undefined && this.seated().length >= Math.max(...allowedPlayerCounts(m));
    p.seat = full ? null : (this.freeSeats()[0] ?? null);
    if (this.phase === "ready" && this.selected) this.revalidateSelection();
  }

  private seatInfo(p: Player): SeatInfo {
    return { seat: p.seat!, playerId: p.id, name: p.name, kind: p.kind, edge: seatEdges(this.layout)[p.seat!] };
  }

  setLayout(n: number) {
    if (![2, 4, 6, 8].includes(n)) throw new TableError(400, "layout must be 2, 4, 6 or 8");
    this.assertNotPlaying("change the layout");
    const layout = n as SeatLayout;
    const m = this.phase === "ready" ? this.selected?.game.manifest : undefined;
    if (m && !m.seatLayouts.includes(layout)) throw new TableError(409, `${m.name} does not support ${layout} seats`);
    if (this.seated().length > layout) throw new TableError(409, `${this.seated().length} players are seated; remove some before choosing ${layout} seats`);
    this.applyLayout(layout);
    if (this.phase === "ready") this.revalidateSelection();
    this.changed();
  }

  /** Switches the seat layout, keeping seats that still exist and moving the others (and anyone on an edge the
   *  selected game cannot use) to free seats. */
  private applyLayout(layout: SeatLayout) {
    this.layout = layout;
    const m = this.selected?.game.manifest;
    const edges = seatEdges(layout);
    const misplaced = this.seated().filter((p) => p.seat! >= layout || (m && !m.edges.includes(edges[p.seat!])));
    for (const p of misplaced) p.seat = null;
    for (const p of misplaced) p.seat = this.freeSeats()[0] ?? null;
  }

  /** Seat layouts that may be chosen now. */
  private allowedLayouts(): SeatLayout[] {
    if (this.selected && this.phase !== "finished") return [...this.selected.game.manifest.seatLayouts].sort((a, b) => a - b);
    const all = new Set<SeatLayout>();
    for (const { manifest } of this.visibleGames()) for (const l of manifest.seatLayouts) all.add(l);
    return [...all].sort((a, b) => a - b);
  }

  private visibleGames() {
    return [...this.games.values()].filter(({ manifest: m }) => this.config.showTestGames || !m.test);
  }

  rotate(degrees: number) {
    if (degrees !== 90 && degrees !== 180) throw new TableError(400, "degrees must be 90 or 180");
    this.face(rotateEdge(this.frontEdge, degrees));
  }

  /** Turns the lobby (and dialogs) to face one edge of the table. Games draw the same whichever way it faces, so
   *  this never blocks a game (D-079). */
  face(edge: string) {
    if (!["north", "east", "south", "west"].includes(edge)) throw new TableError(400, "edge must be north, east, south or west");
    if (this.frontEdge === edge) return;
    this.frontEdge = edge as Edge;
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
    const m = this.phase === "ready" ? this.selected?.game.manifest : undefined;
    if (m && !m.ai.supported) throw new TableError(409, `${m.name} has no AI players`);
    if (m && this.seated().length >= Math.max(...allowedPlayerCounts(m))) throw new TableError(409, `${m.name} takes at most ${Math.max(...allowedPlayerCounts(m))} players`);
    const free = this.freeSeats();
    const target = seat ?? free[0];
    if (target === undefined || !free.includes(target)) throw new TableError(409, "no free seat");
    const p: Player = { id: newId("ai"), name: this.aiName(), kind: "ai", location: "local", seat: target, connected: true, ready: true, sessionToken: null, aiSeed: randomInt(2 ** 31) };
    this.players.set(p.id, p);
    if (this.phase === "ready") this.revalidateSelection();
    this.changed();
    return p.id;
  }

  /** A random short name, marked as AI, that nobody at the table has yet ("Mia (AI)"). Remove and re-add to get another. */
  private aiName() {
    const taken = new Set([...this.players.values()].map((p) => p.name));
    const free = AI_NAMES.map((n) => `${n} (AI)`).filter((n) => !taken.has(n));
    if (free.length) return free[randomInt(free.length)];
    let n = 1;
    while (taken.has(`AI ${n}`)) n++;
    return `AI ${n}`;
  }

  /** Set an AI player's options (play style, level). Checked against the selected game when there is one. */
  setAiOptions(playerId: string, options: Record<string, unknown>) {
    const p = this.mustPlayer(playerId);
    if (p.kind !== "ai") throw new TableError(400, "only AI players have options");
    this.assertNotPlaying("change AI options");
    if (!options || typeof options !== "object") throw new TableError(400, "options must be an object");
    const m = this.selected?.game.manifest;
    if (m) {
      for (const [k, v] of Object.entries(options)) {
        const o = m.ai.options.find((x) => x.key === k);
        if (!o) throw new TableError(400, `${m.name} has no AI option ${k}`);
        if (o.values && !o.values.includes(String(v))) throw new TableError(400, `${k} must be one of ${o.values.join(", ")}`);
      }
    }
    p.aiOptions = { ...(p.aiOptions ?? {}), ...options };
    this.changed();
  }

  /** Evict a human (revokes the session) or remove an AI. */
  removePlayer(playerId: string, reason: "evicted" | "left" = "evicted") {
    const p = this.mustPlayer(playerId);
    if (p.graceTimer) clearTimeout(p.graceTimer);
    this.players.delete(playerId);
    this.emit("removed", playerId, reason);
    if ((this.phase === "active" || this.phase === "paused") && this.runtime && p.seat !== null) {
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

  /** The game the current or last runtime was made from (the selection may change after it ends). */
  private runningGame: InstalledGame | null = null;
  /** Ids of games that came from extra-game repositories (D-097), as opposed to built-in ones. */
  private extraIds = new Set<string>();
  /** A new set of extra games that arrived while a game was running; applied when it ends. */
  private pendingExtra: Map<string, InstalledGame> | null = null;

  /** Ids of the extra games installed now, and of those waiting for the running game to end. */
  extraGames() {
    return { installed: [...this.extraIds].sort(), pending: this.pendingExtra ? [...this.pendingExtra.keys()].sort() : null };
  }

  /**
   * Replace the set of extra games (D-097). Never during a game: the change waits until the running game ends.
   * A built-in game always wins over an extra game with the same id. A chosen game that goes away is unchosen; one
   * that is updated stays chosen with the new code, if its settings still fit. Returns true if applied now.
   */
  setExtraGames(extra: Map<string, InstalledGame>): boolean {
    if (this.phase === "active" || this.phase === "paused" || this.phase === "terminating") {
      this.pendingExtra = extra;
      return false;
    }
    this.pendingExtra = null;
    let changed = false;
    for (const id of this.extraIds) {
      if (extra.has(id)) continue;
      this.games.delete(id);
      changed = true;
      if (this.selected?.game.manifest.id === id) this.unselect();
    }
    const next = new Set<string>();
    for (const [id, g] of extra) {
      const builtIn = this.games.has(id) && !this.extraIds.has(id);
      if (builtIn) {
        console.error(`[games] extra game "${id}" from ${g.source?.repo ?? "?"} has the id of a built-in game; skipped`);
        continue;
      }
      next.add(id);
      if (this.games.get(id) === g) continue;
      this.games.set(id, g);
      changed = true;
      if (this.selected?.game.manifest.id === id) {
        try {
          this.selected = { game: g, settings: settingsWithDefaults(g.manifest, this.selected.settings) };
          if (this.phase === "ready") this.revalidateSelection();
        } catch {
          this.unselect();
        }
      }
    }
    this.extraIds = next;
    if (changed) this.changed();
    return true;
  }

  private applyPendingExtra() {
    if (this.pendingExtra && this.setExtraGames(this.pendingExtra)) this.emit("extraGamesApplied");
  }

  /** Drop the chosen game and its result: back to the plain lobby. */
  private unselect() {
    this.selected = null;
    this.summary = null;
    if (this.phase === "ready" || this.phase === "finished") this.phase = "idle";
    for (const p of this.players.values()) p.ready = p.kind === "ai";
  }

  availability(): GameAvailability[] {
    return this.visibleGames().map(({ manifest: m, source }) => {
      const reasons = this.blockersFor(m);
      return {
        id: m.id,
        name: m.name,
        version: m.version,
        description: m.description,
        selectable: reasons.length === 0,
        reasons,
        needs: this.needsFor(m),
        seatLayouts: m.seatLayouts,
        ai: m.ai.supported,
        simulation: m.simulation.supported && m.ai.supported,
        players: allowedPlayerCounts(m),
        settings: m.settings,
        aiOptions: m.ai.options,
        ...(source ? { extra: true } : {}),
      };
    });
  }

  /**
   * Why a game cannot be CHOSEN now (D-078: game first). Seats and player counts the table can still reach are not
   * blockers: choosing the game switches to a seat layout it supports, and the missing players are listed by
   * needsFor() until the game can start.
   */
  private blockersFor(m: Manifest): string[] {
    const reasons: string[] = [];
    if (this.phase === "active" || this.phase === "paused" || this.phase === "terminating") reasons.push("a game is running");
    if (this.config.requireCloud && !this.cloudOnline) reasons.push("the table is offline");
    const seated = this.seated();
    const max = Math.max(...allowedPlayerCounts(m));
    if (seated.length > max) reasons.push(`takes at most ${max} players (${seated.length} seated)`);
    if (!m.ai.supported && seated.some((p) => p.kind === "ai")) reasons.push("has no AI players; remove the AI seats");
    if (seated.length <= max && this.layoutFor(m) === null) reasons.push(`has no seat layout for ${seated.length} players`);
    return reasons;
  }

  /** What a game still needs before it can start (other than everyone tapping Ready), in plain words. */
  private needsFor(m: Manifest): string[] {
    const seated = this.seated();
    const needs: string[] = [];
    const counts = allowedPlayerCounts(m);
    if (!counts.includes(seated.length)) {
      const next = counts.find((c) => c > seated.length);
      if (next !== undefined) {
        const more = next - seated.length;
        needs.push(counts.length === 1 ? `needs exactly ${counts[0]} players, ${more} more` : `needs ${more} more player${more === 1 ? "" : "s"}`);
      }
    }
    if (!seated.some((p) => p.kind === "human" && p.location === "local")) needs.push("needs at least one player at the table");
    return needs;
  }

  /**
   * The seat layout a game would use: the current one if the game supports it and everyone fits; otherwise the
   * smallest supported layout with room for the game's maximum player count, or, failing that, the largest one that
   * still seats everyone already seated. Only seats on edges the game uses count.
   */
  private layoutFor(m: Manifest): SeatLayout | null {
    const room = (l: SeatLayout) => seatEdges(l).filter((e) => m.edges.includes(e)).length;
    const seated = this.seated().length;
    if (m.seatLayouts.includes(this.layout) && room(this.layout) >= seated) return this.layout;
    const usable = [...m.seatLayouts].sort((a, b) => a - b).filter((l) => room(l) >= seated);
    const max = Math.max(...allowedPlayerCounts(m));
    return usable.find((l) => room(l) >= max) ?? usable.at(-1) ?? null;
  }

  /** Everything that keeps the selected game from starting: blockers, needs, and seats that do not fit it. */
  private reasonsFor(gameId: string): string[] {
    const g = this.games.get(gameId);
    if (!g) return ["not installed"];
    const m = g.manifest;
    const reasons = [...this.blockersFor(m), ...this.needsFor(m)];
    if (!m.seatLayouts.includes(this.layout)) reasons.push(`does not support ${this.layout} seats`);
    const edges = seatEdges(this.layout);
    if (this.seated().some((p) => !m.edges.includes(edges[p.seat!]))) reasons.push("has no seats on the east or west edge");
    return reasons;
  }

  /**
   * Merge display choices into the chosen game's prefs (D-088). Top-level keys are replaced; null removes one.
   * The game's board defines what the keys mean; the table only keeps them small and plain.
   */
  setPrefs(patch: unknown) {
    if (!this.selected) throw new TableError(409, "choose a game first");
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new TableError(400, "prefs must be an object");
    const id = this.selected.game.manifest.id;
    const next: Record<string, unknown> = { ...(this.prefs.get(id) ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (!/^[A-Za-z][\w-]{0,39}$/.test(k)) throw new TableError(400, `bad prefs key "${k}"`);
      if (v === null) delete next[k];
      else next[k] = v;
    }
    if (Object.keys(next).length > 20 || JSON.stringify(next).length > 4096) throw new TableError(413, "prefs are limited to 20 keys and 4 KB");
    this.prefs.set(id, JSON.parse(JSON.stringify(next)));
    this.changed();
    return this.prefs.get(id)!;
  }

  setDisplay(d: unknown) {
    const sound = (d as { sound?: unknown } | null)?.sound;
    if (typeof sound !== "boolean") throw new TableError(400, "sound must be true or false");
    if (sound === this.sound) return;
    this.sound = sound;
    this.changed();
  }

  /**
   * Change the chosen game's settings before it starts (D-090), from the board's settings. Only the keys given
   * change; everyone's Ready stays, since the game itself is the same.
   */
  updateSettings(patch: unknown) {
    if (!this.selected || this.phase !== "ready") throw new TableError(409, "settings can change only before the game starts");
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new TableError(400, "settings must be an object");
    try {
      this.selected.settings = settingsWithDefaults(this.selected.game.manifest, { ...this.selected.settings, ...(patch as Record<string, unknown>) });
    } catch (e) {
      throw new TableError(400, (e as Error).message);
    }
    this.changed();
  }

  selectGame(gameId: string, settings: Record<string, unknown> = {}) {
    if (this.phase !== "idle" && this.phase !== "finished" && this.phase !== "ready")
      throw new TableError(409, "a game is running");
    const g = this.games.get(gameId);
    if (!g) throw new TableError(404, "no such game");
    const reasons = this.blockersFor(g.manifest);
    if (reasons.length) throw new TableError(409, `${g.manifest.name} ${reasons.join("; ")}`);
    let merged: Record<string, unknown>;
    try {
      merged = settingsWithDefaults(g.manifest, settings);
    } catch (e) {
      throw new TableError(400, (e as Error).message);
    }
    const layout = this.layoutFor(g.manifest)!;
    this.selected = { game: g, settings: merged };
    // The table follows the game: a layout it supports, and nobody on an edge it does not use.
    this.applyLayout(layout);
    this.summary = null;
    for (const p of this.players.values()) p.ready = p.kind === "ai";
    this.phase = "ready";
    this.changed();
  }

  /** In 'ready', the selection stays while the game can still be reached; it is dropped only on a blocker
   *  (e.g. too many players). Missing players are not a reason: they show as needs until the game can start. */
  private revalidateSelection() {
    if (!this.selected) return;
    const m = this.selected.game.manifest;
    if (this.blockersFor(m).length === 0 && m.seatLayouts.includes(this.layout)) return;
    this.phase = "idle";
    this.selected = null;
  }

  start() {
    if (this.phase !== "ready" || !this.selected) throw new TableError(409, "select a game first");
    const reasons = this.reasonsFor(this.selected.game.manifest.id);
    if (reasons.length) throw new TableError(409, `${this.selected.game.manifest.name} ${reasons.join("; ")}`);
    const notReady = this.seated().filter((p) => p.kind === "human" && (!p.ready || !p.connected));
    if (notReady.length) throw new TableError(409, `waiting for ${notReady.map((p) => p.name).join(", ")}`);
    const { game, settings } = this.selected;
    const seats = this.seated().map((p) => this.seatInfo(p));
    const aiOptions: Record<number, Record<string, unknown>> = {};
    for (const p of this.seated()) if (p.kind === "ai") aiOptions[p.seat!] = aiDefaults(game.manifest, p.aiOptions);
    const rt = new GameRuntime(game.manifest, game.def, randomInt(2 ** 31), settings, seats, realClock, { aiOptions });
    this.runtime = rt;
    this.runningGame = game;
    this.gameStartedAt = Date.now();
    this.phase = "active";
    rt.onChange((kind, events) => {
      if (kind === "over") void this.onGameOver(events);
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

  private async onGameOver(events: GameEvent[] = []) {
    const rt = this.runtime!;
    const terminated = rt.log.at(-1)?.t === "end" && (rt.log.at(-1) as { reason: string }).reason === "terminated";
    this.phase = "finished";
    this.pause = null;
    // Extra games that changed while this one ran take effect now (D-097); the log below still names the code it ran.
    if (this.pendingExtra) queueMicrotask(() => this.applyPendingExtra());
    this.summary = rt.summary;
    const ms = Date.now() - this.gameStartedAt;
    if (terminated) this.metrics.gamesTerminated++;
    else this.metrics.gamesPlayed++;
    this.metrics.totalGameMs += ms;
    this.emit("game", events);
    this.changed();
    const id = logId(rt.manifest.id);
    if (this.closed) return;
    const saving = this.logs.save(
      { id, tableName: this.config.tableName, gameId: rt.manifest.id, gameVersion: rt.manifest.version, simulation: false, startedAt: new Date(this.gameStartedAt).toISOString(), endedAt: new Date().toISOString(), games: 1, format: "gametable-log/1", ...(this.runningGame ? sourceMeta(this.runningGame) : {}) },
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
    this.emit("logSaved", id);
  }

  intent(playerId: string, intent: Intent) {
    const p = this.mustPlayer(playerId);
    if (this.phase === "paused") throw new TableError(409, "the game is paused");
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

/** AI player names (D-081): short, so "Name (AI)" fits a seat plate; half female, half male. */
export const AI_NAMES = [
  "Anna", "Bea", "Cleo", "Emma", "Ida", "Lena", "Lisa", "Mia", "Nora", "Rosa", "Sara", "Zoe",
  "Ben", "Bob", "Finn", "Jack", "Leo", "Max", "Noah", "Otto", "Paul", "Sam", "Tom", "Theo",
];

/** AI options with manifest defaults. The AI configuration screen (later phase) will override these per seat. */
export function aiDefaults(m: InstalledGame["manifest"], given: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const o of m.ai.options) {
    const v = given[o.key];
    out[o.key] = v !== undefined && (!o.values || o.values.includes(String(v))) ? v : o.default;
  }
  return out;
}

export function logId(gameId: string) {
  const d = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `${d}-${gameId}-${randomBytes(2).toString("hex")}`;
}
