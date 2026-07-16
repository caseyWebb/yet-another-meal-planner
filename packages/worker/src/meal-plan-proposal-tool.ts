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
import { memberViewer } from "./visibility.js";
import { filterRecipes, isMealCourse, type RecipeIndex } from "./recipes.js";
import { mergeOverlay, type Overlay } from "./overlay.js";
import { rankCandidates, resolveRankParams, type RankNudge, type SearchCandidate } from "./semantic-search.js";
import { cosineSimilarity, embedTextsCached } from "./embedding.js";
import { readPreferences } from "./profile-db.js";
import { loadOperatorConfig } from "./operator-config.js";
import { fetchWeatherForecast, deriveCategory, type WeatherCategory } from "./weather.js";
import { readNightVibes, readNightVibeVectors, readVibeLastSatisfied, type NightVibe } from "./night-vibe-db.js";
import { debt, sampleWeek, DEFAULT_CADENCE_PARAMS, type NightVibeSpec, type NewForMeSeed, type WeekSlot } from "./night-vibe-schedule.js";
import { facetsSchema } from "./night-vibe-tools.js";
import { assembleProposal, type ProposalCtx, type ProposalResult, type ProposeMeal, type ProposedSlot } from "./meal-plan-proposal.js";
import { effectiveCadenceCount } from "./preferences.js";
import {
  householdRoster,
  resolveAttendance,
  unionHardConstraints,
  blendTasteProfiles,
  vibeParticipates,
  type AttendanceInput,
} from "./household.js";
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

/** One Claude-authored EPHEMERAL vibe (converge D2): the same primitive as a saved meal vibe (a
 *  `vibe` phrase + optional hard-gate `facets` + a `meal`, default dinner) but with no cadence
 *  history and no persistence — it shapes the week for a single request only, authoring slots
 *  WITH meals. */
export interface ProposeEphemeralVibe {
  vibe: string;
  facets?: Record<string, unknown>;
  meal?: ProposeMeal;
}

/** The per-meal slot-count request: each an integer 0–14, PER-WINDOW (not week-scaled —
 *  parity with the prior `nights`; the planning window bounds recurrence caps, not counts).
 *  An absent meal falls through the default chain: stored `cadence[meal]` → the read-time
 *  derivation (dinner: `default_cooking_nights ?? 5`; breakfast/lunch: 0). */
export interface ProposeMealsInput {
  breakfast?: number;
  lunch?: number;
  dinner?: number;
}

/** The full propose request — the MCP tool's input and the `POST /api/propose` body. */
export interface ProposeInput {
  /** Deprecation-window alias for `meals.dinner = N`; IGNORED (without error) when
   *  `meals` is supplied. */
  nights?: number;
  meals?: ProposeMealsInput;
  /** Attendance (D29-final): exactly one of `away`/`only`; unknown handles are dropped
   *  and echoed in diagnostics; an empty effective set fails open to the full roster. */
  attendance?: AttendanceInput;
  seed?: number;
  lock?: string[];
  exclude?: string[];
  boost_ingredients?: string[];
  nudges?: ProposeNudges;
  slots?: ProposeSlotConstraint[];
  /** A Claude-authored ordered ephemeral vibe set (converge D2). When present it SHAPES the week
   *  — its entries become the slots the engine fills and composes, each embedded + ranked like a
   *  `slots[].vibe` override and facet-gated — replacing the saved-palette cadence sampling for
   *  this request. Absent → `sampleWeek` schedules the palette as today. */
  ephemeral_vibes?: ProposeEphemeralVibe[];
  /** Accepted new-for-me discovery seeds (converge D3), by recipe slug, in priority order. Each
   *  resolvable, non-excluded, non-rejected seed is force-placed by `sampleWeek` (below pinned,
   *  above overdue) within its weather-bucket quota. Threaded through the palette path (the web
   *  app + a palette-driven agent request); when an `ephemeral_vibes` set drives the week, the
   *  authored entries are the slots and these seeds are inert. */
  new_for_me?: string[];
}

/** One meal's requested/filled/empty diagnostics. */
export interface MealDiagnostics {
  requested: number;
  filled: number;
  empty: number;
}

/** The attendance diagnostics, ALWAYS returned: the effective eating set, the dropped
 *  unknown handles, and any fail-open notes (empty effective set, stale vibe members). */
export interface AttendanceDiagnostics {
  effective: string[];
  ignored: string[];
  notes?: string[];
}

/** The op's result: the assembled proposal + the schedule's rollover diagnostics
 *  (`rolled_over` absent only on the empty-palette short-circuit, which carries `note`).
 *  `diagnostics.nights` is kept for one deprecation window as the DINNER alias of
 *  `diagnostics.meals.dinner.requested`. `notes` carries the empty-meal escape nudges. */
