// Recipe-INDEX reconcile (r2-corpus-store). The cron reconcile reads the whole R2
// corpus, validates every recipe against the SAME shared required-field + vocabulary
// contract the write tools use (src/recipe-contract.js) PLUS the cross-corpus checks
// that need the whole corpus (`pairs_with` slug resolution, duplicate slugs, the body
// `## Ingredients`/`## Instructions` sections), and projects the D1 `recipes` table.
// The index is a deterministic, Worker-owned rebuild from R2.
//
// A recipe that fails validation is SKIPPED (not projected) and recorded to the D1
// `reconcile_errors` table, so a malformed human/Obsidian edit is observable
// (agent-readable record + `/health` + an ntfy push) instead of silently dropped.
// Projection is eventual (cron-driven), consistent with the system's accepted
// eventual-consistency.
//
// Logic is split from I/O (injected `ProjectionDeps`) so it is unit-testable with
// in-memory R2/D1 fakes, exactly as `recipe-embeddings.ts` does for the derived reconcile.
// The D1 row shape MUST stay in sync with the read reconstruction in src/recipe-index.ts
// (same column ↔ frontmatter map).

import { db } from "./db.js";
import type { Env } from "./env.js";
import { parseMarkdown } from "./parse.js";
import { validateRecipeContract } from "./recipe-contract.js";
import type { CorpusStore } from "./corpus-store.js";
import { notifyFailure, writeJobHealth } from "./health.js";
import type { KvStore } from "./kroger-user.js";

// --- pure projection helpers ---

// Subjective/per-tenant fields are stripped from the shared index and merged at read
// time from the overlay + cooking log. `status` is not indexed; a stray value is
// tolerated and stripped here so it never reaches the shared index.
const SUBJECTIVE_FIELDS = ["rating", "last_cooked", "status"];

// Recipe bodies must carry these H2 sections so cookbook generation can locate the
// ingredient list and the step list. Extra H2 sections are permitted.
const REQUIRED_SECTIONS = ["Ingredients", "Instructions"];

/** True when the markdown body contains an `## <name>` ATX H2 heading. */
export function hasH2Section(body: string, name: string): boolean {
  const re = new RegExp(`^[ \\t]*##[ \\t]+${name}[ \\t]*$`, "m");
  return re.test(body);
}

/** Recursively convert Date instances (js-yaml dates) to YYYY-MM-DD strings. */
export function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = normalizeValue(v);
    return out;
  }
  return value;
}

/** Normalize the open-vocabulary `course` to a lowercased, trimmed string array. */
export function normalizeCourse(value: unknown): string[] {
  if (value == null) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.map((c) => String(c).trim().toLowerCase()).filter((c) => c.length > 0);
}

/** Derive the slug (basename without `.md`) from a recipe object path. */
export function deriveSlug(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

// Column map — MUST mirror the read reconstruction in src/recipe-index.ts.
// `description` is NOT a column (Worker-derived, recipe_derived/migration 0013) — listed
// in PROMOTED_FIELDS only so a lingering authored `description:` is excluded from `extra`.
// `discovered_at` is a promoted scalar (migration 0016) so the new-for-me read can filter
// on it; it is authored frontmatter (a date normalized to YYYY-MM-DD), projected here.
const RECIPE_SCALAR_COLUMNS = ["title", "protein", "cuisine", "time_total", "discovered_at"];
const RECIPE_JSON_COLUMNS = [
  "ingredients_key",
  "tags",
  "course",
  "season",
  "dietary",
  "pairs_with",
  "perishable_ingredients",
  "requires_equipment",
  "side_search_terms",
];
const RECIPE_COLUMNS = ["slug", ...RECIPE_SCALAR_COLUMNS, "source_url", ...RECIPE_JSON_COLUMNS, "extra"];
const PROMOTED_FIELDS = new Set([
  "slug",
  "source",
  "description",
  ...RECIPE_SCALAR_COLUMNS,
  ...RECIPE_JSON_COLUMNS,
]);

/** Project one recipe entry into its positional bind values (RECIPE_COLUMNS order). */
export function recipeToRow(recipe: Record<string, unknown>): unknown[] {
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(recipe)) if (!PROMOTED_FIELDS.has(k)) extra[k] = v;
  const scalar = (v: unknown) => (v === undefined ? null : v);
  const jsonCol = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));
  return [
    recipe.slug,
    ...RECIPE_SCALAR_COLUMNS.map((c) => scalar(recipe[c] ?? null)),
    scalar(recipe.source ?? null),
    ...RECIPE_JSON_COLUMNS.map((c) => jsonCol(recipe[c])),
    Object.keys(extra).length ? JSON.stringify(extra) : null,
  ];
}

