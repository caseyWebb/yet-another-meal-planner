// Worker read layer for the shared recipe index (d1-recipe-index). The index is a
// D1 `recipes` table (built by scripts/build-indexes.mjs), so this is the single
// place the Worker reconstructs the in-memory `RecipeIndex` shape from rows — a
// drop-in for the old `JSON.parse(DATA_KV.get("index:recipes"))`. Everything goes
// through `src/db.ts`, so a D1 failure surfaces as a structured `storage_error`
// (never a raw throw) and the table being unreadable is distinguishable from it
// being empty (a valid empty corpus).
//
// Column ↔ frontmatter contract (mirrors the projection in build-indexes.mjs —
// keep the two in sync):
//   * scalar columns: title, protein, cuisine, time_total — stored/loaded as-is.
//   * description — NO longer a `recipes` column (it is a Worker-DERIVED field, migration
//     0013); LEFT JOINed from the reconcile-owned `recipe_derived` table at load time, so
//     a recipe whose description hasn't been generated yet simply reads `null`.
//   * source_url column ⇄ the recipe's `source` frontmatter field (the import URL;
//     renamed only at the column boundary so discovery's source lookups stay
//     indexed). Reconstructed back to `source` so callers see the original shape.
//   * ingredients_key + the JSON-array columns (tags/course/season/dietary/
//     pairs_with/perishable_ingredients/requires_equipment) hold a JSON value as
//     TEXT — JSON.parse on load.
//   * extra holds a JSON object of every OTHER objective frontmatter field; spread
//     back onto the reconstructed entry so the projection is lossless.

import type { Env } from "./env.js";
import { db } from "./db.js";
import type { RecipeIndex, IndexedRecipe } from "./recipes.js";

/** Scalar columns reconstructed verbatim (column name === frontmatter field). */
const SCALAR_COLUMNS = ["title", "protein", "cuisine", "time_total", "description"] as const;

/** JSON-encoded columns (TEXT holding a JSON value) — JSON.parse on load. */
const JSON_COLUMNS = [
  "ingredients_key",
  "tags",
  "course",
  "season",
  "dietary",
  "pairs_with",
  "perishable_ingredients",
  "requires_equipment",
  "side_search_terms",
] as const;

/** One D1 `recipes` row as returned by the driver (all columns are TEXT/INTEGER/NULL). */
interface RecipeRow {
  slug: string;
  title: string;
  protein: string | null;
  cuisine: string | null;
  time_total: number | null;
  description: string | null;
  ingredients_key: string | null;
  source_url: string | null;
  tags: string | null;
  course: string | null;
  season: string | null;
  dietary: string | null;
  pairs_with: string | null;
  perishable_ingredients: string | null;
  requires_equipment: string | null;
  side_search_terms: string | null;
  extra: string | null;
}

