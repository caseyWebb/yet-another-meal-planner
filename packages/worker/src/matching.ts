// The match_ingredient_to_kroger_sku pipeline (designs D5–D9). Resolve-only: it
// returns one of three shapes (confident / ambiguous / unavailable) and NEVER
// writes the SKU cache (that rides the Change 06 batched commit) and NEVER
// substitutes (substitution is LLM reasoning over enumerated candidates, not
// this matcher). The deterministic 7-step pipeline:
//   1. alias-driven normalization
//   2. cache lookup + revalidation (no TTL)
//   3. term search
//   4. near-hard constraints: fulfillment, then identity relevance (a confident
//      pick may only come from the top relevance tier — the best ingredient match)
//   5. score by tri-state brand / best-effort dietary within that tier
//   6. deterministic tiebreaker (on-sale > regular, then unit price)
//   7. confidence gate (cache hit OR defined [brands] → confident)
// The fuzzy "which of these?" decision is pushed across the `ambiguous` boundary
// to the LLM.

import type { KrogerCandidate } from "./kroger.js";
import { compareUnitPrice, parseSize, type UnitPriceItem } from "./unit-price.js";
import type { AisleLocation, CandidateView } from "./order-shapes.js";
import type { BrandTierPref } from "./preferences.js";

/** A cached SKU mapping from the shared D1 `sku_cache` table. */
export interface CachedMapping {
  ingredient: string;
  sku: string;
  brand?: string;
  size?: string;
  /** The Kroger locationId this mapping was resolved at (D7). Absent = legacy/untagged. */
  locationId?: string;
  /** Captured aisle placement at this row's location (member-app-differentiators D5).
   *  Absent until an order captures one; the matcher itself never reads it. */
  aisle?: AisleLocation;
  /** ISO date the placement was last captured. */
  aisleCapturedAt?: string;
}

export interface MatchContext {
  recipe_slug?: string;
  dietary?: string[];
  quantity_hint?: string;
}

/** Everything the pipeline needs, injectable so the orchestrator is unit-testable. */
export interface MatchDeps {
  /** Term search at the resolved location. */
  search(term: string): Promise<KrogerCandidate[]>;
  /** Revalidate a cached SKU (current price + fulfillment) at the resolved location. */
  productById(productId: string): Promise<KrogerCandidate | null>;
  /** `aliases` table map (variant → canonical id). */
  aliases: Record<string, string>;
  /**
   * Canonical id → human Kroger search phrase, for qualified ids whose id string is not a
   * search term (`ground beef::fat-80-20` → "80/20 ground beef"). Absent id (a bare base)
   * searches as-is. Optional so unit tests can omit it.
   */
  searchTerms?: Record<string, string>;
  /** Native family preferences. Tiers are ordered; peers within a tier are equal. */
  brands: Record<string, BrandTierPref>;
  /** The shared D1 `sku_cache` mappings (location-tagged, D7). */
  cache: CachedMapping[];
  /** The caller's resolved preferred locationId — drives same-location cache preference (D7). */
  locationId: string;
}

export interface ConfidentMatch {
  resolved: true;
  sku: string;
  brand: string;
  description: string;
  size: string | null;
  price: { regular: number; promo: number };
  on_sale: boolean;
  fulfillment: { curbside: boolean; delivery: boolean };
  reason: string;
  /** The picked candidate's aisle placement at the resolved location, passed through
   *  from the Kroger response (member-app-differentiators D5). Additive — no scoring
   *  or step change; the resolve-only / never-substitutes contracts are untouched. */
  aisleLocation?: AisleLocation | null;
}

// CandidateView lives in the leaf order-shapes.ts (member-app-grocery D9 — the app
// harness types its order fixtures against it); re-exported here so every existing
// importer is unchanged.
export type { CandidateView } from "./order-shapes.js";

export interface AmbiguousMatch {
  resolved: false;
  ambiguous: true;
  candidates: CandidateView[];
  reason: string;
}

export interface UnavailableMatch {
  resolved: false;
  reason: "unavailable";
  message: string;
}

export type MatchResult = ConfidentMatch | AmbiguousMatch | UnavailableMatch;

/** A candidate is a valid pick only if fulfillable via curbside or delivery. */
export function isFulfillable(c: KrogerCandidate): boolean {
  return c.fulfillment.curbside || c.fulfillment.delivery;
}

