// The `propose_meal_plan` tool wrapper (meal-plan-proposal capability). Loads all context
// (the caller's night-vibe palette + vectors, the recipe index + embeddings, favorites,
// preferences, weather, and cadence signals), runs the two-level planner — Level 1 samples the
// week shape by cadence-debt × weather (night-vibe-schedule.ts), Level 2 ranks each slot's
// candidates (semantic-search.ts) and the pure `assembleProposal` cross-slot-diversifies +
// composes the plate — and returns a structured proposal. Stateless; makes NO Workers AI call
// (every query vector is cron-captured) and NO writes.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import type { Tenant } from "./tenant.js";
import { runTool, ToolError } from "./errors.js";
import { loadRecipeIndex, loadRecipeEmbeddings } from "./recipe-index.js";
import { filterRecipes, type RecipeIndex } from "./recipes.js";
import { mergeOverlay, type Overlay } from "./overlay.js";
import { rankCandidates, resolveRankParams, type SearchCandidate } from "./semantic-search.js";
import { readPreferences } from "./profile-db.js";
import { loadOperatorConfig } from "./operator-config.js";
import { fetchWeatherForecast, deriveCategory, type WeatherCategory } from "./weather.js";
import { readNightVibes, readNightVibeVectors, readVibeLastSatisfied, type NightVibe } from "./night-vibe-db.js";
import { debt, sampleWeek, DEFAULT_CADENCE_PARAMS, type NightVibeSpec } from "./night-vibe-schedule.js";
import { assembleProposal, type ProposalCtx } from "./meal-plan-proposal.js";
import type { DiversifyCandidate, DiversifyParams } from "./diversify.js";
import { readPantry } from "./session-db.js";
import { deriveAtRiskDemand } from "./use-it-up.js";
import { emptyIngredientContext, type IngredientContext } from "./corpus-db.js";

/** The buildServer closures this tool reuses (memoized per-request reads). */
export interface ProposeDeps {
  getOverlay: () => Promise<Overlay>;
  getLastCookedMap: () => Promise<Map<string, string>>;
  getOwnedEquipment: () => Promise<string[]>;
  /** The shared ingredient-normalization funnel (resolve + capture + search terms). Every
   *  perishable/key/pantry/boost name the planner sets-maths over routes through `resolveNames`,
   *  so the corpus vocabulary and the pantry line up on the SAME canonical ids. */
  getIngredientContext: () => Promise<IngredientContext>;
}

/** Per-slot recall: how many candidates to rank before the cross-slot diversify narrows. */
const POOL_K = 24;
const DEFAULT_NIGHTS = 5;
/** Fallback planning window (days) when the caller has no `planning_cadence_days` set. */
const DEFAULT_PLANNING_WINDOW_DAYS = 7;

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

