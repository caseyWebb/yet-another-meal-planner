// The `sale` observation arm of the shared raw-observation intake (satellite-sale-scan).
//
// A `sale` observation carries RAW price facts only (sensor-not-judge) — the Worker re-derives
// every conclusion here: "is this on sale" (the existing `isOnSale` single source of truth), the
// `savings` (the existing `deriveSavings`), and the deal floor (applied at READ, in the flyer
// tools, never stored). So a satellite `sale` and a first-party Kroger scan of the same product
// produce an IDENTICAL `FlyerItem`, indistinguishable downstream except by recorded provenance.
//
// Satellite sale data is given NO privileged path: it can set no field a Kroger scan couldn't,
// skips no derivation, and is held to plausibility bounds at least as strict as the Kroger path
// (Decision 7) — validated per-item, so one bad item is rejected without sinking the batch. The
// dispatcher in ingest.ts groups accepted rows by (store, locationId) and REPLACES that store's
// `flyer:{store}:{locationId}` rollup with the freshly-observed set (one scan = one store's full
// current sale set).

import type { SaleObservation } from "@grocery-agent/contract";
import { deriveSavings, isOnSale, type FlyerItem } from "./matching.js";
import { parseSize } from "./unit-price.js";

/** Absolute price ceiling — a fat-fingered `$99999` is a scan/parse error, not a real price. */
export const SALE_MAX_PRICE = 10_000;

/** Markdown ceiling — a > 95%-off "deal" is a scan/parse error, not a real sale (Decision 7). */
export const SALE_MAX_MARKDOWN = 0.95;

export type SaleValidation = { ok: true; item: FlyerItem } | { ok: false; reason: string };

/**
 * Worker-side plausibility for one `sale` observation, EQUAL-OR-STRICTER than the first-party
 * Kroger path. The shared contract already guaranteed the structural shape; here we:
 *   - keep only a genuine discount (`0 < promo < regular` — the same `isOnSale` gate the Kroger
 *     flyer passes, excluding the `promo == regular` non-sale echo),
 *   - reject an out-of-range `regular`/`promo` (the absolute ceiling),
 *   - reject an implausible re-derived markdown (> `SALE_MAX_MARKDOWN`),
 *   - require `size` to parse via the existing unit-price parser or be null.
 * On success it RE-DERIVES the `FlyerItem` (savings via `deriveSavings`) and retains provenance
 * (`productId` → `sku`, product `url` when present) so a claim is spot-checkable — precisely what
 * change 5's sensor-audit would sample. Returns a per-item reason on failure (never throws), so
 * the caller rejects that item without sinking the batch.
 */
export function validateSale(obs: SaleObservation): SaleValidation {
  const price = { regular: obs.regular, promo: obs.promo };

  if (!(price.regular > 0 && price.regular <= SALE_MAX_PRICE)) {
    return { ok: false, reason: `regular price out of range: ${price.regular}` };
  }
  if (!(price.promo >= 0 && price.promo <= SALE_MAX_PRICE)) {
    return { ok: false, reason: `promo price out of range: ${price.promo}` };
  }
  // Genuine discount only — the same rule the Kroger scan applies (promo == regular is not a sale).
  if (!isOnSale({ price })) {
    return { ok: false, reason: `not on sale (promo ${price.promo} is not below regular ${price.regular})` };
  }
  // Markdown ceiling — a > 95%-off "deal" is a scan/parse error, not a sale.
  const markdown = (price.regular - price.promo) / price.regular;
  if (markdown > SALE_MAX_MARKDOWN) {
    return { ok: false, reason: `implausible markdown ${Math.round(markdown * 100)}% (> ${Math.round(SALE_MAX_MARKDOWN * 100)}%)` };
  }
  // Size must parse (via the existing unit-price parser) or be absent/blank → null.
  const rawSize = typeof obs.size === "string" ? obs.size.trim() : "";
  if (rawSize !== "" && !parseSize(rawSize)) {
    return { ok: false, reason: `unparseable size "${rawSize}"` };
  }

  const item: FlyerItem = {
    sku: obs.productId,
    brand: obs.brand ?? "",
    description: obs.description,
    size: rawSize !== "" ? rawSize : null,
    price,
    savings: deriveSavings(price),
    categories: obs.categories ?? [],
    // The satellite doesn't report WHICH broad term surfaced each product, so `matched_terms` is
    // empty for a satellite sale (a display/provenance field the deal floor does not consult).
    matched_terms: [],
  };
  return { ok: true, item };
}
