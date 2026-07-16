// buildServer wires the full yamp tool surface onto an McpServer: the
// repo-data read + Kroger tools defined here, plus the write, grocery-list,
// order, discovery, notes, store, and cooking tool groups registered from
// their own modules. Each tool returns a structured result; failures map to
// the structured-error convention (errors.ts).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import type { Tenant } from "./tenant.js";
import { directoryFromEnv } from "./tenant.js";
import { createR2CorpusStore, readCorpusFile } from "./corpus-store.js";
import { parseMarkdown } from "./parse.js";
import {
  readSkuCache,
  ingredientContext,
  emptyIngredientContext,
  type IngredientContext,
} from "./corpus-db.js";
import { ToolError, runTool } from "./errors.js";
import { instrumentTools, type ToolRegistrar } from "./tool-instrumentation.js";
import { registerWriteTools } from "./write-tools.js";
import { registerGroceryListTools } from "./grocery-tools.js";
import { registerNightVibeTools, aliasDescription } from "./night-vibe-tools.js";
import { registerProposeMealPlanTool, type ProposeDeps } from "./meal-plan-proposal-tool.js";
import { registerReconcileTools, isOperator } from "./reconcile-tools.js";
import { registerOrderTools, type OrderWiring } from "./order-tools.js";
import { computeToBuyView } from "./to-buy.js";
import { registerDiscoveryTools } from "./discovery-tools.js";
import { registerNoteTools, registerStoreNoteTools } from "./notes-tools.js";
import { registerStoreTools } from "./stores-tools.js";
import { registerCookingTools } from "./cooking-tools.js";
import { registerRecipeCardWidget } from "./recipe-card-widget.js";
import { registerMealPlanWidget } from "./meal-plan-widget.js";
import { registerGroceryWidget } from "./grocery-widget.js";
import { registerOrderReviewWidget } from "./order-review-widget.js";
import { registerInstacartTool } from "./instacart-tool.js";
import { getInstacartConfig } from "./instacart.js";
import { filterRecipes, type RecipeIndex } from "./recipes.js";
import { loadRecipeIndex, loadRecipeEmbeddings, recipeDescription } from "./recipe-index.js";
import { isVisible, memberViewer } from "./visibility.js";
import { recordBugReport } from "./bug-reports.js";
import { embedTextsCached } from "./embedding.js";
import {
  rankCandidates,
  resolveRankParams,
  DEFAULT_K,
  MAX_K,
  type SearchCandidate,
} from "./semantic-search.js";
import { listGuidance, readGuidance } from "./guidance.js";
import { loadOperatorConfig, DEFAULT_OPERATOR_CONFIG } from "./operator-config.js";
import { fetchWeatherForecast, type WeatherForecast, type WeatherError } from "./weather.js";
import { mergeOverlay, type Overlay } from "./overlay.js";
import { readPantry, countUnverifiedPerishables } from "./session-db.js";
import {
  readProfile,
  readPreferences,
  readOverlay,
  readOwnedEquipment,
  readBrandTiers,
  readLastRetrospective,
  type AssembledProfile,
  type Preferences,
} from "./profile-db.js";
import { exportPreferences } from "./preferences.js";
import { loadDeploymentProfile, type DeploymentProfile } from "./deployment.js";
import { db } from "./db.js";
import { listMembers } from "./members-db.js";
import { listNicknamesByViewer } from "./social-db.js";
import { readNightVibePalette, type ProfilePaletteVibe } from "./night-vibe-db.js";
import { registerCookingWriteTools } from "./cooking-write.js";
import { createKrogerClient, type KrogerCandidate } from "./kroger.js";
import { buildKrogerConsentUrl } from "./oauth.js";
import {
  matchIngredient,
  isFulfillable,
  isOnSale,
  MIN_FLYER_DISCOUNT,
  type CachedMapping,
  type MatchContext,
  type MatchDeps,
  type MatchResult,
} from "./matching.js";
import { readStoreFlyer, filterByMinSavings, isSatelliteRollupStale, KROGER_STORE } from "./flyer-warm.js";
import type { KvStore } from "./kroger-user.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * last_cooked per recipe, derived by D1 aggregation: MAX(date) over the caller's
 * type='recipe' rows, grouped by slug. An empty/absent log yields an empty map.
 * Shared by the tool closures below (per-request lazy-cached) and the member API's
 * recipe-detail read.
 */
export async function readLastCookedMap(env: Env, tenant: string): Promise<Map<string, string>> {
  const rows = await db(env).all<{ recipe: string; last_cooked: string }>(
    "SELECT recipe, MAX(date) AS last_cooked FROM cooking_log " +
      "WHERE tenant = ?1 AND type = 'recipe' AND recipe IS NOT NULL GROUP BY recipe",
    tenant,
  );
  const map = new Map<string, string>();
  for (const { recipe, last_cooked } of rows) {
    if (recipe && last_cooked) map.set(recipe, last_cooked);
  }
  return map;
}

/**
 * Whether the caller has ANY cooking-log rows — the attention block's `retrospective_due`
 * gate (data-read-tools D8): a brand-new tenant with nothing cooked is never nagged to
 * read a retrospective, regardless of the watermark. One bounded existence probe, not a
 * count.
 */
export async function hasCookingHistory(env: Env, tenant: string): Promise<boolean> {
  const row = await db(env).first<{ ok: number }>(
    "SELECT 1 AS ok FROM cooking_log WHERE tenant = ?1 LIMIT 1",
    tenant,
  );
  return row !== null;
}

/**
 * The `read_recipe` assembly as a shared operation (member-app-core D2): corpus read +
 * `parseMarkdown` + the caller's overlay/last-cooked merge + the derived description.
 * Throws the same structured `not_found` for an invalid or unknown slug. Called by the
 * MCP tool, the `display_recipe` widget, and the member API's
 * `GET /api/cookbook/recipes/:slug`.
 *
 * Lens-bound (shared-corpus D11): visibility resolves through the shared enforcement
 * point BEFORE any body read — a slug outside the caller's lens takes the IDENTICAL
 * `not_found` path an unknown slug takes (same shape, same message, no R2 read), so
 * the tool cannot be used as a slug-probing oracle.
 */
export async function readRecipeDetail(
  env: Env,
  tenant: string,
  slug: string,
): Promise<{ slug: string; frontmatter: Record<string, unknown>; body: string }> {
  if (!SLUG_RE.test(slug)) {
    throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
  }
  if (!(await isVisible(env, memberViewer(tenant), slug))) {
    throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
  }
  const corpus = createR2CorpusStore(env.CORPUS);
  const [text, overlay, lastCooked, description] = await Promise.all([
    readCorpusFile(corpus, `recipes/${slug}.md`, "not_found", `Unknown recipe slug: ${slug}`),
    readOverlay(env, tenant),
    readLastCookedMap(env, tenant),
    recipeDescription(env, slug),
  ]);
  const { frontmatter, body } = parseMarkdown(text, `recipes/${slug}.md`);
  const merged = mergeOverlay(frontmatter, overlay[slug], lastCooked.get(slug));
  // description is a Worker-DERIVED field (recipe_derived), merged at read time alongside
  // overlay/last_cooked; null until the reconcile first generates it (never an error).
  if (description !== null) merged.description = description;
  return { slug, frontmatter: merged, body };
}