export function registerProposeMealPlanTool(server: McpServer, env: Env, tenant: Tenant, deps: ProposeDeps): void {
  server.registerTool(
    "propose_meal_plan",
    {
      description:
        "Propose a week of dinners from the caller's NIGHT-VIBE PALETTE, deterministically and statelessly. Two levels: (1) SHAPE — sample `nights` night-vibe slots weighted by cadence-debt (overdue vibes surface) and weather; (2) FILL — retrieve each slot's vibe by meaning and select a VARIED main (MMR + protein/cuisine caps across the week, not the top-3 lookalikes). Does HOLISTIC use-it-up automatically: derives the caller's at-risk perishables from their PANTRY and spreads them across the week's mains (a multi-serving item can be used across two recipes), subordinate to vibe relevance and the hard gate — no param needed. Composes rung-1 `pairs_with` corpus sides, flags single-use perishable waste + meal-prep + novelty, and returns per-main `why` + `uses_perishables` (what each main actually uses up). Iterate by re-calling with `lock` (keep these recipes — resolved case-insensitively, respecting your rejects; a lock that's unknown, not-yet-embedded, or rejected comes back as an explicit empty locked slot), `exclude` (swap these out), `boost_ingredients` (OVERRIDE — extra items to definitely use up, unioned with the pantry-derived set), `nudges` (max_time_total, variety strength — clamped so it can't collapse relevance), and a `seed` (change it for 'give me another week'). Reads cron-captured vectors only — no Workers AI call, no writes (persist a chosen plan with update_meal_plan, threading each main's vibe id as `from_vibe`). Returns { plan, variety, uncovered_at_risk, diagnostics }; `uncovered_at_risk` names at-risk items the plan couldn't use, and an unfillable slot is returned as an explicit empty slot, never dropped.",
      inputSchema: {
        nights: z.number().int().positive().max(14).optional(),
        seed: z.number().int().optional(),
        lock: z.array(z.string()).optional(),
        exclude: z.array(z.string()).optional(),
        boost_ingredients: z.array(z.string()).optional(),
        nudges: z
          .object({
            max_time_total: z.number().optional(),
            variety: z.number().min(0).max(1).optional(),
          })
          .optional(),
      },
    },
    ({ nights, seed, lock, exclude, boost_ingredients, nudges }) =>
      runTool(async () => {
        const now = new Date();
        const resolvedSeed = seed ?? Number(now.toISOString().slice(0, 10).replace(/-/g, ""));
        const excludeSet = new Set((exclude ?? []).map((s) => s.toLowerCase()));

        const [index, overlay, lastCooked, owned, embeddings, prefs, operatorConfig, ctx, palette, vibeVectors, lastSatisfied, pantry] =
          await Promise.all([
            loadRecipeIndex(env).catch((e) => {
              throw new ToolError("index_unavailable", `the recipe index is unavailable: ${e instanceof Error ? e.message : String(e)}`);
            }),
            deps.getOverlay(),
            deps.getLastCookedMap(),
            deps.getOwnedEquipment(),
            loadRecipeEmbeddings(env),
            readPreferences(env, tenant.id).catch(() => null),
            loadOperatorConfig(env).catch(() => null),
            deps.getIngredientContext().catch(() => emptyIngredientContext(env)),
            readNightVibes(env, tenant.id),
            readNightVibeVectors(env, tenant.id),
            readVibeLastSatisfied(env, tenant.id),
            readPantry(env, tenant.id).catch(() => []),
          ]);

        const nightCount = nights ?? num((prefs as Record<string, unknown> | null)?.default_cooking_nights) ?? DEFAULT_NIGHTS;
        // The planning WINDOW is a separate knob from the night count: it's how far out the
        // caller plans/shops (planning_cadence_days), driving the weather horizon and the
        // vibe-recurrence caps below — a longer window does NOT by itself mean more cooking
        // nights (default_cooking_nights already resolved that, above, independent of window).
        const window = num((prefs as Record<string, unknown> | null)?.planning_cadence_days) ?? DEFAULT_PLANNING_WINDOW_DAYS;

        if (palette.length === 0) {
          return { plan: [], variety: { distinct_proteins: 0, distinct_cuisines: 0, mean_pairwise_sim: 0, max_pairwise_sim: 0 }, uncovered_at_risk: [], diagnostics: { seed: resolvedSeed, lambda: 0, nights: nightCount, filled: 0, empty: 0 }, note: "no night vibes in the palette — add some with add_night_vibe, then propose again" };
        }

        // Effective per-tenant index: merge overlay (favorite/reject) + cooking-log last_cooked
        // so the reject + makeability gates see the caller's view (as search_recipes does).
        const effective: RecipeIndex = {};
        for (const [slug, entry] of Object.entries(index)) {
          effective[slug] = { ...mergeOverlay(entry, overlay[slug], lastCooked.get(slug)), slug };
        }

        const favoriteVecs: number[][] = [];
        for (const [slug, row] of Object.entries(overlay)) {
          if (row?.favorite) {
            const vec = embeddings.get(slug);
            if (vec) favoriteVecs.push(vec);
          }
        }
        const rankParams = resolveRankParams(prefs, operatorConfig ?? undefined);
        const boostItems = ctx.resolveNames(boost_ingredients);
        const diversifyParams: Partial<DiversifyParams> = {};
        // More variety → lower λ, but clamp to the 0.4 floor below which relevance collapses.
        if (typeof nudges?.variety === "number") diversifyParams.lambda = Math.max(0.4, 1 - nudges.variety);

        // Holistic use-it-up: derive the at-risk DEMAND multiset from the pantry (always-on — no
        // param needed), then union the explicit `boost_ingredients` override. The corpus
        // perishable VOCABULARY (alias-normalized union of every recipe's perishable_ingredients)
        // is the "is this a perishable a recipe can use" test; both it and the pantry names are
        // normalized through the SAME alias table as the candidate ingredients, so they line up.
        const perishableVocab = new Set<string>();
        for (const entry of Object.values(effective)) {
          for (const item of ctx.resolveNames((entry as Record<string, unknown>).perishable_ingredients)) perishableVocab.add(item);
        }
        const atRiskDemand = deriveAtRiskDemand(
          pantry.map((row) => ({
            normalizedName: ctx.resolveNames([(row as Record<string, unknown>).name])[0] ?? "",
            quantity: typeof (row as Record<string, unknown>).quantity === "string" ? ((row as Record<string, unknown>).quantity as string) : null,
            addedAt: typeof (row as Record<string, unknown>).added_at === "string" ? ((row as Record<string, unknown>).added_at as string) : null,
          })),
          perishableVocab,
          now,
        );
        // Explicit override: "definitely use these" — honored regardless of pantry/vocab, but never
        // lowering a larger pantry-derived count for the same item.
        for (const item of boostItems) atRiskDemand.set(item, Math.max(atRiskDemand.get(item) ?? 0, 1));

        // Resolve locks case-insensitively against the index (corpus slugs are NOT lowercased),
        // dropping any also in `exclude`. A lock that resolves to a real, embedded, NON-rejected
        // recipe becomes a locked main; anything else (unknown / unembedded / rejected) becomes an
        // explicit empty locked slot — so a lock is never silently dropped and the reject hard
        // gate still holds. Each lock (resolved or not) occupies one night; the rest are sampled.
        const slugByLower = new Map(Object.keys(effective).map((s) => [s.toLowerCase(), s]));
        const lockList = (lock ?? []).filter((s) => !excludeSet.has(s.toLowerCase()));
        const locked: DiversifyCandidate[] = [];
        const lockedUnresolved: string[] = [];
        for (const raw of lockList) {
          const realSlug = slugByLower.get(raw.toLowerCase());
          const entry = realSlug ? effective[realSlug] : undefined;
          const vec = realSlug ? embeddings.get(realSlug) : undefined;
          if (realSlug && entry && vec && !(entry as { reject?: unknown }).reject) {
            // `effective[slug]` is a FLAT index entry (frontmatter fields directly on it) — NOT
            // a `{ frontmatter }` wrapper (that shape only comes from filterRecipes). Pass it as-is.
            const e = entry as Record<string, unknown>;
            locked.push(toDiversify(realSlug, e, vec, 1, ctx.resolveNames(e.perishable_ingredients), ctx.resolveNames(e.ingredients_key)));
          } else {
            lockedUnresolved.push(raw);
          }
        }
        const nightsToFill = Math.max(0, nightCount - lockList.length);

        const debtByVibe = new Map<string, number>();
        for (const v of palette) {
          debtByVibe.set(v.id, v.cadence_days ? debt(lastSatisfied.get(v.id) ?? null, v.cadence_days, now) : 0);
        }
        // The weather forecast horizon IS the planning window (fetchWeatherForecast clamps to
        // its own supported range, e.g. 1–16 days, rather than failing on an oversized window).
        // Each day collapses to exactly ONE discrete category (never a flattened union) —
        // `sampleWeek` histograms this mix into quotas itself (capped at its own reliability
        // horizon), so no additional bounding happens here beyond the fetch's own day count.
        const weather = await fetchWeatherForecast(resolveZip(prefs), window).catch(() => null);
        const dayCategories: WeatherCategory[] =
          weather && "forecast" in weather ? weather.forecast.map((d) => deriveCategory(d.meal_vibes, d.condition)) : [];

        const specs: NightVibeSpec[] = palette.map((v) => ({
          id: v.id,
          base_weight: v.base_weight ?? undefined,
          pinned: v.pinned,
          weather_affinity: v.weather_affinity,
          weather_antipathy: v.weather_antipathy,
          cadence_days: v.cadence_days,
        }));
        const shape = sampleWeek(specs, dayCategories, debtByVibe, nightsToFill, resolvedSeed, DEFAULT_CADENCE_PARAMS, window);
        const paletteById = new Map(palette.map((v) => [v.id, v]));

        // Level 2 — rank each sampled slot's candidates into a pool.
        const poolByVibe = new Map<string, DiversifyCandidate[]>();
        const whyByVibe = new Map<string, string[]>();
        for (const slot of shape.slots) {
          const vibe = paletteById.get(slot.id);
          const vibeVec = vibeVectors.get(slot.id);
          if (!vibe || !vibeVec) {
            poolByVibe.set(slot.id, []); // unembedded / missing → explicit empty slot
            continue;
          }
          poolByVibe.set(slot.id, buildPool(effective, vibe, vibeVec, embeddings, lastCooked, favoriteVecs, rankParams, now, owned, ctx, excludeSet, nudges?.max_time_total));
          if (slot.reason === "pinned") whyByVibe.set(slot.id, [`your regular “${vibe.vibe}”`]);
          else if (slot.reason === "overdue") whyByVibe.set(slot.id, [`“${vibe.vibe}” is due to come back around`]);
        }

        const frontmatterBySlug = new Map<string, Record<string, unknown>>();
        for (const [slug, entry] of Object.entries(effective)) frontmatterBySlug.set(slug, entry as Record<string, unknown>);

        const proposalCtx: ProposalCtx = {
          slots: shape.slots,
          poolByVibe,
          locked,
          lockedUnresolved,
          requestedNights: nightCount,
          frontmatterBySlug,
          embeddingBySlug: embeddings,
          atRiskDemand,
          lastCooked,
          seed: resolvedSeed,
          params: diversifyParams,
          whyByVibe,
        };
        const result = assembleProposal(proposalCtx);
        return { ...result, diagnostics: { ...result.diagnostics, rolled_over: shape.rolledOver } };
      }),
  );
}

