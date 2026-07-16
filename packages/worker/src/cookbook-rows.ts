// The browse page's two differentiator rows (member-app-differentiators D7/D8),
// HTTP-only reads (no MCP tool — the agent has `retrospective` and ranked
// `search_recipes`; the plan scopes these to the app's cookbook area):
//
//   readTrending — a GROUP-WIDE cooking_log aggregation over a trailing window.
//     Deliberately cross-tenant (the group-favorites / group-insights precedent),
//     exposing COUNTS ONLY (`cooks`, `cooks_by`, `last_cooked`) — never which member
//     cooked what. The MIN-SIGNAL GUARD is the sparse-data design: a recipe trends
//     only with ≥ 2 cooks or ≥ 2 distinct cooking tenants in the window; production's
//     single-cook log yields an EMPTY set rather than fake trending. Results join the
//     projected index (unprojected slugs dropped), are filtered by the CALLER's
//     overlay rejects (group fact, personal lens), and are restricted to MEAL
//     candidates (`isMealCourse` — course includes `main` or is empty, fail-open).
//     The aggregation (GROUP BY / HAVING
//     in the design) is computed in JS over the windowed rows — the module idiom
//     (fake-D1-compatible full-read + JS), semantics identical to the D7 SQL.
//
//   readPickedForYou — a deterministic favorites-centroid wrap of `rankCandidates`:
//     the query vector is the normalized centroid of the caller's STORED favorite
//     embeddings (cron-captured — zero env.AI calls at request time), candidates are
//     the embedded index minus favorites/rejects/dietary-avoid conflicts/non-meal
//     courses (the same `isMealCourse` gate), and one
//     plain rankCandidates call orders them (P2's optional nudge params ABSENT —
//     omission is bit-identical by P2's contract). No favorites → an EMPTY result,
//     never a silent backfill from the general index.

import type { Env } from "./env.js";
import { db } from "./db.js";
import { loadRecipeIndex, loadRecipeEmbeddings } from "./recipe-index.js";
import { memberViewer, friendHouseholds } from "./visibility.js";
import { loadDeploymentProfile, type DeploymentProfile } from "./deployment.js";
import { readOverlay, readPreferences } from "./profile-db.js";
import { readLastCookedMap } from "./tools.js";
import { loadOperatorConfig } from "./operator-config.js";
import {
  rankCandidates,
  resolveRankParams,
  type SearchCandidate,
} from "./semantic-search.js";
import { isMealCourse, type IndexedRecipe } from "./recipes.js";

/** The compact recipe row both browse reads return (the new-for-me lite shape). */
export interface CookbookRowRecipe {
  slug: string;
  title: string;
  description: string | null;
  protein: string | null;
  cuisine: string | null;
  time_total: number | null;
}

/** One trending row: the lite recipe + its group-wide counts (never member identities). */
export interface TrendingRecipe extends CookbookRowRecipe {
  cooks: number;
  cooks_by: number;
  last_cooked: string;
}

export interface TrendingResult {
  recipes: TrendingRecipe[];
  window_days: number;
  /** The deployment profile the guard ran under — the browse page's label conditioner
   *  ("Trending" self-hosted / "Popular with Friends" SaaS; one signal, one read). */
  profile: DeploymentProfile;
}

/**
 * The D31 minimum-signal guard, profile-parameterized — ONE guard function for both
 * profiles, never the stricter rule deployment-wide:
 *   * self-hosted: at least 2 cooks OR at least 2 distinct cooking tenants — the
 *     existing guard VERBATIM, preserving the solo-operator degenerate case;
 *   * SaaS: the contributing set must span at least 2 distinct households BESIDES the
 *     caller's own — "cooked by 1 friend" never renders a cook signal.
 */
export function trendGuardQualifies(
  profile: DeploymentProfile,
  caller: string,
  e: { cooks: number; tenants: Set<string> },
): boolean {
  if (profile === "self-hosted") return e.cooks >= 2 || e.tenants.size >= 2;
  let nonCaller = 0;
  for (const t of e.tenants) if (t !== caller) nonCaller++;
  return nonCaller >= 2;
}

const TRENDING_WINDOW_DAYS = 60;
const TRENDING_K = 8;
const PICKED_K = 6;

function toLite(slug: string, entry: IndexedRecipe): CookbookRowRecipe {
  return {
    slug,
    title: typeof entry.title === "string" ? entry.title : slug,
    description: typeof entry.description === "string" ? entry.description : null,
    protein: typeof entry.protein === "string" ? entry.protein : null,
    cuisine: typeof entry.cuisine === "string" ? entry.cuisine : null,
    time_total: typeof entry.time_total === "number" ? entry.time_total : null,
  };
}