/**
 * Fresh propose deps for non-MCP callers (member-app-propose D1): the member API's
 * `POST /api/propose` builds these per request over the SAME underlying reads the MCP
 * server's per-session closures memoize (`buildServer`, below) — lazily and memoized
 * within one call, so the op's parallel loads share one read each.
 */
export function buildProposeDeps(env: Env, tenant: string): ProposeDeps {
  let overlayP: Promise<Overlay> | null = null;
  let lastCookedP: Promise<Map<string, string>> | null = null;
  let ownedP: Promise<string[]> | null = null;
  let ctxP: Promise<IngredientContext> | null = null;
  return {
    getOverlay: () => (overlayP ??= readOverlay(env, tenant)),
    getLastCookedMap: () => (lastCookedP ??= readLastCookedMap(env, tenant)),
    getOwnedEquipment: () => (ownedP ??= readOwnedEquipment(env, tenant)),
    getIngredientContext: () => (ctxP ??= ingredientContext(env)),
  };
}

/**
 * Fresh order wiring for the order operation (member-app-grocery D8): the matcher
 * resolve, the override-SKU revalidation, and the location resolution over the SAME
 * underlying reads (preferences → location, brand prefs, ingredient context, SKU cache)
 * the MCP server memoizes per request — lazily and memoized within one wiring, the
 * `buildProposeDeps` precedent. `buildServer` calls this ONCE per request and reuses the
 * closures across its tools; the member API's `POST /api/grocery/order` builds one per
 * request.
 */
export function buildOrderWiring(env: Env, tenant: string, options: { capture?: boolean } = {}): OrderWiring {
  const kroger = createKrogerClient(env);

  let prefsP: Promise<Preferences> | null = null;
  const getPreferences = (): Promise<Preferences> =>
    (prefsP ??= (async () => {
      const prefs = await readPreferences(env, tenant);
      if (prefs === null) {
        throw new ToolError("not_found", "no preferences are set up");
      }
      return prefs;
    })());

  let locationP: Promise<string> | null = null;
  const getLocationId = (): Promise<string> =>
    (locationP ??= (async () => {
      const prefs = await getPreferences();
      const stores = prefs.stores as Record<string, unknown> | undefined;
      const label =
        typeof stores?.preferred_location === "string" ? stores.preferred_location : null;
      if (!label) {
        throw new ToolError(
          "not_found",
          "no preferred store location is set; cannot price Kroger products",
        );
      }
      return kroger.resolveLocationId(label);
    })());

  let ctxP: Promise<IngredientContext> | null = null;
  const getIngredientContext = (): Promise<IngredientContext> => (ctxP ??= ingredientContext(env, { capture: options.capture !== false }));

  /** Run the resolve-only matcher for one ingredient with the shared deps. */
  async function resolve(
    ingredient: string,
    context: MatchContext = {},
    bypassCache = false,
  ): Promise<MatchResult> {
    const locationId = await getLocationId();
    const brands = await readBrandTiers(env, tenant);
    const ctx = await getIngredientContext();
    const cache: CachedMapping[] = await readSkuCache(env);
    // Capture a novel surface form for the cron (best-effort, non-blocking; the hot path
    // is unchanged — a hit resolves through the map, a miss returns the cleaned term). The
    // context's resolve() does the normalize-and-capture; the matcher re-normalizes over the
    // injected resolver deps (it stays pure over plain aliases/searchTerms data).
    ctx.resolve(ingredient);
    const deps: MatchDeps = {
      search: (term: string): Promise<KrogerCandidate[]> =>
        // Kroger's per-request max (50) — the matcher returns the full ranked
        // fulfillable set when ambiguous, so we want the complete relevant pool.
        kroger.search(term, { locationId, limit: 50 }),
      productById: (productId: string): Promise<KrogerCandidate | null> =>
        kroger.productById(productId, locationId),
      aliases: ctx.resolver.toId,
      searchTerms: ctx.resolver.searchTerms,
      brands,
      cache,
      locationId,
    };
    return matchIngredient(deps, ingredient, context, bypassCache);
  }

  /**
   * Revalidate a forced-override SKU (place_order) against current availability +
   * price at the resolved location — the same one-shot recheck the matcher's cache
   * path does. Returns the fresh state when fulfillable, or null when it is not.
   */
  async function revalidateSku(sku: string) {
    const locationId = await getLocationId();
    const fresh = await kroger.productById(sku, locationId);
    if (!fresh || !isFulfillable(fresh)) return null;
    return {
      brand: fresh.brand,
      description: fresh.description,
      size: fresh.size,
      price: fresh.price,
      on_sale: isOnSale(fresh),
      fulfillment: { curbside: fresh.fulfillment.curbside, delivery: fresh.fulfillment.delivery },
      aisleLocation: fresh.aisleLocation,
    };
  }

  // Raw product reads at the caller's location (member-app-differentiators D1): the
  // substitution op's ≤ 1 revalidation + 1 term search per line ride these — the same
  // client + location resolution the matcher uses, without entering the matcher.
  async function search(term: string): Promise<KrogerCandidate[]> {
    const locationId = await getLocationId();
    return kroger.search(term, { locationId, limit: 50 });
  }

  async function productById(sku: string): Promise<KrogerCandidate | null> {
    const locationId = await getLocationId();
    return kroger.productById(sku, locationId);
  }

  return { resolve, revalidateSku, getLocationId, search, productById };
}

/**
 * The `get_weather_forecast` assembly as a shared operation (member-app-propose D1/D9):
 * resolve the caller's location from preferences (explicit `stores.location_zip`, else a
 * ZIP parsed from `preferred_location` — it lives under `stores` in the D1 schema), then
 * fetch the Open-Meteo daily forecast. Throws the structured `no_location` when no ZIP is
 * resolvable; upstream failures come back as the fetch's VALUE-shaped `WeatherError`
 * (`forecast_unavailable` / `no_results`), exactly as the MCP tool has always returned
 * them. Called by the `get_weather_forecast` tool and the propose op's server-side forecast.
 */
export async function resolveTenantForecast(env: Env, tenant: string, days = 7): Promise<WeatherForecast | WeatherError> {
  const prefs = (await readPreferences(env, tenant)) ?? {};
  const stores = prefs.stores as Record<string, unknown> | undefined;

  let zip: string | null = null;
  if (typeof stores?.location_zip === "string" && stores.location_zip.trim()) {
    zip = stores.location_zip.trim();
  } else if (typeof stores?.preferred_location === "string") {
    zip = stores.preferred_location.match(/\d{5}/)?.[0] ?? null;
  }

  if (!zip) {
    throw new ToolError(
      "no_location",
      "No location found in preferences. Set location_zip or complete store setup with a ZIP code.",
    );
  }

  return fetchWeatherForecast(zip, days);
}

/** One household member in the profile export. `nickname` is the CALLING member's own
 *  alias only (null when unset) — never an alias set by or for anyone else, and never a
 *  self-nickname (D33's rule: aliases are private to the viewer who set them). */
export interface HouseholdMemberExport {
  handle: string;
  nickname: string | null;
  you: boolean;
  joined_at: number;
}

