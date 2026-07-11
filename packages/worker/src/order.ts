// place_order core logic (order-placement capability). Two pieces, both pure
// with respect to their inputs/deps so they unit-test without GitHub or Kroger:
//
//   computeToBuy — the order-time set algebra: to-buy = grocery_list ∪ menu_needs
//     − pantry_has (deduped by normalized name). An item present in the pantry is
//     NOT auto-dropped silently: it is surfaced as a `partial` for the agent to
//     prompt on (the no-auto-decide rule), and only bought if the user confirms
//     it via `include_partials`.
//
//   placeOrder — the order-time flush orchestrator. Resolves each to-buy item,
//     batches ambiguous/unavailable into one checkpoint (never added
//     unilaterally), then runs the writes in double-add-safe order: (1) commit
//     the SKU-cache append (a pure hint, best-effort), (2) advance the list to
//     in_cart BEFORE the cart write, (3) PUT the cart — rolling the advance back
//     to active if the cart write fails. Advance-first because PUT /v1/cart/add
//     is ADDITIVE and unreadable: items left `active` after a successful cart
//     write would be silently re-added by a retry (double-order, costs money),
//     whereas items marked in_cart without a cart write are a visible under-buy
//     (the stale-cart reminder + human checkout surface them) that a retry never
//     compounds. Every outcome is reported honestly and independently.

import { normalizeName, storedGroceryKey, type GroceryItem } from "./grocery.js";
import type { MatchResult } from "./matching.js";
import type { AisleLocation, CheckpointLine, PartialItem, PlaceOrderResult, ResolvedLine } from "./order-shapes.js";

// The pure line/result shapes live in the leaf order-shapes.ts (member-app-grocery D9 —
// the app harness types its order fixtures against them); re-exported so every existing
// importer is unchanged.
export type { CandidateView, CheckpointLine, PartialItem, PlaceOrderResult, ResolvedLine } from "./order-shapes.js";

/** A computed buy line before resolution: ingredient-level, package count. */
export interface ToBuyItem {
  name: string;
  quantity: number;
  for_recipes: string[];
  /** True when no package count was supplied and the line defaulted to 1. */
  assumed_quantity: boolean;
  /**
   * The line's merge/join key — EXACTLY the `grocery_list.normalized_name` this line is stored under
   * (`storedGroceryKey` for a list row: the canonical id for a food row, `normalizeName` for a
   * non-food row, an explicit id for an add-by-id row; `resolve(need)` for a plan need). Consumers
   * that need the stored row key (the satellite order-fill pull-list's `item_id`, `place_order`'s
   * `ResolvedLine.key`) use this rather than re-deriving with `resolve(name)`, which would diverge for
   * a non-food row and for an add-by-id row whose `name` is a display, not the id.
   */
  key: string;
}

export interface ToBuyResult {
  to_buy: ToBuyItem[];
  partials: PartialItem[];
}

/** A menu-derived need not (necessarily) on the grocery list yet. */
export interface MenuNeed {
  name: string;
  quantity?: number;
  for_recipes?: string[];
}

export interface ComputeToBuyInput {
  list: GroceryItem[];
  menuNeeds?: MenuNeed[];
  pantryNames: Set<string>;
  /** Per-name package count override (default 1). Keyed by the resolved (canonical-id) key. */
  quantities?: Record<string, number>;
  /** Resolved keys the user confirmed buying despite a pantry hit. */
  includePartials?: Set<string>;
  /**
   * Map a name to its dedup/join key — `IngredientContext.resolve` in production, so a food
   * item's key is the canonical id and a pantry on-hand cancels its grocery/menu counterpart
   * across surface forms ("scallions" ≡ a pantry "green onion"). Defaults to `normalizeName`,
   * preserving today's behavior for callers/tests that don't inject one. `pantryNames`,
   * `quantities`, and `includePartials` are expected keyed by the SAME function.
   */
  resolve?: (n: string) => string;
}

/**
 * Compute the to-buy set. Only `active` list items participate (in_cart/ordered
 * are already in flight). Menu needs union in by normalized name, merging
 * for_recipes. A name in the pantry (and not user-confirmed) drops to `partials`.
 */
