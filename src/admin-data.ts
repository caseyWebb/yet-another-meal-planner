// The operator data explorer (operator-data-explorer capability). Read-only,
// cross-tenant reads over D1 and the R2 corpus that back the admin panel's Data area
// (`/admin/api/data/*`). Everything here is a READ: `SELECT` through `src/db.ts` and
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
    projection,
    derived,
    dispositions: overlay.map((r) => ({
      tenant: r.tenant,
      favorite: Boolean(r.favorite),
      reject: Boolean(r.reject),
    })),
    notes,
  };
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
  // corpus / shared lookups
  aliases: { columns: ["variant", "canonical"], order: "variant" },
  flyer_terms: { columns: ["term"], order: "term" },
  feeds: { columns: ["url", "name", "weight", "tags"], order: "url" },
  stores: { columns: ["slug", "name", "domain", "extra"], order: "slug" },
  store_notes: {
    columns: ["id", "store", "author", "body", "tags", "private", "created_at"],
    order: "created_at DESC",
  },
  sku_cache: {
    columns: ["ingredient", "location_id", "sku", "brand", "size", "last_used"],
    order: "last_used DESC",
    bounded: true,
  },
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

/** Which flat tables belong to each Data view (so the route can scope the allowlist). */
export const TABLE_GROUPS = {
  corpus: ["aliases", "flyer_terms", "feeds", "stores", "store_notes", "sku_cache"],
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
