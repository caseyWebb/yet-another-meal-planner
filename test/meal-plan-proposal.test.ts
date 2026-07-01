import { describe, it, expect } from "vitest";
import { assembleProposal, type ProposalCtx } from "../src/meal-plan-proposal.js";
import type { DiversifyCandidate } from "../src/diversify.js";
import type { WeekSlot } from "../src/night-vibe-schedule.js";

function cand(slug: string, protein: string | null, cuisine: string | null, embedding: number[], score = 0.8): DiversifyCandidate {
  return { slug, title: slug, protein, cuisine, course: ["main"], time_total: 30, score, embedding };
}
function slot(id: string, reason: WeekSlot["reason"] = "sampled"): WeekSlot {
  return { id, reason, debt: 0, weight: 1 };
}
function embMap(...cs: DiversifyCandidate[]): Map<string, number[]> {
  return new Map(cs.map((c) => [c.slug, c.embedding]));
}

describe("assembleProposal", () => {
  it("fills slots and composes sides / waste / meal-prep / novelty / why", () => {
    const soup = cand("chicken-soup", "chicken", "american", [1, 0, 0]);
    const pasta = cand("beef-ragu", "beef", "italian", [0, 1, 0]);
    const ctx: ProposalCtx = {
      slots: [slot("soup"), slot("pasta", "pinned")],
      poolByVibe: new Map([
        ["soup", [soup]],
        ["pasta", [pasta]],
      ]),
      frontmatterBySlug: new Map<string, Record<string, unknown>>([
        ["chicken-soup", { title: "Chicken Soup", description: "cozy", perishable_ingredients: ["cilantro"], pairs_with: ["crusty-bread"] }],
        ["beef-ragu", { title: "Beef Ragu", description: "rich", perishable_ingredients: ["basil"], meal_preppable: true, pairs_with: [] }],
        ["crusty-bread", { title: "Crusty Bread" }],
      ]),
      embeddingBySlug: embMap(soup, pasta),
      boostItems: ["cilantro"],
      lastCooked: new Map(),
      seed: 1,
    };
    const r = assembleProposal(ctx);
    expect(r.plan).toHaveLength(2);

    const s = r.plan.find((x) => x.vibe_id === "soup")!;
    expect(s.main!.slug).toBe("chicken-soup");
    expect(s.sides).toEqual([{ slug: "crusty-bread", title: "Crusty Bread" }]);
    expect(s.flags.waste).toEqual(["cilantro"]); // no other main uses cilantro
    expect(s.flags.novel).toBe(true); // not in lastCooked
    expect(s.uses_perishables).toEqual(["cilantro"]);
    expect(s.why).toContain("uses your cilantro");

    const p = r.plan.find((x) => x.vibe_id === "pasta")!;
    expect(p.flags.no_corpus_side).toBe(true); // empty pairs_with
    expect(p.flags.meal_prep).toBe(true);
    expect(r.variety.distinct_proteins).toBe(2);
    expect(r.variety.distinct_cuisines).toBe(2);
  });

  it("enforces the protein cap ACROSS the week (empties a slot rather than repeating)", () => {
    const c1 = cand("chx1", "chicken", "american", [1, 0, 0], 0.9);
    const c2 = cand("chx2", "chicken", "american", [0, 1, 0], 0.8);
    const ctx: ProposalCtx = {
      slots: [slot("a"), slot("b")],
      poolByVibe: new Map([
        ["a", [c1]],
        ["b", [c2]],
      ]),
      frontmatterBySlug: new Map(),
      embeddingBySlug: embMap(c1, c2),
      boostItems: [],
      lastCooked: new Map(),
      seed: 1,
      params: { proteinCap: 1 },
    };
    const r = assembleProposal(ctx);
    expect(r.plan.filter((s) => s.main)).toHaveLength(1); // only one chicken allowed
    const empty = r.plan.find((s) => !s.main)!;
    expect(empty.empty_reason).toMatch(/variety caps/);
  });

  it("surfaces an explicit empty slot when the pool is empty", () => {
    const ctx: ProposalCtx = {
      slots: [slot("x")],
      poolByVibe: new Map([["x", []]]),
      frontmatterBySlug: new Map(),
      embeddingBySlug: new Map(),
      boostItems: [],
      lastCooked: new Map(),
      seed: 1,
    };
    const r = assembleProposal(ctx);
    expect(r.plan[0].main).toBeNull();
    expect(r.plan[0].empty_reason).toMatch(/no retrievable candidate/);
  });

  it("returns locked picks first and never re-picks them in a sampled slot", () => {
    const locked = cand("locked-dish", "fish", "japanese", [0, 0, 1], 1);
    const other = cand("other-dish", "beef", "italian", [1, 1, 0], 0.7);
    const ctx: ProposalCtx = {
      slots: [slot("s")],
      poolByVibe: new Map([["s", [locked, other]]]), // locked also appears in the pool
      locked: [locked],
      frontmatterBySlug: new Map(),
      embeddingBySlug: embMap(locked, other),
      boostItems: [],
      lastCooked: new Map(),
      seed: 1,
    };
    const r = assembleProposal(ctx);
    expect(r.plan[0].reason).toBe("locked");
    expect(r.plan[0].main!.slug).toBe("locked-dish");
    expect(r.plan[1].main!.slug).toBe("other-dish"); // deduped away from the locked pick
  });

  it("is deterministic for a fixed seed", () => {
    const a = cand("a", "chicken", "american", [1, 0, 0]);
    const b = cand("b", "beef", "italian", [0, 1, 0]);
    const ctx: ProposalCtx = {
      slots: [slot("x"), slot("y")],
      poolByVibe: new Map([
        ["x", [a, b]],
        ["y", [a, b]],
      ]),
      frontmatterBySlug: new Map(),
      embeddingBySlug: embMap(a, b),
      boostItems: [],
      lastCooked: new Map(),
      seed: 42,
    };
    expect(assembleProposal(ctx)).toEqual(assembleProposal(ctx));
  });
});
