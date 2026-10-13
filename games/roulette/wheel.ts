// European single-zero roulette: wheel order, colors, bet types and payouts. Shared by rules and tests.

/** Pocket order clockwise on a European wheel, starting at zero. */
export const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];

export const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export type Color = "red" | "black" | "green";
export const colorOf = (n: number): Color => (n === 0 ? "green" : RED.has(n) ? "red" : "black");

export type BetType = "straight" | "red" | "black" | "odd" | "even" | "low" | "high" | "dozen" | "column";

export interface Bet {
  type: BetType;
  target?: number; // straight: 0–36, dozen: 1–3, column: 1–3
  amount: number;
}

/** Winnings multiple (paid on top of the returned stake). */
export const PAYOUT: Record<BetType, number> = {
  straight: 35,
  red: 1,
  black: 1,
  odd: 1,
  even: 1,
  low: 1,
  high: 1,
  dozen: 2,
  column: 2,
};

export function validBet(type: unknown, target: unknown): string | null {
  if (typeof type !== "string" || !(type in PAYOUT)) return "unknown bet type";
  if (type === "straight") return Number.isInteger(target) && (target as number) >= 0 && (target as number) <= 36 ? null : "straight bets need a number 0–36";
  if (type === "dozen" || type === "column") return Number.isInteger(target) && (target as number) >= 1 && (target as number) <= 3 ? null : `${type} bets need 1, 2 or 3`;
  return target === undefined || target === null ? null : "this bet takes no number";
}

export function wins(bet: Pick<Bet, "type" | "target">, n: number): boolean {
  switch (bet.type) {
    case "straight":
      return bet.target === n;
    case "red":
      return colorOf(n) === "red";
    case "black":
      return colorOf(n) === "black";
    case "odd":
      return n !== 0 && n % 2 === 1;
    case "even":
      return n !== 0 && n % 2 === 0;
    case "low":
      return n >= 1 && n <= 18;
    case "high":
      return n >= 19 && n <= 36;
    case "dozen":
      return n !== 0 && Math.ceil(n / 12) === bet.target;
    case "column":
      return n !== 0 && ((n - 1) % 3) + 1 === bet.target;
  }
}

/** Total returned to the player for a bet (stake plus winnings, or 0). */
export const returnFor = (bet: Bet, n: number) => (wins(bet, n) ? bet.amount * (PAYOUT[bet.type] + 1) : 0);

export const betKey = (b: Pick<Bet, "type" | "target">) => (b.target === undefined || b.target === null ? b.type : `${b.type}:${b.target}`);
