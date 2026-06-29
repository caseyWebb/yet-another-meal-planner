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
import { readAliases, readSkuCache } from "./corpus-db.js";
import { ToolError, runTool } from "./errors.js";
import { registerWriteTools } from "./write-tools.js";
import { registerGroceryListTools } from "./grocery-tools.js";
import { registerOrderTools } from "./order-tools.js";
import { registerDiscoveryTools } from "./discovery-tools.js";
import { registerNoteTools, registerStoreNoteTools } from "./notes-tools.js";
import { registerStoreTools } from "./stores-tools.js";
import { registerCookingTools } from "./cooking-tools.js";
import { filterRecipes, type RecipeIndex } from "./recipes.js";
import { loadRecipeIndex, loadRecipeEmbeddings, recipeDescription } from "./recipe-index.js";
import { readReconcileErrors } from "./recipe-projection.js";
import { recordBugReport } from "./bug-reports.js";
import { embedTexts } from "./embedding.js";
import {
  rankCandidates,
  resolveRankParams,
  DEFAULT_K,
  MAX_K,
  type SearchCandidate,
} from "./semantic-search.js";
import { listGuidance, readGuidance, saveGuidance } from "./guidance.js";
import { loadOperatorConfig } from "./operator-config.js";
import { fetchWeatherForecast } from "./weather.js";
import { mergeOverlay, type Overlay } from "./overlay.js";
import { readPantry } from "./session-db.js";
import {
  readProfile,
  readPreferences,
  readOverlay,
  readOwnedEquipment,
  readBrandPrefs,
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
  normalizeIngredient,
  MIN_FLYER_DISCOUNT,
  type CachedMapping,
  type MatchContext,
  type MatchDeps,
  type MatchResult,
} from "./matching.js";
import { compareUnitPrice } from "./unit-price.js";
import { readFlyerRollup, filterByMinSavings } from "./flyer-warm.js";
import type { KvStore } from "./kroger-user.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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

/** Normalize an ingredient-name array through the alias table (lowercase/trim/alias per
 *  entry, drop empties, dedupe). Tolerates a missing/non-array/non-string value → []. The
 *  shared boundary normalizer for `search_recipes`'s pantry-overlap set math. */
