// The operator data explorer (operator-data-explorer capability). Read-only,
// cross-tenant reads over D1 and the R2 corpus that back the admin panel's Data area
// (server-rendered at `/admin/data/*`, these readers called directly). Everything here is a
// READ: `SELECT` through `src/db.ts` and
// `get`/`list` through `src/corpus-store.ts` — no row or object is ever created,
// updated, or deleted. Like the rest of the Worker, a storage failure surfaces as a
// structured error (`storage_error` for D1, `upstream_unavailable` for R2), never a
// raw throw (D4).
//
// The explorer is deliberately cross-tenant (the admin surface manages every tenant)
// and performs NO redaction — `private` notes are returned, and cross-tenant
// aggregates name their tenants. Scope is D1 domain data + the R2 corpus only; it
// never reaches KV secrets. Per-tenant and recipe reads REUSE the canonical readers
// (`profile-db`, `session-db`, `recipe-index`, `corpus-store`); only the cross-tenant
// aggregates and the bare lookup tables need new queries, which live here.

import type { Env } from "./env.js";
import { db } from "./db.js";
import { ToolError } from "./errors.js";
import { createR2CorpusStore, type CorpusStore, type DirEntry } from "./corpus-store.js";
import { parseMarkdown } from "./parse.js";
import { readProfile } from "./profile-db.js";
import { readPantry, readMealPlan, readGroceryList } from "./session-db.js";
import { directoryFromEnv } from "./tenant.js";
import { embedText, cosineSimilarity } from "./embedding.js";

/** Default row cap for the potentially-large lookup tables (sku_cache, cooking_log). */
const DEFAULT_ROW_LIMIT = 200;

// --- Recipe cross-tier view --------------------------------------------------

/** The reconcile-pipeline placement of one slug, derived from (R2 source?, recipes row?). */
export type ProjectionStatus = "indexed" | "skipped" | "pending" | "orphaned";

/** Whether the recipe's AI description has been generated yet (for the `indexed` case). */
export type DerivedState = "described" | "pending";

/** One row of the recipe list: slug, a best-effort title, and its projection status. */
export interface RecipeListEntry {
  slug: string;
  title: string | null;
  status: ProjectionStatus;
}

/** The cross-tier record assembled for one recipe slug. */
export interface RecipeDetail {
  slug: string;
  status: ProjectionStatus;
  /** Reconcile reason when `skipped`; null otherwise. */
  reconcile_message: string | null;
  /** The raw R2 `recipes/<slug>.md` source text; null when no source object exists. */
  source: string | null;
  /** The recipe body for client rendering: `source` with its YAML frontmatter fence
   *  removed (via `parseMarkdown`), the whole text when there's no parseable frontmatter,
   *  and null when there's no source. Derived from `source` — no extra R2/D1 read. */
  body: string | null;
  /** The D1 `recipes` projection row (raw columns); null when not indexed/orphaned-absent. */
  projection: Record<string, unknown> | null;
  /** The derived description + embedding presence; null when no `recipe_derived` row. */
  derived: { description: string | null; has_embedding: boolean; state: DerivedState } | null;
  /** Every tenant's disposition for the slug (named, no redaction). */
  dispositions: { tenant: string; favorite: boolean; reject: boolean }[];
  /** Every tenant's notes on the slug (all authors, private included). */
  notes: Record<string, unknown>[];
}

const slugRe = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The D1 `recipes` row stores list-valued facets (tags, dietary, requires_equipment,
 * pairs_with, ingredients_key, side_search_terms, perishable_ingredients, course, season, …)
 * as JSON-encoded TEXT — `PrettyKV` (which renders a genuine JS array as chips) otherwise
 * receives the raw string `'["a","b"]'` and prints it as plain text. This parses every
 * string column that decodes to a JSON array back into an array in place, so the detail
 * view's D1-index panel renders list facets as pills like the R2 frontmatter panel. Only
 * genuinely-array-shaped JSON is touched — a scalar string, a JSON *object* string (e.g.
 * `extra`), or malformed JSON is left as the original string untouched (never throws).
 */
function inflateJsonListColumns(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const [key, value] of Object.entries(row)) {
    if (typeof value !== "string" || value === "") continue;
    const trimmed = value.trimStart();
    if (!trimmed.startsWith("[")) continue; // cheap pre-filter before the JSON.parse try
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) out[key] = parsed;
    } catch {
      // Malformed JSON degrades to the raw string — never a throw.
    }
  }
  return out;
}

