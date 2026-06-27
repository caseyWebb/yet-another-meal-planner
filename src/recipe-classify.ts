// Recipe FACET classify pass (recipe-facet-derivation). The cron derives the descriptive
// recipe facets from the recipe BODY across the WHOLE corpus, generalizing the discovery
// sweep's classifier (src/discovery-classify.ts) beyond new discovery candidates. It writes
// the RAW classifier output to the reconcile-independent `recipe_facets` table (migration
// 0018); the recipe-index projection later merges the EFFECTIVE value (authored override ??
// classified; tags unioned; Tier A classified-wins) into `recipes`, so every reader is
// unchanged.
//
//   - Tier A (derived-only): ingredients_key, perishable_ingredients, side_search_terms,
//     meal_preppable.
//   - Tier B (classified default, authored override wins at merge): protein, cuisine,
//     course, season, tags.
//   - Tier C (dietary, requires_equipment, time_total): authored, NOT derived here.
//
// It runs BEFORE the index projection in scheduled() (the projection merges its output) and
// reads R2 bodies directly (a binding call, off the 50 external-subrequest budget — same
// internal env.AI/D1 bucket as the describe pass). Change-GATED on a hash over the body +
// the authored Tier-B overrides the classifier conditions on (so a steady corpus does ~0
// work, and an override edit re-triggers), and BOUNDED per tick (classify is one env.AI call
// each, not batchable). Logic is split from I/O (injected deps) so it is unit-testable with
// in-memory fakes, exactly as recipe-embeddings.ts / recipe-projection.ts do.

import { db } from "./db.js";
import type { Env } from "./env.js";
import type { CorpusStore } from "./corpus-store.js";
import { parseMarkdown } from "./parse.js";
import { classifyRecipe, CLASSIFY_MAX_RETRIES } from "./discovery-classify.js";
import { normalizeIngredientList } from "./matching.js";
import { readAliases } from "./corpus-db.js";
import { hashText } from "./hash.js";
import { normalizeFacetCourse, EMPTY_FACETS, type ClassifiedFacets } from "./recipe-facets.js";
import { notifyFailure, writeJobHealth } from "./health.js";
import type { KvStore } from "./kroger-user.js";

/** Max recipes CLASSIFIED per tick (one env.AI call each — not batchable, like describe). */
export const CLASSIFY_MAX_PER_TICK = 20;

/** One corpus recipe the pass may (re)classify — body + the conditioning overrides + its gate hash. */
export interface RecipeToClassify {
  slug: string;
  title: string;
  /** The markdown body (carries the ## Ingredients / ## Instructions the classifier reads). */
  body: string;
  /** The authored `course` override (Tier B), for the classifier's side_search_terms conditioning. */
  courseOverride: string[] | null;
  /** Change-detection hash over the body + the authored Tier-B overrides (the regeneration gate). */
  bodyHash: string;
}

/** One `recipe_facets` row's gate state (the facet values are not loaded here). */
export interface FacetState {
  slug: string;
  body_hash: string | null;
}

/** What one classify pass did, for the `health:job:recipe-classify` summary (tenant-data-free). */
export interface FacetReconcileResult {
  /** Recipes (re)classified this tick. */
  classified: number;
  /** Recipes deferred to a later tick (over the per-tick cap). */
  pending: number;
  /** Recipes whose classification failed the contract within the retry budget (gate advanced, facets empty). */
  failed: number;
  /** Orphan facet rows deleted (slug no longer in the corpus). */
  pruned: number;
}

/** The I/O the classify pass needs, injected so the logic is testable without R2/AI/D1. */
export interface DerivedFacetDeps {
  /** Every corpus recipe (slug, title, body, course override, gate hash). */
  loadRecipes(): Promise<RecipeToClassify[]>;
  /** Every `recipe_facets` row's gate state. */
  loadFacetState(): Promise<FacetState[]>;
  /** Classify one recipe's body into the derived facets (one env.AI call + alias normalization). */
  classify(recipe: RecipeToClassify): Promise<ClassifiedFacets>;
  /** Upsert the classified facets + the gate hash (idempotent on slug). */
  upsertFacets(slug: string, facets: ClassifiedFacets, bodyHash: string): Promise<void>;
  /** Record the gate hash with EMPTY facets (a classify that could not pass the contract) — so it is
   *  not re-spent every tick until the body changes. */
  upsertEmpty(slug: string, bodyHash: string): Promise<void>;
  /** Delete facet rows whose slug no longer exists in the corpus; return the count deleted. */
  pruneOrphans(corpusSlugs: string[]): Promise<number>;
  /** Per-tick cap (injected so tests can shrink it). */
  maxPerTick: number;
  /** KV for the health record + epoch-ms clock, mirroring the other crons' deps. */
  kv: KvStore;
  now(): number;
}