/**
 * A candidate is on sale only when it carries a promo price that is an actual
 * DISCOUNT — `promo > 0` AND `promo < regular`. Kroger returns `promo == regular`
 * (and an occasional `promo >= regular`) for non-sale items, so `promo > 0` alone
 * over-reports sales (savings 0). The single source of truth for "on sale" across
 * the matcher, the flyer scan, price reporting, AND the satellite sale intake —
 * so a `sale` observation and a Kroger scan are judged by the identical rule.
 * Takes just the `{ price }` a candidate or a re-derived sale row carries.
 */
export function isOnSale(c: { price: { regular: number; promo: number } }): boolean {
  return c.price.promo > 0 && c.price.promo < c.price.regular;
}

/**
 * Minimum markdown — as a fraction of the regular price — for the **flyer** to
 * surface a sale. The matcher still counts ANY real promo (`isOnSale`) in its
 * tiebreak; this stricter floor is human-facing only, so penny / near-zero
 * "discounts" (e.g. `regular 2.99 → promo 2.98`, and Kroger's `promo == regular`
 * non-sale echo) don't clutter the "what's on sale" scan. Tunable.
 */
export const MIN_FLYER_DISCOUNT = 0.05;

/** Flyer-worthy: a genuine sale whose markdown clears `minDiscount` (default `MIN_FLYER_DISCOUNT`). */
export function isFlyerWorthy(c: KrogerCandidate, minDiscount: number = MIN_FLYER_DISCOUNT): boolean {
  return isOnSale(c) && c.price.regular - c.price.promo >= c.price.regular * minDiscount;
}

/**
 * Re-derive a rollup item's `savings` from its raw `{ regular, promo }` — the SINGLE source of
 * truth shared by the Kroger flyer scan (`dedupeFlyerHits`) and the satellite sale intake, so a
 * `sale` observation and a first-party Kroger scan of the same product derive an IDENTICAL
 * `FlyerItem` (indistinguishable downstream except by provenance). Rounded to cents.
 */
export function deriveSavings(price: { regular: number; promo: number }): number {
  return Math.round((price.regular - price.promo) * 100) / 100;
}

/** One synthesized flyer row (the kroger_flyer output item shape). */
export interface FlyerItem {
  sku: string;
  brand: string;
  description: string;
  size: string | null;
  price: { regular: number; promo: number };
  savings: number;
  categories: string[];
  /** Every scanned term that surfaced this product, in scan order. */
  matched_terms: string[];
}

/**
 * Dedup flyer candidates across terms by productId, preserving scan order. A
 * product surfaced by several terms appears once, carrying every surfacing term
 * in `matched_terms` (the first occurrence wins the row fields). `perTerm` must
 * already be filtered to flyer-worthy, fulfillable candidates — this only merges.
 */
export function dedupeFlyerHits(
  perTerm: { term: string; candidates: KrogerCandidate[] }[],
): FlyerItem[] {
  const seen = new Map<string, FlyerItem>();
  for (const { term, candidates } of perTerm) {
    for (const c of candidates) {
      const existing = seen.get(c.productId);
      if (existing) {
        if (!existing.matched_terms.includes(term)) existing.matched_terms.push(term);
        continue;
      }
      seen.set(c.productId, {
        sku: c.productId,
        brand: c.brand,
        description: c.description,
        size: c.size,
        price: c.price,
        savings: deriveSavings(c.price),
        categories: c.categories,
        matched_terms: [term],
      });
    }
  }
  return [...seen.values()];
}

/** Effective price the shopper pays: promo when on sale, else regular. */
function effectivePrice(c: KrogerCandidate): number {
  return isOnSale(c) ? c.price.promo : c.price.regular;
}

/**
 * Strip a single leading quantity token and optional unit, e.g. "2 lb ",
 * "1 cup ", "16.9 fl oz ", "3 ", "1/2 cup ". Expects already-lowercased input.
 *
 * A **slash-fraction** (`\d+/\d+`) is stripped ONLY when a unit follows it, so a
 * ratio-style PRODUCT QUALIFIER like `80/20` in "80/20 ground beef" is preserved for
 * the resolver rather than silently discarded as a quantity (a plain integer/decimal
 * still strips with or without a unit, so "2 eggs" → "eggs" is unchanged). This keeps
 * "80/20 ground beef" and "1 lb 80/20 ground beef" normalizing to the SAME term.
 */
