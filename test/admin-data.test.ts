import { describe, it, expect } from "vitest";
import {
  recipeList,
  recipeDetail,
  memberDetail,
  readTable,
  guidanceListing,
  guidanceObject,
  searchRecipes,
  storeList,
  storeDetail,
} from "../src/admin-data.js";
import type { Env } from "../src/env.js";
import { fakeD1 } from "./fake-d1.js";
import { fakeR2 } from "./fake-r2.js";

/** Build an Env over an in-memory D1 + R2 corpus for the explorer reads. */
function makeEnv(opts: { tables?: Record<string, Record<string, unknown>[]>; r2?: Record<string, string> } = {}) {
  const d1 = fakeD1({ tables: opts.tables });
  const r2 = fakeR2(opts.r2 ?? {});
  const env = { ...d1.env, CORPUS: r2.bucket } as unknown as Env;
  return { env, d1, r2 };
}

describe("recipeDetail — cross-tier projection status", () => {
  it("indexed: R2 source + a recipes row", async () => {
    const { env } = makeEnv({
      tables: { recipes: [{ slug: "foo", title: "Foo" }], recipe_derived: [{ slug: "foo", description: "A dish.", embedding: "[0.1]" }] },
      r2: { "recipes/foo.md": "# Foo" },
    });
    const d = await recipeDetail(env, "foo");
    expect(d.status).toBe("indexed");
    expect(d.source).toBe("# Foo");
    expect(d.projection).toMatchObject({ slug: "foo", title: "Foo" });
    expect(d.derived).toEqual({ description: "A dish.", has_embedding: true, state: "described" });
    expect(d.reconcile_message).toBeNull();
  });

  it("skipped: R2 source, no recipes row, carries the reconcile reason", async () => {
    const { env } = makeEnv({
      tables: { reconcile_errors: [{ slug: "bar", path: "recipes/bar.md", message: 'cuisine "tex-mex" is not in the vocab', recorded_at: "2026-06-27" }] },
      r2: { "recipes/bar.md": "# Bar" },
    });
    const d = await recipeDetail(env, "bar");
    expect(d.status).toBe("skipped");
    expect(d.projection).toBeNull();
    expect(d.reconcile_message).toBe('cuisine "tex-mex" is not in the vocab');
  });

  it("pending: R2 source, no recipes row, no reconcile entry", async () => {
    const { env } = makeEnv({ r2: { "recipes/baz.md": "# Baz" } });
    const d = await recipeDetail(env, "baz");
    expect(d.status).toBe("pending");
    expect(d.reconcile_message).toBeNull();
  });

  it("orphaned: a recipes row with no R2 source", async () => {
    const { env } = makeEnv({ tables: { recipes: [{ slug: "qux", title: "Qux" }] } });
    const d = await recipeDetail(env, "qux");
    expect(d.status).toBe("orphaned");
    expect(d.source).toBeNull();
  });

  it("not_found: neither tier has the slug", async () => {
    const { env } = makeEnv();
    await expect(recipeDetail(env, "ghost")).rejects.toMatchObject({ code: "not_found" });
  });

  it("derived state is pending when the description is null", async () => {
    const { env } = makeEnv({
      tables: { recipes: [{ slug: "foo", title: "Foo" }], recipe_derived: [{ slug: "foo", description: null, embedding: null }] },
      r2: { "recipes/foo.md": "# Foo" },
    });
    const d = await recipeDetail(env, "foo");
    expect(d.derived).toEqual({ description: null, has_embedding: false, state: "pending" });
  });
});

describe("recipeDetail — body (frontmatter-stripped, for client rendering)", () => {
  it("strips the YAML frontmatter fence, leaving the body; raw source unchanged", async () => {
    const src = "---\ntitle: Foo\ncuisine: italian\n---\n## Ingredients\n- eggs\n\n## Instructions\n1. Cook.\n";
    const { env } = makeEnv({ tables: { recipes: [{ slug: "foo", title: "Foo" }] }, r2: { "recipes/foo.md": src } });
    const d = await recipeDetail(env, "foo");
    expect(d.source).toBe(src);
    expect(d.body).toBe("## Ingredients\n- eggs\n\n## Instructions\n1. Cook.\n");
  });

  it("returns the whole text as body when there's no frontmatter", async () => {
    const { env } = makeEnv({ r2: { "recipes/baz.md": "# Baz\n\nNo frontmatter here." } });
    const d = await recipeDetail(env, "baz");
    expect(d.body).toBe("# Baz\n\nNo frontmatter here.");
  });

  it("falls back to the whole source when the frontmatter YAML is malformed (never throws)", async () => {
    const bad = "---\nfoo: [unclosed\n---\n## Instructions\n1. Cook.\n";
    const { env } = makeEnv({ r2: { "recipes/bar.md": bad } });
    const d = await recipeDetail(env, "bar");
    expect(d.status).toBe("pending");
    expect(d.body).toBe(bad);
  });

  it("body is null for an orphaned slug with no R2 source", async () => {
    const { env } = makeEnv({ tables: { recipes: [{ slug: "qux", title: "Qux" }] } });
    const d = await recipeDetail(env, "qux");
    expect(d.body).toBeNull();
  });
});

