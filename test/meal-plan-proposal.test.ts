import { describe, it, expect } from "vitest";
import { assembleProposal, type ProposalCtx } from "../src/meal-plan-proposal.js";
import type { DiversifyCandidate } from "../src/diversify.js";
import type { WeekSlot } from "../src/night-vibe-schedule.js";

function cand(
  slug: string,
  protein: string | null,
  cuisine: string | null,
  embedding: number[],
  score = 0.8,
  perishable: string[] = [],
): DiversifyCandidate {
  return { slug, title: slug, protein, cuisine, course: ["main"], time_total: 30, score, embedding, perishable_ingredients: perishable, ingredients_key: [] };
}
function slot(id: string, reason: WeekSlot["reason"] = "sampled"): WeekSlot {
  return { id, reason, debt: 0, weight: 1 };
}
function embMap(...cs: DiversifyCandidate[]): Map<string, number[]> {
  return new Map(cs.map((c) => [c.slug, c.embedding]));
}
/** Common ctx defaults so each test only states what it exercises. */
function baseCtx(over: Partial<ProposalCtx> & Pick<ProposalCtx, "slots" | "poolByVibe">): ProposalCtx {
  return {
    frontmatterBySlug: new Map(),
    embeddingBySlug: new Map(),
    atRiskDemand: new Map(),
    lastCooked: new Map(),
    seed: 1,
    ...over,
  };
}