/**
 * One classify pass: (re)classify recipes whose body/override hash differs from what's stored
 * (or that have no row yet), bounded per tick, then prune orphans. Pure orchestration over the
 * injected deps. A partial run is safe — all writes are idempotent and the hash gate means the
 * next tick continues where this one stopped. A classify that cannot pass the contract within the
 * retry budget advances the gate with empty facets (counted), so it is not re-spent every tick.
 */
export async function reconcileRecipeFacets(deps: DerivedFacetDeps): Promise<FacetReconcileResult> {
  const recipes = await deps.loadRecipes();
  const state = new Map((await deps.loadFacetState()).map((s) => [s.slug, s]));

  const stale = recipes.filter((r) => state.get(r.slug)?.body_hash !== r.bodyHash);
  const batch = stale.slice(0, deps.maxPerTick);
  let failed = 0;
  for (const r of batch) {
    try {
      const facets = await deps.classify(r);
      await deps.upsertFacets(r.slug, facets, r.bodyHash);
    } catch {
      // The classifier could not produce contract-valid facets within the retry budget (rare for
      // an already-valid corpus recipe). Advance the gate with empty facets so we don't re-spend
      // env.AI every tick; the recipe reads as "not yet derived" until its body changes.
      failed++;
      await deps.upsertEmpty(r.slug, r.bodyHash);
    }
  }

  const pruned = await deps.pruneOrphans(recipes.map((r) => r.slug));

  return {
    classified: batch.length - failed,
    pending: stale.length - batch.length,
    failed,
    pruned,
  };
}

/** Stable gate hash over the recipe body + the authored Tier-B overrides the classifier conditions on. */
export function facetGateHash(body: string, overrides: Record<string, unknown>): string {
  // A JSON tuple of [body, overrides-in-fixed-key-order] — deterministic, and any change to an
  // override the classifier depends on flips the hash (so an override edit re-triggers classify).
  const ordered: Record<string, unknown> = {};
  for (const k of ["protein", "cuisine", "course", "season", "tags"]) {
    if (overrides[k] !== undefined) ordered[k] = overrides[k];
  }
  return hashText(JSON.stringify([body, ordered]));
}

const LOAD_STATE_SQL = "SELECT slug, body_hash FROM recipe_facets";
const UPSERT_SQL =
  "INSERT INTO recipe_facets (slug, body_hash, protein, cuisine, course, season, tags, ingredients_key, " +
  "perishable_ingredients, side_search_terms, meal_preppable) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) " +
  "ON CONFLICT(slug) DO UPDATE SET body_hash = excluded.body_hash, protein = excluded.protein, " +
  "cuisine = excluded.cuisine, course = excluded.course, season = excluded.season, tags = excluded.tags, " +
  "ingredients_key = excluded.ingredients_key, perishable_ingredients = excluded.perishable_ingredients, " +
  "side_search_terms = excluded.side_search_terms, meal_preppable = excluded.meal_preppable";

function facetBinds(slug: string, f: ClassifiedFacets, bodyHash: string): unknown[] {
  return [
    slug,
    bodyHash,
    f.protein,
    f.cuisine,
    JSON.stringify(f.course),
    JSON.stringify(f.season),
    JSON.stringify(f.tags),
    JSON.stringify(f.ingredients_key),
    JSON.stringify(f.perishable_ingredients),
    JSON.stringify(f.side_search_terms),
    f.meal_preppable == null ? null : f.meal_preppable ? 1 : 0,
  ];
}

/** Coerce a frontmatter value to a string[] (array-of-strings, or a single string → [string]). */
function strArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return typeof v === "string" && v ? [v] : [];
}