export function stripLeadingQuantity(s: string): string {
  return s
    .replace(
      /^(?:\d+\s+)?\d+\/\d+\s*(?:fl\s*oz|oz|lb|lbs|g|kg|ml|l|cup|cups|tbsp|tsp|pt|qt|gal|ct|count|pack|cloves?|cans?|bunch(?:es)?|pieces?)\.?\s+|^\d+(?:\.\d+)?\s*(?:fl\s*oz|oz|lb|lbs|g|kg|ml|l|cup|cups|tbsp|tsp|pt|qt|gal|ct|count|pack|cloves?|cans?|bunch(?:es)?|pieces?)?\.?\s+/,
      "",
    )
    .trim();
}

/**
 * The BASE of a canonical id — the segment up to the first `::` (a pure string op, so
 * "same base?" needs no schema). A bare base id is its own base. Details after `::` are
 * opaque discriminators; deterministic code compares only full-id or base equality.
 */
export function baseOf(id: string): string {
  const i = id.indexOf("::");
  return i === -1 ? id : id.slice(0, i);
}

/**
 * Step 1 — normalize: lowercase, strip a leading quantity/unit, then apply
 * the `aliases` table. Conservative: it does not strip qualifiers beyond what an
 * alias entry collapses.
 */
export function normalizeIngredient(ingredient: string, aliases: Record<string, string>): string {
  const s = stripLeadingQuantity(ingredient.toLowerCase().trim());
  // Alias map keys may be mixed-case (the `aliases` table uses "EVOO"); match
  // case-insensitively. Fall back to the cleaned term when no alias applies.
  for (const [variant, canonical] of Object.entries(aliases)) {
    if (variant.toLowerCase() === s) return canonical;
  }
  return s;
}

/**
 * Normalize a recipe's ingredient-name list (objective shared content — the
 * `perishable_ingredients` and `ingredients_key` arrays) through the same
 * `normalizeIngredient` the verify matcher uses, so cross-recipe overlap (waste
 * detection, the pantry-overlap re-rank) lines up with pantry matching. Drops empties
 * and dedupes; idempotent (re-normalizing an already-normalized list is a no-op). A
 * non-array, or an array containing a non-string, is returned unchanged so
 * write-time/build validation can reject the bad shape rather than this silently
 * coercing it.
 */
