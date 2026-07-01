// A tiny seeded PRNG shared by the deterministic selection paths (diversify + night-vibe
// scheduling). `workerd` forbids nothing here, but the meal-plan proposal must be
// *reproducible* — the same inputs and seed yield the same week, and "give me another"
// is a seed bump — so these paths never touch `Math.random` (non-deterministic, and used
// elsewhere in the repo only for throwaway ids). One function, no global state.

/**
 * mulberry32 — a small, fast seeded PRNG. Deterministic given the seed; returns a closure
 * producing floats in [0, 1). Seed is coerced to a uint32.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
