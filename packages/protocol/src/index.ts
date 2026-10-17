// Shared protocol for the Game Table: envelope, manifest schema, lobby types.
import { z } from "zod";

export const PROTOCOL_VERSION = 1;

// ---------- Envelope ----------

export type Channel = "system" | "lobby" | "game";

export interface Envelope<P = unknown> {
  v: number;
  ch: Channel;
  type: string; // e.g. "hello", "welcome", "state", "intent", "view", "error"
  seq?: number;
  stateRev?: number;
  payload?: P;
}

export function envelope<P>(ch: Channel, type: string, payload?: P, extra: Partial<Envelope> = {}): Envelope<P> {
  return { ...extra, v: PROTOCOL_VERSION, ch, type, payload } as Envelope<P>;
}

// ---------- Board geometry ----------

export type Edge = "north" | "east" | "south" | "west";
export const EDGES_CLOCKWISE: Edge[] = ["south", "west", "north", "east"];
export type SeatLayout = 2 | 4 | 6 | 8;

/** Edge of every seat for a layout. Seats are numbered South first, then North, then East, then West. */
export function seatEdges(layout: SeatLayout): Edge[] {
  switch (layout) {
    case 2:
      return ["south", "north"];
    case 4:
      // One on each side, clockwise from south (D-084).
      return ["south", "west", "north", "east"];
    case 6:
      // Two on each long side and one at each end (D-079): the usual six-seat table.
      return ["south", "south", "north", "north", "east", "west"];
    case 8:
      return ["south", "south", "south", "north", "north", "north", "east", "west"];
  }
}

export function rotateEdge(edge: Edge, degrees: 90 | 180): Edge {
  const i = EDGES_CLOCKWISE.indexOf(edge);
  return EDGES_CLOCKWISE[(i + degrees / 90) % 4];
}

// ---------- Manifest ----------

const settingSchema = z.object({
  key: z.string(),
  type: z.enum(["int", "number", "string", "bool", "enum"]),
  min: z.number().optional(),
  max: z.number().optional(),
  values: z.array(z.string()).optional(),
  default: z.unknown().optional(),
  label: z.string().optional(),
  /** How far one tap on − or + moves a number in the board's settings (D-090). */
  step: z.number().positive().optional(),
});

export const manifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  version: z.string(),
  sdk: z.string(),
  description: z.string().optional(),
  players: z.union([
    z
      .object({ min: z.number().int().min(1).max(8), max: z.number().int().min(1).max(8) })
      .refine((p) => p.min <= p.max, "players.min must not be above players.max"),
    z.array(z.number().int().min(1).max(8)).nonempty(),
  ]),
  turnModel: z.enum(["sequential", "simultaneous"]),
  seatLayouts: z.array(z.union([z.literal(2), z.literal(4), z.literal(6), z.literal(8)])).nonempty(),
  /** Edges of the table the game can seat players on. Not about which way the board faces: games draw the same
   *  either way, and the lobby faces whichever edge the table is turned to (D-079). */
  edges: z.array(z.enum(["north", "east", "south", "west"])).refine(
    (e) => e.includes("north") && e.includes("south"),
    "every game must support north and south",
  ),
  seatConstraints: z.unknown().nullable().optional(),
  dynamicPlayers: z.boolean().default(false),
  saveGame: z.boolean().default(false),
  settings: z.array(settingSchema).default([]),
  ai: z
    .object({
      supported: z.boolean(),
      options: z.array(settingSchema).default([]),
      hostConfig: z.array(z.unknown()).default([]),
      /**
       * Time an AI player may think about one move before the game pauses and the board offers "Play now" (D-112).
       * Only an AI that answers asynchronously can take that long; a synchronous one answers at once.
       */
      timeoutSeconds: z.number().int().min(1).max(600).default(20),
      /** Run the AI in a worker thread, so a long search never blocks the table (D-112). */
      worker: z.boolean().default(false),
    })
    .default({ supported: false, options: [], hostConfig: [], timeoutSeconds: 20, worker: false }),
  simulation: z.object({ supported: z.boolean(), headless: z.boolean() }).default({ supported: false, headless: false }),
  remoteBoardControl: z.boolean().default(true),
  /**
   * Intents a player may also send by touching the board (D-102), e.g. Pachisi's "move": tapping a token on the table's
   * screen instead of the phone. The table's board may send them for players sitting at the table, a remote board
   * only for its own player. Anything else still comes from the phones only.
   */
  boardIntents: z.array(z.string().regex(/^[A-Za-z][\w-]{0,39}$/)).max(10).default([]),
  lobbyButton: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).default("bottom-right"),
  deck: z.object({ minWidth: z.number().optional(), orientation: z.string().optional() }).optional(),
  permissions: z.array(z.string()).default([]),
  /**
   * The Game Viewer's extra columns (D-120), filled from the `columns` of the game's `describe`. Besides these it always
   * shows the move number, time, player and the step's text.
   */
  viewer: z
    .object({ columns: z.array(z.object({ key: z.string().regex(/^[A-Za-z][\w-]{0,30}$/), label: z.string().max(24) })).max(4).default([]) })
    .default({ columns: [] }),
  /** Test games are hidden on the board unless the table is configured to show them. */
  test: z.boolean().default(false),
});

export type Manifest = z.infer<typeof manifestSchema>;

export function allowedPlayerCounts(m: Manifest): number[] {
  if (Array.isArray(m.players)) return [...m.players];
  const out: number[] = [];
  for (let n = m.players.min; n <= m.players.max; n++) out.push(n);
  return out;
}

// ---------- Lobby ----------

export type Phase = "idle" | "loading" | "ready" | "active" | "paused" | "terminating" | "finished";