/** Parse a JSON-array/value column, tolerating null/empty/garbage as `null`. */
function parseJsonColumn(value: string | null): unknown {
  if (value == null || value === "") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Reconstruct one in-memory recipe from its row: spread `extra` first (the
 * unpromoted objective frontmatter), then layer the promoted columns on top so a
 * column always wins over a stale `extra` copy. Mirrors the projection's field map.
 */
function rowToRecipe(row: RecipeRow): IndexedRecipe {
  const extra = parseJsonColumn(row.extra);
  const recipe: Record<string, unknown> =
    extra && typeof extra === "object" && !Array.isArray(extra) ? { ...extra } : {};

  recipe.slug = row.slug;
  for (const col of SCALAR_COLUMNS) {
    const v = row[col];
    if (v !== null) recipe[col] = v;
  }
  // The `source` frontmatter field is stored in the indexed `source_url` column.
  if (row.source_url !== null) recipe.source = row.source_url;
  for (const col of JSON_COLUMNS) {
    const parsed = parseJsonColumn(row[col]);
    if (parsed !== null) recipe[col] = parsed;
  }

  return recipe as IndexedRecipe;
}

/**
 * Load the whole shared recipe index from D1 and rebuild the `RecipeIndex` map
 * (slug → reconstructed objective entry). A drop-in for the old whole-blob load:
 * `search_recipes` still filters in JS over this, leaving the overlay/last_cooked
 * merge and `filterRecipes` untouched. An EMPTY table is a valid empty corpus
 * (`{}`); an UNREADABLE table throws a `storage_error` (mapped by db()), which the
 * caller surfaces as `index_unavailable`.
 */
export async function loadRecipeIndex(env: Env): Promise<RecipeIndex> {
  // description is JOINed from recipe_derived (it left the `recipes` table in 0013).
  const rows = await db(env).all<RecipeRow>(
    "SELECT r.*, d.description AS description FROM recipes r LEFT JOIN recipe_derived d ON d.slug = r.slug",
  );
  const index: RecipeIndex = {};
  for (const row of rows) index[row.slug] = rowToRecipe(row);
  return index;
}

/**
 * Load every recipe embedding from the reconcile-owned `recipe_derived` table (migration
 * 0013, formerly `recipe_embeddings`) into a `slug → vector` map, for the semantic-search
 * cosine pass. Vectors are stored as JSON-array TEXT (NULL until the embed pass fills them,
 * so the load skips NULLs); a row that fails to parse or isn't a numeric array is skipped (a
 * derived index self-heals on the next reconcile — one bad row must not abort a search). An
 * empty/absent table yields an empty map (nothing indexed yet).
 *
 * This is the "load embeddings through the Worker" path the design flags as B's
 * runway limit: fine at friend-group scale (hundreds × 768 floats), and the prefilter
 * still bounds the COSINE work to survivors even though the load is whole-table. The
 * written-down Vectorize promotion trigger covers the eventual scale-out.
 */
export async function loadRecipeEmbeddings(env: Env): Promise<Map<string, number[]>> {
  const rows = await db(env).all<{ slug: string; embedding: string }>(
    "SELECT slug, embedding FROM recipe_derived WHERE embedding IS NOT NULL",
  );
  const map = new Map<string, number[]>();
  for (const { slug, embedding } of rows) {
    const parsed = parseJsonColumn(embedding);
    if (Array.isArray(parsed) && parsed.every((n) => typeof n === "number")) {
      map.set(slug, parsed as number[]);
    }
  }
  return map;
}

/**
 * The Worker-derived `description` for one recipe (the read-time merge for `read_recipe`).
 * It lives in `recipe_derived` (migration 0013), not frontmatter — a recipe whose description
 * hasn't been generated yet (just imported, before the next reconcile tick) returns `null`,
 * treated as "not yet derived", never an error.
 */
export async function recipeDescription(env: Env, slug: string): Promise<string | null> {
  const row = await db(env).first<{ description: string | null }>(
    "SELECT description FROM recipe_derived WHERE slug = ?1 LIMIT 1",
    slug,
  );
  return row?.description ?? null;
}

/**
 * Map canonicalized-free `source_url` → slug for every indexed recipe with a
 * source. Discovery canonicalizes both sides before comparing, so this returns the
 * raw stored URL; the caller (discovery.ts) canonicalizes. Used by the enumeration
 * path (`fetch_rss_discoveries`). First slug wins on a (rare) source collision.
 */
export async function recipeSourceMap(env: Env): Promise<Map<string, string>> {
  const rows = await db(env).all<{ slug: string; source_url: string | null }>(
    "SELECT slug, source_url FROM recipes WHERE source_url IS NOT NULL",
  );
  const map = new Map<string, string>();
  for (const { slug, source_url } of rows) {
    if (source_url && !map.has(source_url)) map.set(source_url, slug);
  }
  return map;
}

/**
 * Indexed point lookup of the slug owning a `source_url` (the discovery idempotency
 * check) — `SELECT slug FROM recipes WHERE source_url = ?` against the
 * idx_recipes_source_url index, not a whole-index scan. Returns null when absent.
 */
export async function recipeSlugForSource(env: Env, sourceUrl: string): Promise<string | null> {
  const row = await db(env).first<{ slug: string }>(
    "SELECT slug FROM recipes WHERE source_url = ?1 LIMIT 1",
    sourceUrl,
  );
  return row?.slug ?? null;
}

/** Minimal per-slug metadata for retrospective's mixes (protein/cuisine). */
export interface RecipeMeta {
  protein: string | null;
  cuisine: string | null;
}

/**
 * Resolve protein/cuisine for a set of cooked slugs (retrospective's per-slug
 * needs), as a targeted query rather than a whole-index load. Returns a map keyed
 * by slug; absent slugs are simply missing. An empty input is a no-op.
 */
export async function recipeMeta(env: Env, slugs: string[]): Promise<Map<string, RecipeMeta>> {
  const map = new Map<string, RecipeMeta>();
  if (slugs.length === 0) return map;
  // Build a positional IN-list (?1, ?2, …) — slugs are recipe identifiers, never
  // tenant data, and are bound (not interpolated).
  const placeholders = slugs.map((_, i) => `?${i + 1}`).join(", ");
  const rows = await db(env).all<{ slug: string; protein: string | null; cuisine: string | null }>(
    `SELECT slug, protein, cuisine FROM recipes WHERE slug IN (${placeholders})`,
    ...slugs,
  );
  for (const { slug, protein, cuisine } of rows) map.set(slug, { protein, cuisine });
  return map;
}