function normalizeItems(value: unknown, aliases: Record<string, string>): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const norm = normalizeIngredient(entry, aliases);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

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

  let locationPromise: Promise<string> | null = null;
  function getLocationId(): Promise<string> {
    if (!locationPromise) {
      locationPromise = (async () => {
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
      })();
    }
    return locationPromise;
  }

  // Shared matcher wiring: aliases, [brands], and the SKU cache are read once and
  // reused by both match_ingredient_to_kroger_sku and place_order's resolution.
  let aliasesPromise: Promise<Record<string, string>> | null = null;
  function getAliases(): Promise<Record<string, string>> {
    if (!aliasesPromise) {
      aliasesPromise = readAliases(env);
    }
    return aliasesPromise;
  }

  async function getCacheMappings(): Promise<CachedMapping[]> {
    return readSkuCache(env);
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

  // last_cooked per recipe is now a D1 aggregation: MAX(date) over the caller's
  // type='recipe' rows, grouped by slug. An empty/absent log yields an empty map.
  let lastCookedPromise: Promise<Map<string, string>> | null = null;
  function getLastCookedMap(): Promise<Map<string, string>> {
    if (!lastCookedPromise) {
      lastCookedPromise = (async () => {
        const rows = await db(env).all<{ recipe: string; last_cooked: string }>(
          "SELECT recipe, MAX(date) AS last_cooked FROM cooking_log " +
            "WHERE tenant = ?1 AND type = 'recipe' AND recipe IS NOT NULL GROUP BY recipe",
          tenant.id,
        );
        const map = new Map<string, string>();
        for (const { recipe, last_cooked } of rows) {
          if (recipe && last_cooked) map.set(recipe, last_cooked);
        }
        return map;
      })();
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

  /** Run the resolve-only matcher for one ingredient with the shared deps. */
  async function resolveIngredient(
    ingredient: string,
    context: MatchContext = {},
    bypassCache = false,
  ): Promise<MatchResult> {
    const locationId = await getLocationId();
    const brands = await readBrandPrefs(env, tenant.id);
    const aliases = await getAliases();
    const cache = await getCacheMappings();
    const deps: MatchDeps = {
      search: (term: string): Promise<KrogerCandidate[]> =>
        // Kroger's per-request max (50) — the matcher returns the full ranked
        // fulfillable set when ambiguous, so we want the complete relevant pool.
        kroger.search(term, { locationId, limit: 50 }),
      productById: (productId: string): Promise<KrogerCandidate | null> =>
        kroger.productById(productId, locationId),
      aliases,
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
    };
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

        // Ranking path: load the embeddings + rotation prefs + operator config + alias table,
        // embed the vibe-bearing specs' vibes in ONE Workers AI call (vibe-less specs make no
        // contribution to the embed batch and stay in membership mode).
        const [embeddings, prefs, operatorConfig, aliases] = await Promise.all([
          loadRecipeEmbeddings(env),
          readPreferences(env, tenant.id).catch(() => null),
          loadOperatorConfig(env).catch(() => null),
          getAliases().catch(() => ({}) as Record<string, string>),
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
        // mix of membership and ranked specs in one call stays aligned.
        const vibeSpecs = specs
          .map((spec, i) => ({ spec, i }))
          .filter((x) => typeof x.spec.vibe === "string" && x.spec.vibe.length > 0);
        const vibeVecs = await embedTexts(
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
          // Normalize the spec's boost items through the SAME alias table the index's
          // ingredient arrays are normalized against, so the overlap is exact set math.
          const boostItems = normalizeItems(spec.boost_ingredients, aliases);
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
              ingredients_key: normalizeItems(fm.ingredients_key, aliases),
              perishable_ingredients: normalizeItems(fm.perishable_ingredients, aliases),
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
    "read_recipe",
    {
      description:
        "Read a single recipe's parsed frontmatter and markdown body by slug. Frontmatter includes `course` (the open-vocabulary dish type — main | side | dessert | breakfast | …), `pairs_with` (slugs of sides remembered for this main), and the AI-generated `description` (merged from the derived store; absent if not yet generated).",
      inputSchema: { slug: z.string() },
    },
    ({ slug }) =>
      runTool(async () => {
        if (!SLUG_RE.test(slug)) {
          throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
        }
        const [text, overlay, lastCooked, description] = await Promise.all([
          readCorpusFile(corpus, `recipes/${slug}.md`, "not_found", `Unknown recipe slug: ${slug}`),
          getOverlay(),
          getLastCookedMap(),
          recipeDescription(env, slug),
        ]);
        const { frontmatter, body } = parseMarkdown(text, `recipes/${slug}.md`);
        const merged = mergeOverlay(frontmatter, overlay[slug], lastCooked.get(slug));
        // description is a Worker-DERIVED field (recipe_derived), merged at read time alongside
        // overlay/last_cooked; null until the reconcile first generates it (never an error).
        if (description !== null) merged.description = description;
        return { slug, frontmatter: merged, body };
      }),
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
    () =>
      runTool(async () => {
        const profile = await readProfile(env, tenant.id);

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
      }),
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
        // Pure cache read: the warm (flyer-warm.ts) stores noise-floor candidates per
        // location; the 5% deal floor is applied HERE so it stays caller-tunable.
        const rollup = await readFlyerRollup(env.KROGER_KV as unknown as KvStore, locationId);
        if (!rollup) return { items: [], as_of: null };
        return { items: filterByMinSavings(rollup.items, minDiscount), as_of: rollup.as_of };
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

  // place_order — the order-time flush: resolve the list, write the Kroger cart,
  // persist learned SKUs to the SHARED cache. The one tool that reaches the cart.
  registerOrderTools(server, env, tenant.id, resolveIngredient, revalidateSku, getLocationId);

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
    ({ days }) =>
      runTool(async () => {
        const prefs = (await readPreferences(env, tenant.id)) ?? {};
        const stores = prefs.stores as Record<string, unknown> | undefined;

        // Resolve location: explicit stores.location_zip first, then parse from
        // preferred_location. (location_zip lives under `stores` in the D1 schema.)
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

        return fetchWeatherForecast(zip, days ?? 7);
      }),
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
