// The browse-row ops (member-app-differentiators D7/D8) over the REAL-SQLite env:
// the trending min-signal guard replayed against the PRODUCTION-SHAPED sparse log
// (single cooks → empty, the acceptance fixture) and a threshold-crossing log
// (ordering, window floor, reject filter, unprojected-slug drop, counts only);
// picked-for-you determinism, exclusions (favorites/rejects/dietary avoids),
// empty-favorites honesty, and the zero-env.AI guarantee.
import { describe, it, expect } from "vitest";
import {
  readTrending,
  readPickedForYou,
  conflictsWithAvoids,
  favoritesCentroid,
} from "../src/cookbook-rows.js";
import { sqliteEnv, type SqliteEnv } from "./sqlite-d1.js";

const T = "casey";
const OTHER = "pat";

const DAY = 86_400_000;
const day = (offset: number) => new Date(Date.now() - offset * DAY).toISOString().slice(0, 10);

function seedRecipe(h: SqliteEnv, slug: string, over: { protein?: string; keys?: string[]; course?: string[] } = {}): void {
  h.raw
    .prepare("INSERT INTO recipes (slug, title, protein, cuisine, time_total, ingredients_key, course) VALUES (?, ?, ?, 'x', 30, ?, ?)")
    .run(
      slug,
      slug.toUpperCase(),
      over.protein ?? null,
      over.keys ? JSON.stringify(over.keys) : null,
      over.course ? JSON.stringify(over.course) : null,
    );
}

function seedCook(h: SqliteEnv, tenant: string, recipe: string, date: string): void {
  h.raw
    .prepare("INSERT INTO cooking_log (tenant, date, type, recipe) VALUES (?, ?, 'recipe', ?)")
    .run(tenant, date, recipe);
}

function seedOverlay(h: SqliteEnv, tenant: string, recipe: string, o: { favorite?: boolean; reject?: boolean }): void {
  h.raw
    .prepare("INSERT INTO overlay (tenant, recipe, favorite, reject) VALUES (?, ?, ?, ?)")
    .run(tenant, recipe, o.favorite ? 1 : 0, o.reject ? 1 : 0);
}

function seedEmbedding(h: SqliteEnv, slug: string, vec: number[]): void {
  h.raw
    .prepare(
      "INSERT INTO recipe_derived (slug, description, embedding) VALUES (?, ?, ?) " +
        "ON CONFLICT(slug) DO UPDATE SET embedding = excluded.embedding",
    )
    .run(slug, `about ${slug}`, JSON.stringify(vec));
}

/** env.AI must NEVER be touched by these reads (the P1 mock pattern). */
function armAiTrap(h: SqliteEnv): void {
  (h.env as unknown as { AI: unknown }).AI = {
    run() {
      throw new Error("env.AI must not be called by the browse-row reads");
    },
  };
}