function corpus(env: Env): CorpusStore {
  return createR2CorpusStore(env.CORPUS);
}

/** Slug → status from the three bulk sources (no per-file fetch). */
function deriveStatus(hasSource: boolean, hasRow: boolean, hasReconcile: boolean): ProjectionStatus {
  if (hasSource && hasRow) return "indexed";
  if (hasSource && !hasRow) return hasReconcile ? "skipped" : "pending";
  return "orphaned"; // !hasSource && hasRow
}

/** Strip the `recipes/` prefix and `.md` suffix from a corpus key, or null if it doesn't fit. */
function slugOfRecipeKey(key: string): string | null {
  const m = /^recipes\/(.+)\.md$/.exec(key);
  return m ? m[1] : null;
}

/**
 * The recipe body (frontmatter removed) for client rendering, from the already-fetched
 * source. `null` when there's no source. A source whose YAML frontmatter is malformed —
 * the very recipe an operator opens to debug a `skipped` row — falls back to the whole
 * text rather than throwing, so the detail endpoint never 500s on the case it exists to
 * surface. With no frontmatter fence, `parseMarkdown` already returns the whole text.
 */
function recipeBody(source: string | null): string | null {
  if (source === null) return null;
  try {
    return parseMarkdown(source, "recipe source").body;
  } catch {
    return source;
  }
}

/**
 * The recipe listing: every slug present in the R2 corpus OR the `recipes` table,
 * each with its projection status — so skipped/pending/orphaned slugs surface, not
 * only the indexed ones. Three bulk reads (R2 keys, `recipes` rows, `reconcile_errors`)
 * joined in memory; no per-slug fetch.
 */
export async function recipeList(env: Env): Promise<{ recipes: RecipeListEntry[] }> {
  const [keys, rows, recon] = await Promise.all([
    corpus(env).list("recipes/"),
    db(env).all<{ slug: string; title: string | null }>("SELECT slug, title FROM recipes"),
    db(env).all<{ slug: string }>("SELECT DISTINCT slug FROM reconcile_errors"),
  ]);
  const sources = new Set<string>();
  for (const key of keys) {
    const slug = slugOfRecipeKey(key);
    if (slug) sources.add(slug);
  }
  const titles = new Map(rows.map((r) => [r.slug, r.title]));
  const reconciled = new Set(recon.map((r) => r.slug));
  const slugs = new Set<string>([...sources, ...titles.keys()]);

  const recipes: RecipeListEntry[] = [];
  for (const slug of slugs) {
    const status = deriveStatus(sources.has(slug), titles.has(slug), reconciled.has(slug));
    recipes.push({ slug, title: titles.get(slug) ?? null, status });
  }
  recipes.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return { recipes };
}

/**
 * The cross-tier record for one slug: R2 source + `recipes` projection + `recipe_derived`
 * + `reconcile_errors` reason + the cross-tenant `overlay`/`recipe_notes`. A slug present
 * in NEITHER tier is `not_found`.
 */
export async function recipeDetail(env: Env, slug: string): Promise<RecipeDetail> {
  if (!slugRe.test(slug)) throw new ToolError("not_found", `Invalid recipe slug: ${slug}`, { slug });
  const [source, projection, derivedRow, reconcile, overlay, notes] = await Promise.all([
    corpus(env).getFile(`recipes/${slug}.md`),
    db(env).first<Record<string, unknown>>("SELECT * FROM recipes WHERE slug = ?1 LIMIT 1", slug),
    db(env).first<{ description: string | null; embedding: string | null }>(
      "SELECT description, embedding FROM recipe_derived WHERE slug = ?1 LIMIT 1",
      slug,
    ),
    db(env).first<{ message: string }>(
      // One slug can have more than one reconcile_errors row (no PK); show the latest.
      "SELECT message FROM reconcile_errors WHERE slug = ?1 ORDER BY recorded_at DESC LIMIT 1",
      slug,
    ),
    db(env).all<{ tenant: string; favorite: number | null; reject: number | null }>(
      "SELECT tenant, favorite, reject FROM overlay WHERE recipe = ?1",
      slug,
    ),
    db(env).all<Record<string, unknown>>(
      "SELECT * FROM recipe_notes WHERE recipe = ?1 ORDER BY created_at DESC",
      slug,
    ),
  ]);

  if (source === null && projection === null) {
    throw new ToolError("not_found", `No recipe ${slug} in the corpus or the index`, { slug });
  }

  const status = deriveStatus(source !== null, projection !== null, reconcile !== null);
  const derived = derivedRow
    ? {
        description: derivedRow.description ?? null,
        has_embedding: derivedRow.embedding != null,
        state: (derivedRow.description ? "described" : "pending") as DerivedState,
      }
    : null;

  return {
    slug,
    status,
    reconcile_message: status === "skipped" ? (reconcile?.message ?? null) : null,
    source,
    body: recipeBody(source),
    projection: projection ? inflateJsonListColumns(projection) : null,
    derived,
    dispositions: overlay.map((r) => ({
      tenant: r.tenant,
      favorite: Boolean(r.favorite),
      reject: Boolean(r.reject),
    })),
    notes,
  };
}