export function computeToBuy(input: ComputeToBuyInput): ToBuyResult {
  const quantities = input.quantities ?? {};
  const includePartials = input.includePartials ?? new Set<string>();
  const resolve = input.resolve ?? normalizeName;

  // Accumulate by the resolved key (canonical id for food) so list + menu needs dedupe
  // across surface forms. `needQty` is the package count carried on a menu need (max across
  // merges); the separate `quantities` map overrides it below.
  const merged = new Map<string, { name: string; for_recipes: string[]; needQty?: number }>();

  for (const it of input.list) {
    if (it.status !== "active") continue;
    // Key on the row's STORED `normalized_name` (`storedGroceryKey`) — the trusted D1 PK, never a
    // re-derivation of the (now-independent) display `name`: an add-by-id row whose `name` is a human
    // display still keys on its id, and a typed food row's stored key is byte-identical to
    // `groceryKey(name,…)`. `entry.name` stays the display so surfaces render it natively.
    const key = storedGroceryKey(it, resolve);
    const entry = merged.get(key) ?? { name: it.name, for_recipes: [] };
    entry.for_recipes = [...new Set([...entry.for_recipes, ...it.for_recipes])];
    merged.set(key, entry);
  }

  for (const need of input.menuNeeds ?? []) {
    // Menu needs are recipe ingredients = food → resolve to the canonical id.
    const key = resolve(need.name);
    const entry = merged.get(key) ?? { name: need.name, for_recipes: [] };
    entry.for_recipes = [...new Set([...entry.for_recipes, ...(need.for_recipes ?? [])])];
    // Honor a per-need package count; take the max when several needs merge.
    if (need.quantity != null && need.quantity > 0) {
      entry.needQty = entry.needQty != null ? Math.max(entry.needQty, need.quantity) : need.quantity;
    }
    merged.set(key, entry);
  }

  const to_buy: ToBuyItem[] = [];
  const partials: PartialItem[] = [];

  for (const [key, entry] of merged) {
    const inPantry = input.pantryNames.has(key);
    if (inPantry && !includePartials.has(key)) {
      partials.push({ name: entry.name, for_recipes: entry.for_recipes });
      continue;
    }
    // Precedence: explicit `quantities` override → menu need quantity → default 1.
    const override = quantities[key];
    const hasOverride = override != null && override > 0;
    const hasNeed = entry.needQty != null && entry.needQty > 0;
    const quantity = hasOverride ? override : hasNeed ? entry.needQty! : 1;
    to_buy.push({
      name: entry.name,
      quantity,
      for_recipes: entry.for_recipes,
      assumed_quantity: !hasOverride && !hasNeed,
      // The merge key IS the stored `normalized_name` (`storedGroceryKey` for a list row, resolve(need)
      // for a plan need) — the canonical id the pull-list issues and advance/cache key on.
      key,
    });
  }

  return { to_buy, partials };
}

// --- orchestrator -----------------------------------------------------------

/** A learned ingredient→SKU mapping to append to the shared D1 `sku_cache` table. */
export interface NewMapping {
  ingredient: string;
  sku: string;
  brand?: string;
  size?: string;
  /** The Kroger locationId this mapping was resolved at (D7). */
  locationId?: string;
  /** The resolved candidate's aisle placement, when Kroger reported one (D5). */
  aisleLocation?: AisleLocation | null;
}

/** Caller-supplied force of a specific SKU for a line — to disposition a
 *  previously-ambiguous/unavailable item, or to lock a SKU the agent verified
 *  (e.g. an on-sale one). The forced SKU is revalidated before it reaches the cart. */
export interface Override {
  sku: string;
  brand?: string;
  size?: string | null;
}

/** Fresh state of a forced-override SKU after one availability + price recheck. */
export interface RevalidatedSku {
  brand: string;
  size: string | null;
  price: { regular: number; promo: number };
  on_sale: boolean;
  /** The revalidated product's aisle placement, when Kroger reported one (D5). */
  aisleLocation?: AisleLocation | null;
}

export interface PlaceOrderDeps {
  /** Resolve one ingredient via the Change 05 matcher (with cache revalidation). */
  resolve(name: string): Promise<MatchResult>;
  /**
   * Revalidate a forced-override SKU against current curbside/delivery availability
   * and price at the resolved location (the same recheck the matcher's cache path
   * does). Returns the fresh state when fulfillable, or null when it is not — so an
   * override SKU that has gone unavailable is checkpointed, not blind-carted.
   */
  revalidateSku(sku: string): Promise<RevalidatedSku | null>;
  /**
   * Normalize an ingredient name to its canonical id — the SAME `normalizeIngredient`
   * the matcher keys the cache read on, so a learned mapping is stored under the key it
   * will be looked up by (a leading quantity / alias / `::` qualifier would otherwise make
   * the write key `normalizeName`-shaped and never re-read). Capture already happened during
   * resolution, so this is normalize-only.
   */
  normalize(name: string): string;
  /** Commit SKU-cache appends; returns the commit sha, or null when nothing was new. Throws on failure. */
  commitSkuCache(mappings: NewMapping[]): Promise<string | null>;
  /** Write the resolved lines to the Kroger cart. Throws on failure. */
  cartAdd(lines: ResolvedLine[]): Promise<void>;
  /** Advance the resolved lines to status:in_cart in the grocery list (D1-backed),
   *  inserting rows for lines not yet listed (menu-plan-derived needs). Returns the
   *  receipt of what was INSERTED so a rollback can compensate exactly. Throws on failure. */
  advanceInCart(lines: ResolvedLine[]): Promise<InCartAdvance>;
  /** Undo an advanceInCart (the compensation for a failed cart write): pre-existing
   *  rows flip back to status:active; rows the advance INSERTED (per the receipt) are
   *  deleted rather than stranded as never-listed active items. Throws on failure. */
  rollbackInCart(lines: ResolvedLine[], advance: InCartAdvance): Promise<void>;
}