describe("assembleProposal", () => {
  it("fills slots and composes sides / waste / meal-prep / novelty / why", () => {
    const soup = cand("chicken-soup", "chicken", "american", [1, 0, 0], 0.8, ["cilantro"]);
    const pasta = cand("beef-ragu", "beef", "italian", [0, 1, 0], 0.8, ["basil"]);
    const ctx = baseCtx({
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
      atRiskDemand: new Map([["cilantro", 1]]),
    });
    const r = assembleProposal(ctx);
    expect(r.plan).toHaveLength(2);

    const s = r.plan.find((x) => x.vibe_id === "soup")!;
    expect(s.main!.slug).toBe("chicken-soup");
    expect(s.sides).toEqual([{ slug: "crusty-bread", title: "Crusty Bread" }]);
    expect(s.flags.waste).toEqual(["cilantro"]); // no other main uses cilantro
    expect(s.flags.novel).toBe(true); // not in lastCooked
    expect(s.uses_perishables).toEqual(["cilantro"]);
    expect(s.why).toContain("uses your cilantro (going bad)");

    const p = r.plan.find((x) => x.vibe_id === "pasta")!;
    expect(p.flags.no_corpus_side).toBe(true); // empty pairs_with
    expect(p.flags.meal_prep).toBe(true);
    expect(r.variety.distinct_proteins).toBe(2);
    expect(r.variety.distinct_cuisines).toBe(2);
    expect(r.uncovered_at_risk).toEqual([]); // cilantro was covered
  });

  it("enforces the protein cap ACROSS the week (empties a slot rather than repeating)", () => {
    const c1 = cand("chx1", "chicken", "american", [1, 0, 0], 0.9);
    const c2 = cand("chx2", "chicken", "american", [0, 1, 0], 0.8);
    const ctx = baseCtx({
      slots: [slot("a"), slot("b")],
      poolByVibe: new Map([
        ["a", [c1]],
        ["b", [c2]],
      ]),
      embeddingBySlug: embMap(c1, c2),
      params: { proteinCap: 1 },
    });
    const r = assembleProposal(ctx);
    expect(r.plan.filter((s) => s.main)).toHaveLength(1); // only one chicken allowed
    const empty = r.plan.find((s) => !s.main)!;
    expect(empty.empty_reason).toMatch(/variety caps/);
  });

  it("surfaces an explicit empty slot when the pool is empty", () => {
    const ctx = baseCtx({ slots: [slot("x")], poolByVibe: new Map([["x", []]]) });
    const r = assembleProposal(ctx);
    expect(r.plan[0].main).toBeNull();
    expect(r.plan[0].empty_reason).toMatch(/no retrievable candidate/);
  });

  it("returns locked picks first and never re-picks them in a sampled slot", () => {
    const locked = cand("locked-dish", "fish", "japanese", [0, 0, 1], 1);
    const other = cand("other-dish", "beef", "italian", [1, 1, 0], 0.7);
    const ctx = baseCtx({
      slots: [slot("s")],
      poolByVibe: new Map([["s", [locked, other]]]), // locked also appears in the pool
      locked: [locked],
      embeddingBySlug: embMap(locked, other),
    });
    const r = assembleProposal(ctx);
    expect(r.plan[0].reason).toBe("locked");
    expect(r.plan[0].main!.slug).toBe("locked-dish");
    expect(r.plan[1].main!.slug).toBe("other-dish"); // deduped away from the locked pick
  });

  it("surfaces an unresolved lock as an explicit empty locked slot and reports requestedNights", () => {
    const a = cand("a", "chicken", "american", [1, 0, 0]);
    const ctx = baseCtx({
      slots: [slot("x")],
      poolByVibe: new Map([["x", [a]]]),
      lockedUnresolved: ["Ghost-Recipe"],
      requestedNights: 2,
      embeddingBySlug: embMap(a),
    });
    const r = assembleProposal(ctx);
    expect(r.plan).toHaveLength(2); // one empty locked slot + one filled sampled slot
    const locked = r.plan.find((s) => s.reason === "locked")!;
    expect(locked.main).toBeNull();
    expect(locked.empty_reason).toMatch(/Ghost-Recipe/);
    expect(r.diagnostics.nights).toBe(2); // honors the caller's requested count
  });

  it("is deterministic for a fixed seed", () => {
    const a = cand("a", "chicken", "american", [1, 0, 0]);
    const b = cand("b", "beef", "italian", [0, 1, 0]);
    const ctx = baseCtx({
      slots: [slot("x"), slot("y")],
      poolByVibe: new Map([
        ["x", [a, b]],
        ["y", [a, b]],
      ]),
      embeddingBySlug: embMap(a, b),
      seed: 42,
    });
    expect(assembleProposal(ctx)).toEqual(assembleProposal(ctx));
  });

  // --- Holistic use-it-up (holistic-use-it-up) ------------------------------------------------

  it("covers an at-risk item WITHOUT an explicit request (always-on, from the demand)", () => {
    // Two equally-relevant candidates; only one uses the at-risk salmon. Coverage flips the slot
    // to it — no boost_ingredients needed, the demand is derived upstream from the pantry.
    const plain = cand("veg-bowl", "tofu", "asian", [1, 0, 0], 0.8);
    const salmon = cand("salmon-rice", "fish", "japanese", [0, 1, 0], 0.8, ["salmon"]);
    const ctx = baseCtx({
      slots: [slot("dinner")],
      poolByVibe: new Map([["dinner", [plain, salmon]]]),
      embeddingBySlug: embMap(plain, salmon),
      atRiskDemand: new Map([["salmon", 1]]),
    });
    const r = assembleProposal(ctx);
    expect(r.plan[0].main!.slug).toBe("salmon-rice");
    expect(r.plan[0].uses_perishables).toEqual(["salmon"]);
    expect(r.uncovered_at_risk).toEqual([]);
  });

  it("splits a multi-serving at-risk item across two mains", () => {
    const d1 = cand("d1", "tofu", "asian", [1, 0, 0], 0.8);
    const beef1 = cand("beef-tacos", "beef", "mexican", [0, 1, 0], 0.8, ["ground beef"]);
    const d2 = cand("d2", "tofu", "asian", [1, 0, 0], 0.8);
    const beef2 = cand("beef-chili", "beef", "american", [0, 0, 1], 0.8, ["ground beef"]);
    const ctx = baseCtx({
      slots: [slot("a"), slot("b")],
      poolByVibe: new Map([
        ["a", [d1, beef1]],
        ["b", [d2, beef2]],
      ]),
      embeddingBySlug: embMap(d1, beef1, d2, beef2),
      atRiskDemand: new Map([["ground beef", 2]]),
      params: { proteinCap: null }, // both beef mains allowed — the split is the point
    });
    const r = assembleProposal(ctx);
    const beefMains = r.plan.filter((s) => s.uses_perishables.includes("ground beef"));
    expect(beefMains).toHaveLength(2); // used across two recipes
    expect(r.uncovered_at_risk).toEqual([]); // count 2 fully consumed
  });

  it("reports uncovered at-risk items the plan couldn't use", () => {
    // salmon is coverable (a pool recipe uses it); kohlrabi is not in any pool recipe → residual.
    const salmon = cand("salmon-rice", "fish", "japanese", [1, 0, 0], 0.8, ["salmon"]);
    const ctx = baseCtx({
      slots: [slot("dinner")],
      poolByVibe: new Map([["dinner", [salmon]]]),
      embeddingBySlug: embMap(salmon),
      atRiskDemand: new Map([["salmon", 1], ["kohlrabi", 1]]),
    });
    const r = assembleProposal(ctx);
    expect(r.plan[0].uses_perishables).toEqual(["salmon"]);
    expect(r.uncovered_at_risk).toEqual(["kohlrabi"]); // honest residual
  });

  it("a main reports only the at-risk items it CLAIMED, not any it merely lists", () => {
    // Both mains list cilantro, but the demand is count 1 — only the first-picked claims it.
    const first = cand("first", "chicken", "thai", [1, 0, 0], 0.9, ["cilantro"]);
    const second = cand("second", "beef", "thai", [0, 1, 0], 0.85, ["cilantro"]);
    const ctx = baseCtx({
      slots: [slot("a"), slot("b")],
      poolByVibe: new Map([
        ["a", [first]],
        ["b", [second]],
      ]),
      embeddingBySlug: embMap(first, second),
      atRiskDemand: new Map([["cilantro", 1]]),
    });
    const r = assembleProposal(ctx);
    const claimers = r.plan.filter((s) => s.uses_perishables.includes("cilantro"));
    expect(claimers).toHaveLength(1); // cilantro credited once, though both list it
    expect(r.uncovered_at_risk).toEqual([]);
  });

  // --- Recurring vibes (planning-cadence) -----------------------------------------------------

  it("a vibe sampled into two slots resolves to two different recipes, not the same one twice", () => {
    // Two slots share the SAME vibe id (as a period-aware recurring vibe now can) and draw from
    // the SAME pool — the cross-slot usedSlugs mechanism must still pick two distinct recipes.
    const pastaA = cand("spaghetti-carbonara", "pork", "italian", [1, 0, 0], 0.9);
    const pastaB = cand("cacio-e-pepe", "none", "italian", [0.9, 0.1, 0], 0.85);
    const pool = [pastaA, pastaB];
    const ctx = baseCtx({
      slots: [slot("pasta-night"), slot("pasta-night")],
      poolByVibe: new Map([["pasta-night", pool]]),
      embeddingBySlug: embMap(pastaA, pastaB),
    });
    const r = assembleProposal(ctx);
    const pastaSlots = r.plan.filter((s) => s.vibe_id === "pasta-night" && s.main);
    expect(pastaSlots).toHaveLength(2);
    const slugs = pastaSlots.map((s) => s.main!.slug);
    expect(new Set(slugs).size).toBe(2); // two DIFFERENT recipes, not the same one twice
  });

  it("coverage can't conjure an item outside the (already-gated) pool", () => {
    // The only at-risk cover isn't a pool survivor → coverage never admits it; it stays uncovered.
    const onVibe = cand("on-vibe", "tofu", "asian", [1, 0, 0], 0.9);
    const ctx = baseCtx({
      slots: [slot("dinner")],
      poolByVibe: new Map([["dinner", [onVibe]]]),
      embeddingBySlug: embMap(onVibe),
      atRiskDemand: new Map([["ground beef", 1]]),
    });
    const r = assembleProposal(ctx);
    expect(r.plan[0].main!.slug).toBe("on-vibe");
    expect(r.uncovered_at_risk).toEqual(["ground beef"]);
  });
});