/** Rank one vibe's facet-gated survivors into a diversify pool. */
function buildPool(
  effective: RecipeIndex,
  vibe: NightVibe,
  vibeVec: number[],
  embeddings: Map<string, number[]>,
  lastCooked: Map<string, string>,
  favoriteVecs: number[][],
  rankParams: ReturnType<typeof resolveRankParams>,
  now: Date,
  owned: string[],
  ctx: IngredientContext,
  excludeSet: Set<string>,
  maxTime: number | undefined,
): DiversifyCandidate[] {
  const facets = { ...(vibe.facets ?? {}) };
  if (typeof maxTime === "number") (facets as Record<string, unknown>).max_time_total = maxTime;
  const survivors = filterRecipes(effective, facets, now, owned).filter((s) => !excludeSet.has(s.slug.toLowerCase()));
  const cands: SearchCandidate[] = [];
  for (const s of survivors) {
    const vec = embeddings.get(s.slug);
    if (!vec) continue;
    const fm = s.frontmatter as Record<string, unknown>;
    cands.push({
      slug: s.slug,
      title: str(fm.title) ?? s.slug,
      description: str(fm.description),
      protein: str(fm.protein),
      cuisine: str(fm.cuisine),
      time_total: num(fm.time_total),
      embedding: vec,
      last_cooked: lastCooked.get(s.slug) ?? null,
      ingredients_key: ctx.resolveNames(fm.ingredients_key),
      perishable_ingredients: ctx.resolveNames(fm.perishable_ingredients),
    });
  }
  // Pool score is PURE vibe relevance (cosine + favorite + freshness) — NO use-it-up boost here.
  // Holistic use-it-up is owned by the planner's stateful, decrementing coverage term (which sees
  // the whole week), so applying the uniform per-slot boost too would double-count it.
  const ranked = rankCandidates(cands, vibeVec, favoriteVecs, [], now, rankParams, POOL_K);
  const ingredientsBySlug = new Map(cands.map((c) => [c.slug, { perishable: c.perishable_ingredients, key: c.ingredients_key }]));
  const pool: DiversifyCandidate[] = [];
  for (const r of ranked) {
    const vec = embeddings.get(r.slug);
    if (!vec) continue;
    const ing = ingredientsBySlug.get(r.slug);
    pool.push(toDiversify(r.slug, (effective[r.slug] as Record<string, unknown>) ?? {}, vec, r.score, ing?.perishable ?? [], ing?.key ?? [], r.title, r.protein, r.cuisine, r.time_total));
  }
  return pool;
}