describe("readTrending — the min-signal guard (D7)", () => {
  it("the PRODUCTION-SHAPED sparse log (2 recipes, 1 cook each) yields an EMPTY trending set", async () => {
    const h = sqliteEnv([T, OTHER]);
    seedRecipe(h, "one-pot");
    seedRecipe(h, "salmon-bowl");
    seedCook(h, T, "one-pot", day(12));
    seedCook(h, OTHER, "salmon-bowl", day(7));
    armAiTrap(h);
    const res = await readTrending(h.env, T);
    expect(res.recipes).toEqual([]); // never rank single cooks as "trending"
    expect(res.window_days).toBe(60);
  });

  it("a threshold-crossing log trends with COUNTS ONLY, deterministically ordered", async () => {
    const h = sqliteEnv([T, OTHER]);
    for (const s of ["ragu", "tacos", "soup"]) seedRecipe(h, s);
    // ragu: 3 cooks / 2 tenants; tacos: 2 cooks / 1 tenant; soup: 1 cook (below guard).
    seedCook(h, T, "ragu", day(2));
    seedCook(h, T, "ragu", day(9));
    seedCook(h, OTHER, "ragu", day(5));
    seedCook(h, T, "tacos", day(1));
    seedCook(h, T, "tacos", day(4));
    seedCook(h, OTHER, "soup", day(3));
    const res = await readTrending(h.env, T);
    expect(res.recipes.map((r) => r.slug)).toEqual(["ragu", "tacos"]);
    expect(res.recipes[0]).toMatchObject({ cooks: 3, cooks_by: 2, last_cooked: day(2), title: "RAGU" });
    expect(res.recipes[1]).toMatchObject({ cooks: 2, cooks_by: 1 });
    // Counts only — no member identity rides any row.
    for (const r of res.recipes) expect(Object.keys(r)).not.toContain("tenant");
  });

  it("qualifies on distinct tenants even at one cook each (≥ 2 cooks OR ≥ 2 tenants)", async () => {
    const h = sqliteEnv([T, OTHER]);
    seedRecipe(h, "stew");
    seedCook(h, T, "stew", day(3));
    seedCook(h, OTHER, "stew", day(6));
    const res = await readTrending(h.env, T);
    expect(res.recipes[0]).toMatchObject({ slug: "stew", cooks: 2, cooks_by: 2 });
  });

  it("applies the window floor, drops unprojected slugs, and filters the CALLER's rejects", async () => {
    const h = sqliteEnv([T, OTHER]);
    seedRecipe(h, "old-favorite");
    seedRecipe(h, "rejected-dish");
    // Crossing the guard, but entirely OUTSIDE the 60-day window.
    seedCook(h, T, "old-favorite", day(90));
    seedCook(h, T, "old-favorite", day(80));
    // Crossing inside the window, but the CALLER rejected it.
    seedCook(h, T, "rejected-dish", day(2));
    seedCook(h, OTHER, "rejected-dish", day(3));
    seedOverlay(h, T, "rejected-dish", { reject: true });
    // Crossing inside the window, but never projected into the index.
    seedCook(h, T, "ghost-recipe", day(2));
    seedCook(h, OTHER, "ghost-recipe", day(3));
    expect((await readTrending(h.env, T)).recipes).toEqual([]);
    // The reject is the CALLER's lens: the other member still sees the dish trend.
    const other = await readTrending(h.env, OTHER);
    expect(other.recipes.map((r) => r.slug)).toEqual(["rejected-dish"]);
  });

  it("a repeat-cooked non-main never trends; a main and an unclassified recipe still do", async () => {
    const h = sqliteEnv([T, OTHER]);
    // Twice-cooked component (real history, not a meal suggestion) + a side, both gated;
    // a twice-cooked main and a twice-cooked NOT-YET-CLASSIFIED recipe (empty course —
    // the fail-open case) both still trend.
    seedRecipe(h, "pasta-dough", { course: ["component"] });
    seedRecipe(h, "garlic-bread", { course: ["side"] });
    seedRecipe(h, "ragu", { course: ["main", "side"] });
    seedRecipe(h, "fresh-import"); // course NULL — unclassified
    for (const slug of ["pasta-dough", "garlic-bread", "ragu", "fresh-import"]) {
      seedCook(h, T, slug, day(2));
      seedCook(h, OTHER, slug, day(4));
    }
    const res = await readTrending(h.env, T);
    expect(res.recipes.map((r) => r.slug)).toEqual(["fresh-import", "ragu"]);
  });
});

