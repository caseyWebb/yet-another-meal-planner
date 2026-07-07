// The `propose_meal_plan` operation + tool wrapper (meal-plan-proposal capability). The whole
// pipeline lives in `runProposeMealPlan` — a shared op called by BOTH the MCP tool and the
// member app's `POST /api/propose` (member-app-propose D1), so the two surfaces are one
// contract. It loads all context (the caller's night-vibe palette + vectors, the recipe index +
// embeddings, favorites, preferences, weather, and cadence signals), runs the two-level
// planner — Level 1 samples the week shape by cadence-debt × weather (night-vibe-schedule.ts),
// Level 2 ranks each slot's candidates (semantic-search.ts) and the pure `assembleProposal`
// cross-slot-diversifies + composes the plate — and returns a structured proposal. Stateless,
// no writes. Request-time model touch is bounded to at most ONE batched, cache-gated embedding
// call (embedTextsCached, D5) covering only the `nudges.freeform` phrase and any `slots[].vibe`
// override phrases; a request with no such text makes NO Workers AI call (every other query
// vector is cron-captured).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import type { Tenant } from "./tenant.js";
import { runTool, ToolError } from "./errors.js";
import { loadRecipeIndex, loadRecipeEmbeddings } from "./recipe-index.js";
import { filterRecipes, type RecipeIndex } from "./recipes.js";
import { mergeOverlay, type Overlay } from "./overlay.js";
import { rankCandidates, resolveRankParams, type RankNudge, type SearchCandidate } from "./semantic-search.js";
import { cosineSimilarity, embedTextsCached } from "./embedding.js";
import { readPreferences } from "./profile-db.js";
import { loadOperatorConfig } from "./operator-config.js";
import { fetchWeatherForecast, deriveCategory, type WeatherCategory } from "./weather.js";
import { readNightVibes, readNightVibeVectors, readVibeLastSatisfied, type NightVibe } from "./night-vibe-db.js";
import { debt, sampleWeek, DEFAULT_CADENCE_PARAMS, type NightVibeSpec } from "./night-vibe-schedule.js";
import { assembleProposal, type ProposalCtx, type ProposalResult } from "./meal-plan-proposal.js";
import type { DiversifyCandidate, DiversifyParams } from "./diversify.js";
import { readPantry } from "./session-db.js";
import { deriveAtRiskDemand } from "./use-it-up.js";
import { emptyIngredientContext, type IngredientContext } from "./corpus-db.js";

/** The buildServer closures this op reuses (memoized per-request reads). Non-MCP callers
 *  (the `/api/propose` route) build fresh ones with `buildProposeDeps` (src/tools.ts). */
export interface ProposeDeps {
  getOverlay: () => Promise<Overlay>;
  getLastCookedMap: () => Promise<Map<string, string>>;
  getOwnedEquipment: () => Promise<string[]>;
  /** The shared ingredient-normalization funnel (resolve + capture + search terms). Every
   *  perishable/key/pantry/boost name the planner sets-maths over routes through `resolveNames`,
   *  so the corpus vocabulary and the pantry line up on the SAME canonical ids. */
  getIngredientContext: () => Promise<IngredientContext>;
}

/** One per-vibe-slot constraint object (member-app-propose D2). Keyed by `vibe_id`; a
 *  constraint whose vibe isn't sampled this week is INERT (no error) so a replayed client
 *  session survives palette edits. */
export interface ProposeSlotConstraint {
  vibe_id: string;
  /** Facet pin: overwrite the vibe facet's protein for this slot's gate. */
  protein?: string;
  /** Facet pin: overwrite the vibe facet's cuisine for this slot's gate. */
  cuisine?: string;
  /** Per-night time cap. EXPLICITLY nullable: `null` LIFTS the vibe's own cap for this
   *  night (which absence cannot express). Precedence: slot pin > global
   *  `nudges.max_time_total` > the vibe's own facet. */
  max_time_total?: number | null;
  /** A typed phrase replacing this slot's query vector (embedded, cache-gated). Gate and
   *  vibe identity unchanged; the returned slot is marked `vibe_override: true`. */
  vibe?: string;
  /** An identity-preserving recipe pin filling this slot (lock resolution rules; an
   *  unresolvable pin returns as an explicit empty slot, never silently dropped). */
  recipe?: string;
}

