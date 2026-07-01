import { describe, it, expect } from "vitest";
import { fakeD1 } from "./fake-d1.js";
import { ingredientContext, emptyIngredientContext } from "../src/corpus-db.js";
import type { Env } from "../src/env.js";

// The IngredientContext façade (design D9): the single funnel consumers use instead of
// re-wiring "load resolver → normalize → enqueue-on-miss → thread search terms → read edges".
// Built from readResolver; the pure core (normalizeIngredient/normalizeIngredientList/baseOf)
// stays in src/matching.ts and is composed here. These tests exercise the impure additions:
// capture-on-miss (deduped, best-effort), search-term fallback, and the lazy §3.4 edge read.

describe("IngredientContext (the ingredient consumption funnel)", () => {
  it("resolve() returns the canonical id for a hit and the cleaned term for a miss", async () => {
    const { env } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "scallion", base: "scallion", representative: "green onion" },
          { id: "green onion", base: "green onion", representative: null },
        ],
        ingredient_alias: [{ variant: "scallions", id: "scallion" }],
        novel_ingredient_terms: [],
      },
    });
    const ctx = await ingredientContext(env);
    // Hit: resolves through the representative pointer to the survivor.
    expect(ctx.resolve("Scallions")).toBe("green onion");
    // Miss: the quantity-stripped, lowercased surface form, unchanged.
    expect(ctx.resolve("2 lb gochujang")).toBe("gochujang");
  });

  it("resolve() enqueues ONLY novel misses, deduped within the context", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [{ id: "green onion", base: "green onion", representative: null }],
        ingredient_alias: [{ variant: "scallions", id: "scallion" }, { variant: "green onions", id: "green onion" }],
        novel_ingredient_terms: [],
      },
    });
    const ctx = await ingredientContext(env);

    // A known id (green onion) is NOT novel → no enqueue.
    ctx.resolve("green onions");
    expect(tables.novel_ingredient_terms).toHaveLength(0);

    // A novel surface form → enqueued once.
    ctx.resolve("gochujang");
    expect(tables.novel_ingredient_terms.map((r) => r.term)).toEqual(["gochujang"]);

    // Same novel term again (any surface variant that normalizes to it) → deduped, no second row.
    ctx.resolve("gochujang");
    ctx.resolve("1 tbsp gochujang");
    expect(tables.novel_ingredient_terms).toHaveLength(1);
  });

  it("resolveList() canonicalizes + captures like normalizeIngredientList, dropping empties/dupes", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [{ id: "green onion", base: "green onion", representative: null }],
        ingredient_alias: [{ variant: "scallions", id: "green onion" }],
        novel_ingredient_terms: [],
      },
    });
    const ctx = await ingredientContext(env);
    // "scallions" aliases to the known survivor; "gochujang" is novel; "" drops; a dup collapses.
    const out = ctx.resolveList(["scallions", "gochujang", "", "gochujang"]);
    expect(out).toEqual(["green onion", "gochujang"]);
    // Only the novel one is captured; the known survivor is not.
    expect(tables.novel_ingredient_terms.map((r) => r.term)).toEqual(["gochujang"]);
  });

  it("resolveList() passes a non-array / non-string-bearing value through unchanged, capturing nothing", async () => {
    const { env, tables } = fakeD1({
      tables: { ingredient_identity: [], ingredient_alias: [], novel_ingredient_terms: [] },
    });
    const ctx = await ingredientContext(env);
    expect(ctx.resolveList("not an array")).toBe("not an array");
    const withNonString = ["ok", 42];
    expect(ctx.resolveList(withNonString)).toBe(withNonString); // the same reference, untouched
    expect(tables.novel_ingredient_terms).toHaveLength(0);
  });

  it("resolveNames() always returns a deduped string[], dropping non-strings, and captures novel misses", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [{ id: "green onion", base: "green onion", representative: null }],
        ingredient_alias: [{ variant: "scallions", id: "green onion" }],
        novel_ingredient_terms: [],
      },
    });
    const ctx = await ingredientContext(env);
    // Unlike resolveList (which passes a non-string-bearing array through for the validator),
    // resolveNames is the lenient set-builder: it drops the 42, keeps + dedupes the rest.
    expect(ctx.resolveNames(["scallions", "gochujang", 42, "", "gochujang"])).toEqual(["green onion", "gochujang"]);
    // A non-array degrades to [] (not a passthrough).
    expect(ctx.resolveNames("not an array")).toEqual([]);
    expect(ctx.resolveNames(undefined)).toEqual([]);
    // The novel one is still captured through the same funnel.
    expect(tables.novel_ingredient_terms.map((r) => r.term)).toEqual(["gochujang"]);
  });

  it("base() and searchTerm() behave (searchTerm falls back to the flattened base)", async () => {
    const { env } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "ground beef", base: "ground beef", representative: null },
          { id: "ground beef::fat-80-20", base: "ground beef", representative: null, search_term: "80/20 ground beef" },
        ],
        ingredient_alias: [],
      },
    });
    const ctx = await ingredientContext(env);
    expect(ctx.base("ground beef::fat-80-20")).toBe("ground beef");
    expect(ctx.base("ground beef")).toBe("ground beef");
    // A stored search_term wins; without one, the id flattens its `::` markers to spaces.
    expect(ctx.searchTerm("ground beef::fat-80-20")).toBe("80/20 ground beef");
    expect(ctx.searchTerm("ground beef")).toBe("ground beef");
    expect(ctx.searchTerm("cheese::cheddar")).toBe("cheese cheddar");
  });

  it("satisfiesAmong() returns only edges whose BOTH endpoints are in the set (representative-resolved)", async () => {
    const { env } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "chicken", base: "chicken", representative: null },
          { id: "chicken::whole", base: "chicken", representative: null },
          { id: "chicken::thighs", base: "chicken", representative: null },
          { id: "scallion", base: "scallion", representative: "green onion" }, // merged away
          { id: "green onion", base: "green onion", representative: null },
        ],
        ingredient_edge: [
          { from_id: "chicken::whole", to_id: "chicken::thighs", kind: "containment" },
          { from_id: "chicken::thighs", to_id: "chicken", kind: "general" },
          // an edge touching a node OUTSIDE the requested set — must be excluded
          { from_id: "scallion", to_id: "green onion", kind: "general" },
        ],
      },
    });
    const ctx = await ingredientContext(env);

    // Only whole + thighs are in the set → just the containment edge (thighs→chicken excluded:
    // `chicken` is not in the set).
    expect(await ctx.satisfiesAmong(["chicken::whole", "chicken::thighs"])).toEqual([
      { from: "chicken::whole", to: "chicken::thighs", kind: "containment" },
    ]);

    // Add `chicken` → the general edge now qualifies too.
    expect(await ctx.satisfiesAmong(["chicken::whole", "chicken::thighs", "chicken"])).toEqual([
      { from: "chicken::whole", to: "chicken::thighs", kind: "containment" },
      { from: "chicken::thighs", to: "chicken", kind: "general" },
    ]);

    // The scallion→green-onion edge is representative-resolved to green-onion→green-onion; asking
    // for the merged-away `scallion` id resolves it to `green onion`, so a set with green onion
    // and the surviving scallion pointer still matches the (self-)edge on the survivor.
    const merged = await ctx.satisfiesAmong(["green onion"]);
    expect(merged).toEqual([{ from: "green onion", to: "green onion", kind: "general" }]);
  });

  it("satisfiesAmong() does NOT load the edge table until first called (lazy), then memoizes", async () => {
    // Wrap the fake DB so we can count reads of the ingredient_edge table.
    const base = fakeD1({
      tables: {
        ingredient_identity: [{ id: "chicken::whole", base: "chicken", representative: null }],
        ingredient_alias: [{ variant: "whole chicken", id: "chicken::whole" }],
        ingredient_edge: [],
        novel_ingredient_terms: [],
      },
    });
    let edgeReads = 0;
    const realDb = base.env.DB;
    const countingDb = {
      prepare(sql: string) {
        if (/FROM ingredient_edge/i.test(sql)) edgeReads++;
        return (realDb as unknown as { prepare(s: string): unknown }).prepare(sql);
      },
      batch(stmts: unknown[]) {
        return (realDb as unknown as { batch(s: unknown[]): unknown }).batch(stmts);
      },
    };
    const env = { DB: countingDb } as unknown as Env;

    const ctx = await ingredientContext(env);
    // Building the context + resolving a hit must touch NO edge read (the hot path).
    expect(ctx.resolve("whole chicken")).toBe("chicken::whole");
    expect(edgeReads).toBe(0);

    // First satisfiesAmong triggers exactly one edge load.
    await ctx.satisfiesAmong(["chicken::whole"]);
    expect(edgeReads).toBe(1);
    // A second call reuses the memoized load — no additional read.
    await ctx.satisfiesAmong(["chicken::whole"]);
    expect(edgeReads).toBe(1);
  });

  it("emptyIngredientContext() degrades to lowercase/strip and captures nothing", async () => {
    const { env, tables } = fakeD1({ tables: { novel_ingredient_terms: [] } });
    const ctx = emptyIngredientContext(env);
    // No aliases → the cleaned surface form; capture is disabled (a read-failure fallback must
    // not flood the queue).
    expect(ctx.resolve("2 lb Gochujang")).toBe("gochujang");
    expect(ctx.resolveList(["scallions", "gochujang"])).toEqual(["scallions", "gochujang"]);
    expect(tables.novel_ingredient_terms).toHaveLength(0);
  });
});