describe("readPickedForYou — deterministic favorites-centroid ranking (D8)", () => {
  function seedCorpus(h: SqliteEnv): void {
    seedRecipe(h, "fav-dish");
    seedRecipe(h, "near-fav");
    seedRecipe(h, "far-dish");
    seedRecipe(h, "unembedded");
    seedEmbedding(h, "fav-dish", [1, 0, 0, 0]);
    seedEmbedding(h, "near-fav", [0.9, 0.1, 0, 0]);
    seedEmbedding(h, "far-dish", [0, 0, 1, 0]);
    seedOverlay(h, T, "fav-dish", { favorite: true });
  }

  it("ranks near the favorites centroid, excluding favorites and unembedded recipes; zero env.AI", async () => {
    const h = sqliteEnv([T]);
    seedCorpus(h);
    armAiTrap(h);
    const res = await readPickedForYou(h.env, T);
    expect(res.recipes.map((r) => r.slug)).toEqual(["near-fav", "far-dish"]);
    // Lite rows only — no scores, no why-labels.
    expect(Object.keys(res.recipes[0]).sort()).toEqual(
      ["cuisine", "description", "protein", "slug", "time_total", "title"].sort(),
    );
  });

  it("is deterministic: the same inputs produce the same order", async () => {
    const h = sqliteEnv([T]);
    seedCorpus(h);
    const a = await readPickedForYou(h.env, T);
    const b = await readPickedForYou(h.env, T);
    expect(a).toEqual(b);
  });

  it("no favorites → an EMPTY result, never a backfill from the general index", async () => {
    const h = sqliteEnv([T]);
    seedRecipe(h, "anything");
    seedEmbedding(h, "anything", [1, 0, 0, 0]);
    armAiTrap(h);
    expect((await readPickedForYou(h.env, T)).recipes).toEqual([]);
    // A favorite WITHOUT a stored vector is the same cold start (stored vectors only).
    seedOverlay(h, T, "unembedded-fav", { favorite: true });
    expect((await readPickedForYou(h.env, T)).recipes).toEqual([]);
  });

  it("rejects and dietary-avoid conflicts never appear as picks", async () => {
    const h = sqliteEnv([T]);
    seedCorpus(h);
    seedRecipe(h, "rejected", {});
    seedEmbedding(h, "rejected", [0.95, 0, 0, 0]);
    seedOverlay(h, T, "rejected", { reject: true });
    seedRecipe(h, "shrimp-boil", { protein: "shellfish" });
    seedEmbedding(h, "shrimp-boil", [0.99, 0, 0, 0]);
    h.raw
      .prepare("INSERT INTO profile (tenant, dietary) VALUES (?, ?)")
      .run(T, JSON.stringify({ avoid: ["shellfish"], limit: [] }));
    const res = await readPickedForYou(h.env, T);
    expect(res.recipes.map((r) => r.slug)).toEqual(["near-fav", "far-dish"]);
  });

  it("a non-main near the centroid is never a pick; an unclassified (empty-course) recipe stays eligible", async () => {
    const h = sqliteEnv([T]);
    seedCorpus(h); // near-fav / far-dish have a NULL course (unclassified — fail-open)
    // A component sub-recipe nearer the favorites centroid than every real candidate.
    seedRecipe(h, "pasta-dough", { course: ["component"] });
    seedEmbedding(h, "pasta-dough", [0.99, 0.01, 0, 0]);
    seedRecipe(h, "garlic-bread", { course: ["side"] });
    seedEmbedding(h, "garlic-bread", [0.98, 0.02, 0, 0]);
    armAiTrap(h);
    const res = await readPickedForYou(h.env, T);
    expect(res.recipes.map((r) => r.slug)).toEqual(["near-fav", "far-dish"]);
  });
});

describe("the dietary-avoid conflict predicate + the centroid", () => {
  it("conflicts on the protein facet or a normalized ingredient entry — exact matches only", () => {
    expect(conflictsWithAvoids({ slug: "a", protein: "shellfish" }, ["shellfish"])).toBe(true);
    expect(conflictsWithAvoids({ slug: "a", ingredients_full: ["shrimp", "rice"] }, ["shrimp"])).toBe(true);
    expect(conflictsWithAvoids({ slug: "a", ingredients_key: ["pork belly"] }, ["pork belly"])).toBe(true);
    // No substring guessing: "pork" does not conflict with "pork belly" entries.
    expect(conflictsWithAvoids({ slug: "a", ingredients_key: ["pork belly"] }, ["pork"])).toBe(false);
    expect(conflictsWithAvoids({ slug: "a", protein: "fish" }, [])).toBe(false);
  });

  it("the centroid is the normalized mean; degenerate inputs return null", () => {
    expect(favoritesCentroid([])).toBeNull();
    expect(favoritesCentroid([[0, 0]])).toBeNull(); // zero norm — nothing to rank against
    const c = favoritesCentroid([
      [1, 0],
      [0, 1],
    ])!;
    expect(c[0]).toBeCloseTo(Math.SQRT1_2);
    expect(c[1]).toBeCloseTo(Math.SQRT1_2);
  });
});
