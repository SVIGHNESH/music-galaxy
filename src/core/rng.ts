/** Deterministic PRNG so every device builds the exact same galaxy from a seed. */
export function createRng(seed: number) {
  let s = seed >>> 0;

  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Box-Muller, one sample per call keeps the sequence simple and reproducible.
  const gaussian = () => {
    const u = Math.max(next(), 1e-9);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };

  return { next, gaussian, range: (a: number, b: number) => a + (b - a) * next() };
}

export type Rng = ReturnType<typeof createRng>;