/** Extract + normalize the derived facets from the classifier's returned frontmatter. */
export function extractFacets(fm: Record<string, unknown>, aliases: Record<string, string>): ClassifiedFacets {
  return {
    protein: typeof fm.protein === "string" ? fm.protein : null,
    cuisine: typeof fm.cuisine === "string" ? fm.cuisine : null,
    course: normalizeFacetCourse(fm.course),
    season: strArray(fm.season),
    tags: strArray(fm.tags),
    ingredients_key: normalizeIngredientList(strArray(fm.ingredients_key), aliases) as string[],
    perishable_ingredients: normalizeIngredientList(strArray(fm.perishable_ingredients), aliases) as string[],
    side_search_terms: strArray(fm.side_search_terms),
    meal_preppable: typeof fm.meal_preppable === "boolean" ? fm.meal_preppable : null,
  };
}

/** Wire the real R2 corpus + Workers AI + D1 + aliases for the scheduled handler. */
export function buildFacetDeps(env: Env, store: CorpusStore): DerivedFacetDeps {
  const d = db(env);
  let aliasesCache: Record<string, string> | null = null;
  const aliases = async () => (aliasesCache ??= await readAliases(env));

  return {
    async loadRecipes() {
      const paths = (await store.list("recipes/")).filter((p) => p.endsWith(".md")).sort();
      const out: RecipeToClassify[] = [];
      for (const path of paths) {
        const text = await store.getFile(path);
        if (text === null) continue;
        let frontmatter: Record<string, unknown>;
        let body: string;
        try {
          ({ frontmatter, body } = parseMarkdown(text, path));
        } catch {
          continue; // a malformed file is the index reconcile's concern; skip it here
        }
        const base = path.split("/").pop() ?? path;
        const slug = base.endsWith(".md") ? base.slice(0, -3) : base;
        const overrides: Record<string, unknown> = {};
        for (const k of ["protein", "cuisine", "course", "season", "tags"]) {
          if (frontmatter[k] !== undefined) overrides[k] = frontmatter[k];
        }
        out.push({
          slug,
          title: typeof frontmatter.title === "string" ? frontmatter.title : slug,
          body,
          courseOverride: frontmatter.course !== undefined ? normalizeFacetCourse(frontmatter.course) : null,
          bodyHash: facetGateHash(body, overrides),
        });
      }
      return out;
    },
    loadFacetState: () => d.all<FacetState>(LOAD_STATE_SQL),
    async classify(recipe) {
      const result = await classifyRecipe(
        env,
        { title: recipe.title, content: recipe.body },
        null,
        CLASSIFY_MAX_RETRIES,
        recipe.courseOverride && recipe.courseOverride.length ? { course: recipe.courseOverride } : undefined,
      );
      return extractFacets(result.frontmatter, await aliases());
    },
    async upsertFacets(slug, facets, bodyHash) {
      await d.run(UPSERT_SQL, ...facetBinds(slug, facets, bodyHash));
    },
    async upsertEmpty(slug, bodyHash) {
      await d.run(UPSERT_SQL, ...facetBinds(slug, EMPTY_FACETS, bodyHash));
    },
    async pruneOrphans(corpusSlugs) {
      const existing = await d.all<{ slug: string }>("SELECT slug FROM recipe_facets");
      const keep = new Set(corpusSlugs);
      const orphans = existing.filter((r) => !keep.has(r.slug));
      if (orphans.length === 0) return 0;
      await d.batch(orphans.map((o) => d.prepare("DELETE FROM recipe_facets WHERE slug = ?1", o.slug)));
      return orphans.length;
    },
    maxPerTick: CLASSIFY_MAX_PER_TICK,
    kv: env.KROGER_KV as unknown as KvStore,
    now: () => Date.now(),
  };
}

/**
 * One scheduled run of the classify pass: do the pass, record `health:job:recipe-classify`
 * (ok with a counts summary, or fail), push an optional ntfy alert on failure, and **rethrow**
 * so the platform's native cron status reflects a failure — the same shape as `runEmbedJob`.
 */
export async function runFacetJob(env: Env, deps: DerivedFacetDeps): Promise<void> {
  const startedAt = deps.now();
  try {
    const r = await reconcileRecipeFacets(deps);
    await writeJobHealth(deps.kv, "recipe-classify", {
      ok: true,
      last_run_at: startedAt,
      summary: { classified: r.classified, pending: r.pending, failed: r.failed, pruned: r.pruned },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[recipe-classify] classify pass failed:", msg);
    await writeJobHealth(deps.kv, "recipe-classify", {
      ok: false,
      last_run_at: startedAt,
      summary: { error: msg },
    }).catch(() => {});
    await notifyFailure(env, "recipe-classify", msg);
    throw e; // cron is not retried; surfacing the failure loses nothing
  }
}
