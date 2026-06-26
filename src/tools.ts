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
import { createGitHubClient, GitHubError } from "./github.js";
import { createInstallationAuth } from "./github-app.js";
import { readFile } from "./gh-read.js";
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
import { loadRecipeIndex, loadRecipeEmbeddings } from "./recipe-index.js";
import { embedTexts } from "./embedding.js";
import {
  rankCandidates,
  resolveRankParams,
  DEFAULT_K,
  MAX_K,
  type SearchCandidate,
} from "./semantic-search.js";
import { listStorageGuidance, readStorageGuidance } from "./storage-guidance.js";
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

// One semantic-search spec: a free-text `vibe` (embedded into the query vector), the
// hard `facets` (the SAME gate as list_recipes — they constrain, semantic rank only
// reorders within them), an echoed `label` to group results by, and an optional `k`.
const searchSpecShape = {
  vibe: z.string(),
  label: z.string(),
  facets: z.object(recipeFiltersShape).optional(),
  k: z.number().int().positive().optional(),
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

export function buildServer(env: Env, tenant: Tenant): McpServer {
  const server = new McpServer({ name: "grocery-mcp", version: "0.1.0" });

  // Repo access is authenticated with a short-lived GitHub App installation token
  // (D3) against the single data repo. After slice 6 the ONLY data the Worker reads
  // from GitHub is recipe markdown (everything else — profile, session, shared corpus
  // — is D1), so `sharedGh` (root paths: `recipes/`) is the only client needed.
  const installationAuth = createInstallationAuth(
    env.GITHUB_APP_ID,
    env.GITHUB_APP_PRIVATE_KEY,
    { id: tenant.installationId, owner: tenant.dataRepo.owner, repo: tenant.dataRepo.repo },
  );
  const dataGh = createGitHubClient(tenant.dataRepo, installationAuth);
  const sharedGh = dataGh;
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

  server.registerTool(
    "list_recipes",
    {
      description:
        "List recipes from the index, filtered. Returns the whole shared corpus (plus the caller's personal recipes) MINUS recipes the caller has rejected — there is no activation step and no status filter; rejected recipes are simply absent. To find recipes by name or keyword (including a named dish), use `query` — the single text search over title AND tags: it keeps recipes whose title or tags contain EVERY token (case-insensitive substring), after dropping connective stopwords (so \"chicken and rice\" matches the same as \"chicken rice\", including a recipe titled \"Chicken and Rice\" whose tags omit \"rice\"). There is no tag filter. Array filters season/dietary match ALL listed values. course is an open-vocabulary facet (main | side | dessert | breakfast | …) matched by containment — `course: 'side'` returns every recipe whose course includes 'side', including a dual-use `[main, side]` dish. exclude_cooked_within_days is a caller-supplied window. A makeability gate is applied by default: recipes needing equipment the caller doesn't own (per the caller's kitchen inventory) are hidden — unless the caller has no kitchen inventory recorded, in which case nothing is gated. Pass include_unmakeable:true to instead return those recipes annotated with missing_equipment (use this when surfacing a specifically NAMED dish so it is never silently dropped). Each returned entry carries the caller's `favorite` boolean; no status or rating.",
      inputSchema: { filters: z.object(recipeFiltersShape).optional() },
    },
    ({ filters }) =>
      runTool(async () => {
        // The shared index is the D1 `recipes` table (loadRecipeIndex rebuilds the
        // in-memory RecipeIndex from rows). An EMPTY table is a valid empty corpus —
        // it yields `{}` and the filter returns []. An UNREADABLE table throws a
        // `storage_error` from db(); remap that to `index_unavailable` (the two cases
        // the old KV key-presence check conflated).
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
        // cooking-log-derived last_cooked before filtering, so the reject hard gate
        // and the makeability gate see the caller's effective per-tenant view.
        const effective: RecipeIndex = {};
        for (const [slug, entry] of Object.entries(index)) {
          effective[slug] = {
            ...mergeOverlay(entry, overlay[slug], lastCooked.get(slug)),
            slug,
          };
        }
        return { recipes: filterRecipes(effective, filters ?? {}, new Date(), owned) };
      }),
  );

  server.registerTool(
    "recipe_semantic_search",
    {
      description:
        "Semantic recipe retrieval (experimental, semantic-meal-plan). Takes an array of search SPECS and returns ranked recipes grouped per spec, in ONE round-trip. Each spec has: `vibe` — free text describing the kind of dish wanted (\"rich cold-weather braise,\" \"bright quick weeknight fish\"), embedded and matched by meaning (NOT keyword); `facets` — the SAME hard filters as list_recipes (protein, cuisine, course, dietary, season, max_time_total, exclude_cooked_within_days, include_unmakeable, …), which CONSTRAIN the result set — semantic rank only reorders within them and can never admit a recipe a facet rejects; `label` — an arbitrary tag echoed back so you can tell each spec's results apart; optional `k` (default " +
        `${DEFAULT_K}, max ${MAX_K}). Results are re-ranked by cosine relevance to the vibe, nudged by closeness to the caller's favorites (taste direction) and by cook recency (never-cooked surfaced, recently-cooked demoted). Recipes with no embedding yet (just imported, not reconciled) are omitted — they remain findable via list_recipes. Use several diverse specs (a vibe, a variety/wildcard, a never-cooked novelty) for good recall; the makeability gate applies by default exactly as in list_recipes.`,
      inputSchema: { specs: z.array(z.object(searchSpecShape)).min(1) },
    },
    ({ specs }) =>
      runTool(async () => {
        // Shared per-request reads, once for all specs: the index + embeddings, the
        // caller's overlay (favorites) / cooking log (freshness) / owned equipment
        // (makeability gate), and preferences (rotation tuning — optional, defaults
        // when unset, so semantic search works before any profile exists).
        const [index, embeddings, overlay, lastCooked, owned, prefs] = await Promise.all([
          loadRecipeIndex(env).catch((e) => {
            throw new ToolError(
              "index_unavailable",
              `the recipe index is unavailable: ${e instanceof Error ? e.message : String(e)}`,
            );
          }),
          loadRecipeEmbeddings(env),
          getOverlay(),
          getLastCookedMap(),
          getOwnedEquipment(),
          readPreferences(env, tenant.id).catch(() => null),
        ]);

        // Merge the caller's overlay (favorite/reject) + last_cooked onto the shared
        // entries so the facet gate (including the reject hard gate) sees the effective
        // per-tenant view, exactly as list_recipes does.
        const effective: RecipeIndex = {};
        for (const [slug, entry] of Object.entries(index)) {
          effective[slug] = { ...mergeOverlay(entry, overlay[slug], lastCooked.get(slug)), slug };
        }

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

        const params = resolveRankParams(prefs);
        const now = new Date();

        // One Workers AI call for ALL spec vibes (one subrequest, not K).
        const vibeVecs = await embedTexts(
          env,
          specs.map((s) => s.vibe),
        );

        const results = specs.map((spec, i) => {
          const survivors = filterRecipes(effective, spec.facets ?? {}, now, owned);
          // Resolve each survivor's embedding + freshness; drop the unembedded (not
          // yet reconciled) — they stay browseable via list_recipes, just unranked here.
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
            });
          }
          const recipes = rankCandidates(candidates, vibeVecs[i], favoriteVecs, now, params, spec.k ?? DEFAULT_K);
          return { label: spec.label, recipes };
        });

        return { results };
      }),
  );

  server.registerTool(
    "recipe_site_url",
    {
      description:
        "Resolve the URL of the hosted recipe site (the static browse view of the shared corpus), via the data repo's GitHub Pages config. Returns { url, enabled }: enabled:true with the published url (honoring a custom domain) when Pages is on, or enabled:false (url:null) when it isn't — in which case tell the user their operator/admin needs to enable GitHub Pages on the data repo. Use it during onboarding to point a new member at the full collection.",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        try {
          return await sharedGh.getPagesUrl();
        } catch (e) {
          if (e instanceof GitHubError && e.status === 403) {
            throw new ToolError(
              "insufficient_permission",
              "the GitHub App lacks the 'Pages: read' permission needed to resolve the recipe-site URL — ask the operator to grant it",
            );
          }
          throw e;
        }
      }),
  );

  server.registerTool(
    "read_recipe",
    {
      description:
        "Read a single recipe's parsed frontmatter and markdown body by slug. Frontmatter includes `course` (the open-vocabulary dish type — main | side | dessert | breakfast | …) and `pairs_with` (slugs of sides remembered for this main).",
      inputSchema: { slug: z.string() },
    },
    ({ slug }) =>
      runTool(async () => {
        if (!SLUG_RE.test(slug)) {
          throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
        }
        const [text, overlay, lastCooked] = await Promise.all([
          readFile(sharedGh, `recipes/${slug}.md`, "not_found", `Unknown recipe slug: ${slug}`),
          getOverlay(),
          getLastCookedMap(),
        ]);
        const { frontmatter, body } = parseMarkdown(text, `recipes/${slug}.md`);
        const merged = mergeOverlay(frontmatter, overlay[slug], lastCooked.get(slug));
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
    "list_storage_guidance",
    {
      description:
        'List the curated storage-guidance classes (each a slug + an optional one-line description) from the shared storage_guidance/ tree. Slugs are storage BEHAVIOR CLASSES (e.g. "tender-herbs", "alliums", "leafy-greens"), a few singletons that break their class\'s rule ("basil", "tomatoes", "avocados"), and "_ethylene" for relational "don\'t store together" rules. Map a just-bought item to the right class with your own world knowledge (e.g. cilantro → tender-herbs), then call read_storage_guidance for the relevant ones. Returns { entries: [] } when no tree exists.',
      inputSchema: {},
    },
    () => runTool(() => listStorageGuidance(sharedGh)),
  );

  server.registerTool(
    "read_storage_guidance",
    {
      description:
        "Read the curated storage-guidance content for the named class slugs (from list_storage_guidance). Returns { entries: [{ slug, content }] } where content is the file's markdown. An unknown slug yields a structured not_found. This is vetted, curated advice — relay any contested tip WITH the hedge written into its prose, and give NO tip for an item that has no matching class (never improvise).",
      inputSchema: { slugs: z.array(z.string()) },
    },
    ({ slugs }) => runTool(() => readStorageGuidance(sharedGh, slugs)),
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
        const minDiscount =
          typeof filter?.min_savings_pct === "number" ? filter.min_savings_pct / 100 : MIN_FLYER_DISCOUNT;
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
  // shared root via GitHub; personal profile/overlay → D1 profile tables; session
  // state pantry → D1 pantry table), so they take the ROOT client + D1 (env) +
  // tenant id.
  registerWriteTools(server, sharedGh, env, tenant.id);
  registerGroceryListTools(server, env, tenant.id);

  // Cooking history + meal plan: read_meal_plan (resume), update_meal_plan, and
  // retrospective. Meal plan reads/writes go through the D1 `meal_plan` table; the
  // cooking log is the D1 `cooking_log` table. log_cooked appends a cooking event and
  // clears the cooked recipe from the meal plan in ONE D1 transaction (slice 5).
  registerCookingTools(server, env, tenant.id);
  registerCookingWriteTools(server, env, tenant.id);

  // Discovery: RSS recipe candidates, parse-only URL import, draft create, plus the
  // feeds/sources config writers. Everything here is SHARED (root client) — recipes,
  // feeds.toml, the discoveries inbox, and discovery_sources.toml all live at the
  // data-repo root, so any member's config feeds one group pool. Imports dedupe by
  // source URL against the shared corpus so a recipe is reused, not duplicated (§6.4).
  registerDiscoveryTools(server, sharedGh, env, tenant.id);

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
  registerOrderTools(server, env, tenant.id, resolveIngredient, getLocationId);

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

  // report_bug — file an attributed GitHub issue on the operator's PRIVATE data
  // repo on the member's behalf (members have no GitHub account). Identity +
  // timestamp + label are added server-side, not trusted from the agent. Issues
  // are repo-level, so this uses the un-prefixed dataGh.
  server.registerTool(
    "report_bug",
    {
      description:
        "File a bug report as a GitHub issue on the maintainer's private repo, on behalf of the user (who has no GitHub account and can't file issues). Use it when a grocery-mcp tool errors in a way you can't work around, or when the user has had to repeatedly correct or redirect you on the same thing. Write a specific, reproducible report. The server attributes the issue to the caller and labels it — don't add identity yourself. Returns the issue url + number, or `insufficient_permission` if the maintainer hasn't enabled issue filing yet.",
      inputSchema: {
        title: z.string().describe("A short, specific issue title."),
        body: z
          .string()
          .describe(
            "What you were doing, what went wrong (the error or the correction pattern), and the tools/inputs involved — enough for the maintainer to reproduce.",
          ),
      },
    },
    ({ title, body }) =>
      runTool(async () => {
        const trailer = `\n\n---\n_Filed by the grocery agent on behalf of **${tenant.id}** at ${new Date().toISOString()}._`;
        try {
          return await dataGh.createIssue(title, `${body}${trailer}`, ["agent-reported"]);
        } catch (e) {
          if (e instanceof GitHubError && e.status === 403) {
            throw new ToolError(
              "insufficient_permission",
              "Could not file the issue: the GitHub App has not been granted Issues:write on the data repo yet.",
            );
          }
          throw e; // runTool maps other failures to upstream_unavailable
        }
      }),
  );

  return server;
}
