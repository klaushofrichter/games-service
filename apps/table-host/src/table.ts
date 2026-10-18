// The table: players, seats, orientation, game selection and the running game.
// The lobby owns the table; the running game owns everything inside it.
import { EventEmitter } from "node:events";
import { randomBytes, randomInt } from "node:crypto";
import {
  PLAYER_COLORS,
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
import { HOW_TO_PLAY, settingsWithDefaults, type InstalledGame } from "./games.ts";
import { withStatistics } from "./stats.ts";

/** The URL a deck fetches a game's rules from (D-099), or null. */
const howToPlayUrl = (g: InstalledGame) => (g.howToPlay ? `/games/${g.manifest.id}/${HOW_TO_PLAY}` : null);
import { GameRuntime, realClock, type AiMoveMeta, type LogRecord } from "./runtime.ts";
import { movesFor } from "./moves.ts";
import { baseMeta, countRecords, rebuild, verifyGame, verifySummary } from "./game-log.ts";
import { AiCancelled, AiWorker, aiMove, isPromise, usesWorker } from "./ai.ts";
import type { LogStore, PlayerMeta, RunningLog } from "./logs.ts";

export class TableError extends Error {
  readonly status: number;
  /** A machine-readable reason where a client acts on it, e.g. "no-seat" (D-129). */
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface TableConfig {
  tableName: string;
  publicUrl: string; // e.g. http://192.168.1.20:8080
  graceMs: number; // how long a disconnected seat is held
  aiDelayMs: number; // pause before an AI acts, so people can follow
  /** AI players wait until the table's board has shown everything (D-141); off for fast tests (BOARD_PACING=0). */
  boardPacing?: boolean;
  /** An AI waits at most this long for a board that does not answer (D-141). */
  boardPaceTimeoutMs?: number;
  joinTokenTtlMs: number;
  requireCloud: boolean; // phase 1a dev mode may run without the cloud
  maxRemotePlayers: number;
  showTestGames: boolean; // stub games used by the automated tests
  /** A snapshot of the whole state in the log every N inputs (D-116); 0: none. */
  logSnapshotEvery?: number;
  /** The developer setting's value at start (ALLOW_NO_LOCAL_PLAYER, D-118); the board can change it until a restart. */
  allowNoLocalPlayer?: boolean;
}

interface Player extends PlayerInfo {
  sessionToken: string | null; // null for AI players
  remoteSession?: string; // the cloud session a remote player came through: one player per invite
  graceTimer?: NodeJS.Timeout;
  aiSeed?: number;
  chosenColor?: string; // picked in the board's settings (D-106)
  /** The colour the player got when first seated (their seat's, else a free one); it moves with them (D-117). */
  keptColor?: string;
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
  /** Colours of seats whose player left during the game (D-125), kept until the next game or the lobby. */
  private leftColors = new Map<number, string>();
  runtime: GameRuntime | null = null;
  private summary: GameSummary | null = null;
  private stateRev = 0;
  private joinToken = "";
  private joinTokenExpires = 0;
  private gameStartedAt = 0;
  /** The running game's log as it is written to disk (D-116), and its run.json so far. */
  private runningLog: { log: RunningLog; meta: ReturnType<typeof baseMeta> } | null = null;
  /** The table's identity at the service, set by the cloud link; null without the service. */
  tableId: string | null = null;
  cloud: CloudStatus = { status: "disabled" };
  readonly metrics = { gamesPlayed: 0, gamesTerminated: 0, totalGameMs: 0, simulations: 0 };

  readonly config: TableConfig;
  readonly games: Map<string, InstalledGame>;
  readonly logs: LogStore;

  constructor(config: TableConfig, games: Map<string, InstalledGame>, logs: LogStore) {
    super();
    this.config = config;
    this.allowNoLocalPlayer = !!config.allowNoLocalPlayer;
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
      players: this.playerInfos(),
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
            howToPlay: howToPlayUrl(this.selected.game),
            settingsShown: this.selected.game.manifest.settings.map((s) => ({ label: s.label ?? s.key, value: this.selected!.settings[s.key] })),
          }
        : null,
      layouts: this.allowedLayouts(),
      summary: this.summary,
      joinUrl: this.currentJoin().url,
      cloud: this.cloud,
      pause: this.pause,
      needed: this.neededPlayers(),
      seatColors: this.seatColors(),
      aiThinking: [...this.aiMoves.entries()]
        .filter(([, m]) => m.shown)
        .map(([playerId, m]) => ({ playerId, seat: m.seat, since: m.startedAt, deadline: m.deadline })),
      display: { sound: this.sound },
      play: { awayTimeout: this.awayTimeout },
      away: this.awayPlayers(),
      developer: { allowNoLocalPlayer: this.allowNoLocalPlayer, protectedPlayer: this.protectedPlayer()?.id ?? null },
      noSeat: this.noFreeSeat(),
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
    if (c.status === this.cloud.status && c.pairingCode === this.cloud.pairingCode && JSON.stringify(c.code ?? null) === JSON.stringify(this.cloud.code ?? null)) return;
    const wasOnline = this.cloud.status === "online";
    this.cloud = c;
    // D-015: losing the service pauses a running game; it resumes by itself when the link returns.
    if (wasOnline && !this.cloudOnline && (this.phase === "active" || this.pause?.reason === "ai")) this.pauseGame("cloud");
    else if (this.cloudOnline && this.phase === "paused" && this.pause?.reason === "cloud") this.resumeGame();
    this.changed();
  }

  pause: LobbyState["pause"] = null;

  /**
   * Players the running game can't go on without whose phones are away (D-119): their seats are held with no time
   * limit, and the game is paused until they are back, or someone ends the game, or removes them (which ends it).
   */
  private waitingFor = new Map<string, { seat: number; text: string; since: number }>();

  private playerPause(): NonNullable<LobbyState["pause"]> {
    const players = [...this.waitingFor].map(([playerId, w]) => ({ playerId, name: this.players.get(playerId)?.name ?? "a player", seat: w.seat, since: w.since, text: w.text }));
    const since = this.pause?.reason === "player" ? this.pause.since : Date.now();
    return { reason: "player", since, canSave: !!this.selected?.game.manifest.saveGame, players };
  }

  /** Pause for the players the game waits for, or go on when the last one is back (D-119). */
  private syncPlayerPause() {
    const rt = this.runtime;
    if (!rt || rt.over || (this.phase !== "active" && this.phase !== "paused")) return;
    if (this.waitingFor.size) {
      if (this.phase === "active") {
        rt.pause("player");
        this.stopAllAi(); // they start again from the current view when the game goes on
        this.phase = "paused";
        this.pause = this.playerPause();
        this.emit("game", [{ name: "paused", data: { reason: "player" } }]);
      } else if (this.pause?.reason === "ai") {
        this.stopAllAi(); // a missing player matters more than a slow AI; it thinks again afterwards
        rt.pause("player");
        this.pause = this.playerPause();
      } else if (this.pause?.reason === "player") this.pause = this.playerPause();
      // Paused for the cloud: that pause stays; resumeGame comes back here when the link returns.
      return;
    }
    if (this.phase !== "paused" || this.pause?.reason !== "player") return;
    if (!this.cloudOnline) {
      rt.pause("cloud");
      this.pause = { reason: "cloud", since: Date.now(), canSave: !!this.selected?.game.manifest.saveGame };
      return;
    }
    rt.resume("player");
    this.phase = "active";
    this.pause = null;
    this.emit("game", [{ name: "resumed" }]);
    this.scheduleAi();
  }

  /** During a game: the seated players it can't go on without, with its reason (D-119). */
  private neededPlayers(): Record<string, string> {
    const rt = this.runtime;
    if (!rt || rt.over || (this.phase !== "active" && this.phase !== "paused")) return {};
    const out: Record<string, string> = {};
    for (const p of this.players.values()) {
      if (p.seat === null || !rt.seats.some((s) => s.seat === p.seat)) continue;
      const r = rt.canContinueWithout(p.seat);
      if (r !== true) out[p.id] = r.wait;
    }
    return out;
  }

  pauseGame(reason: "cloud") {
    if ((this.phase !== "active" && this.pause?.reason !== "ai") || !this.runtime) return;
    this.runtime.pause(reason);
    this.stopAllAi(); // AI players start again from the current view when the game resumes
    this.phase = "paused";
    this.pause = { reason, since: Date.now(), canSave: !!this.selected?.game.manifest.saveGame };
    this.emit("game", [{ name: "paused", data: { reason } }]);
  }

  /** Resume a paused game (automatic when the cloud returns, or from the board once it is back). */
  resumeGame() {
    if (this.phase !== "paused" || !this.runtime) throw new TableError(409, "the game is not paused");
    if (this.pause?.reason === "ai") throw new TableError(409, `waiting for ${this.pause.ai?.name ?? "an AI player"}; tap Play now to move for it`);
    if (this.pause?.reason === "player") throw new TableError(409, `waiting for ${this.pause.players?.map((p) => p.name).join(" and ") || "a player"} to come back`);
    if (!this.cloudOnline) throw new TableError(409, "still offline; the game resumes by itself when the connection returns");
    if (this.waitingFor.size) {
      // Back online, but someone the game needs is still away (D-119): wait for them instead.
      this.runtime.pause("player");
      this.pause = this.playerPause();
      this.changed();
      return;
    }
    this.runtime.resume("cloud");
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

  /**
   * Developer setting (D-118): games may start, and go on, without a player at the table (remote players and AIs, or
   * AIs only). In memory only, so every start of the Table Host turns it off unless ALLOW_NO_LOCAL_PLAYER=1.
   */
  allowNoLocalPlayer = false;

  setDeveloper(d: unknown) {
    const v = (d as { allowNoLocalPlayer?: unknown } | null)?.allowNoLocalPlayer;
    if (typeof v !== "boolean") throw new TableError(400, "allowNoLocalPlayer must be true or false");
    if (v === this.allowNoLocalPlayer) return;
    this.allowNoLocalPlayer = v;
    if (this.phase === "ready") this.revalidateSelection();
    this.changed();
  }

  /**
   * The player the board may not remove (D-118): the last human seated at the table while a game is chosen or
   * running, unless the developer setting allows games without one. A phone that goes away still leaves.
   */
  protectedPlayer(): Player | null {
    if (this.allowNoLocalPlayer || !["ready", "active", "paused"].includes(this.phase)) return null;
    const local = this.seated().filter((p) => p.kind === "human" && p.location === "local");
    return local.length === 1 ? local[0] : null;
  }

  remoteBoardControl = true;

  setRemoteBoardControl(on: boolean) {
    this.remoteBoardControl = !!on;
    this.changed();
  }

  /** Remote boards may act unless switched off at the table or by the running game's manifest (D-006). */
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
    // A seat is taken when a player joins (D-129): with none free, nobody joins to stand around without one.
    const noSeat = this.noFreeSeat();
    if (noSeat) throw new TableError(409, noSeat, "no-seat");
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
    if (!p && this.handedToAi.has(sessionToken))
      throw new TableError(403, `your seat was handed to ${this.handedToAi.get(sessionToken)} while you were away; scan the QR code to join the next game`);
    if (!p) throw new TableError(403, "session expired; scan the QR code to join again (during a game: Settings › Show join code on the board)");
    if (p.graceTimer) clearTimeout(p.graceTimer);
    p.graceTimer = undefined;
    const wasAway = !p.connected;
    p.connected = true;
    if (wasAway && this.inRunningGame(p)) this.runtime!.noteConnection(p.seat!, true);
    this.awaySince.delete(p.id);
    if (this.waitingFor.delete(p.id)) this.syncPlayerPause(); // the game goes on when everyone it needs is back
    this.changed();
    return p;
  }

  /** The player has a seat in the game that is running. */
  private inRunningGame(p: Player): boolean {
    const rt = this.runtime;
    return !!rt && !rt.over && (this.phase === "active" || this.phase === "paused") && p.seat !== null && rt.seats.some((s) => s.seat === p.seat);
  }

  disconnected(playerId: string) {
    if (this.closed) return;
    const p = this.players.get(playerId);
    if (!p || p.kind !== "human" || !p.connected) return;
    p.connected = false;
    // A game that can't go on without this player waits for them (D-119): the seat is held, with no time limit.
    const inGame = this.inRunningGame(p);
    const need = inGame ? this.runtime!.canContinueWithout(p.seat!) : true;
    if (inGame) this.runtime!.noteConnection(p.seat!, false, need === true ? undefined : need.wait);
    if (need !== true) {
      this.waitingFor.set(p.id, { seat: p.seat!, text: need.wait, since: Date.now() });
      this.syncPlayerPause();
    } else if (inGame && !this.awayTimeout) {
      // The seat waits (D-144); after a moment the board shows the player as away, with the choice to hand the seat to an AI.
      this.awaySince.set(p.id, Date.now());
      setTimeout(() => this.awaySince.has(p.id) && this.changed(), Table.AWAY_SHOW_MS + 50);
    } else p.graceTimer = setTimeout(() => this.removePlayer(playerId, "left"), this.config.graceMs);
    this.changed();
  }

  // ---------- seats ----------

  private humans() {
    return [...this.players.values()].filter((p) => p.kind === "human");
  }

  /**
   * Why nobody can take a seat now, in words for the phone and the board, or null when a seat is free (D-129). A seat
   * is taken as soon as a player has joined (phone, invite or AI), connected or reconnecting. Full: every seat of the
   * layout on the edges the chosen game uses is taken, or the chosen game has as many players as it takes.
   */
  noFreeSeat(): string | null {
    const playing = this.phase === "active" || this.phase === "paused" || this.phase === "terminating";
    const m = this.phase === "ready" || playing ? this.selected?.game.manifest : undefined;
    const max = m ? Math.max(...allowedPlayerCounts(m)) : 8;
    const atMax = !!m && this.seated().length >= max;
    if (!atMax && this.freeSeats().length > 0) return null;
    if (playing) return "There is no free seat in this game. Join after it.";
    if (atMax) return `There is no free seat: ${m!.name} takes at most ${max} players. Remove a player on the board first.`;
    const larger = this.allowedLayouts().some((l) => l > this.layout);
    return larger ? "There is no free seat. Choose more seats on the board, or remove a player there." : "There is no free seat. Remove a player on the board first.";
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
    this.colors(); // fix everyone's colour before the move, so it travels with them (D-117)
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

  /**
   * Every seated player's colour (D-106), all different: a player's own choice first (in seat order), then the colour
   * they got when first seated (D-117: it follows them when they move), then their seat's colour, else the first one
   * nobody has. The colour a player ends up with is kept for them. Players without a seat have none.
   */
  colors(): Map<string, string> {
    const seated = this.seated();
    const out = new Map<string, string>();
    const used = new Set<string>(Object.values(this.seatColors()));
    for (const p of seated) {
      if (p.chosenColor && !used.has(p.chosenColor)) {
        out.set(p.id, p.chosenColor);
        used.add(p.chosenColor);
      }
    }
    for (const p of seated) {
      if (out.has(p.id) || !p.keptColor || used.has(p.keptColor)) continue;
      out.set(p.id, p.keptColor);
      used.add(p.keptColor);
    }
    for (const p of seated) {
      if (out.has(p.id)) continue;
      const own = PLAYER_COLORS[p.seat! % PLAYER_COLORS.length];
      const c = used.has(own) ? PLAYER_COLORS.find((x) => !used.has(x)) ?? own : own;
      out.set(p.id, c);
      used.add(c);
    }
    for (const p of seated) p.keptColor = out.get(p.id);
    return out;
  }

  /** Empty seats that keep the colour of the player who left them during the game (D-125), seat → colour. */
  private seatColors(): Record<number, string> {
    const taken = new Set(this.seated().map((p) => p.seat));
    return Object.fromEntries([...this.leftColors].filter(([seat]) => !taken.has(seat)));
  }

  private playerInfos(): PlayerInfo[] {
    const colors = this.colors();
    return [...this.players.values()].map(({ sessionToken, graceTimer, aiSeed, remoteSession, chosenColor, keptColor, ...info }) => ({ ...info, color: colors.get(info.id) ?? null }));
  }

  /**
   * Give a seated player a colour from the palette (D-106). If someone else has it, the two swap, so colours stay
   * distinct. A table setting, not a game's: it holds in the lobby and in every game until the player leaves.
   */
  setColor(playerId: string, color: unknown) {
    const p = this.mustPlayer(playerId);
    if (p.seat === null) throw new TableError(409, `${p.name} has no seat`);
    if (typeof color !== "string" || !(PLAYER_COLORS as readonly string[]).includes(color.toLowerCase())) throw new TableError(400, `color must be one of ${PLAYER_COLORS.join(", ")}`);
    const c = color.toLowerCase();
    const colors = this.colors();
    const mine = colors.get(p.id)!;
    const other = this.seated().find((q) => q.id !== p.id && colors.get(q.id) === c);
    if (other) other.chosenColor = mine;
    // An empty seat keeping a departed player's colour (D-125) swaps too.
    const left = Object.entries(this.seatColors()).find(([, x]) => x === c);
    if (left) this.leftColors.set(Number(left[0]), mine);
    p.chosenColor = c;
    this.changed();
  }

  /** Evict a human (revokes the session) or remove an AI. */
  removePlayer(playerId: string, reason: "evicted" | "left" = "evicted") {
    const p = this.mustPlayer(playerId);
    if (reason === "evicted" && this.protectedPlayer()?.id === p.id)
      throw new TableError(409, `${p.name} is the last player at the table; a game needs one (the developer setting under Advanced on the board allows games without)`);
    if (p.graceTimer) clearTimeout(p.graceTimer);
    // During a game the seat keeps the player's colour (D-125): the game may go on with an AI in it (Loopy) or show it.
    if ((this.phase === "active" || this.phase === "paused") && p.seat !== null) {
      const c = this.colors().get(p.id);
      if (c) this.leftColors.set(p.seat, c);
    }
    this.players.delete(playerId);
    this.waitingFor.delete(playerId);
    this.awaySince.delete(playerId);
    this.emit("removed", playerId, reason);
    if ((this.phase === "active" || this.phase === "paused") && this.runtime && p.seat !== null) {
      // may end the game -> onGameOver; a game that needed them ends with its reason (D-119)
      if (!this.runtime.seatLeft(p.seat)) this.syncPlayerPause();
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
    return this.visibleGames().map((g) => {
      const { manifest: m, source } = g;
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
        howToPlay: howToPlayUrl(g),
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
    if (!this.allowNoLocalPlayer && !seated.some((p) => p.kind === "human" && p.location === "local")) needs.push("needs at least one player at the table");
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

  /**
   * Whether a player whose phone stays away during a game leaves it after the waiting time (graceMs), as before D-144.
   * Off (the default): their seat waits for them, and the board can hand it to an AI player (replaceWithAi). In memory,
   * like the sound setting.
   */
  private awayTimeout = false;

  setPlay(d: unknown) {
    const v = (d as { awayTimeout?: unknown } | null)?.awayTimeout;
    if (typeof v !== "boolean") throw new TableError(400, "awayTimeout must be true or false");
    if (v === this.awayTimeout) return;
    this.awayTimeout = v;
    // Players already away follow the new setting: the waiting time starts now, or their seat waits after all.
    for (const p of this.players.values()) {
      if (p.kind !== "human" || p.connected || !this.inRunningGame(p) || this.waitingFor.has(p.id)) continue;
      if (v && !p.graceTimer) p.graceTimer = setTimeout(() => this.removePlayer(p.id, "left"), this.config.graceMs);
      if (!v && p.graceTimer) {
        clearTimeout(p.graceTimer);
        p.graceTimer = undefined;
      }
    }
    this.changed();
  }

  /** Sessions of players whose seat went to an AI (D-144): their phone, back, is told why instead of "session expired". */
  private handedToAi = new Map<string, string>();
  /** Players away during the game whose seat waits for them (D-144): the board offers to hand it to an AI player. */
  private awaySince = new Map<string, number>();
  /** The board shows an away player only after this long, so a phone that locks for a moment doesn't flash a card. */
  static AWAY_SHOW_MS = 15_000;

  private awayPlayers(): { playerId: string; name: string; seat: number; since: number }[] {
    const now = Date.now();
    return [...this.awaySince]
      .map(([id, since]) => ({ p: this.players.get(id), since }))
      .filter((x): x is { p: Player; since: number } => !!x.p && !x.p.connected && this.inRunningGame(x.p) && !this.waitingFor.has(x.p.id) && now - x.since >= Table.AWAY_SHOW_MS)
      .map(({ p, since }) => ({ playerId: p.id, name: p.name, seat: p.seat!, since }));
  }

  /**
   * Hand the seat of a player who is away to a new AI player (D-144), from the board: the game goes on with the AI in
   * the seat (its moves are ordinary AI moves), the player's session ends, the seat keeps its colour.
   */
  replaceWithAi(playerId: string) {
    const p = this.mustPlayer(playerId);
    const rt = this.runtime;
    const game = this.runningGame;
    if (p.kind !== "human") throw new TableError(400, `${p.name} is not a person`);
    if (!rt || !game || !this.inRunningGame(p)) throw new TableError(409, `${p.name} is not playing in a running game`);
    if (p.connected) throw new TableError(409, `${p.name}'s phone is connected; only a player who is away can be handed to an AI`);
    if (!game.manifest.ai.supported) throw new TableError(409, `${game.manifest.name} has no AI players`);
    const seat = p.seat!;
    const color = this.colors().get(p.id);
    const taken = new Set([...this.players.values()].map((x) => x.name));
    const name = taken.has(`${p.name} (AI)`) ? this.aiName() : `${p.name} (AI)`;
    const aiOptions = aiDefaults(game.manifest, {});
    const ai: Player = { id: newId("ai"), name, kind: "ai", location: "local", seat, connected: true, ready: true, sessionToken: null, aiSeed: randomInt(2 ** 31), aiOptions, chosenColor: color, keptColor: color };
    if (p.graceTimer) clearTimeout(p.graceTimer);
    if (p.sessionToken) this.handedToAi.set(p.sessionToken, ai.name);
    this.players.delete(p.id);
    this.waitingFor.delete(p.id);
    this.awaySince.delete(p.id);
    this.players.set(ai.id, ai);
    rt.aiTakeover(seat, name, aiOptions);
    this.emit("removed", p.id, "replaced");
    this.syncPlayerPause(); // a game that waited for them goes on
    this.scheduleAi();
    this.changed();
    return ai.id;
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
    this.placeLocalPlayer(g.manifest); // and the one player at the table on the game's edge (D-128)
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
    this.placeLocalPlayer(game.manifest);
    const seats = this.seated().map((p) => this.seatInfo(p));
    const aiOptions: Record<number, Record<string, unknown>> = {};
    for (const p of this.seated()) if (p.kind === "ai") aiOptions[p.seat!] = aiDefaults(game.manifest, p.aiOptions);
    const rt = new GameRuntime(game.manifest, game.def, randomInt(2 ** 31), settings, seats, realClock, { aiOptions, snapshotEvery: this.config.logSnapshotEvery });
    this.runtime = rt;
    this.runningGame = game;
    this.gameStartedAt = Date.now();
    this.lastActorSeat = null;
    this.handedToAi.clear();
    this.beginLog(rt, game, settings, aiOptions);
    this.leftColors.clear();
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

  /**
   * A game's `localSeat` (D-128): the one human playing at the table moves to that edge when the game starts, swapping
   * with the remote or AI player there (or taking a free seat). Nothing happens with two or more people at the table,
   * or when they already sit on that edge.
   */
  private placeLocalPlayer(m: Manifest) {
    if (!m.localSeat) return;
    const seated = this.seated();
    const local = seated.filter((p) => p.kind === "human" && p.location === "local");
    if (local.length !== 1) return;
    const me = local[0];
    const edges = seatEdges(this.layout);
    if (edges[me.seat!] === m.localSeat) return;
    const target = edges.findIndex((e) => e === m.localSeat);
    if (target < 0) return;
    this.colors(); // everyone keeps their colour across the swap (D-117)
    const other = seated.find((p) => p.seat === target);
    if (other) other.seat = me.seat;
    me.seat = target;
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
    this.leftColors.clear();
    this.phase = "idle";
    for (const p of this.players.values()) p.ready = p.kind === "ai";
    this.changed();
  }

  private async onGameOver(events: GameEvent[] = []) {
    const rt = this.runtime!;
    const terminated = rt.log.at(-1)?.t === "end" && (rt.log.at(-1) as { reason: string }).reason === "terminated";
    this.stopAllAi(true);
    this.phase = "finished";
    this.pause = null;
    // Seats held for players who are still away (D-119) are released the usual way now.
    for (const id of this.waitingFor.keys()) {
      const p = this.players.get(id);
      if (p && !p.connected && !p.graceTimer) p.graceTimer = setTimeout(() => this.removePlayer(id, "left"), this.config.graceMs);
    }
    this.waitingFor.clear();
    // Seats that waited for away players (D-144) are released the usual way too.
    for (const id of this.awaySince.keys()) {
      const p = this.players.get(id);
      if (p && !p.connected && !p.graceTimer) p.graceTimer = setTimeout(() => this.removePlayer(id, "left"), this.config.graceMs);
    }
    this.awaySince.clear();
    // Extra games that changed while this one ran take effect now (D-097); the log below still names the code it ran.
    if (this.pendingExtra) queueMicrotask(() => this.applyPendingExtra());
    this.summary = withStatistics(rt.summary, rt.log); // with the statistics window's data (D-140)
    const ms = Date.now() - this.gameStartedAt;
    if (terminated) this.metrics.gamesTerminated++;
    else this.metrics.gamesPlayed++;
    this.metrics.totalGameMs += ms;
    this.emit("game", events);
    this.changed();
    const running = this.runningLog;
    this.runningLog = null;
    // A table shutting down leaves the running file; the next start closes it as interrupted.
    if (this.closed || !running) return;
    const end = rt.log.at(-1) as Extract<LogRecord, { t: "end" }>;
    const game = this.runningGame;
    const meta = {
      ...running.meta,
      endedAt: new Date().toISOString(),
      durationMs: ms,
      endReason: end.reason,
      result: rt.summary?.text ?? null,
      counts: { ...countRecords(rt.log), errors: rt.errors },
      verify: game ? verifySummary([verifyGame(game, rt.log)]) : { checked: 0, ok: 0, failed: [], skipped: "game not installed" },
    };
    const id = running.log.id;
    const saving = this.logs.finish(running.log, meta, rt.log, rt.state, movesFor(game ?? undefined, rt.log));
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

  intent(playerId: string, intent: Intent, ai?: AiMoveMeta) {
    const p = this.mustPlayer(playerId);
    if (this.phase === "paused") throw new TableError(409, "the game is paused");
    if (this.phase !== "active" || !this.runtime) throw new TableError(409, "no game is running");
    if (p.seat === null || !this.runtime.seats.some((s) => s.seat === p.seat)) throw new TableError(409, "you are not playing in this game");
    if (!intent || typeof intent.name !== "string") throw new TableError(400, "intent needs a name");
    this.changeByAi = p.kind === "ai";
    let r: ReturnType<GameRuntime["submit"]>;
    try {
      r = this.runtime.submit(p.seat, { name: intent.name, payload: intent.payload }, p.kind === "ai" ? "ai" : "human", p.kind === "ai" ? ai : undefined);
    } finally {
      this.changeByAi = false;
    }
    if (r.ok) this.lastActorSeat = p.seat;
    return r;
  }

  /** True while the game changes because of an AI player's move: decks see it once the board has shown it (D-143). */
  changeByAi = false;
  /** The seat that made the last accepted move: an AI answering its own follow-up question doesn't pause first (D-143). */
  private lastActorSeat: number | null = null;

  /**
   * An intent sent by touching the board for a player (D-102). Only names the running game lists in `boardIntents`.
   * The table's own board acts for humans sitting at the table; a remote board (`remoteSession` set) only for the
   * player who came through that session, whatever the board-control switch says, since it is their own move.
   */
  boardIntent(playerId: unknown, intent: Intent, remoteSession: string | null) {
    const p = typeof playerId === "string" ? this.players.get(playerId) : undefined;
    if (!p) throw new TableError(404, "no such player");
    if (!intent || typeof intent.name !== "string") throw new TableError(400, "intent needs a name");
    if (this.phase !== "active" || !this.runtime) throw new TableError(409, this.phase === "paused" ? "the game is paused" : "no game is running");
    if (!this.runtime.manifest.boardIntents.includes(intent.name)) throw new TableError(403, `${intent.name} is done on the phone, not on the board`);
    if (remoteSession === null ? p.kind !== "human" || p.location !== "local" : p.remoteSession !== remoteSession)
      throw new TableError(403, remoteSession === null ? "only players at the table can move from the board" : "you can only move your own pieces");
    if (p.seat === null || !this.runtime.seats.some((s) => s.seat === p.seat)) throw new TableError(409, `${p.name} is not playing in this game`);
    const r = this.runtime.submit(p.seat, { name: intent.name, payload: intent.payload }, "board");
    if (r.ok) this.lastActorSeat = p.seat;
    return r;
  }

  /**
   * One move in the making per AI player (D-043, D-112): the pause before it starts, then, for an AI that answers
   * later, its abort controller, start, deadline, and whether the board shows it as thinking.
   */
  private aiMoves = new Map<string, AiMoveState>();
  private aiRngs = new Map<string, () => number>();
  /** AI players' worker threads (manifest `ai.worker`), kept between moves so the rules load once per game. */
  private aiWorkers = new Map<string, AiWorker>();
  /** After this long an AI that answers later shows as thinking (`aiThinking`); quicker moves never flicker. */
  static AI_SHOW_THINKING_MS = 800;

  /**
   * Give every AI player a chance to act after any change to the game (an intent, a timer, a player
   * joining or leaving). Each AI has at most one move in the making, replaced on every change, so it always
   * decides from the latest view: a slower AI's stale answer is dropped (its worker thread stopped). A rejected
   * AI move is retried once after a pause.
   */
  private scheduleAi(retryMs?: number) {
    if (this.phase !== "active" || !this.runtime) return;
    this.stopAllAi();
    for (const p of this.players.values()) {
      if (p.kind !== "ai" || p.seat === null) continue;
      const mv: AiMoveState = { seat: p.seat, startedAt: 0, deadline: 0, shown: false };
      // No pause when this AI just moved and the game asks it again (a card, then the marble to move): it is one move,
      // and the board shows each step anyway (D-143). Only with the board pacing the game; without it the pause is all
      // that lets people follow.
      const delay = retryMs ?? (p.seat === this.lastActorSeat && this.pacedByBoard ? 0 : this.config.aiDelayMs);
      mv.timer = setTimeout(() => this.thinkAi(p, mv, retryMs !== undefined), delay);
      this.aiMoves.set(p.id, mv);
    }
  }

  // ---------- AI players at the board's pace (D-141) ----------
  // The table's one local board (D-132) answers each game message with "idle" once it has shown it (its game's
  // whenIdle, D-134). An AI player starts its move only when the board has shown everything sent so far, or the board
  // has been silent for boardPaceTimeoutMs. Without a local board (tests, a table run headless) or with pacing off,
  // AI players don't wait. Remote boards never hold the game up.
  private boardSent = 0; // the last game message number sent to the local board
  private boardShown = 0; // the last one it reported as shown
  private boardSentAt = 0;
  private localBoard = false;
  /** The number for the next game message to the boards. */
  nextBoardMessage() {
    this.boardSent++;
    this.boardSentAt = Date.now();
    return this.boardSent;
  }
  /** The local board has shown game message `n`. */
  boardIdle(n: number) {
    if (!Number.isInteger(n) || n <= this.boardShown || n > this.boardSent) return;
    this.boardShown = n;
    this.emit("boardShown", n);
  }
  /** Whether a local board is connected. */
  setLocalBoard(connected: boolean) {
    this.localBoard = connected;
    if (!connected) {
      this.boardShown = this.boardSent;
      this.emit("boardShown", this.boardShown);
    }
  }
  /** The last game message the local board has shown (D-141). */
  get shownOnBoard() {
    return this.boardShown;
  }
  /** Whether the game goes at the local board's pace now: pacing on and a local board connected (D-141, D-143). */
  get pacedByBoard() {
    return !!this.config.boardPacing && this.localBoard;
  }
  /** How long anything waits for a board that does not answer (D-141). */
  get boardPaceTimeoutMs() {
    return this.config.boardPaceTimeoutMs ?? 20_000;
  }
  private waitingForBoard() {
    if (!this.config.boardPacing || !this.localBoard || this.boardShown >= this.boardSent) return false;
    return Date.now() - this.boardSentAt < this.boardPaceTimeoutMs;
  }

  private thinkAi(p: Player, mv: AiMoveState, retried: boolean) {
    mv.timer = undefined;
    if (this.aiMoves.get(p.id) === mv && this.waitingForBoard()) {
      mv.timer = setTimeout(() => this.thinkAi(p, mv, retried), 50); // the board is still showing the last moves
      return;
    }
    const rt = this.runtime;
    const game = this.runningGame;
    if (this.aiMoves.get(p.id) !== mv || this.phase !== "active" || !rt || !game || !this.players.has(p.id) || rt.over || p.seat === null) return;
    const rng = this.aiRng(p);
    const budget = game.manifest.ai.timeoutSeconds * 1000;
    mv.startedAt = Date.now();
    mv.deadline = mv.startedAt + budget;
    mv.controller = new AbortController();
    const worker = usesWorker(game) ? this.aiWorker(p.id, game) : null;
    let answer: ReturnType<typeof aiMove>;
    try {
      answer = aiMove(game, rt, p.seat, rng, mv.controller.signal, mv.deadline, worker);
    } catch (e) {
      this.aiFailed(p, mv, e);
      return;
    }
    if (!isPromise<Intent | null>(answer)) {
      this.aiMoves.delete(p.id);
      if (answer) this.submitAi(p, answer, undefined, retried);
      return;
    }
    // Answers later: show it as thinking after a moment, pause the game when its time is up.
    mv.showTimer = setTimeout(() => {
      if (this.aiMoves.get(p.id) !== mv) return;
      mv.shown = true;
      this.changed();
    }, Table.AI_SHOW_THINKING_MS);
    mv.overdueTimer = setTimeout(() => this.aiOverdue(p, mv), budget);
    answer.then(
      (intent) => {
        if (this.aiMoves.get(p.id) !== mv) return; // the game moved on: a newer move replaced this one
        const meta: AiMoveMeta = { ms: Date.now() - mv.startedAt, ...(worker ? { worker: true } : {}) };
        const waitedFor = this.pause?.reason === "ai" && this.pause.ai?.playerId === p.id;
        this.endAiMove(p.id, mv);
        if (intent) this.submitAi(p, intent, meta, retried);
        else if (waitedFor) this.scheduleAi(); // the others were stopped for the pause
        this.changed();
      },
      (e) => {
        if (e instanceof AiCancelled || this.aiMoves.get(p.id) !== mv) return;
        this.aiFailed(p, mv, e);
      },
    );
  }

  /** An AI move ended (answered, failed or replaced): its timers go, and a pause waiting for it ends. */
  private endAiMove(playerId: string, mv: AiMoveState) {
    this.dropAiMove(playerId, mv);
    if (this.pause?.reason === "ai" && this.pause.ai?.playerId === playerId) this.resumeAfterAi("ai");
  }

  /** Back from an AI pause (D-112): the game's timers run again. */
  private resumeAfterAi(reason: "ai" | "playNow") {
    if (!this.runtime) return;
    this.runtime.resume(reason);
    this.phase = "active";
    this.pause = null;
    this.emit("game", [{ name: "resumed" }]);
  }

  /** The AI threw or its worker failed: play the game's quick move instead, so the table never waits on a broken AI. */
  private aiFailed(p: Player, mv: AiMoveState, e: unknown) {
    const error = (e as Error)?.message ?? String(e);
    console.error(`[table] ${p.name}'s AI failed: ${error}`);
    this.endAiMove(p.id, mv);
    const rt = this.runtime;
    if (!rt || p.seat === null || this.phase !== "active") return;
    const fallback = rt.aiFallbackIntent(p.seat, this.aiRng(p));
    if (fallback) this.submitAi(p, fallback, { ms: mv.startedAt ? Date.now() - mv.startedAt : 0, fallback: true, ...this.workerMeta(), error }, true);
    else this.changed();
  }

  /** Time is up (D-112): the game pauses while the AI keeps thinking; the board offers "Play now" for it. */
  private aiOverdue(p: Player, mv: AiMoveState) {
    if (this.aiMoves.get(p.id) !== mv || this.phase !== "active" || !this.runtime) return;
    this.runtime.pause("ai", mv.seat);
    // Other AI players start again from the current view after the pause; this one keeps thinking.
    for (const [id, other] of [...this.aiMoves]) if (id !== p.id) this.cancelAiMove(id, other);
    this.phase = "paused";
    this.pause = { reason: "ai", since: Date.now(), canSave: !!this.selected?.game.manifest.saveGame, ai: { playerId: p.id, name: p.name, seat: mv.seat, since: mv.startedAt } };
    this.emit("game", [{ name: "paused", data: { reason: "ai", playerId: p.id } }]);
    this.changed();
  }

  /**
   * Fire one of the running game's timers now (D-136), e.g. Hold'em's "Next hand" instead of waiting out the result.
   * Only timers the manifest lists in `skipTimers`; the server lets remote boards do it only with board control.
   */
  skipTimer(id: unknown) {
    if (typeof id !== "string") throw new TableError(400, "skip-timer needs a timer id");
    if (this.phase !== "active" || !this.runtime) throw new TableError(409, this.phase === "paused" ? "the game is paused" : "no game is running");
    if (!this.runtime.manifest.skipTimers.includes(id)) throw new TableError(403, `${this.runtime.manifest.name} does not let the board skip "${id}"`);
    if (!this.runtime.skipTimer(id)) throw new TableError(409, "nothing to skip right now");
  }

  /**
   * "Play now" on the board (D-112): stop waiting for the AI the game paused for and play the game's quick move for it
   * (or, if the game has none, ask the AI again with a fresh budget).
   */
  playNow() {
    if (this.phase !== "paused" || this.pause?.reason !== "ai" || !this.runtime) throw new TableError(409, "no AI player is being waited for");
    const p = this.players.get(this.pause.ai!.playerId);
    const mv = p ? this.aiMoves.get(p.id) : undefined;
    if (p && mv) this.cancelAiMove(p.id, mv);
    this.resumeAfterAi("playNow");
    const fallback = p && p.seat !== null ? this.runtime.aiFallbackIntent(p.seat, this.aiRng(p)) : null;
    if (p && fallback) this.submitAi(p, fallback, { ms: mv?.startedAt ? Date.now() - mv.startedAt : 0, fallback: true, ...this.workerMeta() }, true);
    if ((this.phase as string) === "active" && !(p && fallback)) this.scheduleAi();
    this.changed();
  }

  private submitAi(p: Player, intent: Intent, meta: AiMoveMeta | undefined, retried: boolean) {
    try {
      const r = this.intent(p.id, intent, meta);
      if (!r.ok && !retried) this.scheduleAi(this.config.aiDelayMs * 4 + 200);
    } catch {
      // the game moved on (ended, paused, seat gone): nothing to do
    }
  }

  /** Stop one AI move: its timers, its signal, and its worker thread if it was busy with it. */
  private cancelAiMove(playerId: string, mv: AiMoveState) {
    mv.controller?.abort();
    const w = this.aiWorkers.get(playerId);
    if (w?.busy) w.cancel();
    this.dropAiMove(playerId, mv);
    if (mv.shown) this.stateDirty = true;
  }

  /** An AI move's timers go, and it is no longer the player's move in the making. */
  private dropAiMove(playerId: string, mv: AiMoveState) {
    clearTimeout(mv.timer);
    clearTimeout(mv.showTimer);
    clearTimeout(mv.overdueTimer);
    if (this.aiMoves.get(playerId) === mv) this.aiMoves.delete(playerId);
  }

  private stateDirty = false;

  /** Stop every AI move; at the end of a game also their worker threads. */
  private stopAllAi(endWorkers = false) {
    for (const [id, mv] of [...this.aiMoves]) this.cancelAiMove(id, mv);
    if (endWorkers) {
      for (const w of this.aiWorkers.values()) w.terminate();
      this.aiWorkers.clear();
    }
    if (this.stateDirty) {
      this.stateDirty = false;
      queueMicrotask(() => this.changed()); // a thinking marker went away
    }
  }

  /** Marks a move of an AI that runs in a worker thread, also when its fallback was played. */
  private workerMeta(): { worker?: true } {
    return this.runningGame && usesWorker(this.runningGame) ? { worker: true } : {};
  }

  private aiRng(p: Player) {
    let rng = this.aiRngs.get(p.id);
    if (!rng) this.aiRngs.set(p.id, (rng = createRng(p.aiSeed ?? 1)));
    return rng;
  }

  private aiWorker(playerId: string, game: InstalledGame) {
    let w = this.aiWorkers.get(playerId);
    if (!w) this.aiWorkers.set(playerId, (w = new AiWorker(game.rulesFile!)));
    return w;
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

  private playersMeta(aiOptions: Record<number, Record<string, unknown>>): PlayerMeta[] {
    return this.seated().map((p) => ({ seat: p.seat!, name: p.name, kind: p.kind, location: p.kind === "ai" ? null : p.location, ...(p.kind === "ai" ? { aiOptions: aiOptions[p.seat!] ?? {} } : {}) }));
  }

  /** Write the game's log to disk from its first record (D-116). A disk problem must not stop the game. */
  private beginLog(rt: GameRuntime, game: InstalledGame, settings: Record<string, unknown>, aiOptions: Record<number, Record<string, unknown>>) {
    const meta = baseMeta({ id: logId(game.manifest.id), game, tableName: this.config.tableName, tableId: this.tableId, simulation: false, startedAt: this.gameStartedAt, settings, players: this.playersMeta(aiOptions), developer: { allowNoLocalPlayer: this.allowNoLocalPlayer } });
    try {
      const log = this.logs.begin(meta);
      for (const r of rt.log) log.append(r);
      rt.onRecord((r) => {
        try {
          log.append(r);
        } catch (err) {
          console.error(`[table] could not write the game log: ${(err as Error).message}`);
        }
      });
      this.runningLog = { log, meta };
    } catch (err) {
      console.error(`[table] could not start the game log: ${(err as Error).message}`);
      // Still packed at the end from memory, just not protected against a stop in the middle.
      this.runningLog = { log: { id: meta.id, dir: "", close() {} } as unknown as RunningLog, meta };
    }
  }

  /**
   * Games the table stopped in the middle of (switched off, crashed): close their logs as "interrupted", with the
   * state rebuilt by replay when the game is installed, and queue them for the service (D-116). Run at start.
   */
  async recoverInterrupted(): Promise<string[]> {
    const ids: string[] = [];
    for (const { dir, meta, records } of await this.logs.interrupted()) {
      const game = this.games.get(meta.gameId);
      const same = game && game.manifest.version === meta.gameVersion ? game : undefined;
      const rebuilt = records[0]?.t === "start" ? rebuild(same, records) : null;
      const lastAt = records.at(-1)?.at;
      const endedAt = typeof lastAt === "number" && lastAt > 1e12 ? lastAt : Date.parse(meta.startedAt) || Date.now();
      const log: LogRecord[] = [...records, { t: "end", at: endedAt, reason: "interrupted", summary: null, stateHash: rebuilt?.hash ?? null }];
      const full = {
        ...meta,
        endedAt: new Date(endedAt).toISOString(),
        durationMs: Math.max(0, endedAt - Date.parse(meta.startedAt)),
        endReason: "interrupted",
        result: "The table stopped during the game.",
        counts: countRecords(records),
        verify: { checked: 0, ok: 0, failed: [], skipped: rebuilt ? "interrupted: the state was rebuilt by replay, there is no end state to compare with" : "interrupted, and the game could not be replayed on this table" },
      };
      try {
        await this.logs.saveInterrupted(dir, full, log, rebuilt?.state, movesFor(same, log));
        ids.push(meta.id);
        this.emit("logSaved", meta.id);
      } catch (err) {
        console.error(`[table] could not close the log of interrupted game ${meta.id}: ${(err as Error).message}`);
      }
    }
    return ids;
  }

  /** A log was packed outside a game (a simulation): announce it for upload. */
  logSaved(id: string) {
    this.emit("logSaved", id);
  }

  /** Wait for game logs that are still being written. */
  async flush() {
    await Promise.allSettled([...this.pendingSaves]);
  }

  shutdown() {
    this.closed = true;
    this.runningLog?.log.close();
    clearInterval(this.joinTimer);
    this.stopAllAi(true);
    for (const p of this.players.values()) if (p.graceTimer) clearTimeout(p.graceTimer);
    this.runtime?.clearAllTimers();
  }
}

interface AiMoveState {
  seat: number;
  timer?: NodeJS.Timeout;
  controller?: AbortController;
  startedAt: number;
  deadline: number;
  showTimer?: NodeJS.Timeout;
  overdueTimer?: NodeJS.Timeout;
  /** Shown as thinking on the board (`aiThinking`). */
  shown: boolean;
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
