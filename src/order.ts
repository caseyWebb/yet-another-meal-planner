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
//     unilaterally), then runs the two INDEPENDENT best-effort writes in the
//     design's order: (1) commit the SKU-cache append, (2) PUT the cart,
//     (3) advance the list to in_cart only AFTER a successful cart write (so the
//     list never claims in_cart for items that aren't actually in the cart).
//     Every outcome is reported honestly and independently.

import { normalizeName, type GroceryItem } from "./grocery.js";
import type { MatchResult, CandidateView } from "./matching.js";

/** A computed buy line before resolution: ingredient-level, package count. */
export interface ToBuyItem {
  name: string;
  quantity: number;
  for_recipes: string[];
  /** True when no package count was supplied and the line defaulted to 1. */
  assumed_quantity: boolean;
}

/** An item skipped because the pantry already has it (prompt candidate). */
export interface PartialItem {
  name: string;
  for_recipes: string[];
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
  /** Per-name package count override (default 1). Keyed by normalized name. */
  quantities?: Record<string, number>;
  /** Normalized names the user confirmed buying despite a pantry hit. */
  includePartials?: Set<string>;
}

/**
 * Compute the to-buy set. Only `active` list items participate (in_cart/ordered
 * are already in flight). Menu needs union in by normalized name, merging
 * for_recipes. A name in the pantry (and not user-confirmed) drops to `partials`.
 */
export function computeToBuy(input: ComputeToBuyInput): ToBuyResult {
  const quantities = input.quantities ?? {};
  const includePartials = input.includePartials ?? new Set<string>();

  // Accumulate by normalized name so list + menu needs dedupe cleanly. `needQty`
  // is the package count carried on a menu need (max across merges); the separate
  // `quantities` map overrides it below.
  const merged = new Map<string, { name: string; for_recipes: string[]; needQty?: number }>();

  for (const it of input.list) {
    if (it.status !== "active") continue;
    const key = normalizeName(it.name);
    const entry = merged.get(key) ?? { name: it.name, for_recipes: [] };
    entry.for_recipes = [...new Set([...entry.for_recipes, ...it.for_recipes])];
    merged.set(key, entry);
  }

  for (const need of input.menuNeeds ?? []) {
    const key = normalizeName(need.name);
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
    });
  }

  return { to_buy, partials };
}

// --- orchestrator -----------------------------------------------------------

export interface ResolvedLine {
  name: string;
  sku: string;
  brand: string;
  size: string | null;
  quantity: number;
  /** Carried from the to-buy line: quantity defaulted to 1 (no count supplied). */
  assumed_quantity: boolean;
}

export interface CheckpointLine {
  name: string;
  kind: "ambiguous" | "unavailable";
  candidates?: CandidateView[];
  message: string;
}

/** A learned ingredient→SKU mapping to append to the shared skus/kroger.toml. */
export interface NewMapping {
  ingredient: string;
  sku: string;
  brand?: string;
  size?: string;
  /** The Kroger locationId this mapping was resolved at (D7). */
  locationId?: string;
}

/** Caller-supplied disposition for a previously-ambiguous item: force this SKU. */
export interface Override {
  sku: string;
  brand?: string;
  size?: string | null;
}

export interface PlaceOrderDeps {
  /** Resolve one ingredient via the Change 05 matcher (with cache revalidation). */
  resolve(name: string): Promise<MatchResult>;
  /** Commit SKU-cache appends; returns the commit sha, or null when nothing was new. Throws on failure. */
  commitSkuCache(mappings: NewMapping[]): Promise<string | null>;
  /** Write the resolved lines to the Kroger cart. Throws on failure. */
  cartAdd(lines: ResolvedLine[]): Promise<void>;
  /** Advance the resolved lines to status:in_cart in the grocery list (D1-backed). Throws on failure. */
  advanceInCart(lines: ResolvedLine[]): Promise<void>;
}

export interface PlaceOrderOptions {
  /** Previously-ambiguous items the user dispositioned, keyed by normalized name. */
  overrides?: Map<string, Override>;
  /** Resolve and report only — no cart write, no commits. */
  preview?: boolean;
}

export interface PlaceOrderResult {
  resolved: ResolvedLine[];
  checkpoint: CheckpointLine[];
  sku_cache: { committed: boolean; error?: string };
  cart: { written: boolean; count?: number; error?: string; code?: string };
  list: { advanced: boolean; error?: string };
  preview: boolean;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** A structured error code if the throw carries one (e.g. ToolError). */
function codeOf(e: unknown): string | undefined {
  const c = (e as { code?: unknown }).code;
  return typeof c === "string" ? c : undefined;
}

function toMapping(line: ResolvedLine): NewMapping {
  return {
    ingredient: normalizeName(line.name),
    sku: line.sku,
    brand: line.brand || undefined,
    size: line.size ?? undefined,
  };
}

/**
 * Resolve the to-buy set and (unless preview) flush it: SKU-cache commit, then
 * cart write, then in_cart advancement gated on cart success. The three writes
 * are independent best-effort — a failure of one never corrupts another, and the
 * cart is never reported populated when its write failed.
 */
export async function placeOrder(
  deps: PlaceOrderDeps,
  toBuy: ToBuyItem[],
  options: PlaceOrderOptions = {},
): Promise<PlaceOrderResult> {
  const overrides = options.overrides ?? new Map<string, Override>();
  const preview = options.preview ?? false;

  const resolved: ResolvedLine[] = [];
  const checkpoint: CheckpointLine[] = [];

  // Resolve every line concurrently (each resolve runs the matcher → Kroger,
  // bounded by the client's concurrency cap), then partition into
  // resolved/checkpoint in input order so the output is deterministic.
  const outcomes = await Promise.all(
    toBuy.map(async (item) => {
      const ov = overrides.get(normalizeName(item.name));
      if (ov) {
        const line: ResolvedLine = {
          name: item.name,
          sku: ov.sku,
          brand: ov.brand ?? "",
          size: ov.size ?? null,
          quantity: item.quantity,
          assumed_quantity: item.assumed_quantity,
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
    const { item, result: r } = o;
    if (r.resolved) {
      resolved.push({
        name: item.name,
        sku: r.sku,
        brand: r.brand,
        size: r.size,
        quantity: item.quantity,
        assumed_quantity: item.assumed_quantity,
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
    preview,
  };

  if (preview || resolved.length === 0) return result;

  // 1. SKU-cache append first — a pure hint, so committing it before the cart
  //    means a cart failure leaves the repo correct and the cart retryable.
  try {
    await deps.commitSkuCache(resolved.map(toMapping));
    result.sku_cache = { committed: true };
  } catch (e) {
    result.sku_cache = { committed: false, error: msg(e) };
  }

  // 2. Cart write — independent of the commit above.
  try {
    await deps.cartAdd(resolved);
    result.cart = { written: true, count: resolved.length };
  } catch (e) {
    result.cart = { written: false, error: msg(e), code: codeOf(e) };
  }

  // 3. Advance the list to in_cart ONLY when the cart actually took the items;
  //    otherwise the items stay `active` and the next order retries them.
  if (result.cart.written) {
    try {
      await deps.advanceInCart(resolved);
      result.list = { advanced: true };
    } catch (e) {
      result.list = { advanced: false, error: msg(e) };
    }
  }

  return result;
}