/**
 * Player colours (D-106): one per player, chosen in the board's settings and the same in every game. By default a player
 * takes their seat's colour, `PLAYER_COLORS[seat % 8]`. Distinct for common colour-vision deficiencies on the felt.
 */
export const PLAYER_COLORS = ["#e8b04a", "#5fb7e8", "#e8735f", "#7fd18b", "#c38be8", "#dde3ea", "#5fe0c8", "#e88fbf"] as const;

export interface PlayerInfo {
  id: string;
  name: string;
  kind: "human" | "ai";
  location: "local" | "remote";
  seat: number | null;
  connected: boolean;
  ready: boolean;
  /** AI players: options chosen on the board (e.g. play style); manifest defaults fill the rest at start. */
  aiOptions?: Record<string, unknown>;
  /** This player's colour while seated (D-106): their own choice, else their seat's; null without a seat. */
  color?: string | null;
}

export interface GameSummary {
  text: string;
  highlights: Record<string, unknown>;
  /** Optional statistics the result screen shows as a table (D-091), e.g. per player: correct guesses, heads %. */
  table?: { columns: string[]; rows: (string | number)[][] };
}

export interface LobbyState {
  stateRev: number;
  tableName: string;
  layout: SeatLayout;
  seatEdges: Edge[];
  frontEdge: Edge;
  players: PlayerInfo[];
  phase: Phase;
  game: {
    id: string;
    name: string;
    version: string;
    settings: Record<string, unknown>;
    lobbyButton: string;
    edges: Edge[];
    /** Player counts the game accepts. */
    players: number[];
    /** What the game still needs before it can start, in plain words (empty when only Ready is missing). */
    needs: string[];
    /**
     * Display choices made in the board's settings for this game (D-088), e.g. Pachisi's player colours.
     * Kept per game on this table, shared with the board and every deck; never part of the game's rules or log.
     */
    prefs: Record<string, unknown>;
    /** Where the game's rules for players are (`/games/<id>/how-to-play.md`), or null if it ships none (D-099). */
    howToPlay: string | null;
    /** The chosen settings as the rules page lists them: label and value, in the manifest's order. */
    settingsShown: { label: string; value: unknown }[];
  } | null;
  /** Seat layouts that may be chosen now: the selected game's, or, with none selected, any visible game's. */
  layouts: SeatLayout[];
  summary: GameSummary | null;
  joinUrl: string;
  cloud: CloudStatus;
  /**
   * Why the running game is paused and what the board may offer. "ai": an AI player is past its time for a move
   * (D-112); the board offers "Play now" for it (`ai`), and the game goes on by itself if the AI answers first.
   */
  pause: {
    reason: "cloud" | "ai" | "player";
    since: number;
    canSave: boolean;
    ai?: { playerId: string; name: string; seat: number; since: number };
    /** "player" (D-119): the players the game can't go on without, whose phones are away, and the game's reason. */
    players?: { playerId: string; name: string; seat: number; since: number; text: string }[];
  } | null;
  /**
   * During a game (D-119): players the game can't go on without, with the game's reason. Removing one ends the game;
   * the board says so before it asks.
   */
  needed: Record<string, string>;
  /**
   * Empty seats whose player left during the game, with that player's colour (D-125), seat → colour: a game that goes
   * on with the seat (Loopy's AI takes it over) keeps showing it in the same colour. Kept until the next game starts
   * or the table returns to the lobby; `playerColor(info, seat)` in the board kit uses it.
   */
  seatColors: Record<number, string>;
  /**
   * AI players thinking about a move for more than a moment (D-112): their seat, since when, and the time they may
   * take (host clock, `deadline`). Games may show it; the board shows "Play now" once a deadline has passed.
   */
  aiThinking: { playerId: string; seat: number; since: number; deadline: number }[];
  /** Remote play: whether remote boards may act, and how many remote players fit. */
  remote: { boardControl: boolean; maxPlayers: number; players: number };
  /** The table's display choices from the board's settings (D-092), followed by every board, remote ones too. */
  display: { sound: boolean };
  /**
   * The developer setting (D-118): games without a player at the table. `protectedPlayer`: the one player the board
   * may not remove while it is off (the last one at the table, while a game is chosen or running).
   */
  developer: { allowNoLocalPlayer: boolean; protectedPlayer: string | null };
}

export interface CloudStatus {
  status: "disabled" | "pending" | "online" | "offline" | "revoked";
  pairingCode?: string;
  /**
   * The table's pre-approved access code (D-113), if it has one: never the code, only its first two characters, where
   * it came from (TABLE_CODE/--code at start, or typed on the board) and what the service said about it ("waiting"
   * until it has answered).
   */
  code?: AccessCodeStatus | null;
}

export interface AccessCodeStatus {
  hint: string;
  source: "start" | "board";
  status: "waiting" | "accepted" | "unknown" | "expired" | "revoked" | "in-use";
  /**
   * While accepted: when the code's validity ends, on the table's clock (ms), or null for forever; absent while the
   * service has not said. Past it, the table keeps working (validity counts only for the first use) and the board
   * shows the code as expired.
   */
  expiresAt?: number | null;
}

export interface GameAvailability {
  id: string;
  name: string;
  version: string;
  description?: string;
  /** The game can be chosen now (the table then adapts its seats to it). */
  selectable: boolean;
  /** Why it cannot be chosen now. */
  reasons: string[];
  /** What it would still need before it could start, in plain words (e.g. "needs 2 more players"). */
  needs: string[];
  seatLayouts: SeatLayout[];
  ai: boolean;
  simulation: boolean;
  players: number[];
  settings: Manifest["settings"];
  aiOptions: Manifest["ai"]["options"];
  /** The game came from an extra-game repository (D-097), not with the table. */
  extra?: boolean;
  /** Where the game's rules for players are, or null (D-099). */
  howToPlay: string | null;
}