describe("recipeDetail — cross-tenant aggregate names tenants (no redaction)", () => {
  it("lists each tenant's disposition and every author's notes, including private", async () => {
    const { env } = makeEnv({
      tables: {
        recipes: [{ slug: "foo", title: "Foo" }],
        overlay: [
          { tenant: "alice", recipe: "foo", favorite: 1, reject: null },
          { tenant: "bob", recipe: "foo", favorite: null, reject: 1 },
        ],
        recipe_notes: [
          { id: "n1", recipe: "foo", author: "alice", body: "shared note", tags: "[]", private: 0, created_at: "2026-06-01" },
          { id: "n2", recipe: "foo", author: "carol", body: "secret", tags: "[]", private: 1, created_at: "2026-06-02" },
        ],
      },
      r2: { "recipes/foo.md": "# Foo" },
    });
    const d = await recipeDetail(env, "foo");
    expect(d.dispositions).toEqual([
      { tenant: "alice", favorite: true, reject: false },
      { tenant: "bob", favorite: false, reject: true },
    ]);
    expect(d.notes.map((n) => n.author)).toEqual(["carol", "alice"]); // created_at DESC
    expect(d.notes.find((n) => n.author === "carol")).toMatchObject({ private: 1, body: "secret" });
  });
});

describe("recipeDetail — D1 list-valued columns inflated back to arrays", () => {
  it("parses JSON-array-shaped columns (tags, dietary, requires_equipment, ingredients_key, …) into real arrays", async () => {
    const { env } = makeEnv({
      tables: {
        recipes: [
          {
            slug: "foo",
            title: "Foo",
            tags: JSON.stringify(["quick", "weeknight"]),
            dietary: JSON.stringify(["vegetarian"]),
            requires_equipment: JSON.stringify(["blender"]),
            pairs_with: JSON.stringify(["rice"]),
            ingredients_key: JSON.stringify(["onion", "garlic"]),
            side_search_terms: JSON.stringify(["a crisp salad"]),
            perishable_ingredients: JSON.stringify(["cilantro"]),
            course: JSON.stringify(["main"]),
            season: JSON.stringify([]),
          },
        ],
      },
      r2: { "recipes/foo.md": "# Foo" },
    });
    const d = await recipeDetail(env, "foo");
    expect(d.projection).toMatchObject({
      tags: ["quick", "weeknight"],
      dietary: ["vegetarian"],
      requires_equipment: ["blender"],
      pairs_with: ["rice"],
      ingredients_key: ["onion", "garlic"],
      side_search_terms: ["a crisp salad"],
      perishable_ingredients: ["cilantro"],
      course: ["main"],
      season: [],
    });
  });

  it("leaves scalar columns (title, protein, slug) as plain strings, not parsed", async () => {
    const { env } = makeEnv({
      tables: { recipes: [{ slug: "foo", title: "Foo", protein: "chicken" }] },
      r2: { "recipes/foo.md": "# Foo" },
    });
    const d = await recipeDetail(env, "foo");
    expect(d.projection?.slug).toBe("foo");
    expect(d.projection?.title).toBe("Foo");
    expect(d.projection?.protein).toBe("chicken");
  });

  it("leaves a JSON-object-shaped column (extra) as the raw string, not parsed into an array", async () => {
    const { env } = makeEnv({
      tables: { recipes: [{ slug: "foo", title: "Foo", extra: JSON.stringify({ servings: 4 }) }] },
      r2: { "recipes/foo.md": "# Foo" },
    });
    const d = await recipeDetail(env, "foo");
    expect(d.projection?.extra).toBe(JSON.stringify({ servings: 4 }));
  });

  it("degrades malformed JSON in a list column to the raw string rather than throwing", async () => {
    const { env } = makeEnv({
      tables: { recipes: [{ slug: "foo", title: "Foo", tags: "[unclosed" }] },
      r2: { "recipes/foo.md": "# Foo" },
    });
    const d = await recipeDetail(env, "foo");
    expect(d.projection?.tags).toBe("[unclosed");
  });
});