export interface ProposeNudges {
  max_time_total?: number;
  variety?: number;
  /** Week-level phrase, embedded once (cache-gated) and applied to every slot's ranking
   *  as a bounded additive term — never a gate. */
  freeform?: string;
  /** Week-level soft protein boost (never a gate; per-slot `protein` pins are the hard
   *  version). */
  proteins?: string[];
}

/** The full propose request — the MCP tool's input and the `POST /api/propose` body. */
export interface ProposeInput {
  nights?: number;
  seed?: number;
  lock?: string[];
  exclude?: string[];
  boost_ingredients?: string[];
  nudges?: ProposeNudges;
  slots?: ProposeSlotConstraint[];
}

/** The op's result: the assembled proposal + the schedule's rollover diagnostics
 *  (`rolled_over` absent only on the empty-palette short-circuit, which carries `note`). */
export interface ProposeResult extends Omit<ProposalResult, "diagnostics"> {
  diagnostics: ProposalResult["diagnostics"] & { rolled_over?: string[] };
  note?: string;
}

/** Per-slot recall: how many candidates to rank before the cross-slot diversify narrows. */
const POOL_K = 24;
const DEFAULT_NIGHTS = 5;
/** Fallback planning window (days) when the caller has no `planning_cadence_days` set. */
const DEFAULT_PLANNING_WINDOW_DAYS = 7;
/** The freeform phrase's rank-nudge weight — the `favoriteWeight` scale, deliberately
 *  subordinate to the primary vibe cosine (a phrase steers the week without capsizing
 *  relevance; mirrors the design mock's 0.14). */
export const FREEFORM_NUDGE_WEIGHT = 0.15;
/** The freeform cosine a chosen main must clear before its `why[]` claims the match
 *  ("matches your ask") — bge cosines run high-baseline, so ~0.6 is a material match. */
export const FREEFORM_WHY_FLOOR = 0.6;

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

/**
 * Run the whole propose pipeline for one tenant (member-app-propose D1: the shared op both
 * `propose_meal_plan` and `POST /api/propose` call). Throws structured `ToolError`s only —
 * the MCP wrapper converts via `runTool`, the route via the shared error middleware.
 */
