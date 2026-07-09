import { describe, it, expect, vi, afterEach } from "vitest";
import {
  reconcileRecipeIndex,
  runProjectionJob,
  recipeToRow,
  deriveSlug,
  hasH2Section,
  buildProjectionDeps,
  type ProjectionDeps,
  type ReconcileError,
} from "../src/recipe-projection.js";
import { readJobHealth } from "../src/health.js";
import type { Env } from "../src/env.js";
import type { IngredientContext } from "../src/corpus-db.js";
import { EMPTY_FACETS, type ClassifiedFacets } from "../src/recipe-facets.js";
import { serializeMarkdown } from "../src/serialize.js";
import { createR2CorpusStore } from "../src/corpus-store.js";
import { buildEmbedDeps } from "../src/recipe-embeddings.js";
import { fakeR2 } from "./fake-r2.js";
import { fakeD1 } from "./fake-d1.js";
import { sqliteEnv } from "./sqlite-d1.js";

afterEach(() => vi.unstubAllGlobals());


const BODY = "## Ingredients\n- x\n\n## Instructions\n1. go\n";

/** A contract-compliant recipe markdown, overriding frontmatter/body fields. */
function recipeMd(over: Record<string, unknown> = {}, body = BODY): string {
  const fm: Record<string, unknown> = {
    title: "Test",
    ingredients_key: ["x"],
    course: ["side"],
    protein: null,
    cuisine: null,
    time_total: null,
    source: null,
    dietary: [],
    season: [],
    tags: [],
    pairs_with: [],
    perishable_ingredients: [],
    requires_equipment: [],
    side_search_terms: [],
    ...over,
  };
  return serializeMarkdown(fm, body);
}

/**
 * A minimal resolve-only fake IngredientContext over a `toId` front-door + `ids`
 * survivor set, mirroring the real capture-off funnel the projection uses:
 * lowercase/trim clean, alias lookup, dedup/drop-empty in `resolveNames`. Capture is
 * the projection's own batched flush (recorded by `makeDeps`), not a context concern.
 */
function fakeContext(over: { toId?: Record<string, string>; ids?: string[] } = {}): IngredientContext {
  const toId = over.toId ?? {};
  const ids = new Set(over.ids ?? []);
  const resolveOne = (term: string): string => {
    const cleaned = term.toLowerCase().trim();
    return toId[cleaned] ?? cleaned;
  };
  return {
    resolver: { toId, ids, searchTerms: {}, displayNames: {} },
    resolve: resolveOne,
    resolveList: (v) => v,
    resolveNames(value: unknown): string[] {
      if (!Array.isArray(value)) return [];
      const seen = new Set<string>();
      const out: string[] = [];
      for (const entry of value) {
        if (typeof entry !== "string") continue;
        const norm = resolveOne(entry);
        if (norm && !seen.has(norm)) {
          seen.add(norm);
          out.push(norm);
        }
      }
      return out;
    },
    base: (id) => id,
    searchTerm: (id) => id,
    displayName: () => undefined,
    idLabel: (id) => id,
    satisfiesAmong: async () => [],
  };
}

/** Injected in-memory deps over a `path -> markdown` map; captures what was written. */
function makeDeps(
  files: Record<string, string>,
  priorErrorSlugs: string[] = [],
  classified: Map<string, ClassifiedFacets> = new Map(),
  funnel: { ctx?: IngredientContext; degraded?: boolean } = {},
) {
  const written = {
    recipes: [] as unknown[][],
    errors: [] as ReconcileError[],
    /** Each enqueueNovelTerms call's batch — the projection flushes at most once per pass. */
    enqueued: [] as string[][],
  };
  const deps: ProjectionDeps = {
    listRecipePaths: async () => Object.keys(files),
    readRecipe: async (p) => files[p] ?? null,
    replaceRecipes: async (rows) => {
      written.recipes = rows;
    },
    replaceErrors: async (errs) => {
      written.errors = errs;
    },
    loadErrorSlugs: async () => priorErrorSlugs,
    loadClassifiedFacets: async () => classified,
    ingredientContext: async () => ({ ctx: funnel.ctx ?? fakeContext(), degraded: funnel.degraded ?? false }),
    enqueueNovelTerms: async (terms) => {
      written.enqueued.push(terms);
    },
  };
  return { deps, written };
}