export interface ProposeResult extends Omit<ProposalResult, "diagnostics"> {
  diagnostics: ProposalResult["diagnostics"] & {
    rolled_over?: string[];
    meals: Record<ProposeMeal, MealDiagnostics>;
    attendance: AttendanceDiagnostics;
  };
  note?: string;
  notes?: string[];
}

/** Per-slot recall: how many candidates to rank before the cross-slot diversify narrows. */
const POOL_K = 24;
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

/** The propose input's zod shape — the MCP tool's `inputSchema` AND the `/api/propose`
 *  body validator (one contract, D7: the tool and the endpoint accept the same request). */
export const PROPOSE_INPUT_SHAPE = {
  // `nights` is the one-window alias of `meals.dinner` (ignored when `meals` is supplied).
  nights: z.number().int().positive().max(14).optional(),
  meals: z
    .object({
      breakfast: z.number().int().min(0).max(14).optional(),
      lunch: z.number().int().min(0).max(14).optional(),
      dinner: z.number().int().min(0).max(14).optional(),
    })
    .optional(),
  attendance: z
    .object({
      away: z.array(z.string()).optional(),
      only: z.array(z.string()).optional(),
    })
    .optional(),
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
  // A Claude-authored ephemeral vibe set (converge D2) — the same `{ vibe, facets, meal }`
  // primitive as a saved meal vibe, reusing the vibe facet gate. Present → it shapes the week
  // (see below), authoring slots WITH meals (`meal` defaults dinner).
  ephemeral_vibes: z
    .array(
      z.object({
        vibe: z.string(),
        facets: facetsSchema,
        meal: z.enum(["breakfast", "lunch", "dinner"]).optional(),
      }),
    )
    .optional(),
  // Accepted new-for-me discovery seeds (converge D3) — recipe slugs, in priority order.
  new_for_me: z.array(z.string()).optional(),
};

/**
 * Run the whole propose pipeline for one tenant (member-app-propose D1: the shared op both
 * `propose_meal_plan` and `POST /api/propose` call). Throws structured `ToolError`s only —
 * the MCP wrapper converts via `runTool`, the route via the shared error middleware.
 */
