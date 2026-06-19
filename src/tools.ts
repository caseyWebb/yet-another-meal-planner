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
import { createGitHubClient, prefixedClient, GitHubError } from "./github.js";
import { createInstallationAuth } from "./github-app.js";
import { readFile, readOptional } from "./gh-read.js";
import { parseMarkdown, parseToml } from "./parse.js";
import { ToolError, runTool } from "./errors.js";
import { registerWriteTools } from "./write-tools.js";
import { registerGroceryListTools } from "./grocery-tools.js";
import { registerOrderTools } from "./order-tools.js";
import { registerDiscoveryTools } from "./discovery-tools.js";
import { registerNoteTools, registerStoreNoteTools } from "./notes-tools.js";
import { registerStoreTools } from "./stores-tools.js";
import { registerCookingTools } from "./cooking-tools.js";
import { filterRecipes, type RecipeIndex } from "./recipes.js";
import { listStorageGuidance, readStorageGuidance } from "./storage-guidance.js";
import { fetchWeatherForecast } from "./weather.js";
import { parseStaples, STAPLES_PATH } from "./staples.js";
import { profileStatus } from "./profile-status.js";
import { parseOverlay, mergeOverlay, type Overlay } from "./overlay.js";
import { toInventory } from "./kitchen.js";
import { entriesOf, deriveLastCooked } from "./cooking-log.js";
import { createKrogerClient, type KrogerCandidate } from "./kroger.js";
import {
  matchIngredient,
  isFulfillable,
  isOnSale,
  isFlyerWorthy,
  dedupeFlyerHits,
  MIN_FLYER_DISCOUNT,
  type CachedMapping,
  type MatchContext,
  type MatchDeps,
  type MatchResult,
} from "./matching.js";
import { compareUnitPrice } from "./unit-price.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const recipeFiltersShape = {
  status: z.string().optional(),
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

const pantryFilterShape = {
  category: z.string().optional(),
  prepared_only: z.boolean().optional(),
  stale_only: z.boolean().optional(),
};

const flyerFilterShape = {
  terms: z.array(z.string()).optional(),
  against_stockup: z.boolean().optional(),
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
  };
}

