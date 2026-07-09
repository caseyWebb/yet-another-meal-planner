import { describe, it, expect } from "vitest";
import { planQueueConvergence, filterCandidates, type PendingVibeProposal } from "../src/night-vibe-dedupe.js";
import type { DerivedArchetype } from "../src/night-vibe-derive.js";

// Synthetic unit vectors on distinct axes: two phrases on the same axis are cosine 1.0 (≥ 0.85 →
// near-duplicates); phrases on different axes are cosine 0 (< 0.85 → distinct). Enough to pin the
// sweep's decisions without real 768-dim embeddings.
const DIM = 8;
function axis(i: number): number[] {
  const v = new Array<number>(DIM).fill(0);
  v[i] = 1;
  return v;
}
function pending(id: string, vibe: string, created_at: string): PendingVibeProposal {
  return { id, vibe, created_at };
}
function candidate(vibe: string): DerivedArchetype {
  return { id: vibe, vibe, cadence_days: null, evidence: { member_slugs: [], size: 0 } };
}

describe("planQueueConvergence", () => {
  it("supersedes a pending proposal covered by a palette vibe", () => {
    const p = [pending("p1", "a spicy seafood dinner", "2026-07-01T00:00:00Z")];
    const vecOf = new Map([["a spicy seafood dinner", axis(0)]]);
    const plan = planQueueConvergence(p, { paletteVecs: [axis(0)], rejectedVecs: [] }, vecOf);
    expect(plan.superseded).toEqual([{ id: "p1", coveredBy: "palette" }]);
    expect(plan.representatives).toEqual([]);
  });

  it("supersedes a pending proposal covered by a rejected proposal (not palette)", () => {
    const p = [pending("p1", "a fiery seafood skillet", "2026-07-01T00:00:00Z")];
    const vecOf = new Map([["a fiery seafood skillet", axis(6)]]);
    const plan = planQueueConvergence(p, { paletteVecs: [axis(0)], rejectedVecs: [axis(6)] }, vecOf);
    expect(plan.superseded).toEqual([{ id: "p1", coveredBy: "rejected" }]);
  });

  it("collapses a group onto the earliest-created representative (id tiebreak)", () => {
    const p = [
      pending("b", "a spicy comfort food night", "2026-07-03T00:00:00Z"),
      pending("a", "a cozy comfort food dinner", "2026-07-01T00:00:00Z"),
      pending("c", "a hearty comfort food plate", "2026-07-01T00:00:00Z"), // ties a on created_at
    ];
    const vecOf = new Map([
      ["a spicy comfort food night", axis(1)],
      ["a cozy comfort food dinner", axis(1)],
      ["a hearty comfort food plate", axis(1)],
    ]);
    const plan = planQueueConvergence(p, { paletteVecs: [], rejectedVecs: [] }, vecOf);
    // earliest created_at wins; "a" and "c" tie on time → lowest id ("a") is the representative.
    expect(plan.representatives).toEqual([{ id: "a", vibe: "a cozy comfort food dinner" }]);
    expect(plan.superseded.map((s) => s.id).sort()).toEqual(["b", "c"]);
    for (const s of plan.superseded) expect(s.coveredBy).toBe("a");
  });

  it("is idempotent — a rerun over the survivors supersedes nothing", () => {
    const p = [
      pending("a", "a cozy comfort food dinner", "2026-07-01T00:00:00Z"),
      pending("d", "a quick vegetable stir fry", "2026-07-02T00:00:00Z"),
    ];
    const vecOf = new Map([
      ["a cozy comfort food dinner", axis(1)],
      ["a quick vegetable stir fry", axis(2)],
    ]);
    const plan = planQueueConvergence(p, { paletteVecs: [], rejectedVecs: [] }, vecOf);
    expect(plan.superseded).toEqual([]);
    expect(plan.representatives).toHaveLength(2);
  });

  it("only ever names ids present in the pending input (pending-only by contract)", () => {
    const p = [
      pending("p1", "a", "2026-07-01T00:00:00Z"),
      pending("p2", "a", "2026-07-02T00:00:00Z"),
      pending("p3", "b", "2026-07-03T00:00:00Z"),
    ];
    const vecOf = new Map([
      ["a", axis(0)],
      ["b", axis(1)],
    ]);
    const plan = planQueueConvergence(p, { paletteVecs: [], rejectedVecs: [] }, vecOf);
    const ids = new Set(["p1", "p2", "p3"]);
    for (const s of plan.superseded) expect(ids.has(s.id)).toBe(true);
    for (const r of plan.representatives) expect(ids.has(r.id)).toBe(true);
  });

  it("keeps a pending proposal whose phrase has no vector rather than collapsing it", () => {
    const p = [pending("p1", "no vector here", "2026-07-01T00:00:00Z")];
    const plan = planQueueConvergence(p, { paletteVecs: [axis(0)], rejectedVecs: [] }, new Map());
    expect(plan.superseded).toEqual([]);
    expect(plan.representatives).toEqual([{ id: "p1", vibe: "no vector here" }]);
  });

  // A production-shaped fixture distilled from design.md's casey rows: 10 pending → 4 reps.
  it("converges the casey fixture (10 pending → 4 representatives)", () => {
    const rows: [string, string, number][] = [
      ["a-spicy-seafood-dinner", "a spicy seafood dinner", 0], // → palette
      ["a-quick-seafood-dinner", "a quick seafood dinner", 0], // → palette
      ["a-hearty-bean-and-cornbread-dinner", "a hearty bean and cornbread dinner", 5], // → palette
      ["a-cozy-comfort-food-dinner", "a cozy comfort food dinner", 1], // REP (earliest comfort)
      ["a-spicy-comfort-food-night", "a spicy comfort food night", 1], // → rep comfort
      ["a-quick-vegetable-stir-fry", "a quick vegetable stir fry", 2], // REP (earliest stir-fry)
      ["a-quick-vegetarian-stir-fry", "a quick vegetarian stir fry", 2], // → rep stir-fry
      ["a-flavorful-vegetarian-bowl", "a flavorful vegetarian bowl", 3], // REP (isolated)
      ["a-cozy-homemade-pizza-night", "a cozy homemade pizza night", 4], // REP (isolated)
      ["a-spicy-seafood-stir-fry", "a spicy seafood stir fry", 6], // → rejected
    ];
    // created_at: representatives are enqueued earliest within their group.
    const createdAt: Record<string, string> = {
      "a-cozy-comfort-food-dinner": "2026-07-01T00:00:00Z",
      "a-spicy-comfort-food-night": "2026-07-04T00:00:00Z",
      "a-quick-vegetable-stir-fry": "2026-07-02T00:00:00Z",
      "a-quick-vegetarian-stir-fry": "2026-07-05T00:00:00Z",
    };
    const p = rows.map(([id, vibe]) => pending(id, vibe, createdAt[id] ?? "2026-07-03T00:00:00Z"));
    const vecOf = new Map(rows.map(([, vibe, dim]) => [vibe, axis(dim)] as const));
    const plan = planQueueConvergence(
      p,
      { paletteVecs: [axis(0), axis(5)], rejectedVecs: [axis(6)] },
      vecOf,
    );
    expect(plan.representatives.map((r) => r.id).sort()).toEqual([
      "a-cozy-comfort-food-dinner",
      "a-cozy-homemade-pizza-night",
      "a-flavorful-vegetarian-bowl",
      "a-quick-vegetable-stir-fry",
    ]);
    expect(plan.superseded).toHaveLength(6);
    const coveredBy = Object.fromEntries(plan.superseded.map((s) => [s.id, s.coveredBy]));
    expect(coveredBy["a-spicy-seafood-dinner"]).toBe("palette");
    expect(coveredBy["a-quick-seafood-dinner"]).toBe("palette");
    expect(coveredBy["a-hearty-bean-and-cornbread-dinner"]).toBe("palette");
    expect(coveredBy["a-spicy-seafood-stir-fry"]).toBe("rejected");
    expect(coveredBy["a-spicy-comfort-food-night"]).toBe("a-cozy-comfort-food-dinner");
    expect(coveredBy["a-quick-vegetarian-stir-fry"]).toBe("a-quick-vegetable-stir-fry");
  });
});

