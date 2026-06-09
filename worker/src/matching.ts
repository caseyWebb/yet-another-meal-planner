// The match_ingredient_to_kroger_sku pipeline (designs D5–D9). Resolve-only: it
// returns one of three shapes (confident / ambiguous / unavailable) and NEVER
// writes the SKU cache (that rides the Change 06 batched commit) and NEVER
// substitutes (that's propose_substitutions). The deterministic 7-step pipeline:
//   1. alias-driven normalization
//   2. cache lookup + revalidation (no TTL)
//   3. term search
//   4. score by tri-state brand / best-effort dietary / availability
//   5. deterministic tiebreaker (on-sale > regular, then unit price)
//   6. confidence gate (cache hit OR defined [brands] → confident)
// The fuzzy "which of these?" decision is pushed across the `ambiguous` boundary
// to the LLM.

import type { KrogerCandidate } from "./kroger.js";
import { compareUnitPrice, parseSize, type UnitPriceItem } from "./unit-price.js";

/** A cached SKU mapping from `skus/kroger.toml`. */
export interface CachedMapping {
  ingredient: string;
  sku: string;
  brand?: string;
  size?: string;
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
  /** `aliases.toml` map (variant → canonical). */
  aliases: Record<string, string>;
  /** `preferences.toml` `[brands]` (key → ranked list; `[]` = don't-care). */
  brands: Record<string, string[]>;
  /** `skus/kroger.toml` mappings. */
  cache: CachedMapping[];
}

export interface ConfidentMatch {
  resolved: true;
  sku: string;
  brand: string;
  size: string | null;
  price: { regular: number; promo: number };
  on_sale: boolean;
  reason: string;
}

export interface CandidateView {
  sku: string;
  brand: string;
  size: string | null;
  price: { regular: number; promo: number };
  on_sale: boolean;
  unit_price?: number;
  fulfillment: { curbside: boolean; delivery: boolean };
}

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

const MAX_CANDIDATES = 5;

/** A candidate is a valid pick only if fulfillable via curbside or delivery. */
export function isFulfillable(c: KrogerCandidate): boolean {
  return c.fulfillment.curbside || c.fulfillment.delivery;
}

function onSale(c: KrogerCandidate): boolean {
  return c.price.promo > 0;
}

/** Effective price the shopper pays: promo when on sale, else regular. */
function effectivePrice(c: KrogerCandidate): number {
  return onSale(c) ? c.price.promo : c.price.regular;
}

/**
 * Strip a single leading quantity token and optional unit, e.g. "2 lb ",
 * "1 cup ", "16.9 fl oz ", "3 ". Expects already-lowercased input. Shared by
 * `normalizeIngredient` and the recipe-line parser so the unit vocabulary stays
 * single-sourced.
 */
export function stripLeadingQuantity(s: string): string {
  return s
    .replace(
      /^\d+(?:\.\d+)?(?:\/\d+)?\s*(?:fl\s*oz|oz|lb|lbs|g|kg|ml|l|cup|cups|tbsp|tsp|pt|qt|gal|ct|count|pack|cloves?|cans?|bunch(?:es)?|pieces?)?\.?\s+/,
      "",
    )
    .trim();
}

/**
 * Step 1 — normalize: lowercase, strip a leading quantity/unit, then apply
 * `aliases.toml`. Conservative: it does not strip qualifiers beyond what an
 * alias entry collapses.
 */
export function normalizeIngredient(ingredient: string, aliases: Record<string, string>): string {
  const s = stripLeadingQuantity(ingredient.toLowerCase().trim());
  // Alias map keys may be mixed-case (aliases.toml uses "EVOO"); match
  // case-insensitively. Fall back to the cleaned term when no alias applies.
  for (const [variant, canonical] of Object.entries(aliases)) {
    if (variant.toLowerCase() === s) return canonical;
  }
  return s;
}

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

/** Index of the highest-ranked (lowest index) listed brand the candidate matches, or -1. */
function brandRank(c: KrogerCandidate, brands: string[]): number {
  const b = c.brand.toLowerCase();
  for (let i = 0; i < brands.length; i++) {
    const wanted = brands[i].toLowerCase();
    if (b === wanted || b.includes(wanted) || wanted.includes(b)) return i;
  }
  return -1;
}

/** Build a candidate view for the ambiguous shape, attaching a unit price when parseable. */
function toCandidateView(c: KrogerCandidate): CandidateView {
  const view: CandidateView = {
    sku: c.productId,
    brand: c.brand,
    size: c.size,
    price: c.price,
    on_sale: onSale(c),
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
  const onSalePool = pool.filter(onSale);
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
    size: c.size,
    price: c.price,
    on_sale: onSale(c),
    reason,
  };
}

function ambiguous(pool: KrogerCandidate[], dietary: string[] | undefined, reason: string): AmbiguousMatch {
  // Surface the strongest candidates first: dietary score, then on-sale, then unit price.
  const ranked = [...pool].sort((a, b) => {
    const ds = dietaryScore(b, dietary) - dietaryScore(a, dietary);
    if (ds !== 0) return ds;
    const sale = Number(onSale(b)) - Number(onSale(a));
    if (sale !== 0) return sale;
    return effectivePrice(a) - effectivePrice(b);
  });
  return {
    resolved: false,
    ambiguous: true,
    candidates: ranked.slice(0, MAX_CANDIDATES).map(toCandidateView),
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

  // Step 2 — cache lookup + revalidation (no TTL). A hit short-circuits search
  // and narrowing, but is revalidated for live price + fulfillment before use.
  if (!bypassCache) {
    const hit = deps.cache.find((m) => m.ingredient === normalized);
    if (hit) {
      const fresh = await deps.productById(hit.sku);
      if (fresh && isFulfillable(fresh)) {
        return confident(fresh, "cache hit (revalidated)");
      }
      // Unavailable on revalidation → fall through to full re-resolution (self-healing).
    }
  }

  // Step 3 — term search.
  const candidates = await deps.search(normalized);

  // Step 4 — availability is the one near-hard constraint.
  const fulfillable = candidates.filter(isFulfillable);
  if (fulfillable.length === 0) {
    return {
      resolved: false,
      reason: "unavailable",
      message: "No candidate is fulfillable via curbside/delivery at the preferred location.",
    };
  }

  // Step 6 — confidence gate driven by the tri-state `[brands]` entry.
  const brandsPref = deps.brands[key];

  // Absent key, no cache → ambiguous (ask). (D5)
  if (brandsPref === undefined) {
    return ambiguous(fulfillable, dietary, "no brand preference defined; choose or say 'don't care'");
  }

  // `[]` → don't care, auto-pick cheapest acceptable. (D5)
  if (brandsPref.length === 0) {
    const pick = commodityPick(fulfillable, context.quantity_hint);
    return confident(pick, "don't-care: cheapest acceptable");
  }

  // Non-empty ranked list → highest-ranked available brand wins; tiebreak within it.
  const ranked = fulfillable
    .map((c) => ({ c, rank: brandRank(c, brandsPref) }))
    .filter((x) => x.rank >= 0);
  if (ranked.length > 0) {
    const bestRank = Math.min(...ranked.map((x) => x.rank));
    const sameBrand = ranked.filter((x) => x.rank === bestRank).map((x) => x.c);
    return confident(tiebreak(sameBrand), "preferred brand match");
  }

  // Listed brands all unavailable → fall back to ambiguous. (D5)
  return ambiguous(
    fulfillable,
    dietary,
    "preferred brand(s) unavailable; choose from these or say 'don't care'",
  );
}
