// Standard 52-card deck helpers for card games: deck, seeded shuffle, poker hand evaluation.
// Cards are two-character strings: rank (2–9, T, J, Q, K, A) + suit (c, d, h, s), e.g. "As", "Td".

export const RANKS = "23456789TJQKA";
export const SUITS = "cdhs";
export type Card = string;

export const rankOf = (c: Card) => RANKS.indexOf(c[0]) + 2; // 2..14
export const suitOf = (c: Card) => c[1];

export function newDeck(): Card[] {
  const d: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) d.push(r + s);
  return d;
}

/** Fisher–Yates shuffle with the game's seeded RNG, so shuffles replay exactly. */
export function shuffle<T>(items: T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const HAND_NAMES = ["High card", "Pair", "Two pair", "Three of a kind", "Straight", "Flush", "Full house", "Four of a kind", "Straight flush"];

export interface HandValue {
  /** [category, tie-breakers…]; compare lexicographically. Category 0 = high card … 8 = straight flush. */
  score: number[];
  name: string;
  cards: Card[]; // the best five
}

function straightHigh(ranks: number[]): number {
  const set = new Set(ranks);
  for (let hi = 14; hi >= 5; hi--) {
    let ok = true;
    for (let k = 0; k < 5; k++) {
      const r = hi - k === 1 ? 14 : hi - k; // the wheel: A-2-3-4-5
      if (!set.has(r)) {
        ok = false;
        break;
      }
    }
    if (ok) return hi;
  }
  return 0;
}

export function evaluate5(cards: Card[]): number[] {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]));
  const sHigh = new Set(ranks).size === 5 ? straightHigh(ranks) : 0;
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  // ranks grouped by count, then by rank, highest first
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const byGroup = groups.map((g) => g[0]);
  const shape = groups.map((g) => g[1]).join("");
  if (flush && sHigh) return [8, sHigh];
  if (shape === "41") return [7, ...byGroup];
  if (shape === "32") return [6, ...byGroup];
  if (flush) return [5, ...ranks];
  if (sHigh) return [4, sHigh];
  if (shape === "311") return [3, ...byGroup];
  if (shape === "221") return [2, ...byGroup];
  if (shape === "2111") return [1, ...byGroup];
  return [0, ...ranks];
}

export function compareScores(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Best five-card hand out of 5–7 cards. */
export function bestHand(cards: Card[]): HandValue {
  let best: number[] | null = null;
  let bestCards: Card[] = [];
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            const s = evaluate5(five);
            if (!best || compareScores(s, best) > 0) {
              best = s;
              bestCards = five;
            }
          }
  return { score: best!, name: HAND_NAMES[best![0]], cards: bestCards };
}
