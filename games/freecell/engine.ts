// FreeCell's rules and a solver, as pure functions on plain data. Used by rules.ts (the game), and by the solver for
// "only deals that can be solved" and the hint.
//
// A card is a number 0–51: rank = card >> 2 (0 = ace … 12 = king), suit = card & 3 (0 ♠, 1 ♥, 2 ♦, 3 ♣).
// A place is a number: 0–7 the columns, 8–11 the free cells, 12 the foundations (as where a card goes: its own suit's).
// A card taken back from a foundation (a house rule) comes from 12 + its suit: 12 ♠, 13 ♥, 14 ♦, 15 ♣.

export const COLUMNS = 8;
export const CELLS = 4;
export const HOME = 12;

export interface Position {
  /** The eight columns, each from the table up: the last card is the one that can be moved. */
  cols: number[][];
  /** The four free cells. */
  cells: (number | null)[];
  /** Cards on each suit's foundation (0–13). */
  home: number[];
}

/** A move of `n` cards (a run from a column; else one card). */
export interface Move {
  from: number;
  to: number;
  n: number;
}

export const rank = (c: number) => c >> 2;
export const suit = (c: number) => c & 3;
export const red = (c: number) => suit(c) === 1 || suit(c) === 2;
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["♠", "♥", "♦", "♣"];
export const cardName = (c: number) => `${RANKS[rank(c)]}${SUITS[suit(c)]}`;
export const isColumn = (p: number) => p >= 0 && p < COLUMNS;
export const isCell = (p: number) => p >= COLUMNS && p < COLUMNS + CELLS;
/** A foundation as where a card is taken from: 12 + suit. */
export const isFoundation = (p: number) => p >= HOME && p < HOME + 4;

/** `upper` may lie on `lower` in a column: one rank lower, the other colour. */
export const stacks = (lower: number, upper: number) => rank(upper) === rank(lower) - 1 && red(upper) !== red(lower);

export function copy(p: Position): Position {
  return { cols: p.cols.map((c) => c.slice()), cells: p.cells.slice(), home: p.home.slice() };
}

/** A deal by its number: the same number is always the same deal. */
export function deal(n: number): Position {
  // mulberry32: small, and the same everywhere
  let a = (n >>> 0) + 0x9e3779b9;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  const cols: number[][] = Array.from({ length: COLUMNS }, () => []);
  deck.forEach((c, i) => cols[i % COLUMNS]!.push(c));
  return { cols, cells: [null, null, null, null], home: [0, 0, 0, 0] };
}

export const cardsHome = (p: Position) => p.home[0]! + p.home[1]! + p.home[2]! + p.home[3]!;
export const solved = (p: Position) => cardsHome(p) === 52;

/** The longest run at a column's end that could be moved together. */
export function runLength(col: readonly number[]): number {
  let n = col.length ? 1 : 0;
  while (n < col.length && stacks(col[col.length - n - 1]!, col[col.length - n]!)) n++;
  return n;
}

/** How many cards can move at once to a column: (free cells + 1) × 2^(empty columns), the target not counted. */
export function capacity(p: Position, to: number): number {
  const cells = p.cells.filter((c) => c === null).length;
  const empty = p.cols.filter((c, i) => c.length === 0 && i !== to).length;
  return (cells + 1) * 2 ** empty;
}

/** The cards a move takes, bottom first; null if there are none to take. */
function taken(p: Position, m: Move): number[] | null {
  if (isFoundation(m.from)) {
    const s = m.from - HOME;
    return p.home[s]! > 0 && m.n === 1 ? [(p.home[s]! - 1) * 4 + s] : null;
  }
  if (isCell(m.from)) {
    const c = p.cells[m.from - COLUMNS];
    return c === null || c === undefined || m.n !== 1 ? null : [c];
  }
  if (!isColumn(m.from)) return null;
  const col = p.cols[m.from]!;
  if (!Number.isInteger(m.n) || m.n < 1 || m.n > runLength(col)) return null;
  return col.slice(col.length - m.n);
}