/** Pull a slug out of a projected positional row (slug is column 0). */
const rowSlugs = (rows: unknown[][]) => rows.map((r) => r[0]).sort();

describe("deriveSlug / hasH2Section", () => {
  it("derives the basename slug from a nested path", () => {
    expect(deriveSlug("recipes/thai-curry.md")).toBe("thai-curry");
    expect(deriveSlug("recipes/sub/foo.md")).toBe("foo");
  });
  it("detects the required H2 sections", () => {
    expect(hasH2Section(BODY, "Ingredients")).toBe(true);
    expect(hasH2Section(BODY, "Instructions")).toBe(true);
    expect(hasH2Section("## Ingredients\n- x\n", "Instructions")).toBe(false);
  });
});

describe("reconcileRecipeIndex — valid corpus", () => {
  it("projects a well-formed corpus including resolved pairs_with", async () => {
    const { deps, written } = makeDeps({
      "recipes/miso-salmon.md": recipeMd({
        title: "Miso Salmon",
        course: ["main"],
        protein: "fish",
        pairs_with: ["cucumber-salad"],
        side_search_terms: ["a bright cucumber salad"],
      }),
      "recipes/cucumber-salad.md": recipeMd({ title: "Cucumber Salad", course: ["side"] }),
    });
    const res = await reconcileRecipeIndex(deps);

    expect(res.projected).toBe(2);
    expect(res.skipped).toBe(0);
    expect(res.errors).toEqual([]);
    expect(rowSlugs(written.recipes)).toEqual(["cucumber-salad", "miso-salmon"]);

    // The main's pairs_with column (a JSON-array TEXT column) carries the resolved ref.
    const main = written.recipes.find((r) => r[0] === "miso-salmon")!;
    const pairsCol = main[1 + 5 + 1 + 6]; // slug + 5 scalars + source_url + (pairs_with is the 6th JSON col)
    expect(JSON.parse(pairsCol as string)).toEqual(["cucumber-salad"]);
  });

  it("projects an empty corpus as an empty index (no errors)", async () => {
    const { deps, written } = makeDeps({});
    const res = await reconcileRecipeIndex(deps);
    expect(res).toEqual({ projected: 0, skipped: 0, tombstoned: 0, unresolved: 0, degraded: false, errors: [] });
    expect(written.recipes).toEqual([]);
  });
});

