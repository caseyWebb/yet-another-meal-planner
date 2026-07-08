// The `ingredients_full` Tier A facet (member-app-grocery D2): the 0040 migration's
// gate-clear semantics over REAL SQLite (values untouched, every row re-derivable), and
// the two import-time seed paths carrying the field so a new recipe is derivable on day
// one (before any cron tick).
import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { seedRecipeFacets, seedClassifiedFacets } from "../src/recipe-classify.js";
import { sqliteEnv } from "./sqlite-d1.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "d1");

describe("migration 0040 (gate-clear reclassification)", () => {
  it("leaves every stored facet VALUE intact while making every row stale (body_hash NULL)", () => {
    const raw = new DatabaseSync(":memory:");
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    // Apply everything BEFORE 0040, seed a classified row, then apply 0040 — the exact
    // production sequence (the corpus is already classified when the migration lands).
    for (const f of files.filter((f) => f < "0040")) raw.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
    raw
      .prepare(
        "INSERT INTO recipe_facets (slug, body_hash, protein, cuisine, course, season, tags, " +
          "ingredients_key, perishable_ingredients, side_search_terms, meal_preppable) " +
          "VALUES ('stew', 'hash-1', 'chicken', 'american', '[\"main\"]', '[]', '[\"cozy\"]', " +
          "'[\"chicken\",\"black beans\"]', '[\"cilantro\"]', '[\"crusty bread\"]', 1)",
      )
      .run();
    for (const f of files.filter((f) => f >= "0040")) raw.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));

    const row = raw.prepare("SELECT * FROM recipe_facets WHERE slug = 'stew'").get() as Record<string, unknown>;
    expect(row.body_hash).toBeNull(); // stale → the bounded classify pass re-derives organically
    expect(row.ingredients_full).toBeNull(); // NULL until derived — underived to consumers, never []
    // Stored values are untouched by the gate-clear (no data loss; convergence is hash-gated).
    expect(row.protein).toBe("chicken");
    expect(JSON.parse(row.ingredients_key as string)).toEqual(["chicken", "black beans"]);
    expect(JSON.parse(row.perishable_ingredients as string)).toEqual(["cilantro"]);
    expect(row.meal_preppable).toBe(1);
    // recipes gained the projected column too.
    const cols = raw.prepare("SELECT name FROM pragma_table_info('recipes')").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("ingredients_full");
  });
});

/** The full classifier output the fake env.AI returns (contract-valid for a main). */
const CLASSIFIED = {
  protein: "chicken",
  cuisine: "american",
  course: ["main"],
  time_total: 40,
  ingredients_key: ["chicken", "black beans"],
  ingredients_full: ["chicken", "black beans", "onion", "cilantro"],
  dietary: [],
  season: [],
  tags: ["cozy"],
  perishable_ingredients: ["cilantro"],
  requires_equipment: [],
  side_search_terms: ["crusty bread"],
  meal_preppable: true,
};

const BODY = "## Ingredients\n- chicken\n- black beans\n- onion\n- cilantro\n\n## Instructions\n1. Simmer.";

function facetRow(raw: { prepare(sql: string): { get(...a: unknown[]): unknown } }, slug: string) {
  return raw.prepare("SELECT * FROM recipe_facets WHERE slug = ?").get(slug) as Record<string, unknown>;
}

describe("import-time seed paths carry ingredients_full", () => {
  it("seedRecipeFacets (create_recipe) writes the normalized full list", async () => {
    const { env, raw } = sqliteEnv();
    (env as unknown as { AI: unknown }).AI = { run: async () => ({ response: CLASSIFIED }) };
    await seedRecipeFacets(env, "stew", { title: "Stew", course: ["main"] }, BODY);
    const row = facetRow(raw, "stew");
    expect(JSON.parse(row.ingredients_full as string)).toEqual(["chicken", "black beans", "onion", "cilantro"]);
    expect(row.body_hash).not.toBeNull();
  });

  it("seedClassifiedFacets (discovery sweep) carries the already-classified full list", async () => {
    const { env, raw } = sqliteEnv();
    await seedClassifiedFacets(env, "stew", { title: "Stew", ...CLASSIFIED }, BODY);
    const row = facetRow(raw, "stew");
    expect(JSON.parse(row.ingredients_full as string)).toEqual(["chicken", "black beans", "onion", "cilantro"]);
  });
});