/** Why a move is not allowed, for the player; null if it is. */
export function refusal(p: Position, m: Move): string | null {
  const cards = taken(p, m);
  if (!cards) return "There is no such card to move";
  if (m.from === m.to) return "The card is already there";
  const first = cards[0]!;
  if (isFoundation(m.from) && !(isColumn(m.to) || isCell(m.to))) return "A card from the foundations goes to a column or a free cell";
  if (m.to === HOME) {
    if (cards.length !== 1) return "Cards go to the foundations one at a time";
    return p.home[suit(first)] === rank(first) ? null : `${cardName(first)} can't go to its foundation yet`;
  }
  if (isCell(m.to)) {
    if (cards.length !== 1) return "A free cell holds one card";
    return p.cells[m.to - COLUMNS] === null ? null : "That free cell is taken";
  }
  if (!isColumn(m.to)) return "There is no such place";
  const target = p.cols[m.to]!;
  if (target.length && !stacks(target[target.length - 1]!, first)) return `${cardName(first)} can't go on ${cardName(target[target.length - 1]!)}`;
  if (cards.length > capacity(p, m.to)) return `Not enough free cells and empty columns to move ${cards.length} cards`;
  return null;
}

/** The position after a move (which must be allowed). */
export function apply(p: Position, m: Move): Position {
  const q = copy(p);
  let cards: number[];
  if (isFoundation(m.from)) {
    const s = m.from - HOME;
    cards = [(q.home[s]! - 1) * 4 + s];
    q.home[s]!--;
  } else if (isCell(m.from)) {
    cards = [q.cells[m.from - COLUMNS] as number];
    q.cells[m.from - COLUMNS] = null;
  } else {
    const col = q.cols[m.from]!;
    cards = col.splice(col.length - m.n, m.n);
  }
  if (m.to === HOME) q.home[suit(cards[0]!)]!++;
  else if (isCell(m.to)) q.cells[m.to - COLUMNS] = cards[0]!;
  else q.cols[m.to]!.push(...cards);
  return q;
}

/** The position before a move that was made; `card` is the (first) card it moved: one taken back from the foundations has no other record. */
export function unapply(p: Position, m: Move, card: number): Position {
  const q = copy(p);
  let cards: number[];
  if (m.to === HOME) {
    q.home[suit(card)]!--;
    cards = [card];
  } else if (isCell(m.to)) {
    cards = [q.cells[m.to - COLUMNS] as number];
    q.cells[m.to - COLUMNS] = null;
  } else {
    const col = q.cols[m.to]!;
    cards = col.splice(col.length - m.n, m.n);
  }
  if (isFoundation(m.from)) q.home[m.from - HOME]!++;
  else if (isCell(m.from)) q.cells[m.from - COLUMNS] = cards[0]!;
  else q.cols[m.from]!.push(...cards);
  return q;
}

/**
 * A card that can go home without ever being missed: the next of its suit, and no card of the other colour could still
 * want to lie on it (both of the other colour's foundations are at least one below it; aces and twos always).
 */
function safeHome(p: Position, c: number): boolean {
  const r = rank(c);
  if (p.home[suit(c)] !== r) return false;
  if (r <= 1) return true;
  const others = red(c) ? [0, 3] : [1, 2];
  return p.home[others[0]!]! >= r && p.home[others[1]!]! >= r;
}

/** Every column in order from high to low (any colours): from here the game plays itself. */
export function ordered(p: Position): boolean {
  return p.cols.every((col) => col.every((c, i) => i === 0 || rank(c) < rank(col[i - 1]!)));
}

/**
 * The moves home that happen by themselves after a move: cards that are safe there, and everything once the columns
 * are in order. In the order they are made.
 */
