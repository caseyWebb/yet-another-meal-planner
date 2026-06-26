import { describe, it, expect } from "vitest";
import { cosineSimilarity } from "../src/embedding.js";

describe("cosineSimilarity", () => {
  it("is 1 for identical direction (scale-invariant)", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
  });

  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("is -1 for opposite direction", () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1);
  });

  it("ranks a nearer vector above a farther one", () => {
    const query = [1, 1, 0];
    const near = [1, 0.9, 0.1];
    const far = [0, 0, 1];
    expect(cosineSimilarity(query, near)).toBeGreaterThan(cosineSimilarity(query, far));
  });

  it("returns 0 for a zero-magnitude vector (degenerate, no throw)", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("returns 0 on dimension mismatch (one bad row can't abort ranking)", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });
});