function toDiversify(
  slug: string,
  fm: Record<string, unknown>,
  embedding: number[],
  score: number,
  perishable: string[],
  ingredientsKey: string[],
  title?: string,
  protein?: string | null,
  cuisine?: string | null,
  timeTotal?: number | null,
): DiversifyCandidate {
  const course = Array.isArray(fm.course) ? fm.course.filter((x): x is string => typeof x === "string") : [];
  return {
    slug,
    title: title ?? str(fm.title) ?? slug,
    protein: protein ?? str(fm.protein),
    cuisine: cuisine ?? str(fm.cuisine),
    course,
    time_total: timeTotal ?? num(fm.time_total),
    score,
    embedding,
    // Alias-normalized ingredient sets — the coverage term's matching inputs.
    perishable_ingredients: perishable,
    ingredients_key: ingredientsKey,
  };
}

/** ZIP from preferences (location_zip, else parsed from preferred_location); "" when unset. */
function resolveZip(prefs: Record<string, unknown> | null): string {
  const stores = prefs?.stores as Record<string, unknown> | undefined;
  if (typeof stores?.location_zip === "string" && stores.location_zip.trim()) return stores.location_zip.trim();
  if (typeof stores?.preferred_location === "string") return stores.preferred_location.match(/\d{5}/)?.[0] ?? "";
  return "";
}
