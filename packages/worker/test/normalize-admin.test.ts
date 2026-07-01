import { describe, it, expect } from "vitest";
import { fakeD1 } from "./fake-d1.js";
import { readNormalizationPage } from "../src/normalize-admin.js";

const NOW = 1_700_000_000_000;

function seeded() {
  return fakeD1({
    tables: {
      ingredient_identity: [
        { id: "green onion", base: "green onion", detail: null, concrete: 1, representative: null },
        { id: "ground beef", base: "ground beef", detail: null, concrete: 1, representative: null },
        { id: "ground beef::fat-80-20", base: "ground beef", detail: "fat-80-20", concrete: 1, representative: null },
        { id: "courgette", base: "courgette", detail: null, concrete: 1, representative: "zucchini" }, // merged away
        { id: "zucchini", base: "zucchini", detail: null, concrete: 1, representative: null },
        { id: "fresh-soft-cheese", base: "fresh-soft-cheese", detail: null, concrete: 0, representative: null }, // concept
      ],
      ingredient_alias: [
        { variant: "scallions", id: "green onion", source: "auto" },
        { variant: "evoo", id: "olive oil", source: "human" }, // id has no identity node (legacy)
        { variant: "courgette", id: "courgette", source: "auto" }, // resolves through rep to zucchini
      ],
      ingredient_edge: [
        { from_id: "ground beef::fat-80-20", to_id: "ground beef", kind: "general" },
        { from_id: "fresh mozzarella", to_id: "fresh-soft-cheese", kind: "membership" },
      ],
      novel_ingredient_terms: [{ term: "gochugaru", first_seen: NOW - 60_000, attempts: 0, next_retry_at: null }],
      ingredient_normalization_log: [
        { id: 1, term: "scallions", outcome: "same", resolved_id: "green onion", candidates: JSON.stringify([{ id: "green onion", score: 0.63 }, { id: "olive oil", score: 0.55 }]), model: "m", detail: JSON.stringify({ reason: "synonym of green onion" }), created_at: NOW - 120_000 },
        { id: 2, term: "80/20 ground beef", outcome: "specialization", resolved_id: "ground beef::fat-80-20", candidates: JSON.stringify([{ id: "ground beef", score: 0.83 }]), model: "m", detail: JSON.stringify({ reason: "fat ratio" }), created_at: NOW - 240_000 },
        { id: 3, term: "xanthan gum", outcome: "novel", resolved_id: "xanthan gum", candidates: JSON.stringify([{ id: "cornstarch", score: 0.33 }]), model: null, detail: null, created_at: NOW - 300_000 },
        { id: 4, term: "courgette", outcome: "merge", resolved_id: "zucchini", candidates: null, model: "m", detail: null, created_at: NOW - 3_600_000 },
        { id: 5, term: "weird xyz", outcome: "novel", resolved_id: "weird xyz", candidates: null, model: "m", detail: JSON.stringify({ note: "confirm_failed_safe" }), created_at: NOW - 7_200_000 },
        { id: 6, term: "a fresh soft cheese", outcome: "novel", resolved_id: "fresh-soft-cheese", candidates: null, model: "m", detail: JSON.stringify({ reason: "concept" }), created_at: NOW - 8_000_000 },
      ],
      job_health: [{ name: "ingredient-normalize", ok: 1, last_run_at: NOW - 180_000, summary: "{}" }],
    },
  });
}

describe("readNormalizationPage", () => {
  it("derives the decision kinds, edges, members, aliases, and stats", async () => {
    const page = await readNormalizationPage(seeded().env, { now: NOW });

    const byTerm = Object.fromEntries(page.decisions.map((d) => [d.term, d]));

    // SAME — synonym, chosen candidate is the resolved id.
    expect(byTerm["scallions"].outcome).toBe("same");
    expect(byTerm["scallions"].candidates.find((c) => c.id === "green onion")?.chosen).toBe(true);
    expect(byTerm["scallions"].reason).toBe("synonym of green onion");

    // SPECIALIZATION — base/detail split, general edge attached, chosen candidate is the base.
    const spec = byTerm["80/20 ground beef"];
    expect(spec.outcome).toBe("spec");
    expect(spec.base).toBe("ground beef");
    expect(spec.detail).toBe("fat-80-20");
    expect(spec.edges).toContainEqual({ from: "ground beef::fat-80-20", to: "ground beef", rel: "satisfies" });
    expect(spec.candidates.find((c) => c.id === "ground beef")?.chosen).toBe(true);

    // Below-floor novel (no model) → nollm.
    expect(byTerm["xanthan gum"].outcome).toBe("nollm");
    expect(byTerm["xanthan gum"].belowFloor).toBe(true);

    // Merge / fail-safe / concept.
    expect(byTerm["courgette"].outcome).toBe("merge");
    expect(byTerm["courgette"].mergeInto).toBe("zucchini");
    expect(byTerm["weird xyz"].outcome).toBe("fail");
    expect(byTerm["weird xyz"].failedSafe).toBe(true);
    expect(byTerm["a fresh soft cheese"].concept).toBe(true);
    expect(byTerm["a fresh soft cheese"].members).toEqual(["fresh mozzarella"]);

    // Newest-first ordering (by id desc).
    expect(page.decisions.map((d) => d.id)).toEqual([6, 5, 4, 3, 2, 1]);

    // Aliases: courgette resolves through the representative to zucchini (merged); evoo is a
    // legacy id with no node; source flags preserved.
    const al = Object.fromEntries(page.aliases.map((a) => [a.variant, a]));
    expect(al["courgette"]).toMatchObject({ base: "zucchini", merged: true, source: "auto" });
    expect(al["evoo"]).toMatchObject({ base: "olive oil", source: "human" });
    expect(al["scallions"]).toMatchObject({ base: "green onion", merged: false });

    // Stats.
    expect(page.stats).toMatchObject({
      nodes: 5, // survivors (courgette merged away)
      aliases: 3,
      satisfies: 2,
      pending: 1,
      decisions24h: 6,
      needsAttention: 1, // the fail-safe row
    });
    expect(page.queue).toEqual([{ term: "gochugaru", firstSeenAt: NOW - 60_000, attempts: 0, nextRetryAt: null }]);
    expect(page.lastSweep).toBe(NOW - 180_000);
  });
});