// --- Recipes: keyword / hybrid search ----------------------------------------

/** The Recipes explorer's search mode — a discriminated toggle, not a bare string. */
export type SearchMode = "keyword" | "hybrid";

/** One search hit: the matched slug plus its relevance (Hybrid only). */
export interface RecipeSearchHit {
  slug: string;
  /** Blended relevance in Hybrid mode; null in Keyword mode (no ranking, just AND-match). */
  score: number | null;
  /** True when a Hybrid hit cleared the relevance floor via the semantic term without a
   *  full keyword match — the "surfaced semantically" badge. Always false in Keyword mode. */
  semantic: boolean;
}

/**
 * `searchRecipes`'s result, discriminated on how the ranking was actually produced —
 * NOT the mode the caller asked for. Keyword mode always returns `"keyword"` (it never
 * touches Workers AI, so it cannot degrade). Hybrid mode returns `"hybrid"` when the
 * embed call + `recipe_derived` read both succeeded, or `"hybrid-degraded"` when either
 * failed (a Workers AI outage or neuron-quota exhaustion, both real and expected —
 * `/health` has its own `ai_quota_exhausted` flag for the same condition) — in which
 * case `results` falls back to the plain keyword match for the same query rather than
 * throwing into the read path. The degraded state is a variant of the result, not a
 * boolean bolted onto a hybrid success, so a caller can't render "hybrid" chrome over
 * keyword data by mistake.
 */
export type RecipeSearchResult =
  | { mode: "keyword"; results: RecipeSearchHit[] }
  | { mode: "hybrid"; results: RecipeSearchHit[] }
  | { mode: "hybrid-degraded"; results: RecipeSearchHit[] };

/** The indexed metadata one recipe's keyword/semantic search reads — a superset of
 *  `RecipeListEntry`, pulled once per search (title/slug/facets), joined against a
 *  `recipe_derived.embedding` bulk read for Hybrid mode. */
interface SearchableRecipe {
  slug: string;
  title: string | null;
  protein: string | null;
  cuisine: string | null;
  course: string | null;
  tags: string | null;
  ingredients_key: string | null;
}

/** Hybrid blend weights + the semantic-surfaced relevance floor. Tunable constants, not
 *  part of the contract (see operator-data-explorer's "keyword and hybrid semantic search"
 *  requirement) — mirrors the design mock's feel, revisited after real corpus use. */
const HYBRID_KEYWORD_WEIGHT = 0.7;
const HYBRID_SEMANTIC_WEIGHT = 0.45;
const HYBRID_RELEVANCE_FLOOR = 0.18;

