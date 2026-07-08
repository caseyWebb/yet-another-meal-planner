// buildServer wires the full grocery-mcp tool surface onto an McpServer: the
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
import { registerNightVibeTools } from "./night-vibe-tools.js";
import { registerProposeMealPlanTool, type ProposeDeps } from "./meal-plan-proposal-tool.js";
import { registerReconcileTools } from "./reconcile-tools.js";
import { registerSuggestNightVibesTool } from "./night-vibe-suggest.js";
import { registerOrderTools, type OrderWiring } from "./order-tools.js";
import { computeToBuyView } from "./to-buy.js";
import { suggestSubstitutions, MAX_SUBSTITUTION_LINES } from "./substitutions.js";
import { registerDiscoveryTools } from "./discovery-tools.js";
import { registerNoteTools, registerStoreNoteTools } from "./notes-tools.js";
import { registerStoreTools } from "./stores-tools.js";
import { registerCookingTools } from "./cooking-tools.js";
import { filterRecipes, type RecipeIndex } from "./recipes.js";
import { loadRecipeIndex, loadRecipeEmbeddings, recipeDescription } from "./recipe-index.js";
import { readReconcileErrors } from "./recipe-projection.js";
import { readRejections, getQuarantine } from "./satellite-audit-db.js";
import { recordBugReport } from "./bug-reports.js";
import { embedTextsCached } from "./embedding.js";
import {
  rankCandidates,
  resolveRankParams,
  DEFAULT_K,
  MAX_K,
  type SearchCandidate,
} from "./semantic-search.js";
import { listGuidance, readGuidance, saveGuidance } from "./guidance.js";
import { loadOperatorConfig, DEFAULT_OPERATOR_CONFIG } from "./operator-config.js";
import { fetchWeatherForecast, type WeatherForecast, type WeatherError } from "./weather.js";
import { mergeOverlay, type Overlay } from "./overlay.js";
import { readPantry } from "./session-db.js";
import {
  readProfile,
  readPreferences,
  readOverlay,
  readOwnedEquipment,
  readBrandPrefs,
  type AssembledProfile,
  type Preferences,
} from "./profile-db.js";
import { db } from "./db.js";
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
import { compareUnitPrice } from "./unit-price.js";
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
 * The `read_recipe` assembly as a shared operation (member-app-core D2): corpus read +
 * `parseMarkdown` + the caller's overlay/last-cooked merge + the derived description.
 * Throws the same structured `not_found` for an invalid or unknown slug. Called by the
 * MCP tool and the member API's `GET /api/cookbook/recipes/:slug`.
 */
