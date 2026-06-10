import { describe, it, expect } from "vitest";
import {
  verifyParsedIngredients,
  aggregateVerifications,
  type PantryItem,
} from "../src/pantry-verify.js";
import type { ParsedIngredient } from "../src/recipe-ingredients.js";
import type { SubRule } from "../src/substitutions.js";

const ing = (name: string, optional = false): ParsedIngredient => ({ name, optional });
const NOW = new Date("2026-06-09T12:00:00Z");

function pantry(name: string, over: Partial<PantryItem> = {}): PantryItem {
  return { name, added_at: "2026-06-01", last_verified_at: "2026-06-01", category: "pantry", prepared_from: null, ...over };
}

describe("verifyParsedIngredients", () => {
  it("buckets exact matches into in_pantry with age metadata, missing into not_in_pantry", () => {
    const res = verifyParsedIngredients(
      [ing("yellow onion"), ing("vegetable broth")],
      [pantry("yellow onion", { last_verified_at: "2026-06-02", category: "fridge" })],
      [],
      {},
      NOW,
    );
    expect(res.in_pantry).toEqual([
      {
        recipe_calls_for: "yellow onion",
        pantry_item: "yellow onion",
        added_at: "2026-06-01",
        last_verified_at: "2026-06-02",
        days_since_verified: 7,
        category: "fridge",
        prepared_from: null,
      },
    ]);
    expect(res.not_in_pantry).toEqual([{ ingredient: "vegetable broth" }]);
  });

  it("never returns a have_stale bucket", () => {
    const res = verifyParsedIngredients([ing("yellow onion")], [pantry("yellow onion", { last_verified_at: "2026-01-01" })], [], {}, NOW);
    expect(res).not.toHaveProperty("have_stale");
    expect(res).not.toHaveProperty("have_fresh");
    // freshness is surfaced as a fact (age), never a classification
    expect(res.in_pantry[0].days_since_verified).toBeGreaterThan(100);
  });

  it("surfaces a token-overlap pair as a possible_match, not an in_pantry match", () => {
    const res = verifyParsedIngredients([ing("long-grain white rice")], [pantry("rice")], [], {}, NOW);
    expect(res.in_pantry).toHaveLength(0);
    expect(res.possible_matches).toEqual([
      { recipe_calls_for: "long-grain white rice", candidate_pantry_item: "rice" },
    ]);
    expect(res.not_in_pantry).toHaveLength(0);
  });

  it("surfaces ALL fuzzy candidates per ingredient, containment ranked first", () => {
    // jasmine rice ⊃ "rice" (containment, stronger) vs "rice vinegar" (token-overlap only).
    // Both must appear; the containment match must come first. (find→filter regression guard.)
    const res = verifyParsedIngredients(
      [ing("jasmine rice")],
      [pantry("rice vinegar"), pantry("rice")], // rice vinegar listed first to prove ranking, not order
      [],
      {},
      NOW,
    );
    expect(res.in_pantry).toHaveLength(0);
    expect(res.possible_matches).toEqual([
      { recipe_calls_for: "jasmine rice", candidate_pantry_item: "rice" },
      { recipe_calls_for: "jasmine rice", candidate_pantry_item: "rice vinegar" },
    ]);
  });

  it("does not silently drop non-first token-overlap candidates", () => {
    const res = verifyParsedIngredients(
      [ing("chicken stock")],
      [pantry("chicken broth"), pantry("beef stock")],
      [],
      {},
      NOW,
    );
    const names = res.possible_matches.map((p) => p.candidate_pantry_item).sort();
    expect(names).toEqual(["beef stock", "chicken broth"]);
  });

  it("does not auto-match a misleading overlap (onion powder vs yellow onion)", () => {
    const res = verifyParsedIngredients([ing("onion powder")], [pantry("yellow onion")], [], {}, NOW);
    // shared token 'onion' makes it at most a candidate for the agent to reject — never in_pantry
    expect(res.in_pantry).toHaveLength(0);
    expect(res.possible_matches[0]).toMatchObject({ recipe_calls_for: "onion powder", candidate_pantry_item: "yellow onion" });
  });

  it("is presence-only: a present item is never netted to not_in_pantry", () => {
    const res = verifyParsedIngredients([ing("onion")], [pantry("onion", { quantity: "1" })], [], {}, NOW);
    expect(res.in_pantry).toHaveLength(1);
    expect(res.not_in_pantry).toHaveLength(0);
  });

  it("routes optional ingredients to optional and excludes them from not_in_pantry", () => {
    const res = verifyParsedIngredients([ing("parsley", true)], [], [], {}, NOW);
    expect(res.optional).toEqual(["parsley"]);
    expect(res.not_in_pantry).toHaveLength(0);
  });

  it("surfaces an inventory substitute for a missing ingredient when a rule allows a pantry-present sub", () => {
    const rules: SubRule[] = [{ ingredient: "salmon", acceptable: ["trout", "cod"], unacceptable: [] }];
    const res = verifyParsedIngredients([ing("salmon")], [pantry("trout")], rules, {}, NOW);
    expect(res.not_in_pantry).toEqual([{ ingredient: "salmon" }]);
    expect(res.inventory_substitutes_available).toEqual([
      { recipe_calls_for: "salmon", available_substitute: "trout" },
    ]);
  });

  it("empty pantry yields all-required → not_in_pantry", () => {
    const res = verifyParsedIngredients([ing("onion"), ing("garlic")], [], [], {}, NOW);
    expect(res.in_pantry).toHaveLength(0);
    expect(res.not_in_pantry.map((n) => n.ingredient)).toEqual(["onion", "garlic"]);
  });
});

describe("aggregateVerifications", () => {
  it("dedupes a shared missing ingredient and attributes it to both recipes", () => {
    const mk = () => verifyParsedIngredients([ing("vegetable broth")], [], [], {}, NOW);
    const agg = aggregateVerifications([
      { slug: "a", result: mk() },
      { slug: "b", result: mk() },
    ]);
    expect(agg.not_in_pantry).toEqual([{ ingredient: "vegetable broth", for_recipes: ["a", "b"] }]);
  });
});
