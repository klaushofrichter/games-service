// The random part of a game's or an AI's context, from a seeded generator: the same in the host and in the AI worker
// thread, so an AI's moves replay alike in both.
export function randomContext(rng: () => number) {
  return { random: rng, randomInt: (min: number, max: number) => min + Math.floor(rng() * (max - min + 1)) };
}
