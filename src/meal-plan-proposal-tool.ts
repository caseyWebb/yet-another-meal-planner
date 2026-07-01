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
import { fetchWeatherForecast } from "./weather.js";
import { readNightVibes, readNightVibeVectors, readVibeLastSatisfied, type NightVibe } from "./night-vibe-db.js";
import { debt, sampleWeek, DEFAULT_CADENCE_PARAMS, type NightVibeSpec } from "./night-vibe-schedule.js";
import { assembleProposal, type ProposalCtx } from "./meal-plan-proposal.js";
import type { DiversifyCandidate, DiversifyParams } from "./diversify.js";

/** The buildServer closures this tool reuses (memoized per-request reads). */
export interface ProposeDeps {
  getOverlay: () => Promise<Overlay>;
  getLastCookedMap: () => Promise<Map<string, string>>;
  getOwnedEquipment: () => Promise<string[]>;
  getAliases: () => Promise<Record<string, string>>;
  normalizeItems: (value: unknown, aliases: Record<string, string>) => string[];
}

/** Per-slot recall: how many candidates to rank before the cross-slot diversify narrows. */
const POOL_K = 24;
const DEFAULT_NIGHTS = 5;

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
        "Propose a week of dinners from the caller's NIGHT-VIBE PALETTE, deterministically and statelessly. Two levels: (1) SHAPE — sample `nights` night-vibe slots weighted by cadence-debt (overdue vibes surface) and weather; (2) FILL — retrieve each slot's vibe by meaning and select a VARIED main (MMR + protein/cuisine caps across the week, not the top-3 lookalikes). Composes rung-1 `pairs_with` corpus sides, flags single-use perishable waste + meal-prep + novelty, and returns per-main `why`. Iterate by re-calling with `lock` (keep these recipes), `exclude` (swap these out), `nudges` (max_time_total, variety strength), and a `seed` (change it for 'give me another week'). Reads cron-captured vectors only — no Workers AI call, no writes (persist a chosen plan with update_meal_plan, threading each main's vibe id as `from_vibe`). Returns { plan, variety, diagnostics }; an unfillable slot is returned as an explicit empty slot, never dropped.",
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

        const [index, overlay, lastCooked, owned, embeddings, prefs, operatorConfig, aliases, palette, vibeVectors, lastSatisfied] =
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
            deps.getAliases().catch(() => ({}) as Record<string, string>),
            readNightVibes(env, tenant.id),
            readNightVibeVectors(env, tenant.id),
            readVibeLastSatisfied(env, tenant.id),
          ]);

        const nightCount = nights ?? num((prefs as Record<string, unknown> | null)?.default_cooking_nights) ?? DEFAULT_NIGHTS;

        if (palette.length === 0) {
          return { plan: [], variety: { distinct_proteins: 0, distinct_cuisines: 0, mean_pairwise_sim: 0, max_pairwise_sim: 0 }, diagnostics: { seed: resolvedSeed, lambda: 0, nights: nightCount, filled: 0, empty: 0 }, note: "no night vibes in the palette — add some with add_night_vibe, then propose again" };
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
        const boostItems = deps.normalizeItems(boost_ingredients, aliases);
        const diversifyParams: Partial<DiversifyParams> = {};
        if (typeof nudges?.variety === "number") diversifyParams.lambda = 1 - nudges.variety; // more variety → lower λ

        // Level 1 — shape the week. Cadence-debt per vibe (no cadence → no pressure), then
        // sample `nights - locked` slots weighted by debt × weather.
        const lockedSlugs = (lock ?? []).map((s) => s.toLowerCase()).filter((s) => !excludeSet.has(s));
        const nightsToFill = Math.max(0, nightCount - lockedSlugs.length);

        const debtByVibe = new Map<string, number>();
        for (const v of palette) {
          debtByVibe.set(v.id, v.cadence_days ? debt(lastSatisfied.get(v.id) ?? null, v.cadence_days, now) : 0);
        }
        const weather = await fetchWeatherForecast(resolveZip(prefs), 7).catch(() => null);
        const weatherVibes = weather && "forecast" in weather ? [...new Set(weather.forecast.flatMap((d) => d.meal_vibes))] : [];

        const specs: NightVibeSpec[] = palette.map((v) => ({
          id: v.id,
          base_weight: v.base_weight ?? undefined,
          pinned: v.pinned,
          weather_affinity: v.weather_affinity,
          weather_antipathy: v.weather_antipathy,
        }));
        const shape = sampleWeek(specs, weatherVibes, debtByVibe, nightsToFill, resolvedSeed, DEFAULT_CADENCE_PARAMS);
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
          poolByVibe.set(slot.id, buildPool(effective, vibe, vibeVec, embeddings, lastCooked, favoriteVecs, boostItems, rankParams, now, owned, aliases, deps, excludeSet, nudges?.max_time_total));
          if (slot.reason === "pinned") whyByVibe.set(slot.id, [`your regular “${vibe.vibe}”`]);
          else if (slot.reason === "overdue") whyByVibe.set(slot.id, [`“${vibe.vibe}” is due to come back around`]);
        }

        // Locked picks → resolved candidates (skip unembedded / gated-out).
        const locked: DiversifyCandidate[] = [];
        for (const slug of lockedSlugs) {
          const entry = effective[slug];
          const vec = embeddings.get(slug);
          if (entry && vec) locked.push(toDiversify(slug, entry.frontmatter as Record<string, unknown>, vec, 1));
        }

        const frontmatterBySlug = new Map<string, Record<string, unknown>>();
        for (const [slug, entry] of Object.entries(effective)) frontmatterBySlug.set(slug, entry.frontmatter as Record<string, unknown>);

        const ctx: ProposalCtx = {
          slots: shape.slots,
          poolByVibe,
          locked,
          frontmatterBySlug,
          embeddingBySlug: embeddings,
          boostItems,
          lastCooked,
          seed: resolvedSeed,
          params: diversifyParams,
          whyByVibe,
        };
        const result = assembleProposal(ctx);
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
  boostItems: string[],
  rankParams: ReturnType<typeof resolveRankParams>,
  now: Date,
  owned: string[],
  aliases: Record<string, string>,
  deps: ProposeDeps,
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
      ingredients_key: deps.normalizeItems(fm.ingredients_key, aliases),
      perishable_ingredients: deps.normalizeItems(fm.perishable_ingredients, aliases),
    });
  }
  const ranked = rankCandidates(cands, vibeVec, favoriteVecs, boostItems, now, rankParams, POOL_K);
  const pool: DiversifyCandidate[] = [];
  for (const r of ranked) {
    const vec = embeddings.get(r.slug);
    if (!vec) continue;
    pool.push(toDiversify(r.slug, (effective[r.slug]?.frontmatter as Record<string, unknown>) ?? {}, vec, r.score, r.title, r.protein, r.cuisine, r.time_total));
  }
  return pool;
}

function toDiversify(
  slug: string,
  fm: Record<string, unknown>,
  embedding: number[],
  score: number,
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
  };
}

/** ZIP from preferences (location_zip, else parsed from preferred_location); "" when unset. */
function resolveZip(prefs: Record<string, unknown> | null): string {
  const stores = prefs?.stores as Record<string, unknown> | undefined;
  if (typeof stores?.location_zip === "string" && stores.location_zip.trim()) return stores.location_zip.trim();
  if (typeof stores?.preferred_location === "string") return stores.preferred_location.match(/\d{5}/)?.[0] ?? "";
  return "";
}