/** The `read_user_profile` payload: the assembled profile + initialization status. */
export interface UserProfilePayload extends AssembledProfile {
  initialized: boolean;
  missing: string[];
  /** The caller's meal-vibe palette — each saved vibe plus its `meal`, its `members`
   *  when set, and its derived `last_satisfied`/cadence status (data-read-tools D5), so
   *  session start reads the revealed-preference rhythm as the basis for shaping a plan.
   *  (The `missing[]` onboarding label stays `"vibes"`.) */
  meal_vibes: ProfilePaletteVibe[];
  /** The caller's household roster + THEIR OWN nicknames (households-friends-and-
   *  people-page): the session-start read resolves "Mom and Grandma" style references
   *  from this; handles are the stable keys. */
  household: { members: HouseholdMemberExport[] };
  /** Server-computed nudge inputs (data-read-tools D8), deterministic and cheap — no AI
   *  call, no write beyond the retrospective surfaces' own watermark stamp. */
  attention: {
    /** True when the caller's cooking log is non-empty AND the retrospective watermark
     *  is NULL or at/past the 42-day due threshold. */
    retrospective_due: boolean;
    /** Pantry rows in a perishable category (produce/dairy/seafood/meat) whose
     *  last_verified_at is NULL or at/past the 7-day staleness threshold. */
    unverified_perishables: number;
    /** The onboarding-area `missing` derivation, surfaced again under the attention lens. */
    stale_areas: string[];
  };
}

/**
 * The `read_user_profile` assembly as a shared operation (member-app-core D2):
 * `readProfile` + the `initialized`/`missing` computation + the household block.
 * Called by the MCP tool and the member API's `GET /api/profile`. `member` is the
 * CALLING member (nickname privacy is per-viewer); it defaults to the founding member
 * for legacy call shapes.
 */
export async function assembleUserProfile(env: Env, tenant: string, member: string = tenant): Promise<UserProfilePayload> {
  const [profile, nightVibes, householdRows, nicknameRows, lastRetrospectiveAt, cookingHistory, unverifiedPerishables] =
    await Promise.all([
      readProfile(env, tenant),
      readNightVibePalette(env, tenant, new Date()),
      listMembers(db(env), tenant),
      listNicknamesByViewer(db(env), member),
      // The attention block's two extra bounded reads (data-read-tools D8), folded into
      // this same batch: no AI, no write, no new read amplification beyond these.
      readLastRetrospective(env, tenant),
      hasCookingHistory(env, tenant),
      countUnverifiedPerishables(env, tenant),
    ]);
  const nicknameOf = new Map(nicknameRows.map((r) => [r.target_member, r.nickname]));
  const household = {
    members: householdRows.map((m) => ({
      handle: m.handle,
      nickname: m.id === member ? null : (nicknameOf.get(m.id) ?? null),
      you: m.id === member,
      joined_at: m.created_at,
    })),
  };

  // Each onboarding area maps to a structured field; an area is "missing"
  // when its field is empty (null preferences/markdown, empty list/inventory).
  const isEmpty = (v: unknown): boolean => {
    if (v == null) return true;
    if (typeof v === "string") return v.trim().length === 0;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === "object") return Object.keys(v as Record<string, unknown>).length === 0;
    return false;
  };
  const PROFILE_AREAS: ReadonlyArray<readonly [area: string, value: unknown]> = [
    ["store", profile.preferences],
    ["taste", profile.taste],
    ["diet", profile.diet_principles],
    ["equipment", profile.kitchen.owned.length ? profile.kitchen : null],
    ["stockup", profile.stockup],
    // An empty palette is an onboarding gap `suggest_meal_vibes` fills (data-read-tools D5).
    // The area label deliberately stays "vibes" across the meal-vibe rename.
    ["vibes", nightVibes.length ? nightVibes : null],
  ];

  const initialized = profile.preferences !== null;
  const missing: string[] = [];
  for (const [area, value] of PROFILE_AREAS) {
    if (isEmpty(value)) missing.push(area);
  }

  return {
    initialized,
    missing,
    // The EXPORT shaping (one deprecation window): `cadence` always present (stored map,
    // else the read-time derivation), `default_cooking_nights` mirrored from the
    // effective cadence.dinner, and the retired lunch_strategy/ready_to_eat_default_action
    // dropped now (meal vibes supersede them).
    preferences: exportPreferences(profile.preferences),
    taste: profile.taste,
    diet_principles: profile.diet_principles,
    kitchen: profile.kitchen,
    staples: profile.staples,
    stockup: profile.stockup,
    meal_vibes: nightVibes,
    household,
    attention: {
      retrospective_due: isRetrospectiveDue(cookingHistory, lastRetrospectiveAt),
      unverified_perishables: unverifiedPerishables,
      stale_areas: missing,
    },
  };
}

const recipeFiltersShape = {
  protein: z.string().optional(),
  cuisine: z.string().optional(),
  course: z.string().optional(),
  query: z.string().optional(),
  season: z.array(z.string()).optional(),
  dietary: z.array(z.string()).optional(),
  max_time_total: z.number().optional(),
  not_cooked_since: z.string().optional(),
  exclude_cooked_within_days: z.number().optional(),
  include_unmakeable: z.boolean().optional(),
};

// One search spec for `search_recipes`. The `facets` are the hard gate (the same
// `filterRecipes` constraint in both modes); `label` is echoed back to group results.
// The `vibe` is OPTIONAL and selects the mode: present ⇒ ranked (embed the vibe, cosine
// over the embedded survivors, drop the unembedded, return top-`k`); absent ⇒ membership
// (return every survivor, unranked, unembedded included, no `k` cap — the named-dish /
// browse path). `k` and `boost_ingredients` apply to ranked specs only.
const searchSpecShape = {
  label: z.string(),
  facets: z.object(recipeFiltersShape).optional(),
  vibe: z.string().optional(),
  k: z.number().int().positive().optional(),
  // Item names the ranker should bias toward (the caller's at-risk perishables /
  // on-hand items). A bounded, perishable-weighted overlap boost — reorders survivors
  // only, never gates. Normalized through the alias table before matching. Ranked specs only.
  boost_ingredients: z.array(z.string()).optional(),
};

const pantryFilterShape = {
  category: z.string().optional(),
  location: z.string().optional(),
  prepared_only: z.boolean().optional(),
  stale_only: z.boolean().optional(),
};

const flyerFilterShape = {
  /** Minimum markdown to keep, as a percent of regular price (default 5). */
  min_savings_pct: z.number().optional(),
};

/** One product row for the list-returning Kroger lookups (kroger_prices). */
function productRow(c: KrogerCandidate): Record<string, unknown> {
  return {
    sku: c.productId,
    brand: c.brand,
    description: c.description,
    size: c.size,
    price: c.price,
    on_sale: isOnSale(c),
    available: c.fulfillment,
    aisleLocation: c.aisleLocation,
    inStore: c.fulfillment.inStore,
  };
}

/**
 * The per-request registration context (mcp-tool-gating): which tool planes register for
 * this caller, resolved once by the MCP handler before `buildServer` runs. `profile`
 * carries the deployment profile so a future profile-gated registration has its seam
 * without re-plumbing — nothing gates on it yet. `kroger`/`instacart` are deployment-level
 * (the credentials are wrangler secrets, not per-tenant); `operator` is the caller's own
 * tenant identity.
 */
export interface RegistrationContext {
  profile: DeploymentProfile;
  operator: boolean;
  kroger: boolean;
  instacart: boolean;
}

