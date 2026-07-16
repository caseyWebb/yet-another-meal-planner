// Recipe-INDEX reconcile (r2-corpus-store). The cron reconcile reads the whole R2
// corpus, validates every recipe against the SAME shared required-field + vocabulary
// contract the write tools use (src/recipe-contract.js) PLUS the cross-corpus checks
// that need the whole corpus (`pairs_with` slug resolution, duplicate slugs, the body
// `## Ingredients`/`## Instructions` sections), and projects the D1 `recipes` table.
// The index is a deterministic, Worker-owned rebuild from R2.
//
// A recipe that fails validation is SKIPPED (not projected) and recorded to the D1
// `reconcile_errors` table, so a malformed human edit is observable
// (agent-readable record + `/health` + an ntfy push) instead of silently dropped.
// Projection is eventual (cron-driven), consistent with the system's accepted
// eventual-consistency.
//
// Logic is split from I/O (injected `ProjectionDeps`) so it is unit-testable with
// in-memory R2/D1 fakes, exactly as `recipe-embeddings.ts` does for the derived reconcile.
// The D1 row shape MUST stay in sync with the read reconstruction in src/recipe-index.ts
// (same column ↔ frontmatter map).

import { db } from "./db.js";
import { emptyIngredientContext, enqueueNovelTerms, ingredientContext, type IngredientContext } from "./corpus-db.js";
import type { Env } from "./env.js";
import { parseMarkdown } from "./parse.js";
import { validateRecipeContract } from "./recipe-contract.js";
import { mergeEffectiveFacets, parseFacetRow, type ClassifiedFacets, type RawFacetRow } from "./recipe-facets.js";
import type { CorpusStore } from "./corpus-store.js";
import { notifyFailure, recordUsagePoint, writeJobHealth, writeJobRun } from "./health.js";

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
  "ingredients_full",
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

/** What one index reconcile did, for the `recipe-index` job_health summary. */
export interface ProjectionResult {
  /** Recipes projected into the index. */
  projected: number;
  /** Invalid recipes skipped (== errors.length). */
  skipped: number;
  /**
   * Valid recipes DELIBERATELY excluded because their frontmatter carries a non-empty
   * `duplicate_of` (the operator-merge tombstone, recipe-dedup) — a curation decision,
   * not a defect, so no `reconcile_errors` row; counted so the exclusion stays observable.
   */
  tombstoned: number;
  /**
   * Distinct projected ingredient ids the current resolver has not placed — the
   * convergence gauge (watch it fall as the capture job drains the queue). A degraded
   * (empty-context) pass counts every term, so a resolver-read failure shows as a spike.
   */
  unresolved: number;
  /**
   * True when the resolver read failed and the pass ran on the empty context (cleaned
   * passthrough, no capture). The alertable signal — the projection itself still
   * succeeds, so this rides the summary rather than flipping the job to failed.
   */
  degraded: boolean;
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
  /** The classify pass's derived facets per slug (recipe-facet-derivation), merged into the index. */
  loadClassifiedFacets(): Promise<Map<string, ClassifiedFacets>>;
  /**
   * The pass's resolver state, loaded once per pass: a resolve-ONLY context (capture
   * off — the projection batches its own enqueue via `enqueueNovelTerms` below) plus
   * whether the read degraded. Must not reject: the real wiring degrades a
   * resolver-read failure to the empty context (cleaned passthrough, `degraded: true`)
   * so the projection always projects.
   */
  ingredientContext(): Promise<{ ctx: IngredientContext; degraded: boolean }>;
  /**
   * Batch-enqueue the pass's distinct unplaced ids to the novel-term queue
   * (insert-or-ignore; the real wiring is best-effort and never throws).
   */
  enqueueNovelTerms(terms: string[]): Promise<void>;
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
  // One resolve-only IngredientContext per pass: the resolver is read once; capture is
  // the projection's own single batched flush below, not per-term context enqueues.
  const [classified, { ctx, degraded }] = await Promise.all([deps.loadClassifiedFacets(), deps.ingredientContext()]);
  const unplaced = new Set<string>(); // distinct mapped ids the resolver has not placed (the capture set)
  const errors: ReconcileError[] = [];
  const valid: Record<string, Record<string, unknown>> = {}; // slug -> projected entry
  const seenSlugs = new Map<string, string>(); // slug -> first path (duplicate-slug guard)
  let tombstoned = 0; // duplicate_of-marked recipes deliberately excluded (recipe-dedup)

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