/** The advanceInCart receipt: which canonical keys the advance INSERTED (vs updated) —
 *  threaded into rollbackInCart so an inserted row is deleted, not flipped to active.
 *  `sendId` is the send record written in the advance's batch (spend-telemetry) —
 *  absent when the snapshot build failed, in which case `sendError` says why (the
 *  advance proceeded bare: telemetry never costs the member their groceries). */
export interface InCartAdvance {
  inserted: string[];
  sendId?: string;
  sendError?: string;
}

export interface PlaceOrderOptions {
  /**
   * Previously-ambiguous items the user dispositioned, keyed by the resolved (canonical-id)
   * name via `resolveKey`. Must be keyed by the SAME function passed as `resolveKey` so a
   * dispositioned line matches its to-buy line across surface forms.
   */
  overrides?: Map<string, Override>;
  /** Resolve and report only — no cart write, no commits. */
  preview?: boolean;
  /**
   * Map a to-buy line name to the override-map key. `IngredientContext.resolve` in production
   * (the SAME funnel `order-tools` keys the override map with); defaults to `normalizeName` so
   * an un-threaded caller keeps today's behavior.
   */
  resolveKey?: (n: string) => string;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** A structured error code if the throw carries one (e.g. ToolError). */
function codeOf(e: unknown): string | undefined {
  const c = (e as { code?: unknown }).code;
  return typeof c === "string" ? c : undefined;
}

function toMapping(line: ResolvedLine, normalize: (name: string) => string): NewMapping {
  return {
    // Key the cache on the line's canonical id (`ResolvedLine.key` — the stored `normalized_name`):
    // byte-identical to `normalize(name)` for a typed row, and for an add-by-id row (whose `name` is a
    // display) it de-fragments the cache onto the id the matcher reads back by. Fall back to
    // `normalize(name)` defensively for any line missing a key.
    ingredient: line.key ?? normalize(line.name),
    sku: line.sku,
    brand: line.brand || undefined,
    size: line.size ?? undefined,
    // Aisle capture (D5): the resolution's placement rides the mapping so the commit
    // can refresh a cached row whose placement moved.
    aisleLocation: line.aisleLocation ?? null,
  };
}

/**
 * Resolve the to-buy set and (unless preview) flush it: SKU-cache commit, then
 * the in_cart advancement, then the cart write (rolled back on cart failure).
 * The SKU-cache commit is independent best-effort; the advance/cart pair is
 * ordered so a retried order can never double-add to the (additive, unreadable)
 * Kroger cart — and the cart is never reported populated when its write failed.
 */
export async function placeOrder(
  deps: PlaceOrderDeps,
  toBuy: ToBuyItem[],
  options: PlaceOrderOptions = {},
): Promise<PlaceOrderResult> {
  const overrides = options.overrides ?? new Map<string, Override>();
  const preview = options.preview ?? false;
  const resolveKey = options.resolveKey ?? normalizeName;

  const resolved: ResolvedLine[] = [];
  const checkpoint: CheckpointLine[] = [];

  // Resolve every line concurrently (each resolve runs the matcher → Kroger,
  // bounded by the client's concurrency cap), then partition into
  // resolved/checkpoint in input order so the output is deterministic.
  const outcomes = await Promise.all(
    toBuy.map(async (item) => {
      const ov = overrides.get(resolveKey(item.name));
      if (ov) {
        // A forced SKU bypasses the matcher, but is still revalidated for current
        // availability + price before it can reach the cart. Fulfillable → resolve
        // with the FRESH price/on_sale (so a lapsed deal is visible); not
        // fulfillable → checkpoint as unavailable rather than blind-carting it.
        const fresh = await deps.revalidateSku(ov.sku);
        if (!fresh) {
          const checkpoint: CheckpointLine = {
            name: item.name,
            kind: "unavailable",
            message: "forced SKU is no longer fulfillable via curbside or delivery",
          };
          return { item, checkpoint };
        }
        const line: ResolvedLine = {
          name: item.name,
          key: item.key,
          sku: ov.sku,
          brand: fresh.brand || ov.brand || "",
          size: fresh.size ?? ov.size ?? null,
          quantity: item.quantity,
          assumed_quantity: item.assumed_quantity,
          price: fresh.price,
          on_sale: fresh.on_sale,
          aisleLocation: fresh.aisleLocation ?? null,
        };
        return { item, line };
      }
      return { item, result: await deps.resolve(item.name) };
    }),
  );

  for (const o of outcomes) {
    if ("line" in o) {
      resolved.push(o.line!);
      continue;
    }
    if ("checkpoint" in o) {
      checkpoint.push(o.checkpoint!);
      continue;
    }
    const { item, result: r } = o;
    if (r.resolved) {
      resolved.push({
        name: item.name,
        key: item.key,
        sku: r.sku,
        brand: r.brand,
        size: r.size,
        quantity: item.quantity,
        assumed_quantity: item.assumed_quantity,
        price: r.price,
        on_sale: r.on_sale,
        aisleLocation: r.aisleLocation ?? null,
      });
    } else if ("ambiguous" in r) {
      checkpoint.push({ name: item.name, kind: "ambiguous", candidates: r.candidates, message: r.reason });
    } else {
      checkpoint.push({ name: item.name, kind: "unavailable", message: r.message });
    }
  }

  const result: PlaceOrderResult = {
    resolved,
    checkpoint,
    sku_cache: { committed: false },
    cart: { written: false },
    list: { advanced: false },
    send: { recorded: false },
    preview,
  };

  if (preview || resolved.length === 0) return result;

  // 1. SKU-cache append first — a pure hint, so committing it before the cart
  //    means a cart failure leaves the repo correct and the cart retryable.
  try {
    await deps.commitSkuCache(resolved.map((l) => toMapping(l, deps.normalize)));
    result.sku_cache = { committed: true };
  } catch (e) {
    result.sku_cache = { committed: false, error: msg(e) };
  }

  // 2. Advance the list to in_cart BEFORE the cart write. Failure ordering is
  //    deliberate: an under-buy (items marked in_cart that never reached the cart)
  //    is visible and self-healing, while the inverse — items left `active` after
  //    a cart write — makes a retried order double-add to the ADDITIVE, unreadable
  //    Kroger cart (silent, costs money). A failed advance skips the cart write
  //    entirely, so nothing was carted and the whole order is safe to retry.
  let advance: InCartAdvance;
  try {
    advance = await deps.advanceInCart(resolved);
    result.list = { advanced: true };
    // The send record rides the advance's batch (spend-telemetry): recorded iff the
    // advance succeeded. A snapshot-BUILD failure degrades to a bare advance — honest
    // `recorded: false` + the reason, never a failed flush.
    result.send = advance.sendId
      ? { recorded: true, id: advance.sendId }
      : { recorded: false, ...(advance.sendError ? { error: advance.sendError } : {}) };
  } catch (e) {
    result.list = { advanced: false, error: msg(e) };
    result.cart = {
      written: false,
      error: `cart write skipped: list advance failed (${msg(e)}); nothing was added to the cart — safe to retry`,
    };
    return result;
  }

  // 3. Cart write. On failure, undo the advance (pre-existing rows back to
  //    `active`, advance-inserted rows deleted — per the receipt) so the next
  //    order retries them. If the ROLLBACK itself fails, do NOT throw: report
  //    { advanced: true, rolled_back: false } — the items are marked in_cart
  //    with no cart write (a visible under-buy: the stale-cart reminder and the
  //    human checkout surface it), and critically a retried place_order will
  //    NOT re-add them (in_cart is filtered out of computeToBuy).
  try {
    await deps.cartAdd(resolved);
    result.cart = { written: true, count: resolved.length };
  } catch (e) {
    result.cart = { written: false, error: msg(e), code: codeOf(e) };
    try {
      await deps.rollbackInCart(resolved, advance);
      result.list = { advanced: false, rolled_back: true };
      // The compensation deleted the send record too — no phantom order survives.
      if (advance.sendId) {
        result.send = { recorded: false, error: "send record rolled back with the failed cart write" };
      }
    } catch (rollbackErr) {
      result.list = { advanced: true, rolled_back: false, error: msg(rollbackErr) };
      // Rollback failed: the send remains alongside the stranded in_cart rows (the
      // existing visible under-buy posture) — result.send keeps reporting it.
    }
  }

  return result;
}