export async function runProposeMealPlan(env: Env, tenant: Tenant, input: ProposeInput, deps: ProposeDeps): Promise<ProposeResult> {
  const { nights, seed, lock, exclude, boost_ingredients, nudges, slots } = input;
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

  // Resolve a raw recipe name case-insensitively against the index (corpus slugs are NOT
  // lowercased) under the LOCK RULES: it must exist, be embedded, and not be rejected —
  // shared by `lock` and the per-slot `slots[].recipe` pins (D3). Returns null when any
  // rule fails (the caller decides how an unresolvable name surfaces).
  const slugByLower = new Map(Object.keys(effective).map((s) => [s.toLowerCase(), s]));
  const resolveCandidate = (raw: string): DiversifyCandidate | null => {
    const realSlug = slugByLower.get(raw.toLowerCase());
    const entry = realSlug ? effective[realSlug] : undefined;
    const vec = realSlug ? embeddings.get(realSlug) : undefined;
    if (!realSlug || !entry || !vec || (entry as { reject?: unknown }).reject) return null;
    // `effective[slug]` is a FLAT index entry (frontmatter fields directly on it) — NOT
    // a `{ frontmatter }` wrapper (that shape only comes from filterRecipes). Pass it as-is.
    const e = entry as Record<string, unknown>;
    return toDiversify(realSlug, e, vec, 1, ctx.resolveNames(e.perishable_ingredients), ctx.resolveNames(e.ingredients_key));
  };

  // Locks: a lock also in `exclude` is dropped up-front (it doesn't occupy a night); a lock
  // that resolves becomes a locked main; anything else (unknown / unembedded / rejected)
  // becomes an explicit empty locked slot — never silently dropped, and the reject hard gate
  // still holds. Each lock (resolved or not) occupies one night; the rest are sampled.
  const lockList = (lock ?? []).filter((s) => !excludeSet.has(s.toLowerCase()));
  const locked: DiversifyCandidate[] = [];
  const lockedUnresolved: string[] = [];
  for (const raw of lockList) {
    const cand = resolveCandidate(raw);
    if (cand) locked.push(cand);
    else lockedUnresolved.push(raw);
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

  // Per-slot constraints keyed by vibe id (D2). First entry per vibe wins (deterministic);
  // a constraint whose vibe wasn't sampled this week is INERT — no effect, no error.
  const constraintByVibe = new Map<string, ProposeSlotConstraint>();
  for (const s of slots ?? []) {
    if (!constraintByVibe.has(s.vibe_id)) constraintByVibe.set(s.vibe_id, s);
  }
  const sampledVibeIds = new Set(shape.slots.map((s) => s.id));

  // Request-time embeds (D4/D5): the freeform phrase + every SAMPLED slot's vibe-override
  // phrase, in ONE cache-gated batched call. A request with no such text makes NO AI call.
  const freeform = nudges?.freeform?.trim() ? nudges.freeform.trim() : undefined;
  const overrideTexts: { id: string; text: string }[] = [];
  for (const [id, c] of constraintByVibe) {
    const text = c.vibe?.trim();
    if (text && sampledVibeIds.has(id)) overrideTexts.push({ id, text });
  }
  const embedInputs = [...(freeform ? [freeform] : []), ...overrideTexts.map((o) => o.text)];
  const embedded = embedInputs.length > 0 ? await embedTextsCached(env, embedInputs) : [];
  const freeformVec = freeform ? embedded[0] : null;
  const overrideVecByVibe = new Map<string, number[]>();
  overrideTexts.forEach((o, j) => overrideVecByVibe.set(o.id, embedded[(freeform ? 1 : 0) + j]));

  const freeformNudge: RankNudge | undefined = freeformVec ? { vec: freeformVec, weight: FREEFORM_NUDGE_WEIGHT } : undefined;
  const proteinWants = nudges?.proteins && nudges.proteins.length > 0 ? nudges.proteins : undefined;

  // Level 2 — rank each sampled slot's candidates into a pool. A `slots[].vibe` override
  // replaces the slot's QUERY VECTOR only (facet gate + vibe identity unchanged) — which
  // also makes a not-yet-embedded fresh vibe fillable tonight instead of an empty slot.
  const poolByVibe = new Map<string, DiversifyCandidate[]>();
  const whyByVibe = new Map<string, string[]>();
  const overriddenVibes = new Set<string>();
  for (const slot of shape.slots) {
    const vibe = paletteById.get(slot.id);
    const overrideVec = overrideVecByVibe.get(slot.id);
    const queryVec = overrideVec ?? vibeVectors.get(slot.id);
    if (!vibe || !queryVec) {
      poolByVibe.set(slot.id, []); // unembedded / missing → explicit empty slot
      continue;
    }
    if (overrideVec) overriddenVibes.add(slot.id);
    poolByVibe.set(slot.id, buildPool(effective, vibe, queryVec, embeddings, lastCooked, favoriteVecs, rankParams, now, owned, ctx, excludeSet, nudges?.max_time_total, constraintByVibe.get(slot.id), freeformNudge, proteinWants));
    if (slot.reason === "pinned") whyByVibe.set(slot.id, [`your regular “${vibe.vibe}”`]);
    else if (slot.reason === "overdue") whyByVibe.set(slot.id, [`“${vibe.vibe}” is due to come back around`]);
  }

  // Recipe pins (D3): lock resolution rules + exclude-wins — an excluded or otherwise
  // unresolvable pin surfaces as an explicit empty slot (never silently dropped). Pins for
  // unsampled vibes are inert.
  const pinnedByVibe = new Map<string, DiversifyCandidate>();
  const pinnedUnresolvedByVibe = new Map<string, string>();
  for (const [id, c] of constraintByVibe) {
    const raw = c.recipe?.trim();
    if (!raw || !sampledVibeIds.has(id)) continue;
    const cand = excludeSet.has(raw.toLowerCase()) ? null : resolveCandidate(raw);
    if (cand) pinnedByVibe.set(id, cand);
    else pinnedUnresolvedByVibe.set(id, raw);
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
    pinnedByVibe,
    pinnedUnresolvedByVibe,
    overriddenVibes,
  };
  const result = assembleProposal(proposalCtx);

  // Nudge legibility (D4): a planner-picked main materially matched by the freeform phrase
  // or covered by a protein want says so. Locked/pinned mains were the CALLER's choice —
  // the nudges didn't pick them, so they claim nothing.
  for (const slot of result.plan) {
    if (!slot.main || slot.reason === "locked" || slot.recipe_pinned) continue;
    const vec = embeddings.get(slot.main.slug);
    if (freeform && freeformVec && vec && cosineSimilarity(freeformVec, vec) >= FREEFORM_WHY_FLOOR) {
      slot.why.push(`matches your ask “${freeform}”`);
    }
    if (proteinWants && slot.main.protein && proteinWants.includes(slot.main.protein)) {
      slot.why.push(`the ${slot.main.protein} you asked for`);
    }
  }
  return { ...result, diagnostics: { ...result.diagnostics, rolled_over: shape.rolledOver } };
}

export function registerProposeMealPlanTool(server: McpServer, env: Env, tenant: Tenant, deps: ProposeDeps): void {
  server.registerTool(
    "propose_meal_plan",
    {
      description:
        "Propose a week of dinners from the caller's NIGHT-VIBE PALETTE, deterministically and statelessly. Two levels: (1) SHAPE — sample `nights` night-vibe slots weighted by cadence-debt (overdue vibes surface) and weather; (2) FILL — retrieve each slot's vibe by meaning and select a VARIED main (MMR + protein/cuisine caps across the week, not the top-3 lookalikes). Does HOLISTIC use-it-up automatically: derives the caller's at-risk perishables from their PANTRY and spreads them across the week's mains (a multi-serving item can be used across two recipes), subordinate to vibe relevance and the hard gate — no param needed. Composes rung-1 `pairs_with` corpus sides, flags single-use perishable waste + meal-prep + novelty, and returns per-main `why` + `uses_perishables` (what each main actually uses up). Iterate by re-calling with `lock` (keep these recipes anywhere in the week, as vibe-less locked slots — resolved case-insensitively, respecting your rejects; a lock that's unknown, not-yet-embedded, or rejected comes back as an explicit empty locked slot), `exclude` (swap these out — an excluded recipe never appears in a pool, an alternate, or a pin), `boost_ingredients` (OVERRIDE — extra items to definitely use up, unioned with the pantry-derived set), `nudges`, `slots`, and a `seed` (change it for 'give me another week'). `nudges`: max_time_total, variety strength (clamped so it can't collapse relevance), `proteins` (week-level SOFT protein boost — reorders, never gates) and `freeform` (a phrase like 'more soup, lighter dinners' — embedded and applied to every slot's ranking as a bounded additive term, never a gate; a main it materially matches says so in `why`). `slots` = per-vibe-slot constraints keyed by vibe_id (inert if that vibe isn't sampled this week): `protein`/`cuisine` facet pins narrowing that night's gate, `max_time_total` (a number caps that night; EXPLICIT null lifts the vibe's own cap — precedence: slot pin > nudges.max_time_total > vibe facet), `vibe` (a typed phrase replacing that slot's query vector — gate + identity unchanged, slot returns vibe_override: true; also fills a fresh not-yet-embedded vibe), and `recipe` (pin that exact recipe INTO the slot keeping its vibe identity + `from_vibe` provenance — the swap-in-place primitive; slot returns recipe_pinned: true, and an unresolvable pin comes back as an explicit empty slot). Each vibe slot also returns swap material from its already-ranked pool: `alternates` (top remaining candidates, week-deduped), `alt_similar` (nearest to the chosen main), `alt_different` (best different-cuisine) — all gate survivors; empty slots keep their alternates as the escape hatch. A slot placed by a non-mild weather quota carries `weather_category` and a weather-fit `why`. Makes at most ONE batched Workers AI embedding call per request — only for `nudges.freeform`/`slots[].vibe` text not already in the query-embedding cache; a request with no such text makes NO AI call (every other vector is cron-captured). NO writes (persist a chosen plan with update_meal_plan, threading each main's vibe id as `from_vibe`). Returns { plan, variety, uncovered_at_risk, diagnostics }; `uncovered_at_risk` names at-risk items the plan couldn't use, and an unfillable slot is returned as an explicit empty slot, never dropped.",
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
            freeform: z.string().optional(),
            proteins: z.array(z.string()).optional(),
          })
          .optional(),
        slots: z
          .array(
            z.object({
              vibe_id: z.string(),
              protein: z.string().optional(),
              cuisine: z.string().optional(),
              max_time_total: z.number().nullable().optional(),
              vibe: z.string().optional(),
              recipe: z.string().optional(),
            }),
          )
          .optional(),
      },
    },
    (input) => runTool(() => runProposeMealPlan(env, tenant, input, deps)),
  );
}