describe("filterCandidates", () => {
  it("drops candidates covered by a basis vector (palette/pending/rejected), keeps orthogonal ones", () => {
    const cands = [candidate("near palette"), candidate("orthogonal one")];
    const vecOf = new Map([
      ["near palette", axis(0)],
      ["orthogonal one", axis(3)],
    ]);
    const kept = filterCandidates(cands, [axis(0), axis(1)], vecOf);
    expect(kept.map((c) => c.vibe)).toEqual(["orthogonal one"]);
  });

  it("drops the second of two near-identical candidates (first-kept-wins)", () => {
    const cands = [candidate("stir fry one"), candidate("stir fry two"), candidate("a bowl")];
    const vecOf = new Map([
      ["stir fry one", axis(2)],
      ["stir fry two", axis(2)],
      ["a bowl", axis(3)],
    ]);
    const kept = filterCandidates(cands, [], vecOf);
    expect(kept.map((c) => c.vibe)).toEqual(["stir fry one", "a bowl"]);
  });

  it("keeps a candidate whose phrase has no vector", () => {
    const cands = [candidate("no vector")];
    const kept = filterCandidates(cands, [axis(0)], new Map());
    expect(kept).toHaveLength(1);
  });

  it("respects the threshold boundary (≥ supersedes, < keeps)", () => {
    // Two vectors at a known cosine: [1,0] vs [cosθ, sinθ]. Pick θ so cosine = 0.86 (≥ 0.85 drops)
    // and 0.84 (< 0.85 keeps).
    const base = [1, 0, 0, 0, 0, 0, 0, 0];
    const at = (cos: number): number[] => [cos, Math.sqrt(1 - cos * cos), 0, 0, 0, 0, 0, 0];
    const drop = filterCandidates([candidate("hot")], [base], new Map([["hot", at(0.86)]]));
    expect(drop).toHaveLength(0);
    const keep = filterCandidates([candidate("warm")], [base], new Map([["warm", at(0.84)]]));
    expect(keep).toHaveLength(1);
  });
});