function tokenize(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** The lowercased haystack a keyword search matches tokens against: title, slug, protein,
 *  cuisine, course, tags, and `ingredients_key` — the fields `recipeList` already indexes. */
function keywordHaystack(r: SearchableRecipe): string {
  const parts = [r.slug, r.title ?? "", r.protein ?? "", r.cuisine ?? "", r.course ?? "", r.tags ?? "", r.ingredients_key ?? ""];
  return parts.join(" ").toLowerCase();
}

/** Fraction of `tokens` present as a substring of `haystack` (0 when `tokens` is empty). */
function tokenCoverage(tokens: string[], haystack: string): number {
  if (tokens.length === 0) return 0;
  return tokens.filter((t) => haystack.includes(t)).length / tokens.length;
}

/**
 * Search the recipe corpus: Keyword mode is an AND-of-tokens substring match over the
 * indexed metadata (title/slug/protein/cuisine/course/tags/ingredients_key), unranked
 * (no score). Hybrid mode additionally embeds the query ONCE (`embedText`, one Workers AI
 * call — never per recipe) and blends keyword-token coverage with cosine similarity
 * against each recipe's stored `recipe_derived.embedding`, using the same primitives
 * `semantic-recipe-search`'s ranked mode and the cookbook's similar-recipes feature both
 * call — but NOT that tool's per-tenant re-ranks (favorites/freshness/pantry), which have
 * no meaning for a cross-tenant operator search (design.md Decision 1). A recipe with no
 * stored embedding is excluded from Hybrid's ranking but stays findable in Keyword mode.
 * An empty query returns the full corpus unranked in either mode — no AI call.
 *
 * Hybrid mode DEGRADES rather than throws: if the query embed (`embedText`) or the
 * `recipe_derived` vector read fails — a Workers AI outage or neuron-quota exhaustion,
 * both real, expected states, not a caller bug — this falls back to the plain keyword
 * match for the same query and returns `mode: "hybrid-degraded"` instead of propagating
 * the `ToolError`. Matches the admin readers' "degrade rather than throw into the read
 * path" discipline: the operator's recipe explorer stays usable during an AI outage
 * instead of hard-500ing the whole list. Keyword mode is untouched — it never calls
 * Workers AI, so it cannot degrade.
 */
export async function searchRecipes(env: Env, query: string, mode: SearchMode): Promise<RecipeSearchResult> {
  const rows = await db(env).all<SearchableRecipe>(
    "SELECT slug, title, protein, cuisine, course, tags, ingredients_key FROM recipes",
  );
  const q = query.trim();
  if (q === "") {
    const results = rows.map((r) => ({ slug: r.slug, score: null, semantic: false }));
    return { mode, results };
  }

  const tokens = tokenize(q);

  const keywordResults = (): RecipeSearchHit[] =>
    rows
      .filter((r) => tokenCoverage(tokens, keywordHaystack(r)) === 1)
      .map((r) => ({ slug: r.slug, score: null, semantic: false }));

  if (mode === "keyword") {
    return { mode: "keyword", results: keywordResults() };
  }

  // Hybrid: one embed call for the query, one bulk read of stored recipe vectors. Either
  // failing (Workers AI outage/quota) degrades to the keyword results rather than throwing.
  let queryVector: number[];
  let derivedRows: { slug: string; embedding: string }[];
  try {
    [queryVector, derivedRows] = await Promise.all([
      embedText(env, q),
      db(env).all<{ slug: string; embedding: string }>(
        "SELECT slug, embedding FROM recipe_derived WHERE embedding IS NOT NULL",
      ),
    ]);
  } catch {
    return { mode: "hybrid-degraded", results: keywordResults() };
  }

  const vectors = new Map<string, number[]>();
  for (const d of derivedRows) {
    try {
      const parsed = JSON.parse(d.embedding);
      if (Array.isArray(parsed)) vectors.set(d.slug, parsed as number[]);
    } catch {
      // A malformed stored vector degrades to "no embedding" for this slug, never a throw.
    }
  }

  const hits: RecipeSearchHit[] = [];
  for (const r of rows) {
    const vector = vectors.get(r.slug);
    if (!vector) continue; // not yet reconciled — absent from Hybrid, still in Keyword
    const kwFrac = tokenCoverage(tokens, keywordHaystack(r));
    const semanticSim = Math.max(0, cosineSimilarity(queryVector, vector));
    const score = Math.min(1, kwFrac * HYBRID_KEYWORD_WEIGHT + semanticSim * HYBRID_SEMANTIC_WEIGHT);
    if (score < HYBRID_RELEVANCE_FLOOR) continue;
    const semantic = kwFrac < 1 && semanticSim > 0;
    hits.push({ slug: r.slug, score, semantic });
  }
  hits.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return { mode: "hybrid", results: hits };
}

/** The facet fields the Recipes-list rows chip alongside title/slug/status. */
export interface RecipeFacetRow {
  protein: string | null;
  cuisine: string | null;
  time_total: number | null;
}

/**
 * Bulk facet read (protein/cuisine/time_total) for the Recipes list rows — one query,
 * joined against `recipeList`'s slug/title/status in memory (mirrors `recipeList`'s own
 * "no per-slug fetch" discipline). Slugs missing from `recipes` (skipped/pending) simply
 * have no facet entry, which the list renders as no chips.
 */
export async function recipeFacets(env: Env): Promise<Map<string, RecipeFacetRow>> {
  const rows = await db(env).all<{ slug: string } & RecipeFacetRow>(
    "SELECT slug, protein, cuisine, time_total FROM recipes",
  );
  return new Map(rows.map((r) => [r.slug, { protein: r.protein, cuisine: r.cuisine, time_total: r.time_total }]));
}

// --- Member 360 view ---------------------------------------------------------

/** One member's complete per-tenant state. Reuses the canonical profile/session readers. */
export interface MemberDetail {
  id: string;
  profile: Awaited<ReturnType<typeof readProfile>>;
  pantry: Awaited<ReturnType<typeof readPantry>>;
  meal_plan: Awaited<ReturnType<typeof readMealPlan>>;
  grocery_list: Awaited<ReturnType<typeof readGroceryList>>;
  overlay: Record<string, unknown>[];
  cooking_log: Record<string, unknown>[];
  recipe_notes: Record<string, unknown>[];
  store_notes: Record<string, unknown>[];
}

/**
 * Assemble one member's full per-tenant state. The CALLER resolves `tenantId` against
 * the allowlist first (the route does, via `resolveActingTenant`), so this is a pure
 * read — it returns whatever rows exist for the id, with no redaction (private notes
 * included). Reuses `readProfile`/`readPantry`/`readMealPlan`/`readGroceryList`; the
 * overlay/cooking-log/authored-notes reads are explorer-specific.
 */
export async function memberDetail(env: Env, tenantId: string): Promise<MemberDetail> {
  const [profile, pantry, mealPlan, grocery, overlay, cookingLog, recipeNotes, storeNotes] =
    await Promise.all([
      readProfile(env, tenantId),
      readPantry(env, tenantId),
      readMealPlan(env, tenantId),
      readGroceryList(env, tenantId),
      db(env).all<Record<string, unknown>>(
        "SELECT recipe, favorite, reject FROM overlay WHERE tenant = ?1",
        tenantId,
      ),
      db(env).all<Record<string, unknown>>(
        "SELECT id, date, type, recipe, name, protein, cuisine FROM cooking_log WHERE tenant = ?1 " +
          `ORDER BY date DESC, id DESC LIMIT ${DEFAULT_ROW_LIMIT}`,
        tenantId,
      ),
      db(env).all<Record<string, unknown>>(
        "SELECT * FROM recipe_notes WHERE author = ?1 ORDER BY created_at DESC",
        tenantId,
      ),
      db(env).all<Record<string, unknown>>(
        "SELECT * FROM store_notes WHERE author = ?1 ORDER BY created_at DESC",
        tenantId,
      ),
    ]);

  return {
    id: tenantId,
    profile,
    pantry,
    meal_plan: mealPlan,
    grocery_list: grocery,
    overlay,
    cooking_log: cookingLog,
    recipe_notes: recipeNotes,
    store_notes: storeNotes,
  };
}

/**
 * Batch-resolve recipe titles for a small set of slugs (the member-detail meal-plan/grocery
 * sections need a title alongside the slug `memberDetail()` already returns; cooking_log
 * carries its own protein/cuisine columns directly, so it needs no join). One `IN (...)`
 * query, never N per-slug reads. Slugs missing from `recipes` are simply absent from the map.
 */
export async function recipeTitles(env: Env, slugs: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(slugs)].filter(Boolean);
  if (unique.length === 0) return new Map();
  const placeholders = unique.map((_, i) => `?${i + 1}`).join(", ");
  const rows = await db(env).all<{ slug: string; title: string }>(
    `SELECT slug, title FROM recipes WHERE slug IN (${placeholders})`,
    ...unique,
  );
  return new Map(rows.map((r) => [r.slug, r.title]));
}