export async function readRecipeDetail(
  env: Env,
  tenant: string,
  slug: string,
): Promise<{ slug: string; frontmatter: Record<string, unknown>; body: string }> {
  if (!SLUG_RE.test(slug)) {
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
export function buildOrderWiring(env: Env, tenant: string): OrderWiring {
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
  const getIngredientContext = (): Promise<IngredientContext> => (ctxP ??= ingredientContext(env));

  /** Run the resolve-only matcher for one ingredient with the shared deps. */
  async function resolve(
    ingredient: string,
    context: MatchContext = {},
    bypassCache = false,
  ): Promise<MatchResult> {
    const locationId = await getLocationId();
    const brands = await readBrandPrefs(env, tenant);
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
      size: fresh.size,
      price: fresh.price,
      on_sale: isOnSale(fresh),
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

/** The `read_user_profile` payload: the assembled profile + initialization status. */
export interface UserProfilePayload extends AssembledProfile {
  initialized: boolean;
  missing: string[];
}

/**
 * The `read_user_profile` assembly as a shared operation (member-app-core D2):
 * `readProfile` + the `initialized`/`missing` computation. Called by the MCP tool and
 * the member API's `GET /api/profile`.
 */
export async function assembleUserProfile(env: Env, tenant: string): Promise<UserProfilePayload> {
  const profile = await readProfile(env, tenant);

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
    ["ready-to-eat", profile.ready_to_eat],
    ["stockup", profile.stockup],
  ];

  const initialized = profile.preferences !== null;
  const missing: string[] = [];
  for (const [area, value] of PROFILE_AREAS) {
    if (isEmpty(value)) missing.push(area);
  }

  return {
    initialized,
    missing,
    preferences: profile.preferences,
    taste: profile.taste,
    diet_principles: profile.diet_principles,
    kitchen: profile.kitchen,
    staples: profile.staples,
    ready_to_eat: profile.ready_to_eat,
    stockup: profile.stockup,
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
  prepared_only: z.boolean().optional(),
  stale_only: z.boolean().optional(),
};

const flyerFilterShape = {
  /** Minimum markdown to keep, as a percent of regular price (default 5). */
  min_savings_pct: z.number().optional(),
};

const matchContextShape = {
  recipe_slug: z.string().optional(),
  dietary: z.array(z.string()).optional(),
  quantity_hint: z.string().optional(),
};

const unitPriceItemShape = {
  id: z.string(),
  price: z.union([z.string(), z.number()]),
  size: z.string(),
  quantity_override: z.number().optional(),
  unit_override: z.string().optional(),
};

const READY_TO_EAT_MEALS = ["breakfast", "lunch", "dinner"] as const;

/** One product row for the list-returning Kroger lookups (kroger_prices, ready_to_eat). */
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

export function buildServer(env: Env, tenant: Tenant, origin?: string): McpServer {
  const server = new McpServer({ name: "grocery-mcp", version: "0.1.0" });

  // tool-usage-trends: wrap registerTool ONCE, before any tool is registered, so every tool —
  // the inline ones below AND those added by the register*Tools helpers — emits one tenant-clean
  // per-call usage point (tool, ok/error, duration) to the `grocery_tool` AE dataset. Best-effort
  // and non-blocking; never touches the result. Tenant id is deliberately NOT passed.
  instrumentTools(server as unknown as ToolRegistrar, env);

  // The authored corpus (recipes/ + guidance/) is read/listed/written through the R2
  // corpus store — no GitHub App, installation token, or GitHub API call on the data
  // path. `report_bug` writes D1 and `recipe_site_url` resolves the Worker-hosted
  // cookbook, so GitHub is no longer on the tool surface at all.
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

  // The order wiring (member-app-grocery D8): resolveIngredient / revalidateSku /
  // getLocationId over lazily-memoized preferences/brands/ingredient-context/SKU-cache
  // reads — built ONCE per request and shared by every tool below that needs them
  // (match_ingredient_to_kroger_sku, place_order, the Kroger price/flyer lookups).
  const orderWiring = buildOrderWiring(env, tenant.id);
  const getLocationId = orderWiring.getLocationId;
  const resolveIngredient = orderWiring.resolve;

  /**
   * Resolve the caller's PRIMARY fulfillment store for `store_flyer`: its slug (`stores.primary`,
   * default "kroger") + the rollup `locationId`. For Kroger the human `preferred_location` label is
   * resolved to a numeric locationId (as `kroger_flyer` does); for a satellite-scanned store the
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
        "Find recipes in the index. Takes an array of search SPECS and returns one result group per spec — `{ results: [{ label, recipes }] }`, in input order — in ONE round-trip. Every spec applies `facets` as the hard gate over the caller's available corpus (the whole shared corpus plus the caller's personal recipes, MINUS the caller's rejects; no status/draft/activation step). A spec's `vibe` is OPTIONAL and picks the mode. WITHOUT a vibe (membership): returns EVERY recipe passing the facets, unranked, INCLUDING recipes not yet embedded (e.g. just imported) and uncapped by `k` — this is the named-dish / browse path, so a named dish is never silently dropped. To find a named dish, use a vibe-less spec with `facets.query` (the single text search over title AND tags: keeps recipes whose title or tags contain EVERY token as a case-insensitive substring after dropping connective stopwords, so \"chicken and rice\" matches \"chicken rice\", including a recipe titled \"Chicken and Rice\" whose tags omit \"rice\"), typically with include_unmakeable:true. WITH a vibe (ranked): the vibe is embedded and the survivors that HAVE an embedding are ranked by cosine to it, nudged by closeness to the caller's favorites (taste direction), cook recency (never-cooked surfaced, recently-cooked demoted), and the spec's `boost_ingredients` (a bounded perishable-weighted pantry overlap); unembedded survivors are dropped and the top-" +
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
          loadRecipeIndex(env).catch((e) => {
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

  server.registerTool(
    "recipe_site_url",
    {
      description:
        "Resolve the URL of the hosted cookbook (the browse view of the shared corpus), served by the grocery-mcp Worker itself (no GitHub Pages, no GitHub Pro). Returns { url, enabled }: enabled:true with the cookbook URL (`<host>/cookbook`) when the host is resolvable, or enabled:false (url:null) on the rare path where it isn't. Use it during onboarding to point a new member at the full collection.",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        // The cookbook is served by THIS Worker at `/cookbook`, built from the D1 index +
        // R2 bodies (src/cookbook.ts) — no GitHub. `origin` is the request host the member
        // connected to (the operator's domain), threaded in from the MCP handler.
        if (!origin) return { url: null, enabled: false };
        return { url: `${origin}/cookbook`, enabled: true };
      }),
  );

  server.registerTool(
    "kroger_login_url",
    {
      description:
        "Mint the one-time Kroger account-authorization link for the CURRENT member and return { url }. Kroger ordering (place_order, ready_to_eat_available, and any cart write) needs the member's own Kroger shopping account linked first; this returns a personal link the member opens in a browser to consent at Kroger (scope: add-to-cart only). Give the returned URL to the member to click. Use it (1) the first time a member sets up ordering, and (2) whenever a Kroger cart write returns `code: \"reauth_required\"` — the stored token was rejected and the member must re-authorize. The link is bound to the calling member from their authenticated session: it takes NO arguments and cannot mint a link for anyone else. It is single-use and expires in ~10 minutes, so mint it on demand rather than caching it. (Operators bootstrapping a member who isn't connected yet use the admin panel's consent-link action instead.)",
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

  server.registerTool(
    "read_reconcile_errors",
    {
      description:
        "List recipes the index reconcile SKIPPED because they failed validation — the shared corpus's current indexing failures ({ errors: [{ slug, path, message, recorded_at }] }). The recipe index is rebuilt from the R2 corpus by a background reconcile; a recipe whose frontmatter breaks the required-field/vocabulary contract, is missing a `## Ingredients`/`## Instructions` body section, duplicates another slug, or has a dangling `pairs_with` is NOT indexed (so it won't appear in search_recipes) and is recorded here with the first actionable error. An empty list means every recipe indexed cleanly. Use it when a member reports a recipe they authored/edited (e.g. via Obsidian) isn't showing up, or proactively after a bulk edit — then relay the specific fix (e.g. \"`thai-curry`: `protein: poltry` isn't a valid value\") so they can correct the source. Shared across the group; takes no parameters.",
      inputSchema: {},
    },
    () => runTool(async () => ({ errors: await readReconcileErrors(env) })),
  );

  server.registerTool(
    "read_satellite_rejections",
    {
      description:
        "List a satellite's recently REJECTED observations — the source-audit rear-view mirror ({ rejections: [{ kind, source, origin, reason, provenance, count, rejected_at }], quarantined: [{ kind, source, quarantined_at }] }), most-recent-first and bounded. A satellite is a member's home helper that scrapes recipes / scans a non-Kroger store's sale flyer / fills a store cart; the Worker re-validates everything it sends and DROPS what fails. This read reflects ONLY rejected observations — an accepted one NEVER appears (so an empty `rejections` means everything the satellite sent lately landed cleanly). Fields: `kind` is recipe | sale | order; `source` is the feed/site (recipe) or the store slug (sale/order); `origin` is `worker` (the Worker rejected it at intake — a bad shape, a wrong-endpoint item, or a quarantined source with `reason: \"quarantined\"`) or `local` (a satellite-reported, pre-aggregated summary of what its own validators dropped before the wire — `reason` is the reported category); `count` is 1 for a worker reject or N for a pre-aggregated local-summary entry; `provenance` is the offending url/id or a redacted sample. `quarantined` lists the sources an operator has flagged as a Worker-side reject (their observations are dropped until un-flagged). Optional `source` filters to one exact source. Visibility: recipe and sale rejections/quarantines are operator-global (shared across the whole group), but `order`-kind rows are per-member PRIVATE (order-fill is a member's own store cart) — you see only your own order rejections, never another member's. Use it when a member says their satellite's recipes/sales aren't showing up: read it and relay the specific defect (e.g. \"seriouseats: 12 rejects in the last day — the adapter likely broke\"). The only parameter is the optional `source`.",
      inputSchema: { source: z.string().optional() },
    },
    ({ source }) =>
      runTool(async () => ({
        // Tenant isolation: recipe/sale rejections are operator-global (tenant IS NULL → household-wide),
        // but `order`-kind rejections are tenant-PRIVATE (provenance = product url/id) — so scope the read
        // to rows VISIBLE to the caller (operator-global OR this tenant), never another member's orders.
        rejections: await readRejections(env, { source, tenantScope: tenant.id }),
        // Same visibility rule for the quarantine set, trimmed to design F's {kind, source, quarantined_at}.
        quarantined: (await getQuarantine(env))
          .filter((q) => q.tenant == null || q.tenant === tenant.id)
          .map((q) => ({ kind: q.kind, source: q.source, quarantined_at: q.quarantined_at })),
      })),
  );

  server.registerTool(
    "read_recipe",
    {
      description:
        "Read a single recipe's parsed frontmatter and markdown body by slug. Frontmatter includes `course` (the open-vocabulary dish type — main | side | dessert | breakfast | …), `pairs_with` (slugs of sides remembered for this main), and the AI-generated `description` (merged from the derived store; absent if not yet generated).",
      inputSchema: { slug: z.string() },
    },
    ({ slug }) => runTool(() => readRecipeDetail(env, tenant.id, slug)),
  );

  server.registerTool(
    "read_pantry",
    {
      description:
        "Read pantry items. Supports category and prepared_only filters. stale_only is unsupported: freshness is judged conversationally (it depends on storage, whether a package was opened, and visual inspection), not computed by the tool.",
      inputSchema: { filter: z.object(pantryFilterShape).optional() },
    },
    ({ filter }) =>
      runTool(async () => {
        if (filter?.stale_only) {
          throw new ToolError(
            "unsupported",
            "stale_only is not computable: freshness is an LLM-judged, conversational concern (storage, open packages, visual inspection), not a function of the repo data.",
          );
        }
        const items = await readPantry(env, tenant.id, {
          category: filter?.category,
          preparedOnly: filter?.prepared_only,
        });
        return { items };
      }),
  );

  server.registerTool(
    "read_user_profile",
    {
      description:
        "Return the caller's full grocery profile in one call, including initialization status. `initialized` is true once preferences are present; `missing` lists onboarding-area keys still absent (store, taste, diet, equipment, ready-to-eat, stockup) — empty when fully set up. Profile fields: preferences (parsed), taste narrative (markdown), diet principles (markdown), kitchen inventory (owned equipment slugs + notes), staples list, ready-to-eat catalog items, stockup watchlist. Absent fields return null or empty. Use this at the start of every session — on initialized:false, run configure-grocery-profile first.",
      inputSchema: {},
    },
    () => runTool(() => assembleUserProfile(env, tenant.id)),
  );

  server.registerTool(
    "list_guidance",
    {
      description:
        'List the curated guidance slugs (each a slug + an optional one-line description) from the shared guidance/ trees. Pass `domain` for one corpus, or omit it to get every domain grouped (returns { domains: [{ domain, entries }] }; with a domain it returns { domain, entries }). Domains: "ingredient_storage" — put-away advice keyed by storage BEHAVIOR CLASS ("tender-herbs", "alliums", "leafy-greens"), a few singletons that break their class\'s rule ("basil", "tomatoes", "avocados"), and "_ethylene" for relational "don\'t store together" rules; "cooking_techniques" — general technique memories keyed by technique ("browning-meat", "searing", "resting-meat"); "purchasing" — buy-side selection keyed by PRODUCT/ITEM ("canned-tomatoes", "olive-oil"): what kind to get, plus the non-obvious "how to tell if it\'s good/ripe" judgments, surfaced while shopping. Map a just-bought item, a recipe step, or a thing on the grocery list to the right slug with your own world knowledge (cilantro → tender-herbs; "brown the beef" → browning-meat; canned tomatoes on the list → canned-tomatoes), then call read_guidance for the relevant ones. An absent tree yields an empty listing, not an error.',
      inputSchema: { domain: z.string().optional() },
    },
    ({ domain }) => runTool(() => listGuidance(corpus, domain)),
  );

  server.registerTool(
    "read_guidance",
    {
      description:
        "Read curated guidance content for the named slugs within a domain (from list_guidance). Returns { domain, entries: [{ slug, content }] } where content is the file's markdown. An unknown slug or domain yields a structured error. This is vetted, curated advice — relay any contested tip WITH the hedge written into its prose, and give NO tip for an item/step that has no matching entry (never improvise). Domains: \"ingredient_storage\", \"cooking_techniques\", \"purchasing\".",
      inputSchema: { domain: z.string(), slugs: z.array(z.string()) },
    },
    ({ domain, slugs }) => runTool(() => readGuidance(corpus, domain, slugs)),
  );

  server.registerTool(
    "save_guidance",
    {
      description:
        "Create or REFINE a single guidance memory (one file per slug — refining overwrites, never appends; read the existing entry first and merge). The \"cooking_techniques\" and \"purchasing\" domains are writable; a write to \"ingredient_storage\" (curated, read-only) is rejected with validation_failed. `content` is the full markdown you compose — distilled, imperative, non-obvious advice (with a one-line `description:` frontmatter), NOT the verbatim article. `source` (optional) records provenance (e.g. an ATK/Serious Eats URL) into the frontmatter. Use it when the member posts an article/technique or a buying guide to internalize. Returns { domain, slug, path }.",
      inputSchema: {
        domain: z.string(),
        slug: z.string(),
        content: z.string(),
        source: z.string().optional(),
      },
    },
    ({ domain, slug, content, source }) =>
      runTool(() => saveGuidance(corpus, domain, slug, content, source)),
  );

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

  server.registerTool(
    "kroger_flyer",
    {
      description:
        "Synthesized sale scan for the caller's store, served from a cache warmed in the background (the public API has no flyer/circular endpoint, and a live per-call fan-out would exceed the Worker's per-request subrequest limit). Returns `{ items, as_of }`: `items` are fulfillable products genuinely on sale (deduped by productId, each carrying every broad term that surfaced it in `matched_terms`), kept only when marked down at least `min_savings_pct` of the regular price — default 5%, applied at read so you can widen with a lower value. `as_of` is when this store's flyer was last refreshed (ISO 8601), or null when the store has not been swept yet — in which case `items` is empty, NOT an error. Explicitly non-exhaustive and may be a few hours stale; for a specific purchase the order path re-prices live. This tool takes no ad-hoc terms — checking whether a specific stockup item or substitute candidate is on sale is handled in the place-groceries flow, not here.",
      inputSchema: { filter: z.object(flyerFilterShape).optional() },
    },
    ({ filter }) =>
      runTool(async () => {
        const locationId = await getLocationId();
        // min_savings_pct is a percent (5 = 5%); convert to a fraction of regular price.
        // Fall back to the operator-configured default, then the compiled constant.
        const operatorFlyerConfig = await loadOperatorConfig(env).catch(() => null);
        const defaultDiscount = operatorFlyerConfig?.minFlyerDiscount ?? MIN_FLYER_DISCOUNT;
        const minDiscount =
          typeof filter?.min_savings_pct === "number" ? filter.min_savings_pct / 100 : defaultDiscount;
        // Pure cache read: the warm (flyer-warm.ts) stores noise-floor candidates per location at
        // the Kroger-namespaced key `flyer:kroger:{locationId}` (readStoreFlyer falls back to the
        // legacy `flyer:{locationId}` while the first namespaced sweep is pending). The 5% deal
        // floor is applied HERE so it stays caller-tunable.
        const rollup = await readStoreFlyer(env.KROGER_KV as unknown as KvStore, KROGER_STORE, locationId);
        if (!rollup) return { items: [], as_of: null };
        return { items: filterByMinSavings(rollup.items, minDiscount), as_of: new Date(rollup.as_of).toISOString() };
      }),
  );

  server.registerTool(
    "store_flyer",
    {
      description:
        "Synthesized sale scan for the caller's PRIMARY fulfillment store — Kroger or a satellite-scanned store — served from a background-warmed cache (never a live fetch). Returns `{ items, as_of }` in the SAME shape as kroger_flyer: `items` are fulfillable products genuinely on sale (deduped by productId), kept only when marked down at least `min_savings_pct` of the regular price (default 5%, applied at read so you can widen with a lower value); `as_of` is when this store's flyer was last refreshed (ISO 8601), or null when it has not been scanned yet — in which case `items` is empty, NOT an error. A satellite-scanned store's rollup that is older than the operator's staleness ceiling reads as empty (with `as_of` still surfaced) rather than steering on stale sales. Resolves the store from the caller's profile (`stores.primary` + `stores.preferred_location`); Kroger and satellite sales are indistinguishable here except by which store they came from. Issues no flyer FAN-OUT subrequest (the background sweep already did that) — a pure cache read; for a Kroger primary, resolving the `preferred_location` to a numeric locationId may cost one Kroger Locations API call, exactly like kroger_flyer (a satellite store's label IS its rollup locationId, so it needs none). Use this as the general menu-gen flyer read; kroger_flyer remains the Kroger-specific read.",
      inputSchema: { filter: z.object(flyerFilterShape).optional() },
    },
    ({ filter }) =>
      runTool(async () => {
        // Resolve the caller's primary fulfillment store (slug + location). A missing/unresolvable
        // store degrades to empty items (never an error) — the same posture as a cold cache. No
        // external store subrequest is issued for a satellite store (its label IS the locationId);
        // a Kroger store resolves its location exactly as kroger_flyer does.
        const target = await resolveStoreFlyerTarget().catch(() => null);
        if (!target) return { items: [], as_of: null };
        const { store, locationId } = target;

        const operatorConfig = await loadOperatorConfig(env).catch(() => null);
        const defaultDiscount = operatorConfig?.minFlyerDiscount ?? MIN_FLYER_DISCOUNT;
        const minDiscount =
          typeof filter?.min_savings_pct === "number" ? filter.min_savings_pct / 100 : defaultDiscount;

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

  server.registerTool(
    "ready_to_eat_available",
    {
      description:
        "Cross-reference the caller's personal ready-to-eat catalog against Kroger availability. Each available catalog item carries the FULL list of fulfillable matching products (relevance-ranked, with price + on-sale + curbside/delivery) so you can pick the right/cheapest one. 'Available' means fulfillable via curbside or delivery — the public API exposes no live in-store stock. An empty or absent catalog returns empty lists.",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        const locationId = await getLocationId();
        const available: Record<string, unknown[]> = { breakfast: [], lunch: [], dinner: [] };
        const unavailable: unknown[] = [];

        const items = (await readProfile(env, tenant.id)).ready_to_eat;
        // One Kroger search per catalog item, run concurrently (bounded by the
        // client cap); bucket from the ordered results so output stays stable.
        const looked = await Promise.all(
          items.map(async (item) => {
            if (typeof item.name !== "string") return null;
            if (item.reject) return null;
            const meal =
              typeof item.meal === "string" && (READY_TO_EAT_MEALS as readonly string[]).includes(item.meal)
                ? item.meal
                : "dinner";
            const candidates = await kroger.search(item.name, { locationId, limit: 50 });
            const products = candidates.filter(isFulfillable).map(productRow);
            return { item, meal, products };
          }),
        );
        for (const r of looked) {
          if (!r) continue;
          if (r.products.length > 0) {
            available[r.meal].push({ name: r.item.name, slug: r.item.slug ?? null, meal: r.meal, products: r.products });
          } else {
            unavailable.push({
              name: r.item.name,
              slug: r.item.slug ?? null,
              meal: r.meal,
              catalog_sku: typeof r.item.sku === "string" ? r.item.sku : null,
            });
          }
        }
        return { available, unavailable };
      }),
  );

  server.registerTool(
    "compare_unit_price",
    {
      description:
        "Deterministic price-per-unit comparison from raw price + size strings. The LLM never does the arithmetic. Ranks only WITHIN a dimension (volume/weight/count); cross-dimension or unparseable items land in incomparable, where the LLM may add quantity_override/unit_override and re-call.",
      inputSchema: { items: z.array(z.object(unitPriceItemShape)) },
    },
    ({ items }) => runTool(async () => compareUnitPrice(items)),
  );

  server.registerTool(
    "match_ingredient_to_kroger_sku",
    {
      description:
        "Run the resolve-only 7-step matching pipeline for one ingredient. Returns a confident match, OR the FULL set of ambiguous candidates (every fulfillable product for the term, relevance-ranked — not truncated, so you can list/compare them all without re-searching), OR unavailable. Never writes the cache (that rides place_order) and never substitutes — when a swap is wanted, enumerate candidate ingredients from world knowledge and resolve each. bypass_cache forces re-resolution.",
      inputSchema: {
        ingredient: z.string(),
        context: z.object(matchContextShape).optional(),
        bypass_cache: z.boolean().optional(),
      },
    },
    ({ ingredient, context, bypass_cache }) =>
      runTool(() => resolveIngredient(ingredient, context ?? {}, bypass_cache ?? false)),
  );

  // Repo-data write tools route by category internally (objective recipe content →
  // R2 corpus store; personal profile/overlay → D1 profile tables; session state
  // pantry → D1 pantry table), so they take the corpus store + D1 (env) + tenant id.
  registerWriteTools(server, corpus, env, tenant.id);
  registerGroceryListTools(server, env, tenant.id);

  // Night-vibe palette CRUD (per-tenant): the durable "shape of a week" propose_meal_plan
  // samples. Private profile data, siblings of staples/stockup.
  registerNightVibeTools(server, env, tenant.id);

  // propose_meal_plan: the two-level planner over the palette. Reuses the search-context
  // closures (overlay / last_cooked / owned / aliases) so its ranking matches search_recipes.
  registerProposeMealPlanTool(server, env, tenant, {
    getOverlay,
    getLastCookedMap,
    getOwnedEquipment,
    getIngredientContext,
  });

  // Profile reconciliation: member confirm (list_/confirm_proposal) + operator-gated
  // cross-tenant surface (reconcile_read_signals / reconcile_enqueue_proposal).
  registerReconcileTools(server, env, tenant);

  // Archetype derivation: suggest_night_vibes derives + enqueues add_vibe proposals from the
  // caller's favorites + cook history (with a taste-text cold start). Never writes the palette.
  registerSuggestNightVibesTool(server, env, tenant);

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
  registerDiscoveryTools(server, corpus, env, tenant.id);

  // Recipe notes (§8): attributed annotations in the D1 `recipe_notes` table,
  // aggregated across the group at read time with the privacy WHERE (own-private +
  // group-shared), joined with the slice-4 overlay-ratings query (fully D1).
  registerNoteTools(server, tenant.id, directoryFromEnv(env), env);

  // In-store fulfillment: the shared D1 `stores` registry (identity-only CRUD,
  // unattributed) + attributed D1 `store_notes` (the recipe-notes pattern, store
  // analog) — layout lives in layout/location/stock-tagged store notes.
  registerStoreTools(server, env);
  registerStoreNoteTools(server, tenant.id, env);

  // read_to_buy — the derived to-buy view (member-app-grocery D1): one shared op with
  // the member API's GET /api/grocery/to-buy (computeToBuyView).
  server.registerTool(
    "read_to_buy",
    {
      description:
        "The DERIVED to-buy view: what an order placed right now would buy — the active grocery list ∪ the meal plan's ingredient needs − pantry on-hand, joined on canonical ingredient ids. This is the SAME set algebra `place_order` flushes, so \"what would we buy?\" has one answer; use it as the shop-time read (read_grocery_list returns only the stored rows and misses the plan's derived needs). READ-ONLY and cheap: zero Kroger calls, zero AI calls, and it writes nothing — derived lines exist only in this read; the plan is their source of truth (editing the plan changes the next read with no sync step). Returns { to_buy, pantry_covered, in_cart, underived }. `to_buy` lines carry `origin`: \"list\" (an explicit row the plan doesn't need), \"plan\" (a VIRTUAL line derived from a planned recipe — no stored row exists; add_to_grocery_list materializes/pins it under the same canonical `key` if the user edits it), or \"both\" (a stored row the plan also needs, merged with unioned `for_recipes`); derived lines default to quantity 1 with `assumed_quantity: true` (derivation is presence-only). `pantry_covered` lists the needs the pantry cancels — the same set `place_order` would return as `partials` — each with the pantry row's quantity/category/last_verified_at so you can nudge verification (\"still good?\") instead of silently skipping. `in_cart` is the current in-cart rows (the stale-cart signal: non-empty at order time means a prior order was never confirmed placed — remind the user to clear the store cart). `underived` names planned recipes whose full ingredient list is not yet derived — their items are NOT in `to_buy` (never silently dropped); offer to add them explicitly. Optional `with_aisles: true` — the ONLY parameter — additionally returns per-line `placement` (captured `aisle_number`/`aisle_description`/`aisle_side` from the shared SKU cache at the caller's Kroger location, learned from past orders; plus a `department` derived from the ingredient identity graph when no aisle is captured) and a top-level `location: { id } | null` naming the store the placements are for. Use it for the Kroger in-store walk: real captured placements beat inferred grouping. The default read's zero-Kroger guarantee is UNCHANGED; the with_aisles variant costs at most one Kroger Locations resolve (label → locationId) and ZERO product searches — with no resolvable Kroger location (walk/satellite primary), placements carry `department` only and `location` is null. Placements start sparse and converge as orders run — a line without one is honest \"unknown\", not an error.",
      inputSchema: { with_aisles: z.boolean().optional() },
    },
    (input) => runTool(() => computeToBuyView(env, tenant.id, { withAisles: input.with_aisles === true })),
  );

  // suggest_substitutions — the deterministic substitution read (member-app-
  // differentiators D1): one shared op with POST /api/grocery/substitutions, over the
  // same per-request order wiring (location, revalidation, term search).
  server.registerTool(
    "suggest_substitutions",
    {
      description:
        "Deterministic substitution suggestions for to-buy lines — READ-ONLY: it NEVER writes the cart, the SKU cache, or the grocery list; nothing is applied implicitly. Acting on a suggestion is a separate, explicit call: a same-identity swap (different SKU, same ingredient) is a `place_order` `overrides` entry; a cross-ingredient swap is the existing list writes (add the replacement + remove the row, or — for a plan-derived virtual line — add the replacement and pass an order-scoped `exclude` for the original). Input: `names` (optional — omitted means the caller's current derived to-buy set, in view order; supplied names resolve through the ingredient funnel) and `max_lines` (default and cap " +
        `${MAX_SUBSTITUTION_LINES}` +
        "). Per line it returns: `current` — the cached SKU pick revalidated live (fresh price/availability/aisle) with `status` ok | current_unavailable | no_cached_pick; `alternatives` — same-ingredient products from ONE term search, fulfillable only, ranked by the unit-price core, each carrying a CLOSED reason vocabulary and nothing else: `cheaper` (strictly lower unit price than the current pick, only when both are comparable in one size dimension — real numbers ride along as `unit_price`/`base_unit`), `on_sale` (a genuine promo discount), `in_stock` (fulfillable while the current pick is not). Qualitative reasons (\"lower fat\", \"better fit\") are NOT produced here — that judgment is yours, grounded in this data. `siblings` — cross-ingredient suggestions from a depth-1 walk over the persisted ingredient identity graph, each LABELED with its relation (`satisfies` = the graph says it can be used where the line's ingredient is requested; `sibling` = co-variant under a shared parent, named in `via`; `generalization` = the base form), annotated `in_pantry` (already on hand — often the best swap) and `on_sale_hint` (the primary store's warmed flyer rollup at the default sale floor; no live price check — verify with kroger_prices before promising a price). The walk proposes and NAMES the relation; whether a sibling fits the dish is the caller's judgment. Budget: at most one revalidation + one search per line, `max_lines` lines per call — unprocessed names return in `remaining`; call again with them to continue. A caller with no resolvable Kroger location still gets the graph half: `location: null`, empty price sections, siblings/pantry/flyer served. Empty `alternatives` AND `siblings` for every line means there is genuinely nothing to suggest — say so rather than inventing swaps.",
      inputSchema: {
        names: z.array(z.string()).optional(),
        max_lines: z.number().int().positive().optional(),
      },
    },
    (input) => runTool(() => suggestSubstitutions(env, tenant.id, input, orderWiring)),
  );

  // place_order — the order-time flush: resolve the list, write the Kroger cart,
  // persist learned SKUs to the SHARED cache. The one tool that reaches the cart.
  registerOrderTools(server, env, tenant.id, orderWiring);

  // get_weather_forecast — read-only Open-Meteo fetch; location resolved from
  // the caller's preferences (location_zip → parse preferred_location). Used by
  // the meal-plan flow as silent context for weather-appropriate recipe selection.
  server.registerTool(
    "get_weather_forecast",
    {
      description:
        "Fetch a daily weather forecast for the user's location (resolved from preferences.location_zip, or parsed from preferred_location). Returns high/low temps, precipitation chance, and meal_vibes hints (no-grill, comfort, soup, grill-friendly, light) per day. Use as silent context in meal planning — weight meal_vibes as soft hints when assigning recipes to planned_for dates; do not narrate the weather to the user unless asked. Structured errors: no_location (ZIP not resolvable from preferences), forecast_unavailable (Open-Meteo unreachable), no_results (location string geocoded to nothing).",
      inputSchema: {
        days: z
          .number()
          .int()
          .optional()
          .describe("Number of forecast days to return (default 7, max 16)."),
      },
    },
    ({ days }) => runTool(() => resolveTenantForecast(env, tenant.id, days ?? 7)),
  );

  // report_bug — record an attributed bug report into the D1 `bug_reports` table the
  // operator reviews via the admin panel (the GitHub App / issues path is gone for
  // data). Identity + timestamp are stamped server-side, never trusted from the agent.
  server.registerTool(
    "report_bug",
    {
      description:
        "File a bug report to the operator's review queue, on behalf of the user (who can't file issues themselves). Use it when a grocery-mcp tool errors in a way you can't work around, or when the user has had to repeatedly correct or redirect you on the same thing. Write a specific, reproducible report. The server attributes the report to the caller and timestamps it — don't add identity yourself. The operator sees it in their admin panel. Returns { filed: true }.",
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
