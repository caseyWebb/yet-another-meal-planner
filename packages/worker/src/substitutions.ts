// The deterministic ALTERNATIVES-ONLY substitution read (inline-substitution-hints
// D1/D4, refactored from member-app-differentiators): behind the coarse MCP tool
// `suggest_substitutions` and `POST /api/grocery/substitutions`. Per line: the cached
// pick revalidated (≤ 1 productById), one term search, one `compareUnitPrice` pass
// with the closed D2 reason vocabulary (`cheaper` / `on_sale` / `in_stock` — nothing
// else, ever). Budgeted at 12 lines per call with honest `remaining` pagination; a
// tenant with no resolvable Kroger location degrades to empty alternatives
// (`location: null`) rather than erroring.
//
// The op's CHEAP half — the identity-graph sibling walk + `in_pantry` + `on_sale_hint`
// — moved to the shared `annotateSubstitutes` (src/substitute-annotator.ts), folded
// into the enriched to-buy read (`to-buy.ts`) so every branch (incl. walk/satellite
// tenants who never called this tool) gets those hints under one Locations resolve.
// This op no longer touches the identity graph, the pantry, or the flyer rollup.
//
// READ-ONLY by construction: the op never writes the cart, the SKU cache, the grocery
// list, or any other store — acting on a suggestion reuses the existing writes (order
// `overrides`/`exclude`, row add/remove, materialize). The matcher's resolve-only
// and never-substitutes contracts are composed with, never modified: nothing here
// enters the matcher, and a suggestion reaches the cart only as an explicit
// caller-supplied override or list row. The ingredient context is loaded resolve-only
// (capture OFF) — a read must not enqueue novel terms (the to-buy view's posture).

import type { Env } from "./env.js";
import type { KrogerCandidate } from "./kroger.js";
import { ingredientContext, emptyIngredientContext, readSkuCache } from "./corpus-db.js";
import { readPreferences } from "./profile-db.js";
import { computeToBuyView } from "./to-buy.js";
import { compareUnitPrice, type UnitPriceItem } from "./unit-price.js";
import { isFulfillable, isOnSale, type CachedMapping } from "./matching.js";
import { KROGER_STORE } from "./flyer-warm.js";
import type { OrderWiring } from "./order-tools.js";
import type {
  LineSuggestions,
  SubstitutionAlternative,
  SubstitutionProduct,
  SubstitutionReason,
  SuggestSubstitutionsInput,
  SuggestSubstitutionsResult,
} from "./order-shapes.js";

// The result shapes live in the workerd-free leaf order-shapes.ts (the app and the
// Playwright fixtures type against them); re-exported unchanged.
export type {
  LineSuggestions,
  SiblingSuggestion,
  SubstitutionAlternative,
  SubstitutionProduct,
  SubstitutionReason,
  SuggestSubstitutionsInput,
  SuggestSubstitutionsResult,
} from "./order-shapes.js";

// The shared cheap-half annotator (siblings + in_pantry + on_sale_hint) lives in its
// own leaf module now — re-exported here so existing importers of `identitySiblings`
// from this file keep working.
export { identitySiblings, annotateSubstitutes, SIBLINGS_CAP, type AnnotateSubstitutesDeps } from "./substitute-annotator.js";

/** Per-call line budget (D1): ≤ 2 Kroger calls per line + token + location resolve —
 *  ≤ ~26 upstream calls at the 12-line cap — stays comfortably under the free-tier
 *  50-subrequest cap. Default AND ceiling. */
export const MAX_SUBSTITUTION_LINES = 12;
/** Same-identity alternatives returned per line, `compareUnitPrice`-ranked (D2). */
export const ALTERNATIVES_CAP = 5;

/** Effective shopper price: promo when it is a real discount, else regular. */
function effectivePrice(c: KrogerCandidate): number {
  return isOnSale(c) ? c.price.promo : c.price.regular;
}

function toProduct(c: KrogerCandidate): SubstitutionProduct {
  return {
    sku: c.productId,
    brand: c.brand,
    description: c.description,
    size: c.size,
    price: c.price,
    on_sale: isOnSale(c),
    available: isFulfillable(c),
    aisleLocation: c.aisleLocation,
  };
}

/** One line as the op processes it (name + funnel key + optional view origin). */
interface LineInput {
  name: string;
  key: string;
  origin?: "list" | "plan" | "both";
}

/** The current pick's cache lookup (matcher D7 semantics, read not modified):
 *  location-tagged rows first, the legacy untagged `''` row next, cross-location last. */
function pickMapping(cache: CachedMapping[], key: string, locationId: string): CachedMapping | null {
  const rank = (m: CachedMapping): number =>
    m.locationId === locationId ? 0 : !m.locationId ? 1 : 2;
  const hits = cache.filter((m) => m.ingredient === key).sort((a, b) => rank(a) - rank(b));
  return hits[0] ?? null;
}

/**
 * The alternatives-only substitution read (D1/D2/D4). Read-only; ≤ 1 `productById`
 * revalidation + exactly 1 term search per processed line; `max_lines` defaults to and
 * is capped at 12 with unprocessed names returned in `remaining`. With no resolvable
 * Kroger location the whole op degrades to empty alternatives (`location: null`)
 * rather than erroring — the cheap sibling/pantry/flyer hints this op used to carry
 * for that same degraded case now live on the enriched to-buy read instead.
 */
