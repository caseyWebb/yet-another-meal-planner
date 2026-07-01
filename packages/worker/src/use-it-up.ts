// Holistic use-it-up: derive the at-risk DEMAND multiset from the caller's pantry (holistic-use-it-up
// capability). PURE — the tool wrapper reads the pantry rows, builds the corpus perishable vocabulary,
// and alias-normalizes names (via the same `normalizeItems` the ranking uses, so pantry items line up
// with a recipe's `perishable_ingredients` / `ingredients_key`); this turns those into the
// `{ item → count }` demand the planner's coverage term consumes and decrements.
//
// "At-risk" is derived, not asked: an item counts when it is a PERISHABLE a recipe can actually use
// (member of the corpus perishable vocabulary) — always-on, so use-it-up happens without the caller
// stating it. `quantity → count` is coarse (the loose "full"/"partial"/count stance), and drives the
// multi-serving split (a 2-count item can be covered by two mains). Age is available as a floor knob
// (default off) — a weight curve is an Open Question left to the §5.2 tuning.

/** Tunable knobs for the at-risk derivation. */
export interface AtRiskParams {
  /** A perishable younger than this many days is NOT yet at risk (skipped). Default 0 = every
   *  perishable on hand is a use-it-up candidate (maximally holistic); raise it once the real
   *  `added_at` distribution is known (Open Question — §5.2). */
  freshnessFloorDays: number;
  /** Cap on a single item's derived demand, so one hoarded item can't demand the whole week. */
  maxCount: number;
}

export const DEFAULT_AT_RISK_PARAMS: AtRiskParams = {
  freshnessFloorDays: 0,
  maxCount: 3,
};

/** A pantry row reduced to what the derivation needs (alias-normalized name + loose quantity + age). */
export interface AtRiskInput {
  /** Alias-normalized item name (via the ranking's `normalizeItems`), so it lines up with recipes. */
  normalizedName: string;
  /** The loose pantry `quantity` ("full" | "partial" | "low" | a count | null). */
  quantity: string | null;
  /** `added_at` (YYYY-MM-DD) or null when unknown. */
  addedAt: string | null;
}

/** Whole days from a YYYY-MM-DD day to `now` (UTC); a missing/unparseable date reads as Infinity
 *  (unknown provenance → assume it's been sitting a while, i.e. at risk). Future → 0. */
function ageInDays(added: string | null, now: Date): number {
  if (!added) return Infinity;
  const t = Date.parse(`${added}T00:00:00Z`);
  if (Number.isNaN(t)) return Infinity;
  const ms = now.getTime() - t;
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000);
}

/**
 * Map a loose pantry `quantity` to a coarse set-cover demand count in [1, maxCount]:
 *   * an explicit number ("2", "3 bunches") → that many (ceil, capped)
 *   * "full" → 2 (a full bunch/pack tends to span two dinners)
 *   * "partial" / "low" / anything else / null → 1
 * This coarse count is what lets a multi-serving item be covered by more than one main.
 */
export function quantityToCount(quantity: string | null | undefined, maxCount: number): number {
  const cap = Math.max(1, maxCount);
  if (quantity == null) return 1;
  const q = quantity.trim().toLowerCase();
  const lead = q.match(/^(\d+(?:\.\d+)?)/);
  if (lead) {
    const n = Math.ceil(Number(lead[1]));
    return Math.min(Math.max(1, n), cap);
  }
  if (q === "full") return Math.min(2, cap);
  return 1;
}

/**
 * Build the at-risk demand multiset from pantry rows: keep the items that are perishable (a member
 * of the corpus perishable vocabulary — an item some recipe can actually consume) and past the
 * freshness floor, mapping `quantity → count`. Alias-normalized names only (no vectors). Rows that
 * normalize to the same item take the MAX count (loose amounts; never sum). Returns `item → count`.
 */
export function deriveAtRiskDemand(
  pantry: AtRiskInput[],
  perishableVocab: Set<string>,
  now: Date,
  params: AtRiskParams = DEFAULT_AT_RISK_PARAMS,
): Map<string, number> {
  const demand = new Map<string, number>();
  for (const row of pantry) {
    const name = row.normalizedName;
    if (!name || !perishableVocab.has(name)) continue; // not a perishable a recipe uses
    if (ageInDays(row.addedAt, now) < params.freshnessFloorDays) continue; // just bought → not yet at risk
    const count = quantityToCount(row.quantity, params.maxCount);
    demand.set(name, Math.max(demand.get(name) ?? 0, count));
  }
  return demand;
}
