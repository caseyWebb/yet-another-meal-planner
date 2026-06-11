// Registers the six repo-data read tools on an McpServer. Each tool reads via
// the shared GitHub client and returns a structured result; failures map to the
// structured-error convention (errors.ts).

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
import { registerNoteTools } from "./notes-tools.js";
import { registerCookingTools } from "./cooking-tools.js";
import { filterRecipes, type RecipeFilters, type RecipeIndex } from "./recipes.js";
import { listStorageGuidance, readStorageGuidance } from "./storage-guidance.js";
import { parseOverlay, mergeOverlay, type Overlay } from "./overlay.js";
import { toInventory } from "./kitchen.js";
import { entriesOf, deriveLastCooked } from "./cooking-log.js";
import { createKrogerClient, type KrogerCandidate } from "./kroger.js";
import {
  matchIngredient,
  isFulfillable,
  isOnSale,
  isFlyerWorthy,
  type CachedMapping,
  type MatchContext,
  type MatchDeps,
  type MatchResult,
} from "./matching.js";
import { compareUnitPrice, type UnitPriceItem } from "./unit-price.js";
import { parseRecipeIngredient, extractIngredientLines, type ParsedIngredient } from "./recipe-ingredients.js";
import {
  parseSubstitutionRules,
  mergeSubstitutionRules,
  findRule,
  proposeInventory,
  proposeSale,
  type SubRule,
  type SubstitutionResult,
} from "./substitutions.js";
import {
  verifyParsedIngredients,
  aggregateVerifications,
  type PantryItem,
  type VerifyResult,
} from "./pantry-verify.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const recipeFiltersShape = {
  status: z.string().optional(),
  protein: z.string().optional(),
  cuisine: z.string().optional(),
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
  against_substitutions: z.boolean().optional(),
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
    tenant.installationId,
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

  /** Read and parse pantry items; empty/comment-only pantry yields []. */
  async function getPantryItems(): Promise<PantryItem[]> {
    const text = await readFile(gh, "pantry.toml", "not_found", "no pantry is set up");
    const parsed = parseToml(text, "pantry.toml");
    return Array.isArray(parsed.items) ? (parsed.items as PantryItem[]) : [];
  }

  /**
   * Read standing substitution rules: the shared corpus rules joined with this
   * tenant's optional personal override layer (`users/<id>/substitutions.toml`).
   * A personal rule for an ingredient wins over the shared rule for that tenant
   * only (§7.2). Absent/empty files yield [].
   */
  async function getSubstitutionRules(): Promise<SubRule[]> {
    const [sharedText, overrideText] = await Promise.all([
      readOptional(sharedGh, "substitutions.toml"),
      readOptional(gh, "substitutions.toml"),
    ]);
    const shared = sharedText ? parseSubstitutionRules(parseToml(sharedText, "substitutions.toml")) : [];
    if (!overrideText) return shared;
    const override = parseSubstitutionRules(parseToml(overrideText, "substitutions.toml"));
    return mergeSubstitutionRules(shared, override, await getAliases());
  }

  /** Parse a recipe's `## Ingredients` section into normalized ingredients. */
  async function getRecipeIngredients(
    slug: string,
    aliases: Record<string, string>,
  ): Promise<ParsedIngredient[]> {
    if (!SLUG_RE.test(slug)) throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
    const text = await readFile(sharedGh, `recipes/${slug}.md`, "not_found", `Unknown recipe slug: ${slug}`);
    const { body } = parseMarkdown(text, `recipes/${slug}.md`);
    const lines = extractIngredientLines(body);
    if (lines === null) {
      throw new ToolError("malformed_data", `recipe ${slug} has no '## Ingredients' section`, { slug });
    }
    return lines.map((line) => parseRecipeIngredient(line, aliases));
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
        "List recipes from the index, filtered. To find recipes by name or keyword (including a named dish), use `query` — the single text search over title AND tags: it keeps recipes whose title or tags contain EVERY token (case-insensitive substring), after dropping connective stopwords (so \"chicken and rice\" matches the same as \"chicken rice\", including a recipe titled \"Chicken and Rice\" whose tags omit \"rice\"). There is no tag filter. Array filters season/dietary match ALL listed values. status defaults to 'active'; pass 'all' to include every status. exclude_cooked_within_days is a caller-supplied window. A makeability gate is applied by default: recipes needing equipment the caller doesn't own (per kitchen.toml) are hidden — unless the caller has no kitchen inventory recorded, in which case nothing is gated. Pass include_unmakeable:true to instead return those recipes annotated with missing_equipment (use this when surfacing a specifically NAMED dish so it is never silently dropped).",
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
        return { recipes: filterRecipes(effective, (filters ?? {}) as RecipeFilters, new Date(), owned) };
      }),
  );

  server.registerTool(
    "read_recipe",
    {
      description: "Read a single recipe's parsed frontmatter and markdown body by slug.",
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
    "read_preferences",
    {
      description: "Return the user's parsed preferences.",
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
      description: "Return the user's taste profile narrative (markdown).",
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
      description: "Return the user's diet-principles narrative (variety rules, markdown).",
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
        const prices = [];
        for (const ingredient of ingredients) {
          const candidates = await kroger.search(ingredient, { locationId, limit: 50 });
          // Every fulfillable product for the term — the LLM judges across them.
          const products = candidates.filter(isFulfillable).map(productRow);
          prices.push({ ingredient, products });
        }
        return { prices };
      }),
  );

  server.registerTool(
    "kroger_flyer",
    {
      description:
        "Synthesized sale scan (the public API has no flyer/circular endpoint). Scans precise context terms (passed plus stockup/substitution candidates) and broad curated category terms, keeps only MEANINGFUL discounts (on sale AND at least 5% off — so neither Kroger's promo==regular non-sale echo nor penny/near-zero markdowns leak through), dedupes by productId. Explicitly non-exhaustive: each term returns a relevance-ranked page, not a discount-sorted one.",
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
        if (f.against_substitutions) {
          const text = await readOptional(sharedGh, "substitutions.toml");
          if (text) {
            const rules = (parseToml(text, "substitutions.toml").rules as Record<string, unknown>[]) ?? [];
            for (const r of rules) {
              if (typeof r.ingredient === "string") precise.push(r.ingredient);
              if (Array.isArray(r.acceptable_substitutes)) {
                for (const s of r.acceptable_substitutes as unknown[]) {
                  if (typeof s === "string") precise.push(s);
                }
              }
            }
          }
        }

        // Broad terms: degrade gracefully when flyer_terms.toml is absent or empty.
        const broad: string[] = [];
        const flyerText = await readOptional(sharedGh, "flyer_terms.toml");
        if (flyerText) {
          const parsed = parseToml(flyerText, "flyer_terms.toml");
          if (Array.isArray(parsed.terms)) {
            for (const t of parsed.terms as unknown[]) if (typeof t === "string") broad.push(t);
          }
        }

        const terms = [...new Set([...precise, ...broad].map((t) => t.trim()).filter(Boolean))];

        const PAGES = 2;
        const LIMIT = 20;
        const seen = new Map<string, unknown>();
        for (const term of terms) {
          for (let page = 0; page < PAGES; page++) {
            const candidates = await kroger.search(term, {
              locationId,
              limit: LIMIT,
              start: page * LIMIT,
            });
            if (candidates.length === 0) break;
            for (const c of candidates) {
              if (isFlyerWorthy(c) && isFulfillable(c) && !seen.has(c.productId)) {
                seen.set(c.productId, {
                  sku: c.productId,
                  brand: c.brand,
                  description: c.description,
                  size: c.size,
                  price: c.price,
                  savings: Math.round((c.price.regular - c.price.promo) * 100) / 100,
                  categories: c.categories,
                  matched_term: term,
                });
              }
            }
          }
        }
        return { items: [...seen.values()] };
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
        for (const item of items) {
          if (typeof item.name !== "string") continue;
          if (item.status === "rejected") continue;
          const meal = READY_TO_EAT_MEALS.includes(item.meal as (typeof READY_TO_EAT_MEALS)[number])
            ? (item.meal as string)
            : "dinner";
          const candidates = await kroger.search(item.name, { locationId, limit: 50 });
          const products = candidates.filter(isFulfillable).map(productRow);
          if (products.length > 0) {
            available[meal].push({ name: item.name, slug: item.slug ?? null, meal, products });
          } else {
            unavailable.push({
              name: item.name,
              slug: item.slug ?? null,
              meal,
              catalog_sku: typeof item.sku === "string" ? item.sku : null,
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
    ({ items }) => runTool(async () => compareUnitPrice(items as UnitPriceItem[])),
  );

  server.registerTool(
    "match_ingredient_to_kroger_sku",
    {
      description:
        "Run the resolve-only 7-step matching pipeline for one ingredient. Returns a confident match, OR the FULL set of ambiguous candidates (every fulfillable product for the term, relevance-ranked — not truncated, so you can list/compare them all without re-searching), OR unavailable. Never writes the cache (that rides write_cart_and_commit) and never substitutes (that's propose_substitutions). bypass_cache forces re-resolution.",
      inputSchema: {
        ingredient: z.string(),
        context: z.object(matchContextShape).optional(),
        bypass_cache: z.boolean().optional(),
      },
    },
    ({ ingredient, context, bypass_cache }) =>
      runTool(() => resolveIngredient(ingredient, context ?? {}, bypass_cache ?? false)),
  );

  server.registerTool(
    "verify_pantry_for_recipe",
    {
      description:
        "Walk a recipe's parsed ingredients against the pantry. Returns facts, not freshness verdicts: in_pantry (exact matches, with age metadata for the agent's 'still good?' judgment), possible_matches (fuzzy candidates the agent confirms), not_in_pantry (to-buy), optional (non-blocking), inventory_substitutes_available. No have_stale bucket — the tool never classifies freshness, and never auto-matches a fuzzy candidate.",
      inputSchema: { slug: z.string() },
    },
    ({ slug }) =>
      runTool(async () => {
        const aliases = await getAliases();
        const [parsed, pantry, rules] = await Promise.all([
          getRecipeIngredients(slug, aliases),
          getPantryItems(),
          getSubstitutionRules(),
        ]);
        return verifyParsedIngredients(parsed, pantry, rules, aliases);
      }),
  );

  server.registerTool(
    "verify_pantry_for_candidates",
    {
      description:
        "Aggregate verify_pantry_for_recipe across several candidate recipes (open-ended menu requests). Same shape, deduped by ingredient name; not_in_pantry / possible_matches / inventory_substitutes_available carry for_recipes attribution.",
      inputSchema: { slugs: z.array(z.string()) },
    },
    ({ slugs }) =>
      runTool(async () => {
        const aliases = await getAliases();
        const [pantry, rules] = await Promise.all([getPantryItems(), getSubstitutionRules()]);
        const perRecipe: { slug: string; result: VerifyResult }[] = [];
        for (const slug of slugs) {
          const parsed = await getRecipeIngredients(slug, aliases);
          perRecipe.push({ slug, result: verifyParsedIngredients(parsed, pantry, rules, aliases) });
        }
        return aggregateVerifications(perRecipe);
      }),
  );

  server.registerTool(
    "propose_substitutions",
    {
      description:
        "Apply the standing substitution rules deterministically, returning { substitutes, unacceptable } for the agent to present for confirmation (never auto-applies). mode 'inventory' surfaces rule-acceptable substitutes present in the pantry; mode 'sale' fetches Kroger prices internally and surfaces rule-acceptable substitutes on sale. Empty result when no rule matches (dormant until substitution rules are seeded).",
      inputSchema: { ingredient: z.string(), mode: z.enum(["inventory", "sale"]) },
    },
    ({ ingredient, mode }) =>
      runTool(async (): Promise<SubstitutionResult> => {
        const aliases = await getAliases();
        const rules = await getSubstitutionRules();
        const rule = findRule(rules, ingredient, aliases);
        if (!rule) return { substitutes: [], unacceptable: [] };

        if (mode === "inventory") {
          const pantry = await getPantryItems();
          const names = pantry.map((it) => (typeof it.name === "string" ? it.name : "")).filter(Boolean);
          return proposeInventory(rule, names, aliases);
        }

        // sale: keep rule-acceptable substitutes that are on sale at the location.
        const locationId = await getLocationId();
        return proposeSale(rule, async (sub) => {
          // Widen the pool so an on-sale match deeper than the first few isn't missed.
          const candidates = await kroger.search(sub, { locationId, limit: 50 });
          return candidates.filter(isFulfillable).some((c) => isOnSale(c));
        });
      }),
  );

  // Repo-data write tools route by category internally (content → shared root,
  // personal/overlay → users/<username>/), so they take the ROOT client + the
  // caller's prefix. The grocery list is personal, so it takes the prefixed client.
  registerWriteTools(server, sharedGh, tenant.userPrefix);
  registerGroceryListTools(server, gh);

  // Cooking history + meal plan: read_meal_plan (resume) and retrospective.
  // The corresponding writes ride commit_changes (cooking_log_entries / meal_plan_ops).
  registerCookingTools(server, gh, sharedGh);

  // Discovery: RSS recipe candidates, parse-only URL import, draft create. Recipes
  // are SHARED content (root client); only feeds.toml is this tenant's personal
  // config (prefixed client). Imports dedupe by source URL against the shared
  // corpus so a recipe is reused, not duplicated (§6.4).
  registerDiscoveryTools(server, sharedGh);

  // Recipe notes (§8): attributed annotations authored in this tenant's subtree,
  // aggregated across the group at read time (KV tenant directory → each subtree).
  registerNoteTools(server, sharedGh, gh, tenant.id, directoryFromEnv(env));

  // place_order — the order-time flush: resolve the list, write the Kroger cart,
  // persist learned SKUs to the SHARED cache. The one tool that reaches the cart.
  registerOrderTools(server, gh, sharedGh, env, tenant.id, resolveIngredient, getLocationId);

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