export async function suggestSubstitutions(
  env: Env,
  tenantId: string,
  input: SuggestSubstitutionsInput,
  wiring: OrderWiring,
): Promise<SuggestSubstitutionsResult> {
  // Resolve-only funnel (capture OFF): a read must not enqueue novel terms; degrade
  // to the empty context rather than failing the read on a resolver blip.
  const ctx = await ingredientContext(env, { capture: false }).catch(() => emptyIngredientContext(env));

  // The caller's current to-buy set: the default line source when no explicit names
  // are supplied.
  const view = await computeToBuyView(env, tenantId);
  const viewLines: LineInput[] = view.to_buy.map((l) => ({ name: l.name, key: l.key, origin: l.origin }));
  const lines: LineInput[] =
    input.names !== undefined
      ? input.names.map((name) => ({ name, key: ctx.resolve(name) }))
      : viewLines;

  const budget = Math.min(Math.max(1, Math.floor(input.max_lines ?? MAX_SUBSTITUTION_LINES)), MAX_SUBSTITUTION_LINES);
  const processed = lines.slice(0, budget);
  const remaining = lines.slice(budget).map((l) => l.name);

  // Kroger-primary tenants get this op's price/availability half; anything else
  // degrades (D1: a resolvable Kroger location gates the whole thing).
  const prefs = await readPreferences(env, tenantId).catch(() => null);
  const stores = prefs?.stores as Record<string, unknown> | undefined;
  const primary =
    typeof stores?.primary === "string" && stores.primary.trim() ? stores.primary.trim().toLowerCase() : KROGER_STORE;

  let locationId: string | null = null;
  if (primary === KROGER_STORE) {
    locationId = await wiring.getLocationId().catch(() => null);
  }

  const cache: CachedMapping[] = locationId !== null ? await readSkuCache(env) : [];

  const suggestions: LineSuggestions[] = await Promise.all(
    processed.map(async (line): Promise<LineSuggestions> => {
      const forLine = { name: line.name, key: line.key, ...(line.origin !== undefined ? { origin: line.origin } : {}) };

      if (locationId === null) {
        return { for: forLine, status: "no_cached_pick", current: null, alternatives: [] };
      }

      // --- the price/availability half (≤ 2 Kroger calls) --------------------
      // 1. Current pick: the cached mapping revalidated for fresh price/fulfillment/aisle.
      const mapping = pickMapping(cache, line.key, locationId);
      let status: LineSuggestions["status"];
      let current: SubstitutionProduct | null = null;
      if (mapping === null) {
        status = "no_cached_pick";
      } else {
        const fresh = await wiring.productById(mapping.sku).catch(() => null);
        if (fresh === null) {
          status = "current_unavailable";
        } else {
          current = toProduct(fresh);
          status = current.available ? "ok" : "current_unavailable";
        }
      }

      // 2. Candidates: exactly one term search (the same phrase the matcher searches),
      //    filtered to fulfillable, the current SKU excluded.
      const found = await wiring.search(ctx.searchTerm(line.key)).catch(() => [] as KrogerCandidate[]);
      const candidates = found.filter((c) => isFulfillable(c) && c.productId !== current?.sku);

      // 3. One compareUnitPrice pass over current + candidates — comparability
      //    (dimension grouping, incomparable) is decided by the existing core.
      const byId = new Map(candidates.map((c) => [c.productId, c] as const));
      const items: UnitPriceItem[] = [];
      const freshCurrent = current;
      if (freshCurrent) {
        items.push({ id: freshCurrent.sku, price: freshCurrent.on_sale ? freshCurrent.price.promo : freshCurrent.price.regular, size: freshCurrent.size ?? "" });
      }
      for (const c of candidates) items.push({ id: c.productId, price: effectivePrice(c), size: c.size ?? "" });
      const compared = compareUnitPrice(items);
      const unitOf = new Map(compared.ranked.map((r) => [r.id, r] as const));
      if (freshCurrent && unitOf.has(freshCurrent.sku)) {
        const u = unitOf.get(freshCurrent.sku)!;
        freshCurrent.unit_price = u.unit_price;
        freshCurrent.base_unit = u.base_unit;
      }

      // Ranked (unit-price ascending) first, then the incomparable in search order.
      const ordered: KrogerCandidate[] = [
        ...compared.ranked.map((r) => byId.get(r.id)).filter((c): c is KrogerCandidate => c !== undefined),
        ...candidates.filter((c) => !unitOf.has(c.productId)),
      ];

      // 4. The closed reason vocabulary (D2) — these three, nothing else, ever.
      const currentUnit = freshCurrent && unitOf.has(freshCurrent.sku) ? unitOf.get(freshCurrent.sku)!.unit_price : null;
      const alternatives: SubstitutionAlternative[] = ordered.slice(0, ALTERNATIVES_CAP).map((c) => {
        const product = toProduct(c);
        const u = unitOf.get(c.productId);
        if (u) {
          product.unit_price = u.unit_price;
          product.base_unit = u.base_unit;
        }
        const reasons: SubstitutionReason[] = [];
        // cheaper: strictly lower unit price, only when BOTH ranked comparable.
        if (currentUnit !== null && u && u.unit_price < currentUnit) reasons.push("cheaper");
        if (product.on_sale) reasons.push("on_sale");
        // in_stock: fulfillable (by filter) while the current pick is unavailable.
        if (status === "current_unavailable") reasons.push("in_stock");
        return { ...product, reasons };
      });

      return { for: forLine, status, current, alternatives };
    }),
  );

  return {
    suggestions,
    remaining,
    location: locationId !== null ? { id: locationId } : null,
  };
}