// --- Corpus-counts (Status stat tiles) ---------------------------------------

/** The Status area's page-level corpus stat tiles — aggregate counts only, no per-tenant data. */
export interface CorpusCounts {
  recipes: number;
  members: number;
  feeds: number;
  cached_skus: number;
}

/**
 * The four corpus stat-tile counts: indexed recipes, allowlisted members, RSS discovery
 * feeds, and cached Kroger SKUs. Three plain `COUNT(*)` reads through `src/db.ts` plus the
 * tenant directory's own list length (members live in `TENANT_KV`, not D1) — aggregate-only,
 * no per-tenant identifier in the result.
 */
export async function corpusCounts(env: Env): Promise<CorpusCounts> {
  const [recipes, feeds, skus, tenants] = await Promise.all([
    db(env).first<{ n: number }>("SELECT COUNT(*) AS n FROM recipes"),
    db(env).first<{ n: number }>("SELECT COUNT(*) AS n FROM feeds"),
    db(env).first<{ n: number }>("SELECT COUNT(*) AS n FROM sku_cache"),
    directoryFromEnv(env).list(),
  ]);
  return {
    recipes: recipes?.n ?? 0,
    members: tenants.length,
    feeds: feeds?.n ?? 0,
    cached_skus: skus?.n ?? 0,
  };
}