/**
 * Trending under the lens (D7 + D31): windowed, PROFILE-PARAMETERIZED min-signal guard
 * (`trendGuardQualifies` — one implementation, both profiles), reject-filtered, counts
 * only, deterministically ordered (cooks desc, distinct cooks desc, recency desc, slug
 * asc). The AGGREGATION SET is the caller's lens households: every household under
 * self-hosted (the friend lens over implicit all-to-all IS deployment-wide — today's
 * read, byte-for-byte), the caller's household plus its friend-seam households under
 * SaaS. Results are further restricted to lens-visible recipes by the viewer-scoped
 * index join. Never member identities — counts only (D31).
 */
export async function readTrending(
  env: Env,
  tenant: string,
  opts: { windowDays?: number; k?: number } = {},
): Promise<TrendingResult> {
  const windowDays = opts.windowDays ?? TRENDING_WINDOW_DAYS;
  const k = opts.k ?? TRENDING_K;
  const floor = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);
  const profile = await loadDeploymentProfile(env);

  // NO tenant filter on the read — the aggregation set is applied in JS below (the
  // module idiom: fake-D1-compatible full-read + JS; counts only; posture documented in
  // docs/ARCHITECTURE.md beside the cross-tenant flyer cache). The JS layer
  // re-validates every predicate so the read is exact on any D1 fidelity.
  const rows = await db(env).all<{ tenant: string; recipe: string | null; date: string; type: string }>(
    "SELECT tenant, recipe, date, type FROM cooking_log WHERE type = 'recipe' AND recipe IS NOT NULL AND date >= ?1",
    floor,
  );

  // SaaS: only the caller's lens households contribute cook events (the friend seam —
  // empty until the friendships table ships, so the set is the caller's own household).
  // Self-hosted: every household (no enumeration needed).
  const lensSet =
    profile === "saas" ? new Set<string>([tenant, ...(await friendHouseholds(env, tenant))]) : null;

  const agg = new Map<string, { cooks: number; tenants: Set<string>; last: string }>();
  for (const r of rows) {
    if (r.type !== "recipe" || !r.recipe || !(r.date >= floor)) continue;
    if (lensSet !== null && !lensSet.has(r.tenant)) continue;
    const e = agg.get(r.recipe) ?? { cooks: 0, tenants: new Set<string>(), last: "" };
    e.cooks += 1;
    e.tenants.add(r.tenant);
    if (r.date > e.last) e.last = r.date;
    agg.set(r.recipe, e);
  }

  const [index, overlay] = await Promise.all([loadRecipeIndex(env, memberViewer(tenant)), readOverlay(env, tenant)]);

  const qualified: TrendingRecipe[] = [];
  for (const [slug, e] of agg) {
    // The profile-parameterized min-signal guard: never rank single cooks as
    // "trending", never render "cooked by 1 friend" (D31). Below the guard the set is
    // EMPTY rather than ranking single cooks.
    if (!trendGuardQualifies(profile, tenant, e)) continue;
    const entry = index[slug];
    if (!entry) continue; // unprojected or out-of-lens — dropped
    if (overlay[slug]?.reject) continue; // the caller's personal disposition
    // Meal candidates only (fail-open for an empty, not-yet-classified course): a
    // component the group cooked twice is real history, but not a meal to suggest.
    if (!isMealCourse(entry.course)) continue;
    // `cooks_by` feeds the counts chip: self-hosted keeps the distinct-cooking-tenant
    // count verbatim (today's chip); SaaS counts distinct FRIEND households (non-caller)
    // so the "cooked by N friend households" copy is honest — never identities.
    const cooksBy =
      profile === "saas" ? [...e.tenants].filter((t) => t !== tenant).length : e.tenants.size;
    qualified.push({ ...toLite(slug, entry), cooks: e.cooks, cooks_by: cooksBy, last_cooked: e.last });
  }

  qualified.sort(
    (a, b) =>
      b.cooks - a.cooks ||
      b.cooks_by - a.cooks_by ||
      (a.last_cooked < b.last_cooked ? 1 : a.last_cooked > b.last_cooked ? -1 : 0) ||
      a.slug.localeCompare(b.slug),
  );

  return { recipes: qualified.slice(0, Math.max(1, k)), window_days: windowDays, profile };
}

/** The caller's hard dietary-avoid terms from `preferences.dietary.avoid`, lowercased. */
export function dietaryAvoids(prefs: Record<string, unknown> | null): string[] {
  const d = prefs?.dietary;
  if (!d || typeof d !== "object" || Array.isArray(d)) return [];
  const avoid = (d as Record<string, unknown>).avoid;
  if (!Array.isArray(avoid)) return [];
  return avoid.filter((x): x is string => typeof x === "string").map((x) => x.trim().toLowerCase()).filter(Boolean);
}