export function normalizeIngredientList(value: unknown, aliases: Record<string, string>): unknown {
  if (!Array.isArray(value)) return value;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return value;
    const norm = normalizeIngredient(entry, aliases);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

/** Back-compat alias — perishables use the generic ingredient-list normalizer. */
export const normalizePerishables = normalizeIngredientList;

/** Canonical normalized term → `[brands]` lookup key (spaces → underscores). */
export function brandKey(normalized: string): string {
  return normalized.replace(/\s+/g, "_");
}

/** Best-effort dietary soft score: +1 per hint token appearing in product text (D7). */
function dietaryScore(c: KrogerCandidate, dietary: string[] | undefined): number {
  if (!dietary?.length) return 0;
  const haystack = `${c.brand} ${c.description} ${c.categories.join(" ")}`.toLowerCase();
  let score = 0;
  for (const hint of dietary) {
    if (haystack.includes(hint.toLowerCase())) score += 1;
  }
  return score;
}

/** Whitespace-split content tokens of an already-normalized (lowercased) query. */
export function relevanceTokens(normalized: string): string[] {
  return normalized.split(/\s+/).filter(Boolean);
}

/**
 * Identity relevance (near-hard constraint): how many query tokens appear, as a
 * case-insensitive substring, in the candidate's description or categories. The
 * matcher's signal for "is this candidate the queried ingredient at all" —
 * distinct from the soft brand/dietary preferences.
 */
export function relevanceScore(c: KrogerCandidate, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const haystack = `${c.description} ${c.categories.join(" ")}`.toLowerCase();
  let score = 0;
  for (const tok of queryTokens) {
    if (haystack.includes(tok)) score += 1;
  }
  return score;
}

/** Build a candidate view for the ambiguous shape, attaching a unit price when parseable. */
function toCandidateView(c: KrogerCandidate): CandidateView {
  const view: CandidateView = {
    sku: c.productId,
    brand: c.brand,
    description: c.description,
    size: c.size,
    price: c.price,
    on_sale: isOnSale(c),
    fulfillment: c.fulfillment,
  };
  if (c.size && parseSize(c.size)) {
    const res = compareUnitPrice([{ id: c.productId, price: effectivePrice(c), size: c.size }]);
    if (res.ranked[0]) view.unit_price = res.ranked[0].unit_price;
  }
  return view;
}

/**
 * Step 5 — deterministic tiebreaker over a candidate pool: on-sale first, then
 * best price-per-unit (falling back to lowest effective price when sizes are
 * unparseable). Returns the single winner.
 */
export function tiebreak(pool: KrogerCandidate[]): KrogerCandidate {
  const onSalePool = pool.filter(isOnSale);
  const tier = onSalePool.length > 0 ? onSalePool : pool;

  const items: UnitPriceItem[] = tier.map((c) => ({
    id: c.productId,
    price: effectivePrice(c),
    size: c.size ?? "",
  }));
  const { cheapest } = compareUnitPrice(items);
  if (cheapest) {
    const byUnit = tier.find((c) => c.productId === cheapest);
    if (byUnit) return byUnit;
  }
  // No parseable sizes: fall back to lowest effective price.
  return [...tier].sort((a, b) => effectivePrice(a) - effectivePrice(b))[0];
}

/**
 * Commodity pick for a "don't care" (`[]`) ingredient: smallest package covering
 * the `quantity_hint`, then cheapest absolute (D, open question 3). Falls back to
 * the general tiebreaker when no hint is parseable.
 */
function commodityPick(pool: KrogerCandidate[], quantityHint: string | undefined): KrogerCandidate {
  const hint = quantityHint ? parseSize(quantityHint) : null;
  if (hint) {
    const covering = pool
      .map((c) => ({ c, size: c.size ? parseSize(c.size) : null }))
      .filter((x) => x.size && x.size.dimension === hint.dimension && x.size.quantity >= hint.quantity);
    if (covering.length > 0) {
      covering.sort(
        (a, b) =>
          a.size!.quantity - b.size!.quantity || effectivePrice(a.c) - effectivePrice(b.c),
      );
      return covering[0].c;
    }
  }
  // No hint, or nothing covers it: cheapest absolute, on-sale preferred.
  return tiebreak(pool);
}

/** Build a confident-match result from a chosen candidate. */
function confident(c: KrogerCandidate, reason: string): ConfidentMatch {
  return {
    resolved: true,
    sku: c.productId,
    brand: c.brand,
    description: c.description,
    size: c.size,
    price: c.price,
    on_sale: isOnSale(c),
    fulfillment: { curbside: c.fulfillment.curbside, delivery: c.fulfillment.delivery },
    reason,
    aisleLocation: c.aisleLocation,
  };
}

function ambiguous(
  pool: KrogerCandidate[],
  dietary: string[] | undefined,
  queryTokens: string[],
  reason: string,
): AmbiguousMatch {
  // Surface the strongest candidates first: identity relevance, then dietary
  // score, then on-sale, then unit price. Relevance leads so the true ingredient
  // match isn't buried by a cheaper unrelated item.
  const ranked = [...pool].sort((a, b) => {
    const rel = relevanceScore(b, queryTokens) - relevanceScore(a, queryTokens);
    if (rel !== 0) return rel;
    const ds = dietaryScore(b, dietary) - dietaryScore(a, dietary);
    if (ds !== 0) return ds;
    const sale = Number(isOnSale(b)) - Number(isOnSale(a));
    if (sale !== 0) return sale;
    return effectivePrice(a) - effectivePrice(b);
  });
  return {
    resolved: false,
    ambiguous: true,
    // Return the FULL relevance-ranked fulfillable set (no truncation) so the LLM
    // can browse everything and pick, rather than re-searching for more. The pool
    // is already bounded by the caller's search limit.
    candidates: ranked.map(toCandidateView),
    reason,
  };
}

/**
 * Run the full resolve-only pipeline for one ingredient. Pure with respect to
 * its injected deps — no GitHub/Kroger wiring here, no cache writes.
 */
export async function matchIngredient(
  deps: MatchDeps,
  ingredient: string,
  context: MatchContext = {},
  bypassCache = false,
): Promise<MatchResult> {
  const normalized = normalizeIngredient(ingredient, deps.aliases);
  const key = brandKey(normalized);
  const dietary = context.dietary;
  // The canonical id keys the cache + brand prefs, but Kroger search and identity relevance
  // run on a human PHRASE: the stored search_term for a qualified id, else the id with any
  // `::` detail markers flattened to spaces (a bare base is already a fine search phrase).
  const searchPhrase = deps.searchTerms?.[normalized] ?? normalized.split("::").join(" ");
  const queryTokens = relevanceTokens(searchPhrase);

  // Step 2 — cache lookup + revalidation (no TTL). The cache is SHARED across the
  // group (D7), so a hit may have been resolved by another tenant at another store.
  // Entries tagged with the caller's own location are tried first; every candidate
  // is still revalidated for live price + fulfillment at the caller's location, so
  // a cross-location entry that isn't carried at the caller's store falls through to
  // search. A hit short-circuits search and narrowing.
  if (!bypassCache) {
    const sameLoc = (m: CachedMapping): boolean => !m.locationId || m.locationId === deps.locationId;
    const hits = deps.cache
      .filter((m) => m.ingredient === normalized)
      .sort((a, b) => Number(sameLoc(b)) - Number(sameLoc(a)));
    for (const hit of hits) {
      const fresh = await deps.productById(hit.sku);
      if (fresh && isFulfillable(fresh)) {
        const reason = sameLoc(hit)
          ? "cache hit (revalidated)"
          : "shared cache hit (revalidated at your store)";
        return confident(fresh, reason);
      }
      // Unavailable on revalidation → try the next candidate, then full
      // re-resolution (self-healing).
    }
  }

  // Step 3 — term search (on the human phrase, not the raw id).
  const candidates = await deps.search(searchPhrase);

  // Step 4 — availability is one near-hard constraint.
  const fulfillable = candidates.filter(isFulfillable);
  if (fulfillable.length === 0) {
    return {
      resolved: false,
      reason: "unavailable",
      message: "No candidate is fulfillable via curbside/delivery at the preferred location.",
    };
  }

  // Identity relevance is the second near-hard constraint: a confident pick may
  // only come from the top relevance tier — the candidates that best match the
  // queried ingredient. This stops "cheapest fulfillable" from confidently
  // resolving to an unrelated product (e.g. refried beans for "anaheim peppers").
  const maxRelevance = Math.max(...fulfillable.map((c) => relevanceScore(c, queryTokens)));
  const topTier =
    maxRelevance > 0 ? fulfillable.filter((c) => relevanceScore(c, queryTokens) === maxRelevance) : [];

  // Step 6 — confidence gate driven by the native tier family.
  const brandsPref = deps.brands[key];

  // Absent key, no cache → ambiguous (ask). (D5)
  if (brandsPref === undefined) {
    return ambiguous(fulfillable, dietary, queryTokens, "no brand preference defined; choose or say 'don't care'");
  }

  // Safe fallback: no candidate clearly matches the ingredient (zero relevance
  // across the pool) → never pick confidently; surface the pool for the LLM/user.
  if (topTier.length === 0) {
    return ambiguous(
      fulfillable,
      dietary,
      queryTokens,
      `no candidate clearly matches "${ingredient}"; choose from these or refine the request`,
    );
  }

  // First available tier wins. Brands in one tier are peers; package-aware price
  // selection decides between them, never their stored order.
  for (let index = 0; index < brandsPref.tiers.length; index += 1) {
    const peers = new Set(brandsPref.tiers[index].map((brand) => brand.trim().toLowerCase()));
    const available = topTier.filter((candidate) => peers.has(candidate.brand.trim().toLowerCase()));
    if (available.length > 0) {
      return confident(commodityPick(available, context.quantity_hint), `brand tier ${index + 1}`);
    }
  }

  // any_brand is a terminal fallback after every tier is exhausted.
  if (brandsPref.any_brand) {
    return confident(commodityPick(topTier, context.quantity_hint), "any-brand fallback");
  }

  return ambiguous(
    fulfillable,
    dietary,
    queryTokens,
    "preferred brand tiers unavailable; choose from these or explicitly allow any brand",
  );
}