    // A validated file whose frontmatter carries a non-empty string `duplicate_of` is the
    // operator-merge TOMBSTONE (recipe-dedup): a deliberate curation exclusion, not a
    // defect — no `recipes` row AND no `reconcile_errors` row, counted in the summary so
    // it stays observable. Downstream convergence is all existing machinery (the derived
    // orphan prunes key off the slug leaving `recipes`); removing the marker restores the
    // row on the next pass. An empty/non-string value is ignored (projects normally).
    if (typeof frontmatter.duplicate_of === "string" && frontmatter.duplicate_of.trim() !== "") {
      tombstoned++;
      continue;
    }

    // Project objective content only (strip subjective fields + the unindexed `standalone`).
    // The descriptive facets are the EFFECTIVE values: the classify pass's derived facets merged
    // with any authored frontmatter override (Tier B authored-wins, tags unioned, Tier A
    // classified-wins) — so a reader sees one resolved value with no read-time join. Tier C
    // (dietary, requires_equipment, time_total, pairs_with) stays authored, untouched.
    const objective: Record<string, unknown> = { ...frontmatter };
    for (const f of SUBJECTIVE_FIELDS) delete objective[f];
    delete objective.standalone;
    const effective = mergeEffectiveFacets(frontmatter, classified.get(slug) ?? null);
    // Re-resolve the ingredient facets through the CURRENT shared resolver: the projected
    // row carries surviving canonical ids (a new alias / synonym merge reaches the index
    // next tick, no reclassification) while `recipe_facets` keeps its classify-time
    // snapshot. Post-merge covers both the classified values and the pre-migration
    // authored Tier-A fallbacks; unplaced ids are collected for the batched capture flush.
    effective.ingredients_key = ctx.resolveNames(effective.ingredients_key);
    effective.ingredients_full = ctx.resolveNames(effective.ingredients_full);
    effective.perishable_ingredients = ctx.resolveNames(effective.perishable_ingredients);
    for (const id of [...effective.ingredients_key, ...effective.ingredients_full, ...effective.perishable_ingredients]) {
      if (!ctx.resolver.ids.has(id)) unplaced.add(id);
    }
    valid[slug] = normalizeValue({
      ...objective,
      slug,
      pairs_with: Array.isArray(frontmatter.pairs_with) ? frontmatter.pairs_with : [],
      requires_equipment: Array.isArray(frontmatter.requires_equipment) ? frontmatter.requires_equipment : [],
      ...effective,
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

  // Convergence gauge: distinct projected ids the resolver has not placed. Computed over
  // the recipes that actually project (after the pairs_with pruning above). A degraded
  // (empty-context) pass counts every term unresolved — the visible signal of a resolver
  // read failure, since the projection itself deliberately still succeeds.
  // NOTE the deliberate capture-vs-gauge divergence: the flush below enqueues the
  // PRE-pruning `unplaced` set (a pairs_with-dropped recipe's terms still funnel), while
  // this gauge counts projected rows only.
  const unresolvedIds = new Set<string>();
  for (const r of Object.values(valid)) {
    for (const field of ["ingredients_key", "ingredients_full", "perishable_ingredients"] as const) {
      const ids = Array.isArray(r[field]) ? (r[field] as unknown[]) : [];
      for (const id of ids) if (typeof id === "string" && !ctx.resolver.ids.has(id)) unresolvedIds.add(id);
    }
  }

  const rows = Object.values(valid)
    .sort((a, b) => String(a.slug).localeCompare(String(b.slug)))
    .map(recipeToRow);
  await deps.replaceRecipes(rows);
  await deps.replaceErrors(errors);

  // Batched capture flush: ONE insert-or-ignore enqueue of the pass's distinct unplaced
  // ids — never when degraded (an unreadable resolver must not flood the queue with
  // terms it cannot check). Awaited so the write isn't orphaned past the invocation,
  // but a flush failure never fails the pass (the terms stay unresolved and re-enqueue
  // next tick).
  if (!degraded && unplaced.size) {
    await deps.enqueueNovelTerms([...unplaced].sort()).catch(() => {});
  }

  return { projected: rows.length, skipped: errors.length, tombstoned, unresolved: unresolvedIds.size, degraded, errors };
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
    async loadClassifiedFacets() {
      const rows = await d.all<RawFacetRow>(
        "SELECT slug, protein, cuisine, course, season, tags, ingredients_key, ingredients_full, " +
          "perishable_ingredients, side_search_terms, meal_preppable FROM recipe_facets",
      );
      return new Map(rows.map((r) => [r.slug, parseFacetRow(r)]));
    },
    // Resolve-only (capture off): the projection flushes its own distinct unplaced set
    // once per pass. A resolver read failure degrades to the empty context (the
    // grocery/pantry-write pattern) with `degraded: true` — stored values pass through
    // in their cleaned form, capture is skipped, and every recipe still projects.
    ingredientContext: () =>
      ingredientContext(env, { capture: false }).then(
        (ctx) => ({ ctx, degraded: false }),
        () => ({ ctx: emptyIngredientContext(env), degraded: true }),
      ),
    // Best-effort by contract (enqueueNovelTerms swallows its own errors).
    enqueueNovelTerms: (terms) => enqueueNovelTerms(env, terms),
  };
}

/**
 * One scheduled run of the index reconcile: read prior error slugs, do the pass, record
 * the `recipe-index` job_health row (ok with a counts summary, or fail), push an ntfy alert for
 * any NEW invalid recipe (de-spammed via the prior-slug diff — a persistent error is
 * recorded once, not re-alerted) AND on a hard job failure, and **rethrow** a hard
 * failure so the platform's native cron status reflects it — the same shape as
 * `runEmbedJob` / `runWarmJob`.
 */
export async function runProjectionJob(env: Env, deps: ProjectionDeps, now: () => number = () => Date.now()): Promise<void> {
  const startedAt = now();
  try {
    const priorSlugs = new Set(await deps.loadErrorSlugs());
    const r = await reconcileRecipeIndex(deps);
    // `unresolved` is the convergence gauge, `degraded` the resolver-read-failure flag
    // (the job stays ok: the projection genuinely succeeded), and `tombstoned` the
    // deliberate duplicate_of exclusions (recipe-dedup); the usage-trends AE point below
    // stays [projected, skipped] — its doubles are consumed positionally.
    const summary = { projected: r.projected, skipped: r.skipped, tombstoned: r.tombstoned, unresolved: r.unresolved, degraded: r.degraded };
    await writeJobHealth(env, "recipe-index", { ok: true, last_run_at: startedAt, summary });
    await writeJobRun(env, "recipe-index", {
      ok: true,
      ran_at: startedAt,
      duration_ms: now() - startedAt,
      summary,
    });
    // History point (usage-trends): doubles = [duration_ms, projected, skipped].
    recordUsagePoint(env, "recipe-index", {
      ok: true,
      durationMs: now() - startedAt,
      counts: [r.projected, r.skipped],
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
    await writeJobHealth(env, "recipe-index", {
      ok: false,
      last_run_at: startedAt,
      summary: { error: m },
    }).catch(() => {});
    await writeJobRun(env, "recipe-index", {
      ok: false,
      ran_at: startedAt,
      duration_ms: now() - startedAt,
      summary: { error: m },
    });
    recordUsagePoint(env, "recipe-index", { ok: false, durationMs: now() - startedAt });
    await notifyFailure(env, "recipe-index", m);
    throw e; // cron is not retried; surfacing the failure loses nothing
  }
}