// --- Flat lookup / operational tables ----------------------------------------

/**
 * The tables a flat view may read, grouped by area, each with a stable column order.
 * The map IS the allowlist — only a name present here is queryable, so no
 * operator-supplied table name ever reaches an interpolated `SELECT`. `bounded` caps
 * the row count (the only tables that grow without bound). `order` is an ORDER BY
 * clause (fixed, not operator-supplied).
 */
interface TableSpec {
  columns: string[];
  order?: string;
  bounded?: boolean;
}

const TABLE_SPECS: Record<string, TableSpec> = {
  // discovery pipeline
  discovery_candidates: {
    columns: ["id", "url", "source", "subject", "body", "discovered_at", "status"],
    order: "discovered_at DESC",
  },
  discovery_senders: { columns: ["address", "name"], order: "address" },
  discovery_members: { columns: ["address"], order: "address" },
  discovery_rejections: {
    columns: ["url", "reason", "rejected_by", "rejected_at"],
    order: "rejected_at DESC",
  },
  // system / operational
  reconcile_errors: {
    columns: ["slug", "path", "message", "recorded_at"],
    order: "recorded_at DESC, slug",
  },
  bug_reports: {
    columns: ["id", "reporter", "title", "body", "created_at", "status"],
    order: "created_at DESC, id DESC",
  },
  schema_meta: { columns: ["key", "value"], order: "key" },
};

/**
 * Which flat tables belong to each group. No live Data-area route reaches `readTable`
 * anymore (Recipes/Stores/Guidance have purpose-built readers; Members/Corpus tables moved
 * to the Members/Config areas' own readers) — `discovery`/`system` stay as an inert,
 * harmless allowlist (System has no redesigned home yet; design.md recommends leaving
 * these rather than coupling this change's scope to a System redesign that doesn't exist).
 */
export const TABLE_GROUPS = {
  discovery: ["discovery_candidates", "discovery_senders", "discovery_members", "discovery_rejections"],
  system: ["reconcile_errors", "bug_reports", "schema_meta"],
} as const;

export type TableGroup = keyof typeof TABLE_GROUPS;