export function autoMoves(p: Position): { moves: Move[]; cards: number[]; position: Position } {
  let q = p;
  const moves: Move[] = [];
  const cards: number[] = [];
  for (let again = true; again; ) {
    again = false;
    const all = ordered(q);
    for (let from = 0; from < COLUMNS + CELLS; from++) {
      const c = isCell(from) ? q.cells[from - COLUMNS] : q.cols[from]![q.cols[from]!.length - 1];
      if (c === null || c === undefined) continue;
      if (all ? q.home[suit(c)] === rank(c) : safeHome(q, c)) {
        const m = { from, to: HOME, n: 1 };
        q = apply(q, m);
        moves.push(m);
        cards.push(c);
        again = true;
      }
    }
  }
  return { moves, cards, position: q };
}

/** Where a tapped card goes by itself: home, else onto a column's card, else an empty column, else a free cell. */
export function bestTarget(p: Position, from: number, n: number): Move | null {
  const ok = (to: number, k: number) => refusal(p, { from, to, n: k }) === null;
  if (n === 1 && ok(HOME, 1)) return { from, to: HOME, n: 1 };
  for (let to = 0; to < COLUMNS; to++) if (to !== from && p.cols[to]!.length && ok(to, n)) return { from, to, n };
  // an empty column: not for a column's only cards (that changes nothing)
  const whole = isColumn(from) && p.cols[from]!.length === n;
  if (!whole) for (let to = 0; to < COLUMNS; to++) if (to !== from && !p.cols[to]!.length && ok(to, n)) return { from, to, n };
  if (n === 1 && isColumn(from)) for (let to = COLUMNS; to < COLUMNS + CELLS; to++) if (ok(to, 1)) return { from, to, n: 1 };
  return null;
}

/** Is any move left (other than shuffling a card between free cells)? With `takeBack`, a card from a foundation counts. */
export function anyMove(p: Position, takeBack = false): boolean {
  if (takeBack) {
    for (let s = 0; s < 4; s++) {
      if (!p.home[s]) continue;
      for (let to = 0; to < COLUMNS + CELLS; to++) if (refusal(p, { from: HOME + s, to, n: 1 }) === null) return true;
    }
  }
  for (let from = 0; from < COLUMNS + CELLS; from++) {
    const has = isCell(from) ? p.cells[from - COLUMNS] !== null : p.cols[from]!.length > 0;
    if (!has) continue;
    if (refusal(p, { from, to: HOME, n: 1 }) === null) return true;
    for (let to = 0; to < COLUMNS; to++) if (to !== from && refusal(p, { from, to, n: 1 }) === null) return true;
    if (isColumn(from)) for (let to = COLUMNS; to < COLUMNS + CELLS; to++) if (p.cells[to - COLUMNS] === null) return true;
  }
  return false;
}

// ---------- the solver ----------

/** The same for positions that differ only in the order of columns or free cells. */
function key(p: Position): string {
  const cols = p.cols.map((c) => String.fromCharCode(...c.map((x) => x + 48))).sort();
  const cells = p.cells.map((c) => (c === null ? 0 : c + 48)).sort((a, b) => a - b);
  return `${cols.join("|")}#${String.fromCharCode(...cells)}`;
}

/** How far from solved: cards not home, cards lying on a lower card of their suit (they must move first), cells in use. */
function distance(p: Position): number {
  let d = (52 - cardsHome(p)) * 4;
  for (const col of p.cols) {
    const lowest = [99, 99, 99, 99];
    for (const c of col) {
      const s = suit(c);
      // a card over a lower one of any suit that is needed soon blocks it
      let blocks = false;
      for (let t = 0; t < 4; t++) if (lowest[t]! < rank(c) && lowest[t]! - p.home[t]! < 4) blocks = true;
      if (blocks) d += 3;
      else if (lowest[s]! < rank(c)) d += 1;
      if (rank(c) < lowest[s]!) lowest[s] = rank(c);
    }
    d -= Math.min(runLength(col), 6) * 0.25; // (long runs are worth keeping)
  }
  for (const c of p.cells) if (c !== null) d += 2;
  for (const col of p.cols) if (!col.length) d -= 2;
  return d;
}

