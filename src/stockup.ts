// Pure helpers for the bulk-buy watchlist (stockup.toml). Mirrors email.ts
// addSources: read existing, merge add-only (deduped by normalized item name),
// preserve the leading doc header, and return the new text plus what changed.
// The per-tenant `update_stockup` tool wraps this; keeping it pure makes it
// unit-testable off `workerd`.

import { parseToml } from "./parse.js";
import { stringifyTomlWithHeader } from "./serialize.js";
import { normalizeName } from "./grocery.js";

export const STOCKUP_PATH = "stockup.toml";

const STOCKUP_HEADER =
  "# stockup.toml — bulk-buy watchlist (agent-writable via update_stockup).\n" +
  "# Add-only, deduped by normalized item name. Price thresholds are advisory\n" +
  "# (nothing gates on them) — the agent reasons over the live flyer price.";

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

function rowsOf(parsed: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(parsed.items) ? (parsed.items as Record<string, unknown>[]) : [];
}

/** Drop undefined fields — TOML has no null, so omit absent optionals. */
function compactItem(item: StockupItem): Record<string, unknown> {
  const out: Record<string, unknown> = { name: item.name };
  if (item.unit !== undefined) out.unit = item.unit;
  if (item.typical_purchase !== undefined) out.typical_purchase = item.typical_purchase;
  if (item.notes !== undefined) out.notes = item.notes;
  if (item.baseline_price !== undefined) out.baseline_price = item.baseline_price;
  if (item.buy_at_or_below !== undefined) out.buy_at_or_below = item.buy_at_or_below;
  return out;
}

/**
 * Add bulk-buy items to `stockup.toml`, deduping by normalized `name` (existing
 * rows untouched) and optionally setting the top-level `freezer_capacity_estimate`.
 * Returns the new file text, the count of items actually added, and whether
 * anything changed (so the caller can skip a no-op commit). The top-level scalar
 * is serialized BEFORE the `[[items]]` tables (a TOML requirement — a scalar after
 * an array-of-tables would bind to the last table).
 */
export function addStockup(
  existingRaw: string | null,
  additions: StockupAdditions,
): { text: string; added: number; changed: boolean } {
  let parsed: Record<string, unknown> = {};
  if (existingRaw) {
    try {
      parsed = parseToml(existingRaw, STOCKUP_PATH);
    } catch {
      parsed = {};
    }
  }

  const rows = [...rowsOf(parsed)];
  const have = new Set(
    rows
      .map((r) => (typeof r.name === "string" ? normalizeName(r.name) : null))
      .filter((n): n is string => n !== null),
  );
  let added = 0;
  for (const item of additions.items ?? []) {
    const key = normalizeName(item.name);
    if (!key || have.has(key)) continue;
    have.add(key);
    rows.push(compactItem(item));
    added++;
  }

  let freezerChanged = false;
  const freezer = additions.freezer_capacity_estimate ?? parsed.freezer_capacity_estimate;
  if (
    additions.freezer_capacity_estimate !== undefined &&
    additions.freezer_capacity_estimate !== parsed.freezer_capacity_estimate
  ) {
    freezerChanged = true;
  }

  // Scalars first, then the array-of-tables (TOML ordering).
  const next: Record<string, unknown> = {};
  if (freezer !== undefined) next.freezer_capacity_estimate = freezer;
  next.items = rows;

  const text = stringifyTomlWithHeader(existingRaw ?? STOCKUP_HEADER, next);
  return { text, added, changed: added > 0 || freezerChanged };
}
