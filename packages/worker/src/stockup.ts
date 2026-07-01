// Pure helpers for the bulk-buy watchlist — items the member wants to buy in bulk
// when they hit a good price. Add-only (deduped by normalized item name), applied
// over an in-memory list; the per-tenant `update_stockup` tool persists the result
// as rows in the D1 `stockup` table and the freezer estimate on the `profile` row
// (src/profile-db.ts). Keeping the logic pure (object-in/object-out, no TOML, no D1)
// makes it unit-testable off `workerd`.

import { normalizeName } from "./grocery.js";

export interface StockupItem {
  name: string;
  unit?: string;
  typical_purchase?: string;
  notes?: string;
  baseline_price?: number;
  buy_at_or_below?: number;
}

export interface StockupAdditions {
  items?: StockupItem[];
  freezer_capacity_estimate?: string;
}

/** Drop undefined optional fields so a stored row carries only set values. */
function compactItem(item: StockupItem): StockupItem {
  const out: StockupItem = { name: item.name };
  if (item.unit !== undefined) out.unit = item.unit;
  if (item.typical_purchase !== undefined) out.typical_purchase = item.typical_purchase;
  if (item.notes !== undefined) out.notes = item.notes;
  if (item.baseline_price !== undefined) out.baseline_price = item.baseline_price;
  if (item.buy_at_or_below !== undefined) out.buy_at_or_below = item.buy_at_or_below;
  return out;
}

/**
 * Add bulk-buy items to a stockup list, deduping by normalized `name` (existing
 * items untouched) and optionally setting the top-level `freezer_capacity_estimate`
 * (which the caller stores on the `profile` row). Returns the new list, the freezer
 * value, the count actually added, and whether anything changed (so the caller can
 * skip a no-op write).
 */
export function addStockup(
  existing: StockupItem[],
  currentFreezer: string | null,
  additions: StockupAdditions,
): { items: StockupItem[]; freezer: string | null; added: number; changed: boolean } {
  const items = [...existing];
  const have = new Set(items.map((it) => normalizeName(it.name)).filter((n) => n !== ""));

  let added = 0;
  for (const item of additions.items ?? []) {
    const key = normalizeName(item.name);
    if (!key || have.has(key)) continue;
    have.add(key);
    items.push(compactItem(item));
    added++;
  }

  let freezer = currentFreezer;
  let freezerChanged = false;
  if (
    additions.freezer_capacity_estimate !== undefined &&
    additions.freezer_capacity_estimate !== currentFreezer
  ) {
    freezer = additions.freezer_capacity_estimate;
    freezerChanged = true;
  }

  return { items, freezer, added, changed: added > 0 || freezerChanged };
}