export function buildServer(env: Env, tenant: Tenant): McpServer {
  const server = new McpServer({ name: "grocery-mcp", version: "0.1.0" });

  // Repo access is authenticated with a short-lived GitHub App installation token
  // (D3) against the single data repo. `sharedGh` addresses root paths (objective
  // content `recipes/`, reference data, SKU cache, indexes); `gh` is the same repo
  // wrapped to address this tenant's `users/<username>/` subtree (personal state,
  // overlay, notes). One repo, two path views — never another tenant's subtree.
  const installationAuth = createInstallationAuth(
    env.GITHUB_APP_ID,
    env.GITHUB_APP_PRIVATE_KEY,
    { id: tenant.installationId, owner: tenant.dataRepo.owner, repo: tenant.dataRepo.repo },
  );
  const dataGh = createGitHubClient(tenant.dataRepo, installationAuth);
  const sharedGh = dataGh;
  const gh = prefixedClient(dataGh, tenant.userPrefix);
  const kroger = createKrogerClient(env);

  // Per-request lazy caches: preferences is read once, the location resolved once,
  // even when several priced tools run in the same request.
  let prefsPromise: Promise<Record<string, unknown>> | null = null;
  function getPreferences(): Promise<Record<string, unknown>> {
    if (!prefsPromise) {
      prefsPromise = (async () => {
        const text = await readFile(gh, "preferences.toml", "not_found", "no preferences are set up");
        return parseToml(text, "preferences.toml");
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
      aliasesPromise = (async () => {
        const aliasText = await readOptional(sharedGh, "aliases.toml");
        return aliasText !== null
          ? ((parseToml(aliasText, "aliases.toml").aliases as Record<string, string>) ?? {})
          : {};
      })();
    }
    return aliasesPromise;
  }

  async function getCacheMappings(): Promise<CachedMapping[]> {
    const cacheText = await readOptional(sharedGh, "skus/kroger.toml");
    const cache: CachedMapping[] = [];
    if (cacheText) {
      const mappings = (parseToml(cacheText, "skus/kroger.toml").mappings as Record<string, unknown>[]) ?? [];
      for (const m of mappings) {
        if (typeof m.ingredient === "string" && typeof m.sku === "string") {
          cache.push({
            ingredient: m.ingredient,
            sku: m.sku,
            brand: typeof m.brand === "string" ? m.brand : undefined,
            size: typeof m.size === "string" ? m.size : undefined,
            locationId: typeof m.locationId === "string" ? m.locationId : undefined,
          });
        }
      }
    }
    return cache;
  }

  // Per-request lazy reads of the caller's subjective layer (on the personal
  // client `gh`, so they resolve under users/<username>/). The overlay supplies
  // rating+status; the cooking log supplies last_cooked. Both are merged onto
  // shared recipe content at read time (§6.2).
  let overlayPromise: Promise<Overlay> | null = null;
  function getOverlay(): Promise<Overlay> {
    if (!overlayPromise) {
      overlayPromise = (async () => {
        const text = await readOptional(gh, "overlay.toml");
        return text ? parseOverlay(text) : {};
      })();
    }
    return overlayPromise;
  }

  let lastCookedPromise: Promise<Map<string, string>> | null = null;
  function getLastCookedMap(): Promise<Map<string, string>> {
    if (!lastCookedPromise) {
      lastCookedPromise = (async () => {
        const text = await readOptional(gh, "cooking_log.toml");
        return text
          ? deriveLastCooked(entriesOf(parseToml(text, "cooking_log.toml")))
          : new Map<string, string>();
      })();
    }
    return lastCookedPromise;
  }

  // The caller's owned equipment (kitchen.toml `owned`), the makeability gate's
  // left operand. Empty/absent ⇒ unknown inventory ⇒ the gate is a no-op.
  let ownedPromise: Promise<string[]> | null = null;
  function getOwnedEquipment(): Promise<string[]> {
    if (!ownedPromise) {
      ownedPromise = (async () => {
        const text = await readOptional(gh, "kitchen.toml");
        return text ? toInventory(parseToml(text, "kitchen.toml")).owned : [];
      })();
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
    const prefs = await getPreferences();
    const brands = (prefs.brands as Record<string, string[]> | undefined) ?? {};
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
        "List recipes from the index, filtered. To find recipes by name or keyword (including a named dish), use `query` — the single text search over title AND tags: it keeps recipes whose title or tags contain EVERY token (case-insensitive substring), after dropping connective stopwords (so \"chicken and rice\" matches the same as \"chicken rice\", including a recipe titled \"Chicken and Rice\" whose tags omit \"rice\"). There is no tag filter. Array filters season/dietary match ALL listed values. status defaults to 'active'; pass 'all' to include every status. course is an open-vocabulary facet (main | side | dessert | breakfast | …) matched by containment — `course: 'side'` returns every recipe whose course includes 'side', including a dual-use `[main, side]` dish. exclude_cooked_within_days is a caller-supplied window. A makeability gate is applied by default: recipes needing equipment the caller doesn't own (per kitchen.toml) are hidden — unless the caller has no kitchen inventory recorded, in which case nothing is gated. Pass include_unmakeable:true to instead return those recipes annotated with missing_equipment (use this when surfacing a specifically NAMED dish so it is never silently dropped).",
      inputSchema: { filters: z.object(recipeFiltersShape).optional() },
    },
    ({ filters }) =>
      runTool(async () => {
        const [raw, overlay, lastCooked, owned] = await Promise.all([
          readFile(
            sharedGh,
            "_indexes/recipes.json",
            "index_unavailable",
            "the recipe index is unavailable",
          ),
          getOverlay(),
          getLastCookedMap(),
          getOwnedEquipment(),
        ]);
        let index: RecipeIndex;
        try {
          index = JSON.parse(raw) as RecipeIndex;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          throw new ToolError("index_unavailable", `the recipe index is malformed: ${message}`);
        }
        // Join each shared entry with the caller's overlay (rating/status) and
        // cooking-log-derived last_cooked before filtering, so filters see the
        // caller's effective per-tenant view (effective status defaults to draft).
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
        const text = await readFile(gh, "pantry.toml", "not_found", "no pantry is set up");
        const parsed = parseToml(text, "pantry.toml");
        let items = Array.isArray(parsed.items) ? (parsed.items as Record<string, unknown>[]) : [];
        if (filter?.category !== undefined) {
          items = items.filter((i) => i.category === filter.category);
        }
        if (filter?.prepared_only) {
          items = items.filter((i) => i.prepared_from != null);
        }
        return { items };
      }),
  );

  server.registerTool(
    "read_kitchen",
    {
      description:
        "Read the caller's kitchen equipment inventory: { owned: [...EQUIPMENT_VOCAB slugs], notes: {...} }. `owned` is what gates recipe makeability; `notes` is freeform cook context (oven count, pan sizes). Returns an empty inventory when none is set up — an absent inventory means equipment is UNKNOWN, which makes the makeability gate a no-op (every recipe shows).",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        const text = await readOptional(gh, "kitchen.toml");
        if (!text) return { owned: [], notes: {} };
        return toInventory(parseToml(text, "kitchen.toml"));
      }),
  );

  server.registerTool(
    "read_staples",
    {
      description:
        "Read the caller's staples list — items they never want to run out of. Returns { items: [{ name, perishable? }] }. Returns { items: [] } when no staples.toml exists — this is not an error; staples-driven behaviors simply degrade to no-ops for that session. Call unconditionally in the meal-plan context pre-pass.",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        const text = await readOptional(gh, STAPLES_PATH);
        return { items: parseStaples(text) };
      }),
  );

  server.registerTool(
    "read_preferences",
    {
      description:
        "Return the user's parsed preferences. Throws `not_found` when none are set up yet — the empty signal for a new member, not an error.",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        const text = await readFile(
          gh,
          "preferences.toml",
          "not_found",
          "no preferences are set up",
        );
        return parseToml(text, "preferences.toml");
      }),
  );

  server.registerTool(
    "read_taste",
    {
      description:
        "Return the user's taste profile narrative (markdown). Throws `not_found` when none is set up yet — the empty signal for a new member, not an error.",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        const content = await readFile(gh, "taste.md", "not_found", "no taste profile is set up");
        return { content };
      }),
  );

  server.registerTool(
    "read_diet_principles",
    {
      description:
        "Return the user's diet-principles narrative (variety rules, markdown). Throws `not_found` when none are set up yet — the empty signal for a new member, not an error.",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        const content = await readFile(
          gh,
          "diet_principles.md",
          "not_found",
          "no diet principles are set up",
        );
        return { content };
      }),
  );

  server.registerTool(
    "profile_status",
    {
      description:
        "Report whether the caller has set up their grocery profile, from a single listing of their own subtree. Returns { initialized, missing }: `initialized` is true once preferences.toml exists (the unconditional first onboarding area); `missing` lists the onboarding-area keys still absent (store, taste, diet, equipment, pantry, ready-to-eat, stockup, corpus). A brand-new member with no files yet is { initialized: false, missing: [all areas] }. Read-only, no params. Use it as the up-front gate before doing real work — on initialized:false, run the configure-grocery-profile flow first. If this call errors, treat the result as indeterminate and proceed.",
      inputSchema: {},
    },
    () => runTool(() => profileStatus(gh)),
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
        "Current Kroger prices for each ingredient at the preferred location. Returns the FULL list of fulfillable products per ingredient (relevance-ranked) — each with { regular, promo } price, on-sale flag, and curbside/delivery availability — so you can compare across brands/sizes and pick, not just the top one. An ingredient with nothing fulfillable returns an empty products list.",
      inputSchema: { ingredients: z.array(z.string()) },
    },
    ({ ingredients }) =>
      runTool(async () => {
        const locationId = await getLocationId();
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
        "Synthesized sale scan (the public API has no flyer/circular endpoint). Scans precise context terms (passed `terms` plus, with `against_stockup`, the caller's stockup item names — including any substitute candidates the caller enumerates from world knowledge and passes in `terms`) and broad curated category terms, keeps only MEANINGFUL discounts (on sale AND at least `min_savings_pct` off — default 5%, so neither Kroger's promo==regular non-sale echo nor penny/near-zero markdowns leak through; pass a lower `min_savings_pct` to widen, e.g. for a bulk stockup item), dedupes by productId. Each kept item carries `matched_terms` — every scanned term that surfaced it — so you can tell a stockup/menu match from a broad-category one. Explicitly non-exhaustive: each term returns a relevance-ranked page, not a discount-sorted one.",
      inputSchema: { filter: z.object(flyerFilterShape).optional() },
    },
    ({ filter }) =>
      runTool(async () => {
        const locationId = await getLocationId();
        const f = filter ?? {};

        const precise = [...(f.terms ?? [])];
        if (f.against_stockup) {
          const text = await readOptional(gh, "stockup.toml");
          if (text) {
            const items = (parseToml(text, "stockup.toml").items as Record<string, unknown>[]) ?? [];
            for (const it of items) if (typeof it.name === "string") precise.push(it.name);
          }
        }
        // Broad terms: degrade gracefully when flyer_terms.toml is absent or empty.
        const broad: string[] = [];
        const flyerText = await readOptional(sharedGh, "flyer_terms.toml");
        if (flyerText) {
          const parsed = parseToml(flyerText, "flyer_terms.toml");
          if (Array.isArray(parsed.terms)) {
            for (const t of parsed.terms) if (typeof t === "string") broad.push(t);
          }
        }

        const terms = [...new Set([...precise, ...broad].map((t) => t.trim()).filter(Boolean))];

        // min_savings_pct is a percent (5 = 5%); convert to the fraction isFlyerWorthy wants.
        const minDiscount =
          typeof f.min_savings_pct === "number" ? f.min_savings_pct / 100 : MIN_FLYER_DISCOUNT;

        const PAGES = 2;
        const LIMIT = 20;
        // Scan terms concurrently (bounded by the Kroger client cap); within a term
        // keep the ≤2-page sequential walk + break-on-empty. dedupeFlyerHits then
        // merges by productId in term order, so each product carries every surfacing
        // term in matched_terms — no order-dependent first-wins to preserve.
        const perTerm = await Promise.all(
          terms.map(async (term) => {
            const found: KrogerCandidate[] = [];
            for (let page = 0; page < PAGES; page++) {
              const candidates = await kroger.search(term, {
                locationId,
                limit: LIMIT,
                start: page * LIMIT,
              });
              if (candidates.length === 0) break;
              for (const c of candidates) {
                if (isFlyerWorthy(c, minDiscount) && isFulfillable(c)) found.push(c);
              }
            }
            return { term, candidates: found };
          }),
        );
        return { items: dedupeFlyerHits(perTerm) };
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

        const text = await readOptional(gh, "ready_to_eat.toml");
        const items = text ? ((parseToml(text, "ready_to_eat.toml").items as Record<string, unknown>[]) ?? []) : [];
        // One Kroger search per catalog item, run concurrently (bounded by the
        // client cap); bucket from the ordered results so output stays stable.
        const looked = await Promise.all(
          items.map(async (item) => {
            if (typeof item.name !== "string") return null;
            if (item.status === "rejected") return null;
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

  // Repo-data write tools route by category internally (content → shared root,
  // personal/overlay → users/<username>/), so they take the ROOT client + the
  // caller's prefix. The grocery list is personal, so it takes the prefixed client.
  registerWriteTools(server, sharedGh, tenant.userPrefix);
  registerGroceryListTools(server, gh);

  // Cooking history + meal plan: read_meal_plan (resume) and retrospective.
  // The corresponding writes ride commit_changes (cooking_log_entries / meal_plan_ops).
  registerCookingTools(server, gh, sharedGh);

  // Discovery: RSS recipe candidates, parse-only URL import, draft create, plus the
  // feeds/sources config writers. Everything here is SHARED (root client) — recipes,
  // feeds.toml, the discoveries inbox, and discovery_sources.toml all live at the
  // data-repo root, so any member's config feeds one group pool. Imports dedupe by
  // source URL against the shared corpus so a recipe is reused, not duplicated (§6.4).
  registerDiscoveryTools(server, sharedGh);

  // Recipe notes (§8): attributed annotations authored in this tenant's subtree,
  // aggregated across the group at read time (KV tenant directory → each subtree).
  registerNoteTools(server, sharedGh, gh, tenant.id, directoryFromEnv(env));

  // In-store fulfillment: the shared stores/ registry (identity-only CRUD,
  // unattributed) + attributed per-tenant store notes (the recipe-notes pattern,
  // store analog) — layout lives in layout/location/stock-tagged store notes.
  registerStoreTools(server, sharedGh);
  registerStoreNoteTools(server, sharedGh, gh, tenant.id, directoryFromEnv(env));

  // place_order — the order-time flush: resolve the list, write the Kroger cart,
  // persist learned SKUs to the SHARED cache. The one tool that reaches the cart.
  registerOrderTools(server, gh, sharedGh, env, tenant.id, resolveIngredient, getLocationId);

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
        const prefsText = await readOptional(gh, "preferences.toml");
        const prefs = prefsText ? parseToml(prefsText, "preferences.toml") : {};
        const stores = prefs.stores as Record<string, unknown> | undefined;

        // Resolve location: explicit location_zip first, then parse from preferred_location.
        let zip: string | null = null;
        if (typeof prefs.location_zip === "string" && prefs.location_zip.trim()) {
          zip = prefs.location_zip.trim();
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
