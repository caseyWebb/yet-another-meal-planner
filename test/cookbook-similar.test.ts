import { describe, it, expect } from "vitest";
import { nearestNeighbors, SIMILAR_K, SIMILAR_FLOOR } from "../src/cookbook-similar.js";

/** Build an embedding map from a plain object (slug → vector). */
const map = (entries: Record<string, number[]>) => new Map(Object.entries(entries));

describe("nearestNeighbors", () => {
  // base=[1,0]: a≈0.981, b≈0.707, c=0 (orthogonal)
  const m = map({ base: [1, 0], a: [1, 0.2], b: [1, 1], c: [0, 1] });

  it("orders neighbors by descending cosine similarity", () => {
    expect(nearestNeighbors("base", m, { k: 5, floor: 0 })).toEqual(["a", "b", "c"]);
  });

  it("excludes the viewed recipe from its own neighbors", () => {
    expect(nearestNeighbors("base", m, { k: 5, floor: 0 })).not.toContain("base");
  });

  it("drops neighbors below the floor", () => {
    // floor 0.5 keeps a (0.98) and b (0.71); drops c (cosine 0)
    expect(nearestNeighbors("base", m, { k: 5, floor: 0.5 })).toEqual(["a", "b"]);
  });

  it("caps the result at k", () => {
    expect(nearestNeighbors("base", m, { k: 1, floor: 0 })).toEqual(["a"]);
  });

  it("breaks similarity ties on slug, deterministically", () => {
    // apple & zebra share a vector → equal cosine → ordered by slug (apple < zebra)
    const t = map({ base: [1, 0], zebra: [1, 1], apple: [1, 1] });
    expect(nearestNeighbors("base", t, { k: 5, floor: 0 })).toEqual(["apple", "zebra"]);
  });

  it("returns [] when the viewed recipe has no vector (not yet reconciled)", () => {
    expect(nearestNeighbors("ghost", m, { k: 5, floor: 0 })).toEqual([]);
  });

  it("returns [] when nothing clears the floor", () => {
    const far = map({ base: [1, 0], ortho: [0, 1] }); // cosine 0
    expect(nearestNeighbors("base", far, { k: 5, floor: 0.5 })).toEqual([]);
  });

  it("applies the shipped default floor + k when params are omitted", () => {
    // near ≈ 0.999 clears SIMILAR_FLOOR; far (cosine 0) does not
    const m2 = map({ base: [1, 0], near: [1, 0.05], far: [0, 1] });
    expect(nearestNeighbors("base", m2)).toEqual(["near"]);
  });

  it("ships sane default constants", () => {
    expect(SIMILAR_K).toBeGreaterThan(0);
    expect(SIMILAR_FLOOR).toBeGreaterThan(0);
    expect(SIMILAR_FLOOR).toBeLessThan(1);
  });
});