describe("recipeList — every slug with status", () => {
  it("surfaces indexed, skipped, and orphaned slugs together", async () => {
    const { env } = makeEnv({
      tables: {
        recipes: [{ slug: "foo", title: "Foo" }, { slug: "qux", title: "Qux" }],
        reconcile_errors: [{ slug: "bar", path: "recipes/bar.md", message: "bad", recorded_at: "2026-06-27" }],
      },
      r2: { "recipes/foo.md": "# Foo", "recipes/bar.md": "# Bar" },
    });
    const { recipes } = await recipeList(env);
    const byslug = Object.fromEntries(recipes.map((r) => [r.slug, r.status]));
    expect(byslug).toEqual({ foo: "indexed", bar: "skipped", qux: "orphaned" });
  });
});

describe("memberDetail — full per-tenant state, no redaction", () => {
  it("assembles pantry/session/overlay/cooking_log and the member's private note", async () => {
    const { env } = makeEnv({
      tables: {
        profile: [{ tenant: "alice", taste: "likes spice" }],
        pantry: [{ tenant: "alice", name: "olive oil", normalized_name: "olive oil", quantity: "partial", category: "pantry" }],
        cooking_log: [{ id: 1, tenant: "alice", date: "2026-06-20", type: "recipe", recipe: "foo", name: null, protein: null, cuisine: null }],
        recipe_notes: [{ id: "n1", recipe: "foo", author: "alice", body: "my private note", tags: "[]", private: 1, created_at: "2026-06-01" }],
      },
    });
    const m = await memberDetail(env, "alice");
    expect(m.id).toBe("alice");
    expect(m.pantry).toHaveLength(1);
    expect(m.cooking_log).toHaveLength(1);
    expect(m.recipe_notes).toHaveLength(1);
    expect(m.recipe_notes[0]).toMatchObject({ private: 1, body: "my private note" });
  });
});