/** A flat-table read result: the column order plus the rows, for a generic renderer. */
export interface TablePage {
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

/**
 * Read a flat table by name, scoped to a view's group. The `(group, table)` pair is
 * checked against `TABLE_GROUPS`/`TABLE_SPECS` — an unknown or cross-group table is a
 * structured `not_found`, never an interpolated query. The column list is fixed (from
 * the spec), the ORDER BY is fixed, and the bounded tables get a default `LIMIT`. A
 * belt-and-suspenders `slice` enforces the cap even on a backing store that ignores
 * `LIMIT`.
 */
export async function readTable(env: Env, group: TableGroup, table: string): Promise<TablePage> {
  const allowed: readonly string[] = TABLE_GROUPS[group] ?? [];
  const spec = TABLE_SPECS[table];
  if (!spec || !allowed.includes(table)) {
    throw new ToolError("not_found", `No data table ${table} in ${group}`, { group, table });
  }
  const cols = spec.columns.join(", ");
  let sql = `SELECT ${cols} FROM ${table}`;
  if (spec.order) sql += ` ORDER BY ${spec.order}`;
  if (spec.bounded) sql += ` LIMIT ${DEFAULT_ROW_LIMIT}`;
  const rows = await db(env).all<Record<string, unknown>>(sql);
  return {
    table,
    columns: spec.columns,
    rows: spec.bounded ? rows.slice(0, DEFAULT_ROW_LIMIT) : rows,
  };
}

// --- Stores: shared registry list + per-store detail -------------------------

/** One row of the Stores list: identity basics only (no SKU/notes counts join needed
 *  beyond a cheap count, so the list stays a single bulk read like `recipeList`). */
export interface StoreListEntry {
  slug: string;
  name: string;
  domain: string | null;
  chain: string | null;
  notes_count: number;
  skus_count: number;
}

/** A cached Kroger SKU row, scoped to one store's `location_id`. */
export interface SkuRow {
  ingredient: string;
  sku: string;
  brand: string | null;
  size: string | null;
  last_used: string | null;
}

/** One store note, grouped server-side by its first tag (default `general`). */
export interface StoreNoteRow {
  id: string;
  author: string;
  body: string;
  tags: string[];
  private: boolean;
  created_at: string | null;
}

/** The store-note tag-convention groups (design.md Decision 2 — first tag, default `general`). */
export type StoreNoteGroup = "layout" | "location" | "stock" | "general";
const STORE_NOTE_GROUPS: StoreNoteGroup[] = ["layout", "location", "stock", "general"];

/** The cross-tier record assembled for one store slug. */
export interface StoreDetail {
  slug: string;
  name: string;
  domain: string | null;
  chain: string | null;
  label: string | null;
  address: string | null;
  location_id: string | null;
  /** Cached SKUs for this store's `location_id`; empty (not an error) when there's no
   *  `location_id` (a non-Kroger chain) or none have been looked up yet. */
  skus: SkuRow[];
  /** Notes grouped by tag convention; every group key is present (possibly empty). */
  notes: Record<StoreNoteGroup, StoreNoteRow[]>;
}

function parseJsonObject(text: unknown): Record<string, unknown> {
  if (typeof text !== "string" || text === "") return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseJsonArray(text: unknown): string[] {
  if (typeof text !== "string" || text === "") return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** Every store in the shared registry, with a notes/SKU count for the list rows. Three
 *  bulk reads joined in memory — no per-store fetch, mirroring `recipeList`'s shape. */
export async function storeList(env: Env): Promise<{ stores: StoreListEntry[] }> {
  const [stores, notes, skus] = await Promise.all([
    db(env).all<{ slug: string; name: string; domain: string | null; extra: string | null }>(
      "SELECT slug, name, domain, extra FROM stores ORDER BY slug",
    ),
    db(env).all<{ store: string }>("SELECT store FROM store_notes"),
    db(env).all<{ location_id: string | null }>("SELECT location_id FROM sku_cache"),
  ]);
  const notesCount = new Map<string, number>();
  for (const n of notes) notesCount.set(n.store, (notesCount.get(n.store) ?? 0) + 1);
  const skusByLocation = new Map<string, number>();
  for (const s of skus) {
    if (!s.location_id) continue;
    skusByLocation.set(s.location_id, (skusByLocation.get(s.location_id) ?? 0) + 1);
  }
  return {
    stores: stores.map((s) => {
      const extra = parseJsonObject(s.extra);
      const locationId = typeof extra.location_id === "string" ? extra.location_id : null;
      return {
        slug: s.slug,
        name: s.name,
        domain: s.domain,
        chain: typeof extra.chain === "string" ? extra.chain : null,
        notes_count: notesCount.get(s.slug) ?? 0,
        skus_count: locationId ? (skusByLocation.get(locationId) ?? 0) : 0,
      };
    }),
  };
}

/**
 * The cross-tier record for one store slug: identity (chain/label/address/`location_id`
 * unpacked from `stores.extra`), its cached Kroger SKUs scoped to that `location_id`
 * (empty — not an error — when `location_id` is null, a non-Kroger location), and its
 * `store_notes` grouped by the first-tag convention (default `general`). One assembled
 * read next to the query, mirroring `recipeDetail` (design.md Decision 2).
 */
export async function storeDetail(env: Env, slug: string): Promise<StoreDetail> {
  const store = await db(env).first<{ slug: string; name: string; domain: string | null; extra: string | null }>(
    "SELECT slug, name, domain, extra FROM stores WHERE slug = ?1 LIMIT 1",
    slug,
  );
  if (!store) throw new ToolError("not_found", `No store ${slug} in the registry`, { slug });

  const extra = parseJsonObject(store.extra);
  const locationId = typeof extra.location_id === "string" ? extra.location_id : null;

  const [skuRows, noteRows] = await Promise.all([
    locationId
      ? db(env).all<{ ingredient: string; sku: string; brand: string | null; size: string | null; last_used: string | null }>(
          "SELECT ingredient, sku, brand, size, last_used FROM sku_cache WHERE location_id = ?1 ORDER BY last_used DESC",
          locationId,
        )
      : Promise.resolve([]),
    db(env).all<{ id: string; author: string; body: string; tags: string | null; private: number | null; created_at: string | null }>(
      "SELECT id, author, body, tags, private, created_at FROM store_notes WHERE store = ?1 ORDER BY created_at DESC",
      slug,
    ),
  ]);

  const notes: Record<StoreNoteGroup, StoreNoteRow[]> = { layout: [], location: [], stock: [], general: [] };
  for (const n of noteRows) {
    const tags = parseJsonArray(n.tags);
    const group = (STORE_NOTE_GROUPS as string[]).includes(tags[0] ?? "") ? (tags[0] as StoreNoteGroup) : "general";
    notes[group].push({
      id: n.id,
      author: n.author,
      body: n.body,
      tags,
      private: Boolean(n.private),
      created_at: n.created_at,
    });
  }

  return {
    slug: store.slug,
    name: store.name,
    domain: store.domain,
    chain: typeof extra.chain === "string" ? extra.chain : null,
    label: typeof extra.label === "string" ? extra.label : null,
    address: typeof extra.address === "string" ? extra.address : null,
    location_id: locationId,
    skus: skuRows,
    notes,
  };
}

// --- Guidance R2 browse ------------------------------------------------------

/** A guidance tree listing: the immediate children (files + dirs) under a prefix. */
export interface GuidanceListing {
  prefix: string;
  entries: DirEntry[];
}

const GUIDANCE_ROOT = "guidance/";

/**
 * Normalize a path to a key under `guidance/` and reject any that escapes the subtree.
 * Accepts a bare relative path (`cooking_techniques/x.md`), an already-rooted path
 * (`guidance/cooking_techniques/x.md`), or the root itself (`""` / `guidance` /
 * `guidance/`) — so a bare `guidance` prefix lists the root, not `guidance/guidance`.
 * A `..` segment is a `not_found` (no traversal out of the subtree).
 */
function guidanceKey(path: string): string {
  const trimmed = path.replace(/^\/+/, "");
  const rooted =
    trimmed === "" || trimmed === "guidance" || trimmed === GUIDANCE_ROOT
      ? GUIDANCE_ROOT
      : trimmed.startsWith(GUIDANCE_ROOT)
        ? trimmed
        : `${GUIDANCE_ROOT}${trimmed}`;
  if (rooted.includes("..")) throw new ToolError("not_found", `Invalid guidance path: ${path}`, { path });
  return rooted;
}

/** List the immediate children of a `guidance/**` prefix (files + dirs), for the tree browser. */
export async function guidanceListing(env: Env, prefix = GUIDANCE_ROOT): Promise<GuidanceListing> {
  const key = prefix === "" ? GUIDANCE_ROOT : guidanceKey(prefix);
  const entries = await corpus(env).listDir(key.endsWith("/") ? key.slice(0, -1) : key);
  return { prefix: key, entries };
}

/** Read one guidance object's markdown text; `not_found` when the object is absent. */
export async function guidanceObject(env: Env, path: string): Promise<{ key: string; markdown: string }> {
  const key = guidanceKey(path);
  if (!key.endsWith(".md")) throw new ToolError("not_found", `Not a guidance markdown object: ${path}`, { path });
  const markdown = await corpus(env).getFile(key);
  if (markdown === null) throw new ToolError("not_found", `No guidance object at ${key}`, { path });
  return { key, markdown };
}
