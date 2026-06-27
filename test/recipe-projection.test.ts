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
import type { Env } from "../src/env.js";
import type { KvStore } from "../src/kroger-user.js";
import { serializeMarkdown } from "../src/serialize.js";
import { createR2CorpusStore } from "../src/corpus-store.js";
import { fakeR2 } from "./fake-r2.js";

afterEach(() => vi.unstubAllGlobals());

/** A tiny in-memory KvStore (put/get) for the job-runner health record. */
function makeKv(): KvStore & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
  } as unknown as KvStore & { store: Map<string, string> };
}

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

/** Injected in-memory deps over a `path -> markdown` map; captures what was written. */
function makeDeps(files: Record<string, string>, priorErrorSlugs: string[] = []) {
  const written = { recipes: [] as unknown[][], errors: [] as ReconcileError[] };
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
    const pairsCol = main[1 + 5 + 1 + 5]; // slug + 5 scalars + source_url + (pairs_with is the 5th JSON col)
    expect(JSON.parse(pairsCol as string)).toEqual(["cucumber-salad"]);
  });

  it("projects an empty corpus as an empty index (no errors)", async () => {
    const { deps, written } = makeDeps({});
    const res = await reconcileRecipeIndex(deps);
    expect(res).toEqual({ projected: 0, skipped: 0, errors: [] });
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
    const kv = makeKv();
    const bodies: string[] = [];
    vi.stubGlobal("fetch", (async (_url: string, init: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response("ok");
    }) as unknown as typeof fetch);
    const env = { NTFY_URL: "https://ntfy.test/topic" } as unknown as Env;

    await runProjectionJob(env, deps, kv, () => 1000);

    const health = JSON.parse(kv.store.get("health:job:recipe-index")!);
    expect(health.ok).toBe(true);
    expect(health.summary).toEqual({ projected: 0, skipped: 2 });
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
    };
    const kv = makeKv();
    vi.stubGlobal("fetch", (async () => new Response("ok")) as unknown as typeof fetch);
    const env = {} as unknown as Env; // no NTFY_URL → notifyFailure is a no-op
    await expect(runProjectionJob(env, deps, kv, () => 1000)).rejects.toThrow(/R2 down/);
    const health = JSON.parse(kv.store.get("health:job:recipe-index")!);
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