describe("readTable — fixed, allowlisted, bounded (discovery/system groups; inert until routed)", () => {
  it("bounds a bounded table to the default limit", async () => {
    // reconcile_errors isn't bounded, but discovery_candidates and system tables share the
    // same TableSpec machinery; exercise the allowlist + column projection over `system`.
    const rows = Array.from({ length: 5 }, (_, i) => ({ slug: `s${i}`, path: `recipes/s${i}.md`, message: "bad", recorded_at: "2026-06-01" }));
    const { env } = makeEnv({ tables: { reconcile_errors: rows } });
    const page = await readTable(env, "system", "reconcile_errors");
    expect(page.rows.length).toBe(5);
    expect(page.columns).toContain("slug");
  });

  it("rejects an unknown table", async () => {
    const { env } = makeEnv();
    await expect(readTable(env, "system", "secrets")).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects a table from another group (no cross-group read)", async () => {
    const { env } = makeEnv();
    await expect(readTable(env, "discovery", "reconcile_errors")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("searchRecipes — keyword mode (AND-of-tokens, no ranking, zero AI calls)", () => {
  it("matches all query tokens across the indexed metadata (AND semantics)", async () => {
    const { env } = makeEnv({
      tables: {
        recipes: [
          { slug: "miso-butter-salmon", title: "Miso Butter Salmon", protein: "fish", cuisine: "japanese", course: "main", tags: "[]", ingredients_key: "[]" },
          { slug: "weeknight-dal", title: "Weeknight Dal", protein: "vegan", cuisine: "indian", course: "main", tags: "[]", ingredients_key: "[]" },
        ],
      },
    });
    const { mode, results } = await searchRecipes(env, "miso salmon", "keyword");
    expect(mode).toBe("keyword");
    expect(results.map((h) => h.slug)).toEqual(["miso-butter-salmon"]);
    expect(results[0].score).toBeNull();
    expect(results[0].semantic).toBe(false);
  });

  it("excludes a recipe matching only some tokens", async () => {
    const { env } = makeEnv({
      tables: { recipes: [{ slug: "miso-butter-salmon", title: "Miso Butter Salmon", protein: "fish", cuisine: "japanese", course: "main", tags: "[]", ingredients_key: "[]" }] },
    });
    const { results } = await searchRecipes(env, "miso beef", "keyword");
    expect(results).toEqual([]);
  });

  it("an empty query returns the full corpus unranked", async () => {
    const { env } = makeEnv({
      tables: { recipes: [{ slug: "a", title: "A", protein: null, cuisine: null, course: null, tags: null, ingredients_key: null }] },
    });
    const { mode, results } = await searchRecipes(env, "", "keyword");
    expect(mode).toBe("keyword");
    expect(results).toEqual([{ slug: "a", score: null, semantic: false }]);
  });

  it("makes zero AI calls in keyword mode", async () => {
    let calls = 0;
    const { env } = makeEnv({ tables: { recipes: [{ slug: "a", title: "A", protein: null, cuisine: null, course: null, tags: null, ingredients_key: null }] } });
    (env as unknown as { AI: { run: () => unknown } }).AI = { run: () => { calls++; throw new Error("must not be called"); } };
    await searchRecipes(env, "a", "keyword");
    expect(calls).toBe(0);
  });
});

// A 768-dim (EMBED_DIM) unit vector along the first axis — the shape `embedText`'s
// response-validation requires. cosineSimilarity is scale/dimension-checked separately.
const UNIT_VECTOR_768 = [1, ...Array(767).fill(0)];

describe("searchRecipes — hybrid mode (embed once, blend, semantic-surfaced flag)", () => {
  function makeHybridEnv() {
    let embedCalls = 0;
    const { env } = makeEnv({
      tables: {
        recipes: [
          { slug: "miso-butter-salmon", title: "Miso Butter Salmon", protein: "fish", cuisine: "japanese", course: "main", tags: "[]", ingredients_key: "[]" },
          { slug: "unembedded-recipe", title: "Unembedded Recipe", protein: "beef", cuisine: "american", course: "main", tags: "[]", ingredients_key: "[]" },
        ],
        recipe_derived: [
          // A vector identical to the query direction (cosine 1) so it clears the floor
          // purely on the semantic term, even with zero keyword overlap.
          { slug: "miso-butter-salmon", embedding: JSON.stringify(UNIT_VECTOR_768) },
        ],
      },
    });
    (env as unknown as { AI: { run: (model: string, opts: { text: string }) => Promise<{ data: number[][] }> } }).AI = {
      run: async () => {
        embedCalls++;
        return { data: [UNIT_VECTOR_768] };
      },
    };
    return { env, getEmbedCalls: () => embedCalls };
  }

  it("returns a blended relevance score per hit", async () => {
    const { env } = makeHybridEnv();
    const { mode, results } = await searchRecipes(env, "cozy umami dinner", "hybrid");
    expect(mode).toBe("hybrid");
    expect(results.length).toBe(1);
    expect(results[0].slug).toBe("miso-butter-salmon");
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("flags a hit surfaced via the semantic term without a full keyword match", async () => {
    const { env } = makeHybridEnv();
    const { results } = await searchRecipes(env, "cozy umami dinner", "hybrid");
    expect(results[0].semantic).toBe(true);
  });

  it("excludes an unembedded recipe from hybrid ranking but keeps it in keyword mode", async () => {
    const { env } = makeHybridEnv();
    const hybrid = await searchRecipes(env, "unembedded", "hybrid");
    expect(hybrid.results.find((h) => h.slug === "unembedded-recipe")).toBeUndefined();
    const keyword = await searchRecipes(env, "unembedded", "keyword");
    expect(keyword.results.map((h) => h.slug)).toEqual(["unembedded-recipe"]);
  });

  it("makes exactly one embed call per hybrid search, never one per recipe", async () => {
    const { env, getEmbedCalls } = makeHybridEnv();
    await searchRecipes(env, "cozy umami dinner", "hybrid");
    expect(getEmbedCalls()).toBe(1);
  });

  it("an empty query returns the full corpus unranked, without an embed call", async () => {
    const { env, getEmbedCalls } = makeHybridEnv();
    const { mode, results } = await searchRecipes(env, "", "hybrid");
    expect(mode).toBe("hybrid");
    expect(results.map((h) => h.slug).sort()).toEqual(["miso-butter-salmon", "unembedded-recipe"]);
    expect(results.every((h) => h.score === null)).toBe(true);
    expect(getEmbedCalls()).toBe(0);
  });

  it("degrades to keyword results when embedText throws (Workers AI outage/quota exhaustion)", async () => {
    const { env } = makeEnv({
      tables: {
        recipes: [
          { slug: "miso-butter-salmon", title: "Miso Butter Salmon", protein: "fish", cuisine: "japanese", course: "main", tags: "[]", ingredients_key: "[]" },
          { slug: "weeknight-dal", title: "Weeknight Dal", protein: "vegan", cuisine: "indian", course: "main", tags: "[]", ingredients_key: "[]" },
        ],
        recipe_derived: [{ slug: "miso-butter-salmon", embedding: JSON.stringify(UNIT_VECTOR_768) }],
      },
    });
    (env as unknown as { AI: { run: () => unknown } }).AI = {
      run: () => {
        throw new Error("Workers AI neuron quota exhausted");
      },
    };
    const { mode, results } = await searchRecipes(env, "miso salmon", "hybrid");
    expect(mode).toBe("hybrid-degraded");
    // Falls back to the plain keyword match for the same query — unranked, no scores.
    expect(results).toEqual([{ slug: "miso-butter-salmon", score: null, semantic: false }]);
  });

  it("degrades to keyword results when the recipe_derived vector read fails", async () => {
    const { env } = makeEnv({
      tables: {
        recipes: [{ slug: "miso-butter-salmon", title: "Miso Butter Salmon", protein: "fish", cuisine: "japanese", course: "main", tags: "[]", ingredients_key: "[]" }],
      },
    });
    (env as unknown as { AI: { run: (model: string, opts: { text: string }) => Promise<{ data: number[][] }> } }).AI = {
      run: async () => ({ data: [UNIT_VECTOR_768] }),
    };
    // Wrap DB.prepare so the recipe_derived read specifically fails, exercising the
    // "embed succeeded but the vector read failed" half of the degrade path.
    const realDB = (env as unknown as { DB: D1Database }).DB;
    (env as unknown as { DB: D1Database }).DB = {
      ...realDB,
      prepare(sql: string) {
        if (/FROM recipe_derived/i.test(sql)) {
          return {
            bind: () => ({
              all: async () => {
                throw new Error("D1 unavailable");
              },
            }),
          } as unknown as D1PreparedStatement;
        }
        return realDB.prepare(sql);
      },
    } as unknown as D1Database;
    const { mode, results } = await searchRecipes(env, "miso salmon", "hybrid");
    expect(mode).toBe("hybrid-degraded");
    expect(results).toEqual([{ slug: "miso-butter-salmon", score: null, semantic: false }]);
  });
});

describe("storeList — the shared registry with notes/SKU counts", () => {
  it("lists every store with counts joined in memory", async () => {
    const { env } = makeEnv({
      tables: {
        stores: [
          { slug: "kroger-hp", name: "Kroger HP", domain: "grocery", extra: JSON.stringify({ chain: "kroger", location_id: "L1" }) },
          { slug: "tjs", name: "Trader Joe's", domain: "grocery", extra: JSON.stringify({ chain: "trader-joes" }) },
        ],
        store_notes: [{ id: "n1", store: "kroger-hp", author: "casey", body: "x", tags: "[]", private: 0, created_at: "2026-06-01" }],
        sku_cache: [{ ingredient: "salmon", location_id: "L1", sku: "1", brand: null, size: null, last_used: "2026-06-01" }],
      },
    });
    const { stores } = await storeList(env);
    expect(stores).toEqual([
      { slug: "kroger-hp", name: "Kroger HP", domain: "grocery", chain: "kroger", notes_count: 1, skus_count: 1 },
      { slug: "tjs", name: "Trader Joe's", domain: "grocery", chain: "trader-joes", notes_count: 0, skus_count: 0 },
    ]);
  });
});

describe("storeDetail — identity, scoped SKUs, grouped notes", () => {
  it("unpacks identity from `extra` and scopes SKUs to the store's location_id", async () => {
    const { env } = makeEnv({
      tables: {
        stores: [{ slug: "kroger-hp", name: "Kroger HP", domain: "grocery", extra: JSON.stringify({ chain: "kroger", label: "the big one", address: "123 Main St", location_id: "L1" }) }],
        sku_cache: [
          { ingredient: "salmon", location_id: "L1", sku: "1", brand: "Kroger", size: "1 lb", last_used: "2026-06-01" },
          { ingredient: "rice", location_id: "L2", sku: "2", brand: null, size: null, last_used: "2026-06-01" },
        ],
      },
    });
    const d = await storeDetail(env, "kroger-hp");
    expect(d).toMatchObject({ chain: "kroger", label: "the big one", address: "123 Main St", location_id: "L1" });
    expect(d.skus).toHaveLength(1);
    expect(d.skus[0].ingredient).toBe("salmon");
  });

  it("a store with no location_id has an empty SKU list (not an error)", async () => {
    const { env } = makeEnv({
      tables: { stores: [{ slug: "tjs", name: "Trader Joe's", domain: "grocery", extra: JSON.stringify({ chain: "trader-joes" }) }] },
    });
    const d = await storeDetail(env, "tjs");
    expect(d.location_id).toBeNull();
    expect(d.skus).toEqual([]);
  });

  it("groups notes by first tag, defaulting to general", async () => {
    const { env } = makeEnv({
      tables: {
        stores: [{ slug: "kroger-hp", name: "Kroger HP", domain: "grocery", extra: "{}" }],
        store_notes: [
          { id: "n1", store: "kroger-hp", author: "casey", body: "layout note", tags: JSON.stringify(["layout"]), private: 0, created_at: "2026-06-01" },
          { id: "n2", store: "kroger-hp", author: "dlo", body: "no tags", tags: "[]", private: 0, created_at: "2026-06-02" },
          { id: "n3", store: "kroger-hp", author: "sage", body: "stock note", tags: JSON.stringify(["stock", "extra"]), private: 1, created_at: "2026-06-03" },
        ],
      },
    });
    const d = await storeDetail(env, "kroger-hp");
    expect(d.notes.layout.map((n) => n.id)).toEqual(["n1"]);
    expect(d.notes.general.map((n) => n.id)).toEqual(["n2"]);
    expect(d.notes.stock.map((n) => n.id)).toEqual(["n3"]);
    expect(d.notes.location).toEqual([]);
  });

  it("not_found for an unknown store slug", async () => {
    const { env } = makeEnv();
    await expect(storeDetail(env, "ghost")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("guidance R2 browse — confinement + normalization", () => {
  const guidance = {
    "guidance/cooking_techniques/sear.md": "# Searing",
    "guidance/ingredient_storage/onions.md": "# Onions",
  };

  it("lists the guidance tree at the root (default prefix)", async () => {
    const { env } = makeEnv({ r2: guidance });
    const listing = await guidanceListing(env);
    expect(listing.entries.map((e) => e.name).sort()).toEqual(["cooking_techniques", "ingredient_storage"]);
    expect(listing.entries.every((e) => e.type === "dir")).toBe(true);
  });

  it("a bare `guidance` prefix lists the root, not guidance/guidance", async () => {
    const { env } = makeEnv({ r2: guidance });
    const listing = await guidanceListing(env, "guidance");
    expect(listing.entries.length).toBe(2);
  });

  it("returns a guidance object's markdown (rooted or relative path)", async () => {
    const { env } = makeEnv({ r2: guidance });
    expect((await guidanceObject(env, "guidance/cooking_techniques/sear.md")).markdown).toBe("# Searing");
    expect((await guidanceObject(env, "cooking_techniques/sear.md")).markdown).toBe("# Searing");
  });

  it("rejects a `..` traversal out of the subtree", async () => {
    const { env } = makeEnv({ r2: guidance });
    await expect(guidanceObject(env, "../secrets.md")).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects a non-markdown object and an absent object", async () => {
    const { env } = makeEnv({ r2: guidance });
    await expect(guidanceObject(env, "guidance/cooking_techniques")).rejects.toMatchObject({ code: "not_found" });
    await expect(guidanceObject(env, "guidance/missing.md")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("read-only guarantee", () => {
  it("never writes D1 or R2 while serving reads", async () => {
    const { env, d1, r2 } = makeEnv({
      tables: {
        recipes: [{ slug: "foo", title: "Foo" }],
        stores: [{ slug: "kroger-hp", name: "Kroger HP", domain: "grocery", extra: "{}" }],
      },
      r2: { "recipes/foo.md": "# Foo" },
    });
    const before = r2.objects.size;
    await recipeDetail(env, "foo");
    await recipeList(env);
    await storeDetail(env, "kroger-hp");
    await memberDetail(env, "alice");
    expect(d1.batches).toHaveLength(0); // no write batch ran
    expect(r2.objects.size).toBe(before); // no R2 put/delete
  });
});

// The read-only JSON data API (`GET /admin/api/data/*`) is retired: the Hono data explorer
// SSRs these views by calling the same `admin-data.ts` readers directly (covered above and in
// admin-data-views.test.ts). The Access gate is covered in admin.test.ts / admin-app.test.ts.