/** Rank one vibe's facet-gated survivors into a diversify pool. `queryVec` is the vibe's
 *  cron-captured vector — or the slot's override-phrase vector (D4). `pins` narrows the
 *  facet gate with precedence slot pin > global `maxTime` nudge > vibe facet (a `null`
 *  per-slot time cap LIFTS the vibe's own); `nudge`/`proteinWants` are the bounded
 *  additive rank terms (they reorder gate survivors, never admit past the gate). */
function buildPool(
  effective: RecipeIndex,
  vibe: NightVibe,
  queryVec: number[],
  embeddings: Map<string, number[]>,
  lastCooked: Map<string, string>,
  favoriteVecs: number[][],
  rankParams: ReturnType<typeof resolveRankParams>,
  now: Date,
  owned: string[],
  ctx: IngredientContext,
  excludeSet: Set<string>,
  maxTime: number | undefined,
  pins: ProposeSlotConstraint | undefined,
  nudge: RankNudge | undefined,
  proteinWants: string[] | undefined,
): DiversifyCandidate[] {
  const facets = { ...(vibe.facets ?? {}) };
  if (typeof maxTime === "number") (facets as Record<string, unknown>).max_time_total = maxTime;
  // Slot pins (D2) apply LAST so they win over both the vibe facet and the global nudge;
  // `max_time_total: null` deletes the cap for this night — absence changes nothing.
  if (pins) {
    if (pins.protein !== undefined) (facets as Record<string, unknown>).protein = pins.protein;
    if (pins.cuisine !== undefined) (facets as Record<string, unknown>).cuisine = pins.cuisine;
    if (pins.max_time_total === null) delete (facets as Record<string, unknown>).max_time_total;
    else if (typeof pins.max_time_total === "number") (facets as Record<string, unknown>).max_time_total = pins.max_time_total;
  }
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
  // the whole week), so applying the uniform per-slot boost too would double-count it. The
  // freeform/protein-want nudges DO live here (bounded additive, per D4) — they shape every
  // slot's relevance ordering uniformly, with no cross-slot state to double-count.
  const ranked = rankCandidates(cands, queryVec, favoriteVecs, [], now, rankParams, POOL_K, nudge, proteinWants);
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