describe("reconcileRecipeIndex — invalid recipes are skipped and recorded", () => {
  it("skips an off-vocabulary protein, projecting the rest", async () => {
    const { deps, written } = makeDeps({
      "recipes/good.md": recipeMd({ title: "Good" }),
      "recipes/bad.md": recipeMd({ title: "Bad", protein: "poltry" }),
    });
    const res = await reconcileRecipeIndex(deps);

    expect(res.projected).toBe(1);
    expect(res.skipped).toBe(1);
    expect(rowSlugs(written.recipes)).toEqual(["good"]);
    expect(written.errors).toHaveLength(1);
    expect(written.errors[0].slug).toBe("bad");
    expect(written.errors[0].message).toMatch(/protein/);
  });

  it("skips a recipe missing a required body section", async () => {
    const { deps, written } = makeDeps({
      "recipes/no-steps.md": recipeMd({ title: "No Steps" }, "## Ingredients\n- x\n"),
    });
    const res = await reconcileRecipeIndex(deps);
    expect(res.projected).toBe(0);
    expect(written.errors[0]).toMatchObject({ slug: "no-steps" });
    expect(written.errors[0].message).toMatch(/## Instructions/);
  });

  it("records a duplicate slug across two paths (first wins)", async () => {
    const { deps, written } = makeDeps({
      "recipes/a/foo.md": recipeMd({ title: "Foo A" }),
      "recipes/b/foo.md": recipeMd({ title: "Foo B" }),
    });
    const res = await reconcileRecipeIndex(deps);
    expect(res.projected).toBe(1); // the first path wins
    expect(written.errors).toHaveLength(1);
    expect(written.errors[0].slug).toBe("foo");
    expect(written.errors[0].message).toMatch(/duplicate slug/);
  });
});

describe("reconcileRecipeIndex — dangling pairs_with is flagged corpus-wide", () => {
  it("flags and drops a recipe referencing a non-existent slug", async () => {
    const { deps, written } = makeDeps({
      "recipes/orphan-main.md": recipeMd({
        title: "Orphan Main",
        course: ["main"],
        pairs_with: ["ghost-side"],
        side_search_terms: ["something green"],
      }),
      "recipes/real-side.md": recipeMd({ title: "Real Side", course: ["side"] }),
    });
    const res = await reconcileRecipeIndex(deps);

    // The referring recipe is dropped from the index; the valid side remains.
    expect(rowSlugs(written.recipes)).toEqual(["real-side"]);
    expect(res.skipped).toBe(1);
    expect(written.errors[0]).toMatchObject({ slug: "orphan-main" });
    expect(written.errors[0].message).toMatch(/pairs_with references unknown recipe "ghost-side"/);
  });
});

describe("reconcileRecipeIndex — the duplicate_of tombstone (recipe-dedup)", () => {
  it("excludes a duplicate_of-marked recipe deliberately: no row, no error, counted", async () => {
    const { deps, written } = makeDeps({
      "recipes/keep.md": recipeMd({ title: "Keep" }),
      "recipes/dup.md": recipeMd({ title: "Dup", duplicate_of: "keep" }),
    });
    const res = await reconcileRecipeIndex(deps);
    expect(rowSlugs(written.recipes)).toEqual(["keep"]);
    expect(res.tombstoned).toBe(1);
    expect(res.skipped).toBe(0); // a tombstone is a curation decision, not a defect
    expect(written.errors).toEqual([]);
  });

  it("removing the marker restores the row on the next run", async () => {
    const files = {
      "recipes/keep.md": recipeMd({ title: "Keep" }),
      "recipes/dup.md": recipeMd({ title: "Dup", duplicate_of: "keep" }),
    };
    const first = makeDeps(files);
    await reconcileRecipeIndex(first.deps);
    expect(rowSlugs(first.written.recipes)).toEqual(["keep"]);

    files["recipes/dup.md"] = recipeMd({ title: "Dup" }); // marker removed
    const second = makeDeps(files);
    const res = await reconcileRecipeIndex(second.deps);
    expect(rowSlugs(second.written.recipes)).toEqual(["dup", "keep"]);
    expect(res.tombstoned).toBe(0);
  });

  it("an EMPTY-string duplicate_of is ignored (projects normally)", async () => {
    const { deps, written } = makeDeps({
      "recipes/plain.md": recipeMd({ title: "Plain", duplicate_of: "" }),
    });
    const res = await reconcileRecipeIndex(deps);
    expect(rowSlugs(written.recipes)).toEqual(["plain"]);
    expect(res.tombstoned).toBe(0);
    expect(written.errors).toEqual([]);
  });

  it("integration: after a tombstoned projection the embed reconcile's orphan prune drops the derived row", async () => {
    // Real migrated SQLite + real projection deps: the tombstoned slug leaves `recipes`,
    // so the recipe-derived PRUNE_SQL (and, likewise, the dup-scan's stamp prune — both
    // key off the slug's absence) converges the derived state with no tombstone-specific
    // machinery.
    const s = sqliteEnv();
    const store = createR2CorpusStore(
      fakeR2({
        "recipes/keep.md": recipeMd({ title: "Keep" }),
        "recipes/dup.md": recipeMd({ title: "Dup", duplicate_of: "keep" }),
      }).bucket,
    );
    for (const slug of ["keep", "dup"]) {
      await (s.env.DB.prepare("INSERT INTO recipe_derived (slug, embedding, description_hash) VALUES (?1, ?2, ?3)")
        .bind(slug, JSON.stringify([1, 0]), `dh-${slug}`) as unknown as { run(): Promise<unknown> }).run();
    }
    const res = await reconcileRecipeIndex(buildProjectionDeps(s.env, store));
    expect(res.tombstoned).toBe(1);
    expect(s.rows<{ slug: string }>("recipes").map((r) => r.slug)).toEqual(["keep"]);

    const pruned = await buildEmbedDeps(s.env).pruneOrphans();
    expect(pruned).toBe(1);
    expect(s.rows<{ slug: string }>("recipe_derived").map((r) => r.slug)).toEqual(["keep"]);
  });
});

// Positional JSON-column offsets in a projected row (RECIPE_COLUMNS order):
// slug + 5 scalars + source_url, then the JSON columns.
const COL_INGREDIENTS_KEY = 7;
const COL_INGREDIENTS_FULL = 8;
const COL_PERISHABLE = 14;

describe("reconcileRecipeIndex — projection-time re-resolution (the IngredientContext funnel)", () => {
  it("writes surviving canonical ids; an unmapped term projects as its cleaned form", async () => {
    const ctx = fakeContext({ toId: { scallions: "green-onion" }, ids: ["green-onion"] });
    const classified = new Map<string, ClassifiedFacets>([
      [
        "soup",
        {
          ...EMPTY_FACETS,
          ingredients_key: ["scallions", "Mystery Leaf"],
          ingredients_full: ["scallions", "Mystery Leaf", "olive oil"],
          perishable_ingredients: ["scallions"],
        },
      ],
    ]);
    const { deps, written } = makeDeps({ "recipes/soup.md": recipeMd({ title: "Soup" }) }, [], classified, { ctx });
    const res = await reconcileRecipeIndex(deps);

    const row = written.recipes[0];
    expect(JSON.parse(row[COL_INGREDIENTS_KEY] as string)).toEqual(["green-onion", "mystery leaf"]);
    // ingredients_full re-resolves through the SAME funnel and round-trips its own column.
    expect(JSON.parse(row[COL_INGREDIENTS_FULL] as string)).toEqual(["green-onion", "mystery leaf", "olive oil"]);
    expect(JSON.parse(row[COL_PERISHABLE] as string)).toEqual(["green-onion"]);
    // "mystery leaf" + "olive oil" are the projected ids the resolver has not placed.
    expect(res.unresolved).toBe(2);
  });

  it("does not silently re-point a stored canonical id that has no alias-variant row", async () => {
    // "spring-onion" was stored as a canonical id but the graph has no alias row for it
    // (e.g. a merged-away id whose surface term never got a variant). It is NOT
    // re-pointed to the survivor: it projects cleaned/unchanged, counts unresolved, and
    // is enqueued for capture — convergence is eventual, via the capture job.
    const ctx = fakeContext({ toId: { scallions: "green-onion" }, ids: ["green-onion"] });
    const classified = new Map<string, ClassifiedFacets>([
      ["soup", { ...EMPTY_FACETS, ingredients_key: ["spring-onion"], perishable_ingredients: [] }],
    ]);
    const { deps, written } = makeDeps({ "recipes/soup.md": recipeMd({ title: "Soup" }) }, [], classified, { ctx });
    const res = await reconcileRecipeIndex(deps);

    expect(JSON.parse(written.recipes[0][COL_INGREDIENTS_KEY] as string)).toEqual(["spring-onion"]);
    expect(res.unresolved).toBe(1);
    expect(written.enqueued).toEqual([["spring-onion"]]);
  });

  it("flushes ONE batch of distinct unplaced ids — deduped across recipes, never a known survivor, from both facet fields and authored Tier-A fallbacks", async () => {
    const ctx = fakeContext({ ids: ["salt"] });
    const classified = new Map<string, ClassifiedFacets>([
      // Both classified recipes share "scallions" (dedup) and carry the known "salt".
      ["a", { ...EMPTY_FACETS, ingredients_key: ["scallions", "salt"], perishable_ingredients: ["scallions"] }],
      ["b", { ...EMPTY_FACETS, ingredients_key: ["scallions"], perishable_ingredients: ["fresh dill"] }],
    ]);
    const { deps, written } = makeDeps(
      {
        "recipes/a.md": recipeMd({ title: "A" }),
        "recipes/b.md": recipeMd({ title: "B" }),
        // No classified row: the merge falls back to the authored Tier-A values, which
        // go through the same funnel.
        "recipes/c.md": recipeMd({ title: "C", ingredients_key: ["Heirloom Beans"] }),
      },
      [],
      classified,
      { ctx },
    );
    await reconcileRecipeIndex(deps);

    // Exactly one flush call; the distinct-set dedup means "scallions" appears once,
    // and the known survivor "salt" is never enqueued. Sorted for determinism.
    expect(written.enqueued).toEqual([["fresh dill", "heirloom beans", "scallions"]]);
  });

  it("survives a flush failure — the pass still projects and succeeds", async () => {
    const { deps, written } = makeDeps({ "recipes/a.md": recipeMd({ title: "A" }) });
    deps.enqueueNovelTerms = async () => {
      throw new Error("queue write failed");
    };
    const res = await reconcileRecipeIndex(deps);
    expect(res.projected).toBe(1);
    expect(written.recipes).toHaveLength(1);
  });

  it("degrades on an empty context: every recipe projects with stored values passed through, nothing enqueued", async () => {
    const classified = new Map<string, ClassifiedFacets>([
      ["a", { ...EMPTY_FACETS, ingredients_key: ["scallions"], perishable_ingredients: [] }],
    ]);
    const { deps, written } = makeDeps(
      { "recipes/a.md": recipeMd({ title: "A" }), "recipes/b.md": recipeMd({ title: "B" }) },
      [],
      classified,
      { ctx: fakeContext(), degraded: true },
    );
    const res = await reconcileRecipeIndex(deps);

    expect(res.projected).toBe(2);
    expect(res.degraded).toBe(true);
    expect(written.enqueued).toEqual([]); // no flush on a degraded pass
    const a = written.recipes.find((r) => r[0] === "a")!;
    expect(JSON.parse(a[COL_INGREDIENTS_KEY] as string)).toEqual(["scallions"]); // cleaned passthrough
    // The empty resolver places nothing, so every distinct term reports unresolved (the spike).
    expect(res.unresolved).toBe(2); // "scallions" + b's "x"
  });

  it("still projects through the real wiring when the resolver read fails (buildProjectionDeps + fakeD1)", async () => {
    const fake = fakeD1({ tables: { recipes: [], reconcile_errors: [], novel_ingredient_terms: [] } });
    const realPrepare = fake.env.DB.prepare.bind(fake.env.DB);
    (fake.env.DB as { prepare: (sql: string) => unknown }).prepare = (sql: string) => {
      if (/ingredient_identity|ingredient_alias/i.test(sql)) throw new Error("resolver read failed");
      return realPrepare(sql);
    };
    const { bucket } = fakeR2({ "recipes/a.md": recipeMd({ title: "A" }) });
    const deps = buildProjectionDeps(fake.env, createR2CorpusStore(bucket));
    const res = await reconcileRecipeIndex(deps);

    expect(res.projected).toBe(1); // the projection succeeded despite the resolver failure
    expect(res.degraded).toBe(true);
    expect(fake.tables.recipes).toHaveLength(1); // the row really was written
    expect(fake.tables.novel_ingredient_terms).toEqual([]); // no flush on a degraded pass
  });

  it("flushes to the real novel-term queue through the real wiring (buildProjectionDeps + fakeD1)", async () => {
    const fake = fakeD1({ tables: { recipes: [], novel_ingredient_terms: [] } });
    const { bucket } = fakeR2({ "recipes/a.md": recipeMd({ title: "A" }) });
    const deps = buildProjectionDeps(fake.env, createR2CorpusStore(bucket));
    const res = await reconcileRecipeIndex(deps);

    expect(res.degraded).toBe(false); // empty identity tables read fine — not a failure
    expect(res.unresolved).toBe(1); // "x" is unplaced
    expect(fake.tables.novel_ingredient_terms.map((r) => r.term)).toEqual(["x"]);
  });
});

describe("runProjectionJob — unresolved convergence gauge + degraded flag in the summary", () => {
  it("counts distinct unresolved terms across recipes", async () => {
    const ctx = fakeContext({ ids: ["x"] });
    const { deps } = makeDeps(
      {
        // Both share the unknown "weird thing"; "x" is a known survivor.
        "recipes/a.md": recipeMd({ title: "A", ingredients_key: ["x", "weird thing"] }),
        "recipes/b.md": recipeMd({ title: "B", ingredients_key: ["weird thing"] }),
      },
      [],
      new Map(),
      { ctx },
    );
    const env = fakeD1().env;
    await runProjectionJob(env, deps, () => 1000);
    const health = (await readJobHealth(env, "recipe-index"))!;
    expect(health.summary).toEqual({ projected: 2, skipped: 0, tombstoned: 0, unresolved: 1, degraded: false });
  });

  it("reports zero when every projected term resolves", async () => {
    const ctx = fakeContext({ ids: ["x"] });
    const { deps } = makeDeps({ "recipes/a.md": recipeMd({ title: "A" }) }, [], new Map(), { ctx });
    const env = fakeD1().env;
    await runProjectionJob(env, deps, () => 1000);
    const health = (await readJobHealth(env, "recipe-index"))!;
    expect(health.summary).toEqual({ projected: 1, skipped: 0, tombstoned: 0, unresolved: 0, degraded: false });
  });

  it("flags a degraded pass in the summary while the job stays ok", async () => {
    const { deps } = makeDeps({ "recipes/a.md": recipeMd({ title: "A" }) }, [], new Map(), {
      degraded: true,
    });
    const env = fakeD1().env;
    await runProjectionJob(env, deps, () => 1000);
    const health = (await readJobHealth(env, "recipe-index"))!;
    expect(health.ok).toBe(true); // the projection genuinely succeeded
    expect(health.summary).toEqual({ projected: 1, skipped: 0, tombstoned: 0, unresolved: 1, degraded: true });
  });
});

describe("recipeToRow — projection shape (mirrors the recipes table / recipe-index.ts)", () => {
  it("promotes scalars + source_url, JSON-encodes arrays, and carries leftovers in extra", () => {
    const row = recipeToRow({
      slug: "x",
      title: "X",
      protein: "beef",
      cuisine: "italian",
      time_total: 40,
      source: "https://ex.com/x",
      ingredients_key: ["beef"],
      course: ["main"],
      season: [],
      dietary: [],
      tags: [],
      pairs_with: [],
      perishable_ingredients: [],
      requires_equipment: [],
      side_search_terms: ["a salad"],
      servings: 4, // a free-form objective field → extra
    });
    // [slug, title, protein, cuisine, time_total, discovered_at, source_url, ...9 json cols, extra]
    expect(row[0]).toBe("x");
    expect(row.slice(1, 5)).toEqual(["X", "beef", "italian", 40]);
    expect(row[5]).toBeNull(); // discovered_at (none on this recipe)
    expect(row[6]).toBe("https://ex.com/x"); // source_url
    expect(JSON.parse(row[7] as string)).toEqual(["beef"]); // ingredients_key
    expect(JSON.parse(row[row.length - 1] as string)).toEqual({ servings: 4 }); // extra
  });

  it("promotes discovered_at to its own column and keeps discovery_source in extra", () => {
    const row = recipeToRow({
      slug: "d",
      title: "D",
      protein: null,
      cuisine: null,
      time_total: null,
      source: null,
      ingredients_key: ["x"],
      course: ["main"],
      season: [],
      dietary: [],
      tags: [],
      pairs_with: [],
      perishable_ingredients: [],
      requires_equipment: [],
      side_search_terms: ["a salad"],
      discovered_at: "2025-05-20", // promoted column (migration 0016)
      discovery_source: "serious-eats", // NOT promoted → stays in extra
    });
    expect(row[5]).toBe("2025-05-20"); // discovered_at column
    expect(JSON.parse(row[row.length - 1] as string)).toEqual({ discovery_source: "serious-eats" });
  });
});

describe("runProjectionJob — health record + new-error alert", () => {
  it("writes an ok health summary and ntfy-alerts only NEW invalid recipes (de-spam)", async () => {
    // bad1 was already recorded last tick; bad2 is new this tick.
    const { deps } = makeDeps(
      {
        "recipes/bad1.md": recipeMd({ title: "Bad1", protein: "poltry" }),
        "recipes/bad2.md": recipeMd({ title: "Bad2", cuisine: "klingon" }),
      },
      ["bad1"],
    );
    const bodies: string[] = [];
    vi.stubGlobal("fetch", (async (_url: string, init: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response("ok");
    }) as unknown as typeof fetch);
    const env = { ...fakeD1().env, NTFY_URL: "https://ntfy.test/topic" } as unknown as Env;

    await runProjectionJob(env, deps, () => 1000);

    const health = (await readJobHealth(env, "recipe-index"))!;
    expect(health.ok).toBe(true);
    expect(health.summary).toEqual({ projected: 0, skipped: 2, tombstoned: 0, unresolved: 0, degraded: false });
    // exactly one alert, naming the NEW failure only
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatch(/1 recipe\(s\) failed to index/);
    expect(bodies[0]).toContain("bad2");
    expect(bodies[0]).not.toContain("bad1");
  });

  it("records ok:false and rethrows a hard job failure (R2/D1)", async () => {
    const deps: ProjectionDeps = {
      listRecipePaths: async () => {
        throw new Error("R2 down");
      },
      readRecipe: async () => null,
      replaceRecipes: async () => {},
      replaceErrors: async () => {},
      loadErrorSlugs: async () => [],
      loadClassifiedFacets: async () => new Map(),
      ingredientContext: async () => ({ ctx: fakeContext(), degraded: false }),
      enqueueNovelTerms: async () => {},
    };
    vi.stubGlobal("fetch", (async () => new Response("ok")) as unknown as typeof fetch);
    const env = fakeD1().env; // no NTFY_URL → notifyFailure is a no-op
    await expect(runProjectionJob(env, deps, () => 1000)).rejects.toThrow(/R2 down/);
    const health = (await readJobHealth(env, "recipe-index"))!;
    expect(health.ok).toBe(false);
  });
});

describe("buildProjectionDeps — R2 listing", () => {
  it("lists every recipe object recursively from the corpus store", async () => {
    const { bucket } = fakeR2({
      "recipes/a.md": recipeMd(),
      "recipes/sub/b.md": recipeMd(),
      "guidance/purchasing/olive-oil.md": "not a recipe",
    });
    const store = createR2CorpusStore(bucket);
    const deps = buildProjectionDeps({} as never, store);
    const paths = await deps.listRecipePaths();
    expect(paths.sort()).toEqual(["recipes/a.md", "recipes/sub/b.md"]);
  });
});