export async function runProposeMealPlan(env: Env, tenant: Tenant, input: ProposeInput, deps: ProposeDeps): Promise<ProposeResult> {
  const { nights, meals, attendance, seed, lock, exclude, boost_ingredients, nudges, slots, ephemeral_vibes, new_for_me } = input;
  const now = new Date();
  const resolvedSeed = seed ?? Number(now.toISOString().slice(0, 10).replace(/-/g, ""));
  const excludeSet = new Set((exclude ?? []).map((s) => s.toLowerCase()));
  // D2: a Claude-authored ephemeral vibe set (non-blank entries) shapes the week directly,
  // bypassing palette cadence sampling. An agent with intent can propose even on an empty palette.
  const ephemeral = (ephemeral_vibes ?? []).filter((e) => typeof e.vibe === "string" && e.vibe.trim());

  // The household seam (D29-final): one roster read, attendance resolved with fully-defined
  // fail-opens (validation of the exactly-one shape fires BEFORE any heavy load). Band-1
  // degeneracy: the roster is the singleton [tenant], so no handle is recognizable and every
  // call ranks as the whole household — today's ranking, observably.
  const roster = await householdRoster(env, tenant.id);
  const att = resolveAttendance(roster, attendance);
  const attendanceNotes: string[] = [...att.notes];

  const [index, overlay, lastCooked, owned, embeddings, prefs, operatorConfig, ctx, palette, vibeVectors, lastSatisfied, pantry] =
    await Promise.all([
      // The propose candidate POOLS read the caller's lens-visible corpus (shared-corpus
      // D11): an out-of-lens recipe can never be proposed.
      loadRecipeIndex(env, memberViewer(tenant.id, tenant.member)).catch((e) => {
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

  // Per-meal slot counts (per-window, not week-scaled): explicit `meals` → stored
  // `cadence[meal]` → the read-time derivation. `nights` stays for one window as the
  // dinner alias, IGNORED (without error) when `meals` is supplied.
  const countFor = (meal: ProposeMeal): number => {
    if (meals !== undefined) {
      const v = meals[meal];
      if (typeof v === "number") return v;
      return effectiveCadenceCount(prefs as Record<string, unknown> | null, meal);
    }
    if (meal === "dinner" && typeof nights === "number") return nights;
    return effectiveCadenceCount(prefs as Record<string, unknown> | null, meal);
  };
  const counts: Record<ProposeMeal, number> = {
    breakfast: countFor("breakfast"),
    lunch: countFor("lunch"),
    dinner: countFor("dinner"),
  };
  // The planning WINDOW is a separate knob from the counts: it's how far out the
  // caller plans/shops (planning_cadence_days), driving the weather horizon and the
  // vibe-recurrence caps below — a longer window does NOT by itself mean more slots
  // per window (the cadence map already resolved that, above, independent of window).
  const window = num((prefs as Record<string, unknown> | null)?.planning_cadence_days) ?? DEFAULT_PLANNING_WINDOW_DAYS;

  const attendanceDiag = (): { effective: string[]; ignored: string[]; notes?: string[] } => ({
    effective: att.effective,
    ignored: att.ignored,
    ...(attendanceNotes.length ? { notes: attendanceNotes } : {}),
  });
  const emptyMealsDiag = (): Record<ProposeMeal, MealDiagnostics> => ({
    breakfast: { requested: counts.breakfast, filled: 0, empty: 0 },
    lunch: { requested: counts.lunch, filled: 0, empty: 0 },
    dinner: { requested: counts.dinner, filled: 0, empty: 0 },
  });

  if (palette.length === 0 && ephemeral.length === 0) {
    return {
      plan: [],
      variety: { distinct_proteins: 0, distinct_cuisines: 0, mean_pairwise_sim: 0, max_pairwise_sim: 0 },
      uncovered_at_risk: [],
      diagnostics: { seed: resolvedSeed, lambda: 0, nights: counts.dinner, filled: 0, empty: 0, meals: emptyMealsDiag(), attendance: attendanceDiag() },
      note: "no meal vibes in the palette — add some with add_meal_vibe, or pass an ephemeral_vibes set, then propose again",
    };
  }

  // The household HARD FLOOR (D29-final): the union of every roster member's hard
  // constraints — computed over the singleton profile in band 1 (identity), and NEVER
  // varied by attendance (an absent member's rejects still gate).
  const memberRejects = new Set<string>();
  for (const [slug, row] of Object.entries(overlay)) if (row?.reject) memberRejects.add(slug);
  const hardFloor = unionHardConstraints([{ memberId: tenant.id, rejects: memberRejects, dietaryAvoid: [] }]);

  // Effective per-tenant index: merge overlay (favorite/reject) + cooking-log last_cooked
  // so the reject + makeability gates see the caller's view (as search_recipes does) —
  // with the reject flag forced from the household union (identity in band 1).
  const effective: RecipeIndex = {};
  for (const [slug, entry] of Object.entries(index)) {
    const merged = { ...mergeOverlay(entry, overlay[slug], lastCooked.get(slug)), slug };
    if (hardFloor.rejects.has(slug)) (merged as Record<string, unknown>).reject = true;
    effective[slug] = merged;
  }

  // The household SOFT BLEND: favorite anchors blended with uniform weights over the
  // effective eating set — the singleton profile makes this an identity blend (today's
  // ranking byte-for-byte); band 5 grows the loader, not this call shape.
  const memberFavoriteVecs: number[][] = [];
  for (const [slug, row] of Object.entries(overlay)) {
    if (row?.favorite) {
      const vec = embeddings.get(slug);
      if (vec) memberFavoriteVecs.push(vec);
    }
  }
  const favoriteVecs = blendTasteProfiles([{ memberId: tenant.id, favoriteVecs: memberFavoriteVecs }], att.effective);
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
  // Locks (and new_for_me force-placements) are DINNER slots — a lock is "cook this
  // this week" intent, dinner-shaped by construction; per-meal pinning goes through
  // `slots[].recipe` or an `ephemeral_vibes[].meal` entry plus a pin.
  const dinnerToFill = Math.max(0, counts.dinner - lockList.length);

  // Per-slot constraints keyed by PALETTE vibe id (D2). First entry per vibe wins (deterministic);
  // a constraint whose vibe isn't a slot this week is INERT (no effect, no error) — so with an
  // ephemeral set (whose slot ids are synthetic `ephemeral-N`) these are naturally inert.
  const constraintByVibe = new Map<string, ProposeSlotConstraint>();
  for (const s of slots ?? []) {
    if (!constraintByVibe.has(s.vibe_id)) constraintByVibe.set(s.vibe_id, s);
  }
  const freeform = nudges?.freeform?.trim() ? nudges.freeform.trim() : undefined;

  // ── Level 1: shape the week ────────────────────────────────────────────────────────────────
  // Both paths emit a set of slots to fill, each mapped to a `vibe` (facets + phrase) and a query
  // vector (fed to the shared buildPool loop below): (D2) an ephemeral set authors the slots
  // directly, or the saved palette is scheduled by `sampleWeek` (cadence-debt × weather + D3
  // new-for-me). The single cache-gated embed batch (freeform + ephemeral phrases OR sampled
  // slot-override phrases) is made inside the chosen path — still at most ONE AI call per request.
  const shapeSlots: (WeekSlot & { meal: ProposeMeal })[] = [];
  const vibeForSlot = new Map<string, NightVibe>();
  const queryVecBySlot = new Map<string, number[]>();
  const overriddenVibes = new Set<string>();
  const rolledOver: string[] = [];
  const placedNewForMe: DiversifyCandidate[] = [];
  let freeformVec: number[] | null = null;
  /** Explicit empty slots for a meal with count > 0 but ZERO vibes of that meal —
   *  appended to the plan after assembly, never a silent fallback into another
   *  meal's palette. `notes` names the escapes. */
  const emptyMealSlots: ProposedSlot[] = [];
  const notes: string[] = [];
  const ENGINE_MEALS: readonly ProposeMeal[] = ["breakfast", "lunch", "dinner"];

  if (ephemeral.length > 0) {
    // Ephemeral path (D2): each authored entry IS a slot — a synthetic vibe (phrase + facets +
    // meal, default dinner), its phrase embedded like an override and facet-gated like any slot.
    // Palette cadence sampling is bypassed for this request; palette-keyed `slots[]` constraints
    // are inert, and the `meals` counts don't apply (the authored set IS the week's slots).
    const phrases = ephemeral.map((e) => e.vibe.trim());
    const embedInputs = [...(freeform ? [freeform] : []), ...phrases];
    const embedded =
      embedInputs.length > 0 ? await embedTextsCached(env, { activity: "embed-search", trigger: "request" }, embedInputs) : [];
    freeformVec = freeform ? embedded[0] : null;
    ephemeral.forEach((e, i) => {
      const id = `ephemeral-${i}`;
      shapeSlots.push({ id, reason: "sampled", debt: 0, weight: 0, meal: e.meal ?? "dinner" });
      vibeForSlot.set(id, { id, vibe: e.vibe.trim(), facets: e.facets ?? undefined, meal: e.meal ?? "dinner" });
      queryVecBySlot.set(id, embedded[(freeform ? 1 : 0) + i]);
    });
  } else {
    // Palette path: partition the palette by meal (after the D29-final participation
    // filter) and sample EACH MEAL's slots from that meal's vibes with that meal's
    // count, cadence-debt-weighted as today. Weather quotas apply to the DINNER pass
    // only (stories/02 Q4): the non-dinner passes see a neutral all-`mild` histogram
    // (empty dayCategories) AND meal-stripped weather affinities, so a stored affinity
    // on a non-dinner vibe is preserved-but-inert and the quota machinery degenerates
    // cleanly to cadence-debt-only sampling rather than forking the code path.

    // The vibe-contribution rule: an assigned vibe participates only when its members
    // intersect the effective eating set; NULL = everyone; all-unresolvable members
    // fail OPEN to everyone with a diagnostics note (never silently deleted).
    const participating: NightVibe[] = [];
    for (const v of palette) {
      const p = vibeParticipates(v.members, att.effective, roster);
      if (p.stale) attendanceNotes.push(`vibe '${v.id}' names no recognizable member — treating it as everyone's`);
      if (p.participates) participating.push(v);
    }

    const debtByVibe = new Map<string, number>();
    for (const v of participating) {
      debtByVibe.set(v.id, v.cadence_days ? debt(lastSatisfied.get(v.id) ?? null, v.cadence_days, now) : 0);
    }
    const lockedSlugs = new Set(locked.map((c) => c.slug));
    const newForMeSeeds: NewForMeSeed[] = [];
    const newForMeCandBySlug = new Map<string, DiversifyCandidate>();
    for (const raw of new_for_me ?? []) {
      if (excludeSet.has(raw.toLowerCase())) continue;
      const cand = resolveCandidate(raw);
      if (!cand || lockedSlugs.has(cand.slug) || newForMeCandBySlug.has(cand.slug)) continue;
      const fm = effective[cand.slug] as Record<string, unknown>;
      const tags = Array.isArray(fm.tags) ? fm.tags.filter((t): t is string => typeof t === "string") : [];
      newForMeSeeds.push({ id: cand.slug, weather_affinity: tags });
      newForMeCandBySlug.set(cand.slug, cand);
    }
    // The weather forecast horizon IS the planning window (fetchWeatherForecast clamps to
    // its own supported range, e.g. 1–16 days, rather than failing on an oversized window).
    // Each day collapses to exactly ONE discrete category (never a flattened union) —
    // `sampleWeek` histograms this mix into quotas itself (capped at its own reliability
    // horizon), so no additional bounding happens here beyond the fetch's own day count.
    // Fetched only when a dinner pass will run — the only pass weather shapes.
    const weather = dinnerToFill > 0 ? await fetchWeatherForecast(resolveZip(prefs), window).catch(() => null) : null;
    const dayCategories: WeatherCategory[] =
      weather && "forecast" in weather ? weather.forecast.map((d) => deriveCategory(d.meal_vibes, d.condition)) : [];
    const paletteById = new Map(participating.map((v) => [v.id, v]));

    const vibeSlots: (WeekSlot & { meal: ProposeMeal })[] = [];
    for (const meal of ENGINE_MEALS) {
      const count = meal === "dinner" ? dinnerToFill : counts[meal];
      // New-for-me force-placement is DINNER-only; carry the seeds through every branch so an
      // accepted discovery is never silently dropped when the dinner pass is short-circuited.
      const seeds = meal === "dinner" ? newForMeSeeds : [];
      if (count <= 0) {
        // No free slots for this meal (a dinner fully consumed by locks) — the accepted
        // discoveries have nowhere to land, so roll them over rather than drop them.
        for (const s of seeds) rolledOver.push(s.id);
        continue;
      }
      const mealVibes = participating.filter((v) => (v.meal ?? "dinner") === meal);
      if (mealVibes.length === 0) {
        // VIBE-MEAL BINDING: a requested meal with no palette of its own yields
        // EXPLICIT empty slots + an escape note — never a cross-palette fallback.
        // Force-placement is vibe-INDEPENDENT, though: an accepted new_for_me discovery
        // still claims a free dinner slot here (sampleWeek over an EMPTY palette — the same
        // quota/rollover machinery as the normal pass), and only the LEFTOVER slots stay empty.
        let placedHere = 0;
        if (seeds.length > 0) {
          const shape = sampleWeek([], meal === "dinner" ? dayCategories : [], debtByVibe, count, resolvedSeed, DEFAULT_CADENCE_PARAMS, window, seeds);
          rolledOver.push(...shape.rolledOver);
          for (const s of shape.slots) {
            if (s.reason !== "new_for_me") continue;
            const cand = newForMeCandBySlug.get(s.id);
            if (cand) placedNewForMe.push(cand);
            placedHere++;
          }
        }
        for (let i = 0; i < count - placedHere; i++) {
          emptyMealSlots.push({
            vibe_id: null,
            meal,
            reason: "sampled",
            main: null,
            empty_reason: "no_palette_for_meal",
            alternates: [],
            alt_similar: null,
            alt_different: null,
            sides: [],
            uses_perishables: [],
            flags: {},
            why: [],
          });
        }
        // Flag the missing palette only when empty slots actually remain — a week whose free
        // dinner slots were entirely claimed by discoveries has nothing left to escape.
        if (count - placedHere > 0) {
          notes.push(
            `no ${meal} vibes in the palette — add one with add_meal_vibe (meal: "${meal}"), or author an ephemeral_vibes entry carrying meal: "${meal}"`,
          );
        }
        continue;
      }
      const specs: NightVibeSpec[] = mealVibes.map((v) => ({
        id: v.id,
        base_weight: v.base_weight ?? undefined,
        pinned: v.pinned,
        // Weather is dinner-scoped: stripping the affinity from non-dinner specs keeps a
        // stored value preserved-but-INERT in allocation (a bucketless vibe fills any slot).
        weather_affinity: meal === "dinner" ? v.weather_affinity : undefined,
        weather_antipathy: meal === "dinner" ? v.weather_antipathy : undefined,
        cadence_days: v.cadence_days,
      }));
      const shape = sampleWeek(
        specs,
        meal === "dinner" ? dayCategories : [],
        debtByVibe,
        count,
        resolvedSeed,
        DEFAULT_CADENCE_PARAMS,
        window,
        seeds,
      );
      rolledOver.push(...shape.rolledOver);
      for (const s of shape.slots) {
        // A new-for-me force-placement (dinner pass only) resolves to its standalone
        // recipe candidate (emitted by assembleProposal as a vibe-less dinner slot).
        if (s.reason === "new_for_me") {
          const cand = newForMeCandBySlug.get(s.id);
          if (cand) placedNewForMe.push(cand);
          continue;
        }
        vibeSlots.push({ ...s, meal });
      }
    }

    // Request-time embeds (D5): the freeform phrase + every SAMPLED slot's vibe-override phrase,
    // in ONE cache-gated batched call. A request with no such text makes NO AI call.
    const sampledVibeIdSet = new Set(vibeSlots.map((s) => s.id));
    const overrideTexts: { id: string; text: string }[] = [];
    for (const [id, c] of constraintByVibe) {
      const text = c.vibe?.trim();
      if (text && sampledVibeIdSet.has(id)) overrideTexts.push({ id, text });
    }
    const embedInputs = [...(freeform ? [freeform] : []), ...overrideTexts.map((o) => o.text)];
    const embedded =
      embedInputs.length > 0 ? await embedTextsCached(env, { activity: "embed-search", trigger: "request" }, embedInputs) : [];
    freeformVec = freeform ? embedded[0] : null;
    const overrideVecByVibe = new Map<string, number[]>();
    overrideTexts.forEach((o, j) => overrideVecByVibe.set(o.id, embedded[(freeform ? 1 : 0) + j]));

    // A `slots[].vibe` override replaces the slot's QUERY VECTOR only (facet gate + vibe identity
    // unchanged) — which also makes a not-yet-embedded fresh vibe fillable tonight, not empty.
    for (const s of vibeSlots) {
      shapeSlots.push(s);
      const vibe = paletteById.get(s.id);
      if (vibe) vibeForSlot.set(s.id, vibe);
      const overrideVec = overrideVecByVibe.get(s.id);
      const queryVec = overrideVec ?? vibeVectors.get(s.id);
      if (queryVec) queryVecBySlot.set(s.id, queryVec);
      if (overrideVec) overriddenVibes.add(s.id);
    }
  }

  const freeformNudge: RankNudge | undefined = freeformVec ? { vec: freeformVec, weight: FREEFORM_NUDGE_WEIGHT } : undefined;
  const proteinWants = nudges?.proteins && nudges.proteins.length > 0 ? nudges.proteins : undefined;
  const sampledVibeIds = new Set(shapeSlots.map((s) => s.id));

  // Level 2 — rank each slot's candidates into a pool from its vibe (facets) + query vector (a
  // palette vibe's cron vector, its override phrase, or an ephemeral entry's embedded phrase). A
  // slot with no vibe/vector (unembedded, missing) returns an explicit empty slot.
  const poolByVibe = new Map<string, DiversifyCandidate[]>();
  const whyByVibe = new Map<string, string[]>();
  for (const slot of shapeSlots) {
    const vibe = vibeForSlot.get(slot.id);
    const queryVec = queryVecBySlot.get(slot.id);
    if (!vibe || !queryVec) {
      poolByVibe.set(slot.id, []); // unembedded / missing → explicit empty slot
      continue;
    }
    poolByVibe.set(slot.id, buildPool(effective, vibe, slot.meal, queryVec, embeddings, lastCooked, favoriteVecs, rankParams, now, owned, ctx, excludeSet, nudges?.max_time_total, constraintByVibe.get(slot.id), freeformNudge, proteinWants));
    // Only pinned slots get a scheduling why-chip; an overdue placement already reads as
    // its `reason` — no member-facing badge (the slot's why[] may legitimately be empty).
    if (slot.reason === "pinned") whyByVibe.set(slot.id, [`your regular “${vibe.vibe}”`]);
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
    slots: shapeSlots,
    poolByVibe,
    locked,
    lockedUnresolved,
    newForMe: placedNewForMe,
    // The palette path reports the REQUESTED dinner count (honest under-fill diagnostics;
    // `diagnostics.nights` stays the DINNER alias for one window). The ephemeral path's slot
    // count is the authored set, so leave requestedNights unset and let diagnostics.nights
    // fall through to the actual slot count — keeping it in step with plan.length.
    requestedNights: ephemeral.length > 0 ? undefined : counts.dinner,
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
  // the nudges didn't pick them, so they claim nothing. Wants match case-insensitively —
  // the same fold rankCandidates scores with, so a boosted main always earns its why line.
  const proteinWantsLower = new Set((proteinWants ?? []).map((p) => p.toLowerCase()));
  for (const slot of result.plan) {
    // Locked / recipe-pinned / new-for-me mains were the CALLER's choice (or the discovery tier's
    // force-placement), not the nudges' pick — so the nudges claim nothing about them.
    if (!slot.main || slot.reason === "locked" || slot.reason === "new_for_me" || slot.recipe_pinned) continue;
    const vec = embeddings.get(slot.main.slug);
    if (freeform && freeformVec && vec && cosineSimilarity(freeformVec, vec) >= FREEFORM_WHY_FLOOR) {
      slot.why.push(`matches your ask “${freeform}”`);
    }
    if (slot.main.protein && proteinWantsLower.has(slot.main.protein.toLowerCase())) {
      slot.why.push(`the ${slot.main.protein} you asked for`);
    }
  }
  // Append the empty-meal explicit slots (a requested meal with no palette of its own),
  // then present the FLAT plan in meal order — breakfast → lunch → dinner, position-
  // stable within each meal (a stable sort; selection order above is unaffected).
  const MEAL_POS: Record<ProposeMeal, number> = { breakfast: 0, lunch: 1, dinner: 2 };
  const plan = [...result.plan, ...emptyMealSlots].sort((a, b) => MEAL_POS[a.meal] - MEAL_POS[b.meal]);

  // Per-meal diagnostics: requested (the resolved counts; for the ephemeral path, the
  // authored entries per meal) / filled / empty over the returned plan.
  const requestedFor = (meal: ProposeMeal): number => {
    if (ephemeral.length > 0) return ephemeral.filter((e) => (e.meal ?? "dinner") === meal).length;
    return counts[meal];
  };
  const mealsDiag = {} as Record<ProposeMeal, MealDiagnostics>;
  for (const meal of ["breakfast", "lunch", "dinner"] as const) {
    const ofMeal = plan.filter((sl) => sl.meal === meal);
    mealsDiag[meal] = {
      requested: requestedFor(meal),
      filled: ofMeal.filter((sl) => sl.main !== null).length,
      empty: ofMeal.filter((sl) => sl.main === null).length,
    };
  }

  const out: ProposeResult = {
    ...result,
    plan,
    diagnostics: {
      ...result.diagnostics,
      // Recount over the final plan (the empty-meal slots joined after assembly).
      nights: mealsDiag.dinner.requested,
      filled: plan.filter((sl) => sl.main !== null).length,
      empty: plan.filter((sl) => sl.main === null).length,
      rolled_over: rolledOver,
      meals: mealsDiag,
      attendance: attendanceDiag(),
    },
  };
  if (notes.length) out.notes = notes;
  return out;
}

export function registerProposeMealPlanTool(server: McpServer, env: Env, tenant: Tenant, deps: ProposeDeps): void {
  server.registerTool(
    "propose_meal_plan",
    {
      description:
        "Agent-internal planning engine — when the member asked to plan or see their week, render display_meal_plan instead (same request shape; the card presents the proposal, its dials retune client-side, and its Commit saves the plan); use this data form only to reason over a proposal without showing it, or when no widget can render. Proposes a week of meals from the caller's MEAL-VIBE PALETTE, deterministically and statelessly. Two levels, run PER MEAL: (1) SHAPE — the palette partitions by `meal` and each meal's slots are sampled from that meal's vibes, weighted by cadence-debt (overdue vibes surface); weather quotas shape the DINNER pass only (breakfast/lunch sample on cadence-debt alone — a weather affinity stored on a non-dinner vibe is inert); (2) FILL — retrieve each slot's vibe by meaning and select a VARIED main in ONE shared compose pass across all meals (MMR + protein/cuisine caps span the whole week, and the engine emits one recipe AT MOST ONCE per proposal across all meals — explicit locks/pins are the only duplication). Slot counts come from `meals` ({ breakfast?, lunch?, dinner? }, each 0-14, PER-WINDOW not week-scaled), defaulting per meal to the stored cadence map, then (dinner) the legacy nights count or 5 — `nights` remains a deprecated alias of meals.dinner and is ignored when `meals` is supplied. A meal requested with count > 0 but NO vibes of that meal returns explicit empty slots with empty_reason 'no_palette_for_meal' plus a note naming the escapes (add_meal_vibe with that meal, or an ephemeral_vibes entry carrying `meal`) — never a silent fallback into another meal's palette. `attendance` ({ away: [...] } OR { only: [...] }, exactly one — both is validation_failed) narrows SOFT ranking to who's eating: unknown handles are dropped (never errors) and echoed in diagnostics.attendance.ignored, an empty effective set fails open to the whole household, and the HARD floor (dietary gates, rejects) never moves with attendance — an absent member's hard constraints still apply. A vibe assigned to `members` contributes only when one of them is eating (a members list naming nobody recognizable contributes as everyone, noted in diagnostics). Each slot's pool is COURSE-GATED by its meal: dinner/lunch volunteer recipes whose course includes `main` — or is empty (fail-open: not-yet-classified is never hidden) — and breakfast slots gate on course includes `breakfast` or empty, so a dinner main never fills a breakfast slot; a vibe authored with an explicit `facets.course` (breakfast-for-dinner) suppresses the default for its slot, and `lock`s/`slots[].recipe` pins are exempt (an explicit caller choice is honored regardless of course). Does HOLISTIC use-it-up automatically: derives the caller's at-risk perishables from their PANTRY and spreads them across the week's mains, subordinate to vibe relevance and the hard gate — no param needed. Composes rung-1 `pairs_with` corpus sides, flags single-use perishable waste + meal-prep + novelty, and returns per-main `why` + `uses_perishables`. Iterate by re-calling with `lock` (keep these recipes in the week as vibe-less locked DINNER slots — resolved case-insensitively, respecting your rejects; a lock that's unknown, not-yet-embedded, or rejected comes back as an explicit empty locked slot), `exclude` (swap these out — an excluded recipe never appears in a pool, an alternate, or a pin), `boost_ingredients` (OVERRIDE — extra items to definitely use up, unioned with the pantry-derived set), `nudges`, `slots`, and a `seed` (change it for 'give me another week'). `new_for_me` = accepted new-for-me discovery slugs (from list_new_for_me), in priority order: each resolvable one is FORCE-PLACED as a dinner slot (below your pinned vibes, above overdue ones) within its weather bucket — an unresolvable/excluded/already-locked one is simply dropped. `ephemeral_vibes` = an ordered set of authored `{ vibe, facets, meal? }` (the same primitive as a saved meal vibe, just for this one request; `meal` defaults dinner): when present it SHAPES the week directly — its entries become the slots WITH their meals (each phrase embedded + facet-gated like a per-slot vibe override), REPLACING the saved-palette cadence sampling for this request (it does NOT bypass the hard gate or the diversify pass, and palette-keyed `slots`/`new_for_me` inputs are inert while it drives). Distill intent into it for a rich request; omit it to let the palette shape a bare 'plan my week'. `nudges`: max_time_total, variety strength (clamped so it can't collapse relevance), `proteins` (week-level SOFT protein boost — reorders, never gates) and `freeform` (a phrase like 'more soup, lighter dinners' — embedded and applied to every slot's ranking as a bounded additive term, never a gate; a main it materially matches says so in `why`). `slots` = per-vibe-slot constraints keyed by vibe_id (inert if that vibe isn't sampled this week): `protein`/`cuisine` facet pins narrowing that slot's gate, `max_time_total` (a number caps that slot; EXPLICIT null lifts the vibe's own cap — precedence: slot pin > nudges.max_time_total > vibe facet), `vibe` (a typed phrase replacing that slot's query vector — gate + identity unchanged, slot returns vibe_override: true; also fills a fresh not-yet-embedded vibe), and `recipe` (pin that exact recipe INTO the slot keeping its vibe identity + `from_vibe` provenance — the swap-in-place primitive; slot returns recipe_pinned: true, and an unresolvable pin comes back as an explicit empty slot). Each vibe slot also returns swap material from its already-ranked pool: `alternates` (top remaining candidates, week-deduped), `alt_similar` (nearest to the chosen main), `alt_different` (best different-cuisine) — all gate survivors; empty slots keep their alternates as the escape hatch. A slot placed by a non-mild weather quota carries `weather_category` and a weather-fit `why`. Makes at most ONE batched Workers AI embedding call per request — only for `nudges.freeform`/`slots[].vibe`/`ephemeral_vibes[].vibe` text not already in the query-embedding cache; a request with no such text makes NO AI call (every other vector is cron-captured). NO writes (persist a chosen plan with update_meal_plan, threading each slot's `meal` and its vibe id as `from_vibe`). Returns { plan, variety, uncovered_at_risk, diagnostics, notes? }: `plan` is FLAT and meal-ordered (breakfast then lunch then dinner, position-stable within each meal), each slot carrying its `meal`; `diagnostics.meals` reports per-meal { requested, filled, empty } (diagnostics.nights stays the dinner alias for one window) and `diagnostics.attendance` always reports { effective, ignored }; `uncovered_at_risk` names at-risk items the plan couldn't use, and an unfillable slot is returned as an explicit empty slot, never dropped.",
      inputSchema: PROPOSE_INPUT_SHAPE,
    },
    (input) => runTool(() => runProposeMealPlan(env, tenant, input, deps)),
  );
}

/** Breakfast's meal-default course gate: `course` includes `breakfast`, or is EMPTY
 *  (the same fail-open as the main gate — a not-yet-classified recipe is unknown, not
 *  known-non-breakfast, so an unclassified corpus still proposes). */
function isBreakfastCourse(course: unknown): boolean {
  const courses = (Array.isArray(course) ? course : course != null ? [course] : []).map((c) =>
    String(c).trim().toLowerCase(),
  );
  return courses.length === 0 || courses.includes("breakfast");
}

/** Rank one vibe's facet-gated survivors into a diversify pool. `queryVec` is the vibe's
 *  cron-captured vector — or the slot's override-phrase vector (D4). `pins` narrows the
 *  facet gate with precedence slot pin > global `maxTime` nudge > vibe facet (a `null`
 *  per-slot time cap LIFTS the vibe's own); `nudge`/`proteinWants` are the bounded
 *  additive rank terms (they reorder gate survivors, never admit past the gate). The
 *  survivors are additionally course-gated BY THE SLOT'S MEAL: dinner and lunch slots
 *  keep the `main`-or-empty fail-open gate (`isMealCourse`); breakfast slots gate on
 *  `course` includes `breakfast` or empty (`isBreakfastCourse`) — keeping breakfast
 *  pools from filling with dinner mains. An explicit `course` on the effective facet
 *  set suppresses the default, so a component/side never fills a slot by default —
 *  and, by construction, never appears among the alternates. */
function buildPool(
  effective: RecipeIndex,
  vibe: NightVibe,
  slotMeal: ProposeMeal,
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
  let survivors = filterRecipes(effective, facets, now, owned).filter((s) => !excludeSet.has(s.slug.toLowerCase()));
  // The default MEAL-AWARE course gate: the pool volunteers only the slot's meal's
  // candidates — dinner/lunch: course includes `main`, or is empty (fail-open:
  // not-yet-classified is unknown, never hidden); breakfast: course includes
  // `breakfast`, or is empty (the same fail-open) — so a dinner main never fills a
  // breakfast slot and a component/side never fills any slot by default. An explicit
  // `course` on the effective facet set (the vibe's escape hatch, e.g. a breakfast-
  // for-dinner vibe) suppresses the default — that slot gates by containment alone,
  // exactly as above. Locks and `slots[].recipe` pins resolve OUTSIDE this pool
  // (resolveCandidate), so an explicit caller choice is never vetoed by course.
  if ((facets as Record<string, unknown>).course === undefined) {
    const gate = slotMeal === "breakfast" ? isBreakfastCourse : isMealCourse;
    survivors = survivors.filter((s) => gate(s.frontmatter.course));
  }
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