/** Single-card moves worth trying from a position (the safe moves home are made by `autoMoves`). */
function candidates(p: Position): Move[] {
  const out: Move[] = [];
  const emptyCol = p.cols.findIndex((c) => c.length === 0);
  const freeCell = p.cells.indexOf(null);
  for (let from = 0; from < COLUMNS + CELLS; from++) {
    const col = isColumn(from) ? p.cols[from]! : null;
    const c = col ? col[col.length - 1] : p.cells[from - COLUMNS];
    if (c === null || c === undefined) continue;
    if (p.home[suit(c)] === rank(c)) out.push({ from, to: HOME, n: 1 });
    for (let to = 0; to < COLUMNS; to++) {
      const t = p.cols[to]!;
      if (to !== from && t.length && stacks(t[t.length - 1]!, c)) out.push({ from, to, n: 1 });
    }
    if (emptyCol >= 0 && !(col && col.length === 1)) out.push({ from, to: emptyCol, n: 1 });
    if (col && freeCell >= 0) out.push({ from, to: COLUMNS + freeCell, n: 1 });
  }
  return out;
}

interface Node {
  p: Position;
  parent: Node | null;
  /** The moves from the parent: one chosen, then those that follow by themselves. */
  moves: Move[];
  f: number;
  depth: number;
}

/**
 * Ways found before, by exact position and budget: the rules run the search again whenever a game is replayed (the
 * check at its end, a restored game, every step in the Game Viewer), and a search can take a few hundred milliseconds.
 * The answer is a function of its input alone, so remembering it changes nothing but the time.
 */
const solvedBefore = new Map<string, Move[] | null>();
const REMEMBERED = 48;

/**
 * A way to solve a position: single-card moves in order (moves that happen by themselves included), or null if none
 * was found within `budget` positions. Not the shortest way, but a sound one. Always the same for the same position.
 */
export function solve(start: Position, budget = 60000): Move[] | null {
  const asked = `${budget}:${JSON.stringify([start.cols, start.cells])}`;
  const known = solvedBefore.get(asked);
  if (known !== undefined) return known && known.map((m) => ({ ...m }));
  const found = search(start, budget);
  if (solvedBefore.size >= REMEMBERED) solvedBefore.delete(solvedBefore.keys().next().value!);
  solvedBefore.set(asked, found);
  return found && found.map((m) => ({ ...m }));
}

function search(start: Position, budget: number): Move[] | null {
  const first = autoMoves(start);
  const root: Node = { p: first.position, parent: null, moves: first.moves, f: distance(first.position), depth: 0 };
  if (solved(root.p)) return root.moves;
  const seen = new Set<string>([key(root.p)]);
  // a binary heap on f; ties: the newer first (deeper), which keeps the search going down
  const heap: Node[] = [root];
  const push = (n: Node) => {
    let i = heap.length;
    heap.push(n);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (heap[up]!.f < n.f) break;
      heap[i] = heap[up]!;
      i = up;
    }
    heap[i] = n;
  };
  const pop = (): Node => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      for (;;) {
        let k = 2 * i + 1;
        if (k >= heap.length) break;
        if (k + 1 < heap.length && heap[k + 1]!.f < heap[k]!.f) k++;
        if (last.f <= heap[k]!.f) break;
        heap[i] = heap[k]!;
        i = k;
      }
      heap[i] = last;
    }
    return top;
  };
  for (let visited = 0; heap.length && visited < budget; visited++) {
    const node = pop();
    for (const m of candidates(node.p)) {
      const after = autoMoves(apply(node.p, m));
      const k = key(after.position);
      if (seen.has(k)) continue;
      seen.add(k);
      const child: Node = { p: after.position, parent: node, moves: [m, ...after.moves], f: distance(after.position) + node.depth * 0.05, depth: node.depth + 1 };
      if (solved(child.p)) {
        const path: Move[] = [];
        for (let n: Node | null = child; n; n = n.parent) path.unshift(...n.moves);
        return path;
      }
      push(child);
    }
  }
  return null;
}