/**
 * Resolve the registration context: `profile` is the one async input
 * (`loadDeploymentProfile`'s cached D1 singleton read); operator identity and the
 * Kroger/Instacart config gates are synchronous env checks. Called once by the MCP
 * handler (src/index.ts) alongside tenant resolution, before `buildServer`.
 */
export async function resolveRegistrationContext(env: Env, tenant: Tenant): Promise<RegistrationContext> {
  return {
    profile: await loadDeploymentProfile(env),
    operator: isOperator(env, tenant),
    kroger: Boolean(env.KROGER_CLIENT_ID?.trim()) && Boolean(env.KROGER_CLIENT_SECRET?.trim()),
    instacart: getInstacartConfig(env) !== null,
  };
}

/** A fail-closed registration context: every gated plane off. The backstop `buildServer`
 *  falls back to when no context is supplied — every real caller (the MCP handler, every
 *  test) passes one explicitly; this only guards a caller that forgets to. */
const CLOSED_REGISTRATION_CONTEXT: RegistrationContext = {
  profile: "self-hosted",
  operator: false,
  kroger: false,
  instacart: false,
};

/** `today` minus `days`, as an ISO day string (UTC) — the attention block's threshold
 *  cutoffs (data-read-tools D8), compared lexicographically against stored ISO-day
 *  watermarks (retrospective.ts's `isoDay`/cutoff idiom). */
function isoDaysAgo(days: number, now: Date): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** The attention block's retrospective-due threshold (days) — a compiled constant. */
const RETROSPECTIVE_DUE_DAYS = 42;

/**
 * Whether `read_user_profile`'s `attention.retrospective_due` should be true (data-read-
 * tools D8): the caller has cooking history AND the watermark is NULL or at/past the
 * 42-day due threshold. A caller with no cooking history is never nagged.
 */
export function isRetrospectiveDue(
  hasCookingLog: boolean,
  lastRetrospectiveAt: string | null,
  now: Date = new Date(),
): boolean {
  if (!hasCookingLog) return false;
  if (lastRetrospectiveAt === null) return true;
  return lastRetrospectiveAt <= isoDaysAgo(RETROSPECTIVE_DUE_DAYS, now);
}

