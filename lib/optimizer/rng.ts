/**
 * Seeded pseudo-random numbers (mulberry32). The optimizer never calls
 * Math.random, so the same seed and the same inputs give the same set.
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [0, max). */
export function randomInt(rng: Rng, max: number): number {
  return Math.floor(rng() * max);
}

/** Fisher-Yates shuffle in place. */
export function shuffle(items: Int32Array, rng: Rng): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    const held = items[i];
    items[i] = items[j];
    items[j] = held;
  }
}