/** A recipe that failed validation and was not projected. */
export interface ReconcileError {
  slug: string;
  path: string;
  /** The first (most actionable) validation error, human-readable. */
  message: string;
}

/** What one index reconcile did, for the `health:job:recipe-index` summary. */
export interface ProjectionResult {
  /** Recipes projected into the index. */
  projected: number;
  /** Invalid recipes skipped (== errors.length). */
  skipped: number;
  /** The skipped recipes' first error each (recorded to reconcile_errors). */
  errors: ReconcileError[];
}

/** The I/O the index reconcile needs, injected so the logic is testable without R2/D1. */
export interface ProjectionDeps {
  /** Every recipe object path in the corpus (recipes/<slug>.md, recursive). */
  listRecipePaths(): Promise<string[]>;
  /** Read one recipe object's text; null if it vanished mid-run. */
  readRecipe(path: string): Promise<string | null>;
  /** Replace the whole `recipes` table with these positional rows (one transaction). */
  replaceRecipes(rows: unknown[][]): Promise<void>;
  /** Replace the whole `reconcile_errors` table with these records (one transaction). */
  replaceErrors(errors: ReconcileError[]): Promise<void>;
  /** The slugs currently recorded as reconcile errors — to detect NEW failures for the alert. */
  loadErrorSlugs(): Promise<string[]>;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * One index reconcile pass: read the corpus, validate each recipe (contract + body
 * sections + duplicate-slug + cross-corpus `pairs_with` resolution), project the valid
 * recipes into `recipes`, and record the invalid ones into `reconcile_errors`. Pure
 * orchestration over injected deps; deterministic (sorted), and a full replace-all so a
 * removed recipe loses its row.
 */
export async function reconcileRecipeIndex(deps: ProjectionDeps): Promise<ProjectionResult> {
  const paths = (await deps.listRecipePaths()).filter((p) => p.endsWith(".md")).sort();
  const errors: ReconcileError[] = [];
  const valid: Record<string, Record<string, unknown>> = {}; // slug -> projected entry
  const seenSlugs = new Map<string, string>(); // slug -> first path (duplicate-slug guard)

  for (const path of paths) {
    const slug = deriveSlug(path);
    const text = await deps.readRecipe(path);
    if (text === null) continue; // vanished mid-run; the next tick reconciles

    let frontmatter: Record<string, unknown>;
    let body: string;
    try {
      ({ frontmatter, body } = parseMarkdown(text, path));
    } catch (e) {
      errors.push({ slug, path, message: `frontmatter failed to parse — ${msg(e)}` });
      continue;
    }

    if (seenSlugs.has(slug)) {
      errors.push({ slug, path, message: `duplicate slug "${slug}": ${seenSlugs.get(slug)} and ${path}` });
      continue;
    }
    seenSlugs.set(slug, path);

    // Required-field contract (frontmatter) + required body sections. The contract returns
    // every violation; the section check adds any missing H2. Surface the first as the
    // recorded error.
    const allErrs = [
      ...validateRecipeContract(frontmatter),
      ...REQUIRED_SECTIONS.filter((s) => !hasH2Section(body, s)).map(
        (s) => `missing required body section "## ${s}"`,
      ),
    ];
    if (allErrs.length) {
      errors.push({ slug, path, message: allErrs[0] });
      continue;
    }

    // Project objective content only (strip subjective fields + the unindexed `standalone`),
    // normalizing course + the array facets.
    const objective: Record<string, unknown> = { ...frontmatter };
    for (const f of SUBJECTIVE_FIELDS) delete objective[f];
    delete objective.standalone;
    valid[slug] = normalizeValue({
      ...objective,
      slug,
      pairs_with: Array.isArray(frontmatter.pairs_with) ? frontmatter.pairs_with : [],
      perishable_ingredients: Array.isArray(frontmatter.perishable_ingredients)
        ? frontmatter.perishable_ingredients
        : [],
      requires_equipment: Array.isArray(frontmatter.requires_equipment) ? frontmatter.requires_equipment : [],
      course: normalizeCourse(frontmatter.course),
    }) as Record<string, unknown>;
  }

  // Cross-corpus `pairs_with` resolution (possible because the reconcile holds the whole
  // corpus): every referenced slug must be
  // a real, VALID recipe. A dangling reference flags the REFERRING recipe and drops it
  // from the index (a validation failure → not projected), consistent with the contract.
  for (const [slug, r] of Object.entries(valid)) {
    const refs = Array.isArray(r.pairs_with) ? (r.pairs_with as unknown[]) : [];
    for (const target of refs) {
      if (typeof target !== "string" || !(target in valid)) {
        errors.push({
          slug,
          path: `recipes/${slug}.md`,
          message: `pairs_with references unknown recipe "${String(target)}"`,
        });
        delete valid[slug];
        break;
      }
    }
  }

  const rows = Object.values(valid)
    .sort((a, b) => String(a.slug).localeCompare(String(b.slug)))
    .map(recipeToRow);
  await deps.replaceRecipes(rows);
  await deps.replaceErrors(errors);

  return { projected: rows.length, skipped: errors.length, errors };
}

const INSERT_SQL = `INSERT INTO recipes (${RECIPE_COLUMNS.join(", ")}) VALUES (${RECIPE_COLUMNS.map(
  (_, i) => `?${i + 1}`,
).join(", ")})`;
const ERR_INSERT_SQL =
  "INSERT INTO reconcile_errors (slug, path, message, recorded_at) VALUES (?1, ?2, ?3, ?4)";

/** One recorded index-projection failure, as surfaced to the agent. */
export interface ReconcileErrorRow extends ReconcileError {
  recorded_at: string;
}

/**
 * The current index-projection failures (the agent-readable read path for the eventual
 * human-edit feedback). Empty when every recipe in the corpus indexed cleanly. Shared
 * corpus — not tenant-scoped.
 */
export async function readReconcileErrors(env: Env): Promise<ReconcileErrorRow[]> {
  return db(env).all<ReconcileErrorRow>(
    "SELECT slug, path, message, recorded_at FROM reconcile_errors ORDER BY slug",
  );
}

/** Wire the real R2 corpus store + D1 client for the scheduled handler. */
export function buildProjectionDeps(env: Env, store: CorpusStore, now: () => number = () => Date.now()): ProjectionDeps {
  const d = db(env);
  return {
    async listRecipePaths() {
      return store.list("recipes/");
    },
    readRecipe: (path) => store.getFile(path),
    async replaceRecipes(rows) {
      // DELETE + INSERTs as ONE D1 transaction (native batch), so a concurrent reader
      // sees the table before or after the rebuild, never mid-replace. An empty corpus is
      // just the DELETE (a valid empty index).
      const stmts = [d.prepare("DELETE FROM recipes"), ...rows.map((r) => d.prepare(INSERT_SQL, ...r))];
      await d.batch(stmts);
    },
    async replaceErrors(errors) {
      const at = new Date(now()).toISOString().slice(0, 10);
      const stmts = [
        d.prepare("DELETE FROM reconcile_errors"),
        ...errors.map((e) => d.prepare(ERR_INSERT_SQL, e.slug, e.path, e.message, at)),
      ];
      await d.batch(stmts);
    },
    async loadErrorSlugs() {
      const rows = await d.all<{ slug: string }>("SELECT slug FROM reconcile_errors");
      return rows.map((r) => r.slug);
    },
  };
}

/**
 * One scheduled run of the index reconcile: read prior error slugs, do the pass, record
 * `health:job:recipe-index` (ok with a counts summary, or fail), push an ntfy alert for
 * any NEW invalid recipe (de-spammed via the prior-slug diff — a persistent error is
 * recorded once, not re-alerted) AND on a hard job failure, and **rethrow** a hard
 * failure so the platform's native cron status reflects it — the same shape as
 * `runEmbedJob` / `runWarmJob`.
 */
export async function runProjectionJob(env: Env, deps: ProjectionDeps, kv: KvStore, now: () => number = () => Date.now()): Promise<void> {
  const startedAt = now();
  try {
    const priorSlugs = new Set(await deps.loadErrorSlugs());
    const r = await reconcileRecipeIndex(deps);
    await writeJobHealth(kv, "recipe-index", {
      ok: true,
      last_run_at: startedAt,
      summary: { projected: r.projected, skipped: r.skipped },
    });
    const newErrors = r.errors.filter((e) => !priorSlugs.has(e.slug));
    if (newErrors.length) {
      // A new malformed edit is surfaced (Decision 3): the count + the first few
      // slug/messages, tenant-clean (recipe slugs are shared corpus, not tenant data).
      const detail = newErrors
        .slice(0, 5)
        .map((e) => `${e.slug} (${e.message})`)
        .join("; ");
      await notifyFailure(env, "recipe-index", `${newErrors.length} recipe(s) failed to index: ${detail}`);
    }
  } catch (e) {
    const m = msg(e);
    console.error("[recipe-index] reconcile failed:", m);
    await writeJobHealth(kv, "recipe-index", {
      ok: false,
      last_run_at: startedAt,
      summary: { error: m },
    }).catch(() => {});
    await notifyFailure(env, "recipe-index", m);
    throw e; // cron is not retried; surfacing the failure loses nothing
  }
}