/**
 * Does a recipe CONFLICT with the caller's dietary avoids? Deterministic and
 * conservative: an avoided term conflicts when it equals the recipe's `protein`
 * facet (the coarse vocab — `shellfish`, `pork`, …) or appears as an entry in its
 * normalized ingredient arrays (`ingredients_key` / `ingredients_full`). Exact
 * entry matches only — no substring guessing; subtler conflicts stay LLM territory.
 */
export function conflictsWithAvoids(entry: IndexedRecipe, avoids: string[]): boolean {
  if (avoids.length === 0) return false;
  const terms = new Set<string>();
  if (typeof entry.protein === "string") terms.add(entry.protein.toLowerCase());
  for (const field of ["ingredients_key", "ingredients_full"] as const) {
    const v = entry[field];
    if (Array.isArray(v)) for (const i of v) if (typeof i === "string") terms.add(i.toLowerCase());
  }
  return avoids.some((a) => terms.has(a));
}

/** Normalized centroid of the caller's favorite embeddings (the D8 query vector). */
export function favoritesCentroid(vecs: number[][]): number[] | null {
  if (vecs.length === 0) return null;
  const dim = vecs[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vecs) {
    if (v.length !== dim) continue;
    for (let i = 0; i < dim; i++) sum[i] += v[i];
  }
  let norm = 0;
  for (const x of sum) norm += x * x;
  norm = Math.sqrt(norm);
  if (!(norm > 0)) return null;
  return sum.map((x) => x / norm);
}

/**
 * Picked-for-you (D8): rank the embedded index against the favorites centroid with
 * the existing blend (favoriteAffinity sharpens toward the nearest favorite,
 * freshness keeps new imports competitive). Stored vectors only — no model call.
 */
export async function readPickedForYou(
  env: Env,
  tenant: string,
  opts: { k?: number } = {},
): Promise<{ recipes: CookbookRowRecipe[] }> {
  const k = opts.k ?? PICKED_K;
  // Candidates are the caller's LENS-VISIBLE corpus (the shared enforcement point): an
  // out-of-lens recipe near the centroid is never a pick (member-app-differentiators).
  const [index, embeddings, overlay, lastCooked, prefs, operatorConfig] = await Promise.all([
    loadRecipeIndex(env, memberViewer(tenant)),
    loadRecipeEmbeddings(env),
    readOverlay(env, tenant),
    readLastCookedMap(env, tenant),
    readPreferences(env, tenant).catch(() => null),
    loadOperatorConfig(env).catch(() => null),
  ]);

  const favoriteVecs: number[][] = [];
  for (const [slug, row] of Object.entries(overlay)) {
    if (row?.favorite) {
      const vec = embeddings.get(slug);
      if (vec) favoriteVecs.push(vec);
    }
  }
  // No favorites → an honest empty row (never a backfill from the general index).
  const centroid = favoritesCentroid(favoriteVecs);
  if (centroid === null) return { recipes: [] };

  const avoids = dietaryAvoids(prefs);
  const candidates: SearchCandidate[] = [];
  for (const [slug, entry] of Object.entries(index)) {
    const row = overlay[slug];
    if (row?.favorite || row?.reject) continue; // never re-pick a favorite; rejects never surface
    if (conflictsWithAvoids(entry, avoids)) continue;
    // Meal candidates only (fail-open for an empty course): picked-for-you suggests
    // meals — a component/sub-recipe near the centroid is never a pick.
    if (!isMealCourse(entry.course)) continue;
    const vec = embeddings.get(slug);
    if (!vec) continue; // stored vectors only — an unembedded recipe is "not yet indexed"
    const lite = toLite(slug, entry);
    candidates.push({
      slug,
      title: lite.title,
      description: lite.description,
      protein: lite.protein,
      cuisine: lite.cuisine,
      time_total: lite.time_total,
      embedding: vec,
      last_cooked: lastCooked.get(slug) ?? null,
      ingredients_key: [],
      perishable_ingredients: [],
    });
  }
  if (candidates.length === 0) return { recipes: [] };

  const params = resolveRankParams(prefs, operatorConfig ?? undefined);
  // P2's optional trailing nudge/proteinWants params are ABSENT — bit-identical omission.
  const ranked = rankCandidates(candidates, centroid, favoriteVecs, [], new Date(), params, k);
  // Lite rows only — no scores, no why-labels (D8: the mock shows none).
  return {
    recipes: ranked.map(({ slug, title, description, protein, cuisine, time_total }) => ({
      slug,
      title,
      description,
      protein,
      cuisine,
      time_total,
    })),
  };
}