export function buildServer(
  env: Env,
  tenant: Tenant,
  origin?: string,
  ctx: RegistrationContext = CLOSED_REGISTRATION_CONTEXT,
): McpServer {
  const server = new McpServer(
    { name: "yamp", version: "0.1.0" },
    {
      // Routing preamble ONLY — never persona (agent-plugin-distribution). Tool
      // descriptions carry the same guarantee for hosts that ignore instructions.
      instructions:
        "Routing: when the member asks to SEE something — their grocery list (\"what's on my list?\"), a recipe, a proposed week — call the matching display_* tool so the live card renders; never answer a show-me ask by pasting a read tool's contents. read_* tools are for your own reasoning. Keep member-facing replies plain and brief.",
    },
  );

  // tool-usage-trends: wrap registerTool ONCE, before any tool is registered, so every tool —
  // the inline ones below AND those added by the register*Tools helpers — emits one tenant-clean
  // per-call usage point (tool, ok/error, duration) to the `yamp_tool` AE dataset. Best-effort
  // and non-blocking; never touches the result. Tenant id is deliberately NOT passed.
  instrumentTools(server as unknown as ToolRegistrar, env);

  // The authored corpus (recipes/ + guidance/) is read/listed/written through the R2
  // corpus store — no GitHub App, installation token, or GitHub API call on the data
  // path. `report_bug` writes D1, so GitHub is no longer on the tool surface at all.
  const corpus = createR2CorpusStore(env.CORPUS);
  const kroger = createKrogerClient(env);

  // Per-request lazy caches backed by the D1 profile tables (the profile left KV
  // for normalized D1 tables — src/profile-db.ts assembles the agent-facing shapes).
  let prefsPromise: Promise<Preferences> | null = null;
  function getPreferences(): Promise<Preferences> {
    if (!prefsPromise) {
      prefsPromise = (async () => {
        const prefs = await readPreferences(env, tenant.id);
        if (prefs === null) {
          throw new ToolError("not_found", "no preferences are set up");
        }
        return prefs;
      })();
    }
    return prefsPromise;
  }

  // The order wiring (member-app-grocery D8): revalidateSku / getLocationId over
  // lazily-memoized preferences/brands/ingredient-context/SKU-cache reads — built ONCE
  // per request and shared by every tool below that needs them (place_order, the Kroger
  // price/flyer lookups). The matcher's own resolve() rides place_order's resolution and
  // the order-review widget's ops now (ingredient-matching) — no tool calls it directly.
  const orderWiring = buildOrderWiring(env, tenant.id);
  const getLocationId = orderWiring.getLocationId;

  /**
   * Resolve the caller's PRIMARY fulfillment store for `flyer`: its slug (`stores.primary`,
   * default "kroger") + the rollup `locationId`. For Kroger the human `preferred_location` label is
   * resolved to a numeric locationId; for a satellite-scanned store the
   * Worker has no API, so the operator's `preferred_location` label IS the locationId the producer
   * enqueues and the satellite reports under (the `flyer:{store}:{locationId}` rollup key). Throws
   * `not_found` when no preferred location is set — the tool catches it and degrades to empty.
   */
  async function resolveStoreFlyerTarget(): Promise<{ store: string; locationId: string }> {
    const prefs = await getPreferences();
    const stores = prefs.stores as Record<string, unknown> | undefined;
    const primary =
      typeof stores?.primary === "string" && stores.primary.trim()
        ? stores.primary.trim().toLowerCase()
        : KROGER_STORE;
    const label = typeof stores?.preferred_location === "string" ? stores.preferred_location : null;
    if (!label) throw new ToolError("not_found", "no preferred store location is set");
    if (primary === KROGER_STORE) return { store: KROGER_STORE, locationId: await getLocationId() };
    return { store: primary, locationId: label };
  }

  // Shared matcher wiring: the ingredient context (the normalization funnel — resolve +
  // capture-on-miss + search terms + satisfies-edges over one `readResolver` load) is built
  // once and reused by match_ingredient_to_kroger_sku, place_order's resolution, and the
  // search-recipes boost normalization.
  let ctxPromise: Promise<IngredientContext> | null = null;
  function getIngredientContext(): Promise<IngredientContext> {
    if (!ctxPromise) ctxPromise = ingredientContext(env);
    return ctxPromise;
  }

  // Per-request lazy reads of the caller's subjective layer. The overlay
  // supplies favorite+reject from the D1 `overlay` table; the cooking log supplies
  // last_cooked from the D1 `cooking_log` table. Both are merged onto shared
  // recipe content at read time (§6.2).
  let overlayPromise: Promise<Overlay> | null = null;
  function getOverlay(): Promise<Overlay> {
    if (!overlayPromise) {
      overlayPromise = readOverlay(env, tenant.id);
    }
    return overlayPromise;
  }

  // last_cooked per recipe is now a D1 aggregation (readLastCookedMap), lazily
  // cached per request like the overlay.
  let lastCookedPromise: Promise<Map<string, string>> | null = null;
  function getLastCookedMap(): Promise<Map<string, string>> {
    if (!lastCookedPromise) {
      lastCookedPromise = readLastCookedMap(env, tenant.id);
    }
    return lastCookedPromise;
  }

  // The caller's owned equipment (from the D1 kitchen_equipment table), the
  // makeability gate's left operand. Empty/absent ⇒ unknown inventory ⇒ gate no-op.
  let ownedPromise: Promise<string[]> | null = null;
  function getOwnedEquipment(): Promise<string[]> {
    if (!ownedPromise) {
      ownedPromise = readOwnedEquipment(env, tenant.id);
    }
    return ownedPromise;
  }

  server.registerTool(
    "search_recipes",
    {
      description:
        "Find recipes in the index. Takes an array of search SPECS and returns one result group per spec — `{ results: [{ label, recipes }] }`, in input order — in ONE round-trip. Every spec applies `facets` as the hard gate over the caller's VISIBLE corpus — the recipes inside the caller's household's visibility lens (its own imports, friend households' imports, and the curated set; on a self-hosted deployment that is the whole shared corpus) MINUS the caller's rejects; no status/draft/activation step. A recipe outside the caller's lens appears in NO group, in either mode — its absence is indistinguishable from nonexistence. A spec's `vibe` is OPTIONAL and picks the mode. WITHOUT a vibe (membership): returns EVERY recipe passing the facets, unranked, INCLUDING recipes not yet embedded (e.g. just imported) and uncapped by `k` — this is the named-dish / browse path, so a named dish is never silently dropped. To find a named dish, use a vibe-less spec with `facets.query` (the single text search over title AND tags: keeps recipes whose title or tags contain EVERY token as a case-insensitive substring after dropping connective stopwords, so \"chicken and rice\" matches \"chicken rice\", including a recipe titled \"Chicken and Rice\" whose tags omit \"rice\"), typically with include_unmakeable:true. WITH a vibe (ranked): the vibe is embedded and the survivors that HAVE an embedding are ranked by cosine to it, nudged by closeness to the caller's favorites (taste direction), cook recency (never-cooked surfaced, recently-cooked demoted), and the spec's `boost_ingredients` (a bounded perishable-weighted pantry overlap); unembedded survivors are dropped and the top-" +
        `${DEFAULT_K} (max ${MAX_K}, override with \`k\`) compact rows returned. Facet notes (both modes): array filters season/dietary match ALL listed values; course is an open-vocabulary facet (main | side | dessert | breakfast | …) matched by containment — \`course: 'side'\` returns every recipe whose course includes 'side', including a dual-use \`[main, side]\` dish; exclude_cooked_within_days is a caller-supplied window; there is no tag filter. A makeability gate is applied by default in both modes: recipes needing equipment the caller doesn't own are hidden — unless the caller has no kitchen inventory recorded, in which case nothing is gated — and include_unmakeable:true instead returns those recipes annotated with missing_equipment. Each membership row carries the caller's \`favorite\` boolean and \`description\`; no status or rating. For recall, use several diverse vibe specs (a vibe, a variety/wildcard, a never-cooked novelty) in one call.`,
      inputSchema: { specs: z.array(z.object(searchSpecShape)).min(1) },
    },
    ({ specs }) =>
      runTool(async () => {
        // Membership (no vibe) needs only the index + overlay/last_cooked/owned for the
        // facet gate; ranking (vibe present) additionally needs embeddings, rotation
        // prefs, and the alias table for boost normalization. We load the ranking-only
        // reads conditionally so a pure-membership batch makes ZERO AI subrequests and no
        // extra D1 reads. The index read remaps an UNREADABLE table to `index_unavailable`
        // (an EMPTY table is a valid empty corpus — `{}`, so the gate returns []).
        const ranked = specs.some((s) => typeof s.vibe === "string" && s.vibe.length > 0);
        const [index, overlay, lastCooked, owned] = await Promise.all([
          // The caller's LENS position (shared-corpus D11): the membership universe is
          // the lens-visible corpus, so an out-of-lens recipe appears in no group in
          // either mode — its absence indistinguishable from nonexistence.
          loadRecipeIndex(env, memberViewer(tenant.id, tenant.member)).catch((e) => {
            throw new ToolError(
              "index_unavailable",
              `the recipe index is unavailable: ${e instanceof Error ? e.message : String(e)}`,
            );
          }),
          getOverlay(),
          getLastCookedMap(),
          getOwnedEquipment(),
        ]);

        // Join each shared entry with the caller's overlay (favorite/reject) and
        // cooking-log-derived last_cooked before filtering, so the reject hard gate and
        // the makeability gate see the caller's effective per-tenant view (both modes).
        const effective: RecipeIndex = {};
        for (const [slug, entry] of Object.entries(index)) {
          effective[slug] = {
            ...mergeOverlay(entry, overlay[slug], lastCooked.get(slug)),
            slug,
          };
        }
        const now = new Date();

        // Membership-only: gate per spec and return the survivors directly — unranked,
        // unembedded included, no `k` cap, `boost_ingredients` ignored.
        if (!ranked) {
          return {
            results: specs.map((spec) => ({
              label: spec.label,
              recipes: filterRecipes(effective, spec.facets ?? {}, now, owned),
            })),
          };
        }

        // Ranking path: load the embeddings + rotation prefs + operator config + ingredient
        // context (the normalization funnel — boost/index terms normalize AND capture through
        // it), embed the vibe-bearing specs' vibes in ONE Workers AI call (vibe-less specs make
        // no contribution to the embed batch and stay in membership mode).
        const [embeddings, prefs, operatorConfig, ctx] = await Promise.all([
          loadRecipeEmbeddings(env),
          readPreferences(env, tenant.id).catch(() => null),
          loadOperatorConfig(env).catch(() => null),
          getIngredientContext().catch(() => emptyIngredientContext(env)),
        ]);

        // Favorites = the caller's favorited recipes that are embedded — the
        // nearest-liked re-rank's anchor set (the favorite cutover repointed this
        // from `rating >= 4` to the `overlay.favorite` flag, leaving the math intact).
        const favoriteVecs: number[][] = [];
        for (const [slug, row] of Object.entries(overlay)) {
          if (row?.favorite) {
            const vec = embeddings.get(slug);
            if (vec) favoriteVecs.push(vec);
          }
        }
        const params = resolveRankParams(prefs, operatorConfig ?? undefined);

        // One embed call for ALL vibe-bearing specs, mapped back to their spec index so a
        // mix of membership and ranked specs in one call stays aligned. Routed through the
        // query-embedding cache (member-app-propose D5): a recently-embedded vibe phrase —
        // by this tool or the propose surface — is a KV hit, and only misses hit Workers AI
        // (still one batched call; byte-identical to the plain embed on a cold cache).
        const vibeSpecs = specs
          .map((spec, i) => ({ spec, i }))
          .filter((x) => typeof x.spec.vibe === "string" && x.spec.vibe.length > 0);
        const vibeVecs = await embedTextsCached(
          env,
          { activity: "embed-search", trigger: "request" },
          vibeSpecs.map((x) => x.spec.vibe as string),
        );
        const vibeVecByIndex = new Map<number, number[]>();
        vibeSpecs.forEach((x, j) => vibeVecByIndex.set(x.i, vibeVecs[j]));

        const results = specs.map((spec, i) => {
          const survivors = filterRecipes(effective, spec.facets ?? {}, now, owned);
          const vibeVec = vibeVecByIndex.get(i);
          // A vibe-less spec in a ranked batch is still membership: return survivors
          // directly (unranked, unembedded included, no `k`).
          if (!vibeVec) {
            return { label: spec.label, recipes: survivors };
          }
          // Normalize the spec's boost items through the SAME funnel the index's ingredient
          // arrays are normalized against, so the overlap is exact set math.
          const boostItems = ctx.resolveNames(spec.boost_ingredients);
          // Resolve each survivor's embedding + freshness; drop the unembedded (not yet
          // reconciled) — they stay reachable via a vibe-less membership spec.
          const candidates: SearchCandidate[] = [];
          for (const s of survivors) {
            const vec = embeddings.get(s.slug);
            if (!vec) continue;
            const fm = s.frontmatter;
            candidates.push({
              slug: s.slug,
              title: typeof fm.title === "string" ? fm.title : s.slug,
              description: typeof fm.description === "string" ? fm.description : null,
              protein: typeof fm.protein === "string" ? fm.protein : null,
              cuisine: typeof fm.cuisine === "string" ? fm.cuisine : null,
              time_total: typeof fm.time_total === "number" ? fm.time_total : null,
              embedding: vec,
              last_cooked: lastCooked.get(s.slug) ?? null,
              // Normalize at the boundary so the ranker does plain set membership.
              // perishable_ingredients is already normalized at import; ingredients_key
              // is conventionally-but-not-guaranteed normalized, so alias-collapse it too.
              ingredients_key: ctx.resolveNames(fm.ingredients_key),
              perishable_ingredients: ctx.resolveNames(fm.perishable_ingredients),
            });
          }
          const recipes = rankCandidates(
            candidates,
            vibeVec,
            favoriteVecs,
            boostItems,
            now,
            params,
            spec.k ?? DEFAULT_K,
          );
          return { label: spec.label, recipes };
        });

        return { results };
      }),
  );

  // Kroger-gated (mcp-tool-gating): registers only when the deployment carries Kroger
  // API credentials — a walk-only deployment advertises no Kroger tools.
  if (ctx.kroger) {
    server.registerTool(
      "kroger_login_url",
      {
        description:
          "Mint the one-time Kroger account-authorization link for the CURRENT member and return { url }. Kroger ordering (place_order and any cart write) needs the member's own Kroger shopping account linked first; this returns a personal link the member opens in a browser to consent at Kroger (scope: add-to-cart only). Give the returned URL to the member to click. Use it (1) the first time a member sets up ordering, and (2) whenever a Kroger cart write returns `code: \"reauth_required\"` — the stored token was rejected and the member must re-authorize. The link is bound to the calling member from their authenticated session: it takes NO arguments and cannot mint a link for anyone else. It is single-use and expires in ~10 minutes, so mint it on demand rather than caching it. (Operators bootstrapping a member who isn't connected yet use the admin panel's consent-link action instead.)",
        inputSchema: {},
      },
      () =>
        runTool(async () => {
          // The link is minted for the caller's OWN grant tenant (never an argument);
          // `origin` is the member's connected host, threaded in from the MCP handler.
          if (!origin) {
            throw new ToolError(
              "upstream_unavailable",
              "cannot resolve the Worker origin for the Kroger authorization link",
            );
          }
          const url = await buildKrogerConsentUrl(
            env.KROGER_KV as unknown as KvStore,
            origin,
            tenant.id,
          );
          return { url };
        }),
    );
  }

  server.registerTool(
    "read_recipe",
    {
      description:
        "Agent-internal read for reasoning over a recipe — a member's show-me ask renders display_recipe instead; never paste this read as the answer. Read a single recipe's parsed frontmatter and markdown body by slug. Frontmatter includes `course` (the open-vocabulary dish type — main | side | dessert | breakfast | …), `pairs_with` (slugs of sides remembered for this main), and the AI-generated `description` (merged from the derived store; absent if not yet generated).",
      inputSchema: { slug: z.string() },
    },
    ({ slug }) => runTool(() => readRecipeDetail(env, tenant.id, slug)),
  );

  server.registerTool(
    "read_pantry",
    {
      description:
        "Read pantry items. Items carry orthogonal `category` (food taxonomy) and `location` fields; filter on either, plus prepared_only. stale_only remains unsupported because public freshness claims require conversational context.",
      inputSchema: { filter: z.object(pantryFilterShape).optional() },
    },
    ({ filter }) =>
      runTool(async () => {
        if (filter?.stale_only) throw new ToolError("unsupported", "stale_only is not computable: freshness is a conversational concern requiring storage/open-package/inspection context.");
        const items = await readPantry(env, tenant.id, {
          category: filter?.category,
          location: filter?.location,
          preparedOnly: filter?.prepared_only,
        });
        return { items };
      }),
  );

  server.registerTool(
    "read_user_profile",
    {
      description:
        "Return the caller's full grocery profile in one call, including initialization status. `initialized` is true once preferences are present; `missing` lists onboarding-area keys still absent (store, taste, diet, equipment, stockup, vibes) — empty when fully set up. Profile fields: preferences (parsed; `preferences.cadence` is the per-meal planning-frequency map { breakfast, lunch, dinner } — the stored map, or a derivation from the legacy nights count when unset; `default_cooking_nights` remains exported for one deprecation window as a derived MIRROR of cadence.dinner — prefer cadence), taste narrative (markdown), diet principles (markdown), kitchen inventory (owned equipment slugs + notes), staples list, stockup watchlist, meal_vibes (the palette — each saved vibe plus its `meal`, its `members` when set, and its derived last_satisfied and cadence status: overdue|due|soon|ok, the revealed-preference rhythm), household (`household.members[]` — every household member as { handle, nickname, you, joined_at }, where nickname is the CALLER's own private alias only, null when unset; never an alias set by or for anyone else. Handles are the stable keys for attendance and member-assigned vibes), and attention (server-computed nudge inputs, deterministic — no AI, nothing narrated unless it's actionable: `retrospective_due` — true when there is cooking history and the retrospective hasn't been read in 42+ days (reading one via the retrospective tool resets it); `unverified_perishables` — a COUNT of pantry rows in produce/dairy/seafood/meat unverified for 7+ days, not a list; `stale_areas` — the same array as `missing`, under the attention lens). Absent fields return null or empty. Use this at the start of every session — on initialized:false, run configure-yamp-profile first.",
      inputSchema: {},
    },
    () => runTool(() => assembleUserProfile(env, tenant.id, tenant.member)),
  );

  // Fused guidance read (cooking-techniques): absent `slugs` returns list_guidance's old
  // listing (per-domain, or all domains grouped when `domain` is also absent); present
  // `slugs` returns today's content read. `list_guidance` stays registered for one
  // deprecation window as a dispatch alias onto the listing mode (identical responses,
  // no `warnings` injection — the `*_night_vibe` D21 precedent). `save_guidance` is a
  // hard removal (no member guidance-write surface); `saveGuidance` itself stays for the
  // admin guidance editor.
  const guidanceListingHandler = (domain?: string) => runTool(() => listGuidance(corpus, domain));

  server.registerTool(
    "read_guidance",
    {
      description:
        'Read or list curated guidance from the shared guidance/ trees. With `slugs` ABSENT: lists available slugs (each with an optional one-line description) — pass `domain` for one corpus, or omit it to get every domain grouped ({ domains: [{ domain, entries }] }; with a domain, { domain, entries }). With `slugs` PRESENT (domain required): returns their content, { domain, entries: [{ slug, content }] } — an unknown slug or domain yields a structured error. Domains: "ingredient_storage" — put-away advice keyed by storage BEHAVIOR CLASS ("tender-herbs", "alliums", "leafy-greens"), a few singletons that break their class\'s rule ("basil", "tomatoes", "avocados"), and "_ethylene" for relational "don\'t store together" rules; "cooking_techniques" — general technique memories keyed by technique ("browning-meat", "searing", "resting-meat"); "purchasing" — buy-side selection keyed by PRODUCT/ITEM ("canned-tomatoes", "olive-oil"): what kind to get, plus the non-obvious "how to tell if it\'s good/ripe" judgments, surfaced while shopping. Map a just-bought item, a recipe step, or a thing on the grocery list to the right slug with your own world knowledge (cilantro → tender-herbs; "brown the beef" → browning-meat; canned tomatoes on the list → canned-tomatoes), then read the content of the relevant ones. This is vetted, curated advice — relay any contested tip WITH the hedge written into its prose, and give NO tip for an item/step that has no matching entry (never improvise). An absent tree yields an empty listing, not an error.',
      inputSchema: { domain: z.string().optional(), slugs: z.array(z.string()).optional() },
    },
    ({ domain, slugs }) =>
      runTool(async () => {
        if (slugs === undefined) return listGuidance(corpus, domain);
        if (domain === undefined) {
          throw new ToolError("validation_failed", "reading specific guidance slugs requires a `domain`");
        }
        return readGuidance(corpus, domain, slugs);
      }),
  );

  server.registerTool(
    "list_guidance",
    {
      description: aliasDescription("read_guidance"),
      inputSchema: { domain: z.string().optional() },
    },
    ({ domain }) => guidanceListingHandler(domain),
  );

  // Kroger-gated (mcp-tool-gating): kroger_prices needs a working Kroger client.
  if (ctx.kroger) {
    server.registerTool(
      "kroger_prices",
      {
        description:
          "Current Kroger prices for each ingredient at the preferred location. Returns the FULL list of fulfillable products per ingredient (relevance-ranked) — each with { regular, promo } price, on-sale flag, curbside/delivery availability, top-level inStore flag, and aisleLocation — so you can compare across brands/sizes and pick, not just the top one. An ingredient with nothing fulfillable returns an empty products list.",
        inputSchema: { ingredients: z.array(z.string()), location_id: z.string().optional() },
      },
      ({ ingredients, location_id }) =>
        runTool(async () => {
          const locationId = location_id ?? await getLocationId();
          // Independent per-ingredient searches run concurrently (bounded by the
          // Kroger client's concurrency cap); Promise.all preserves input order.
          const prices = await Promise.all(
            ingredients.map(async (ingredient) => {
              const candidates = await kroger.search(ingredient, { locationId, limit: 50 });
              // Every fulfillable product for the term — the LLM judges across them.
              const products = candidates.filter(isFulfillable).map(productRow);
              return { ingredient, products };
            }),
          );
          return { prices };
        }),
    );

    // flyer (kroger-integration + satellite-sale-scan): unifies the former kroger_flyer +
    // store_flyer under one name — resolves the caller's PRIMARY fulfillment store (Kroger
    // or a satellite-scanned store) from `stores.primary` + `stores.preferred_location`,
    // reads that store's background-warmed rollup (never a live fan-out), and applies the
    // read-time deal floor. Kroger-gated per mcp-tool-gating (a walk-only deployment has no
    // flyer producer today); ungating for a hypothetical satellite-only deployment is a
    // one-line change if one ever materializes.
    server.registerTool(
      "flyer",
      {
        description:
          "Synthesized sale scan for the caller's PRIMARY fulfillment store — Kroger or a satellite-scanned store — served from a background-warmed cache (never a live fetch; the public API has no flyer/circular endpoint, and a live per-call fan-out would exceed the Worker's per-request subrequest limit). Returns `{ items, as_of }`: `items` are fulfillable products genuinely on sale (deduped by productId, each carrying every broad term that surfaced it in `matched_terms`), kept only when marked down at least `min_savings_pct` of the regular price — default 5%, applied at read so you can widen with a lower value. `as_of` is when this store's flyer was last refreshed (ISO 8601), or null when it has not been swept/scanned yet — in which case `items` is empty, NOT an error. A satellite-scanned store's rollup older than the operator's staleness ceiling reads as empty (with `as_of` still surfaced) rather than steering on stale sales; Kroger and satellite sales are indistinguishable here except by which store they came from. Resolves the store from the caller's profile (`stores.primary` + `stores.preferred_location`). Issues no flyer FAN-OUT subrequest (the background sweep already did that) — a pure cache read; for a Kroger primary, resolving `preferred_location` to a numeric locationId may cost one Kroger Locations API call (a satellite store's label IS its rollup locationId, so it needs none). A missing/unresolvable store degrades to `{ items: [], as_of: null }`, never an error. This tool takes no ad-hoc terms — checking whether a specific stockup item or substitute candidate is on sale is handled in the place-groceries flow, not here.",
        inputSchema: { filter: z.object(flyerFilterShape).optional() },
      },
      ({ filter }) =>
        runTool(async () => {
          // Resolve the caller's primary fulfillment store (slug + location). A missing/unresolvable
          // store degrades to empty items (never an error) — the same posture as a cold cache. No
          // external store subrequest is issued for a satellite store (its label IS the locationId);
          // a Kroger store resolves its location via the Locations API.
          const target = await resolveStoreFlyerTarget().catch(() => null);
          if (!target) return { items: [], as_of: null };
          const { store, locationId } = target;

          const operatorConfig = await loadOperatorConfig(env).catch(() => null);
          const defaultDiscount = operatorConfig?.minFlyerDiscount ?? MIN_FLYER_DISCOUNT;
          const minDiscount =
            typeof filter?.min_savings_pct === "number" ? filter.min_savings_pct / 100 : defaultDiscount;

          // Pure cache read: the warm (flyer-warm.ts) stores noise-floor candidates per location at
          // the `flyer:{store}:{locationId}` rollup key (readStoreFlyer falls back to the legacy
          // un-namespaced Kroger key while a deploy's first namespaced sweep is pending). The deal
          // floor is applied HERE so it stays caller-tunable.
          const rollup = await readStoreFlyer(env.KROGER_KV as unknown as KvStore, store, locationId);
          if (!rollup) return { items: [], as_of: null };
          const as_of = new Date(rollup.as_of).toISOString();

          // Staleness ceiling — SATELLITE-scanned stores only (see `isSatelliteRollupStale`):
          // past the ceiling a scanned store reads as empty rather than steering on stale sales.
          const stalenessDays = operatorConfig?.scanStalenessDays ?? DEFAULT_OPERATOR_CONFIG.scanStalenessDays;
          if (isSatelliteRollupStale(store, rollup.as_of, stalenessDays)) {
            return { items: [], as_of };
          }
          return { items: filterByMinSavings(rollup.items, minDiscount), as_of };
        }),
    );
  }

  // Repo-data write tools route by category internally (personal profile/overlay →
  // D1 profile tables; session state pantry+kitchen → D1 pantry/profile tables), so
  // they take D1 (env) + tenant id. `update_recipe` (the one R2-corpus write here)
  // left the MCP surface — this group no longer needs the corpus store.
  registerWriteTools(server, env, tenant.id);
  registerGroceryListTools(server, env, tenant.id);

  // The bespoke in-chat recipe card (recipe-card-widget): the `display_recipe` tool +
  // the `ui://recipe/card` MCP Apps resource. Reuses `readRecipeDetail` (injected, to
  // stay off this module's import cycle); the widget HTML is read from the ASSETS binding.
  registerRecipeCardWidget(server, env, (slug) => readRecipeDetail(env, tenant.id, slug));

  // Night-vibe palette CRUD (per-tenant): the durable "shape of a week" propose_meal_plan
  // samples. Private profile data, siblings of staples/stockup.
  registerNightVibeTools(server, env, tenant.id);

  // propose_meal_plan: the two-level planner over the palette. Reuses the search-context
  // closures (overlay / last_cooked / owned / aliases) so its ranking matches search_recipes.
  const proposeDeps = {
    getOverlay,
    getLastCookedMap,
    getOwnedEquipment,
    getIngredientContext,
  };
  registerProposeMealPlanTool(server, env, tenant, proposeDeps);

  // The bespoke in-chat meal-plan proposal card (meal-plan-widget): the `display_meal_plan`
  // tool + the `ui://plan/propose` MCP Apps resource. Reuses the SAME shared propose op + deps
  // as propose_meal_plan (one contract); the widget HTML is read from the ASSETS binding.
  registerMealPlanWidget(server, env, tenant, proposeDeps);
  registerGroceryWidget(server, env, tenant.id);
  // Kroger-gated (mcp-tool-gating): display_order_review + its app-plane review ops.
  if (ctx.kroger) {
    registerOrderReviewWidget(server, env, tenant.id, buildOrderWiring(env, tenant.id, { capture: false }));
  }

  // Profile reconciliation: list_proposals/confirm_proposal (the operator's OWN queue,
  // including corpus-curation merge_recipes review) and the operator-frontier producer
  // (reconcile_read_signals/reconcile_enqueue_proposal) — the whole group registers only
  // for the operator tenant (mcp-tool-gating); members confirm proposals in the web app's
  // reconciliation queue instead. The call-time isOperator checks on the reconcile pair
  // stay as defense in depth.
  if (ctx.operator) {
    registerReconcileTools(server, env, tenant);
  }

  // Archetype derivation (meal-vibe-archetype-derivation) is a scheduled generative
  // reconcile pass now (runArchetypeDerivationJob, src/index.ts's cron) — there is no
  // on-demand suggest_meal_vibes/suggest_night_vibes MCP tool; candidates land as
  // pending proposals for the member app's reconciliation queue.

  // Cooking history + meal plan: read_meal_plan (resume), update_meal_plan, and
  // retrospective. Meal plan reads/writes go through the D1 `meal_plan` table; the
  // cooking log is the D1 `cooking_log` table. log_cooked appends a cooking event and
  // clears the cooked recipe from the meal plan in ONE D1 transaction (slice 5).
  registerCookingTools(server, env, tenant.id);
  registerCookingWriteTools(server, env, tenant.id);

  // Discovery: RSS recipe candidates, parse-only URL import, draft create, plus the
  // feeds/sources config writers. Everything here is SHARED — recipes live at the
  // data-repo root, while the discovery feeds/inbox/allowlist are shared D1 tables,
  // so any member's config feeds one group pool. Imports dedupe by
  // source URL against the shared corpus so a recipe is reused, not duplicated (§6.4).
  registerDiscoveryTools(server, corpus, env, tenant);

  // Recipe notes (§8): attributed annotations in the D1 `recipe_notes` table,
  // aggregated across the group at read time with the privacy WHERE (own-private +
  // group-shared), joined with the slice-4 overlay-ratings query (fully D1).
  // Author/privacy caller is the MEMBER (attribution), not the tenant (isolation) —
  // byte-identical for founding members, correct once households hold more than one.
  registerNoteTools(server, tenant, directoryFromEnv(env), env);

  // In-store fulfillment: the shared D1 `stores` registry (identity-only CRUD,
  // unattributed) + attributed D1 `store_notes` (the recipe-notes pattern, store
  // analog) — layout lives in layout/location/stock-tagged store notes.
  registerStoreTools(server, env);
  registerStoreNoteTools(server, tenant.member, env);

  // read_to_buy — the derived to-buy view (member-app-grocery D1): one shared op with
  // the member API's GET /api/grocery/to-buy (computeToBuyView).
  server.registerTool(
    "read_to_buy",
    {
      description:
        "Agent-internal reasoning read — never present its contents as the answer to a show-me ask (\"what's on my list?\" renders display_grocery_list instead). The checked-aware derived shopping view: (active list UNION plan needs) MINUS pantry coverage MINUS active substitution suppressions, partitioned into unchecked `to_buy` and durable `checked`. Only `to_buy` can enter an online cart; checked never means in_cart. Returns row freshness, pantry freshness/decision state, in-cart linkage, underived recipes, and opaque snapshot_version. Optional enrich adds store placement and relation-labeled substitute hints with at most one location resolve and zero product searches.",
      inputSchema: { enrich: z.boolean().optional() },
    },
    (input) => runTool(() => computeToBuyView(env, tenant.id, { enrich: input.enrich === true })),
  );

  // Instacart-gated (mcp-tool-gating): registers only when the Instacart config resolves.
  if (ctx.instacart) {
    registerInstacartTool(server, env, tenant.id);
  }

  // suggest_substitutions is cut from the member surface (data-write-tools,
  // ingredient-matching): read_to_buy(enrich) already carries substitutes[], and
  // same-identity SKU alternatives live on the order-review widget's app ops.

  // place_order — the order-time flush: resolve the list, write the Kroger cart,
  // persist learned SKUs to the SHARED cache. The one tool that reaches the cart.
  // Kroger-gated (mcp-tool-gating): the only tool that writes a cart needs Kroger config.
  if (ctx.kroger) {
    registerOrderTools(server, env, tenant.id, orderWiring);
  }

  // get_weather_forecast is cut from the member surface (data-read-tools,
  // member-app-propose): weather is engine context, not an agent verb.
  // propose_meal_plan already loads the forecast server-side through
  // resolveTenantForecast (this module), which the shared propose op also
  // runs for POST /api/propose — no forecast tool appears on the MCP surface.

  // report_bug — record an attributed bug report into the D1 `bug_reports` table the
  // operator reviews via the admin panel (the GitHub App / issues path is gone for
  // data). Identity + timestamp are stamped server-side, never trusted from the agent.
  server.registerTool(
    "report_bug",
    {
      description:
        "File a bug report to the operator's review queue, on behalf of the user (who can't file issues themselves). Use it when a yamp tool errors in a way you can't work around, or when the user has had to repeatedly correct or redirect you on the same thing. Write a specific, reproducible report. The server attributes the report to the caller and timestamps it — don't add identity yourself. The operator sees it in their admin panel. Returns { filed: true }.",
      inputSchema: {
        title: z.string().describe("A short, specific issue title."),
        body: z
          .string()
          .describe(
            "What you were doing, what went wrong (the error or the correction pattern), and the tools/inputs involved — enough for the operator to reproduce.",
          ),
      },
    },
    ({ title, body }) =>
      runTool(async () => {
        await recordBugReport(db(env), tenant.id, title, body, new Date().toISOString());
        return { filed: true };
      }),
  );

  return server;
}
