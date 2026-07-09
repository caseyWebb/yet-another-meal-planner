// place_order tool registration + the shared order operation (order-placement /
// member-app-grocery D4/D8). `runPlaceOrder` is the whole order-time flush as one
// operation — list+pantry reads → the server-side plan-needs derivation → funnel-keyed
// input maps → `computeToBuy` (∪ caller menu_needs − pantry) → order-scoped `exclude`
// → `placeOrder` over the real deps — called by the MCP tool (with buildServer's
// per-request closures as its wiring) and by `POST /api/grocery/order` (over
// `buildOrderWiring`, tools.ts). It is the ONLY path that writes a Kroger cart.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import type { KrogerCandidate } from "./kroger.js";
import { runTool } from "./errors.js";
import { upsertSkuMappings, readSkuCache, ingredientContext, type NewSkuMapping } from "./corpus-db.js";
import { normalizeIngredient, type MatchContext, type MatchResult } from "./matching.js";
import {
  computeToBuy,
  placeOrder,
  type InCartAdvance,
  type NewMapping,
  type Override,
  type PlaceOrderDeps,
  type ResolvedLine,
  type RevalidatedSku,
} from "./order.js";
import type { PlaceOrderInput, PlaceOrderOutcome } from "./order-shapes.js";

// The op's input/outcome shapes live in the leaf order-shapes.ts (member-app-grocery D9
// — the app harness types its order fixtures against them); re-exported unchanged.
export type { PlaceOrderInput, PlaceOrderOutcome } from "./order-shapes.js";
import { deriveMenuNeeds, dropInFlightNeeds } from "./to-buy.js";
import { createKrogerUserClient, toToolError, type KvStore } from "./kroger-user.js";
import { readGroceryList, readPantryNames, advanceInCartRows, rollbackInCartRows } from "./session-db.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

type Resolver = (
  name: string,
  context?: MatchContext,
  bypassCache?: boolean,
) => Promise<MatchResult>;

/** Revalidate a forced-override SKU against current availability + price. */
type Revalidator = (sku: string) => Promise<RevalidatedSku | null>;

/**
 * The injected I/O `runPlaceOrder` needs beyond D1: the matcher resolve, the override-SKU
 * revalidation, and the location resolution. The MCP server passes its per-request
 * memoized closures; the member API builds fresh ones via `buildOrderWiring` (tools.ts).
 */
export interface OrderWiring {
  resolve: Resolver;
  revalidateSku: Revalidator;
  getLocationId(): Promise<string>;
  /** Raw term search at the resolved location (member-app-differentiators D1) — the
   *  substitution read's one-search-per-line; `placeOrder` itself never calls it. */
  search(term: string): Promise<KrogerCandidate[]>;
  /** Raw product revalidation at the resolved location (fresh price/fulfillment/aisle). */
  productById(sku: string): Promise<KrogerCandidate | null>;
}

/** The learned fields the commit compares for its identical-skip (D5): SKU, brand, and
 *  size always; the aisle placement is folded in ONLY when `compareAisle` is set (the
 *  fresh mapping actually carries a placement) — so a revalidation whose response omits
 *  `aisleLocation` compares on SKU/brand/size alone and can't look "changed" against a
 *  stored placement (keep-on-null, D5 follow-up). */
function learnedFieldsKey(
  m: {
    sku: string;
    brand?: string | null;
    size?: string | null;
    aisle?: { number?: string; description?: string; side?: string } | null;
  },
  compareAisle: boolean,
): string {
  const parts = [m.sku, m.brand ?? "", m.size ?? ""];
  if (compareAisle) {
    const a = m.aisle ?? null;
    parts.push(a?.number ?? "", a?.description ?? "", a?.side ?? "");
  }
  return parts.join("\0");
}

/** The prior row's learned fields, as needed to re-key the identical-skip and to carry
 *  a placement forward across a genuine (SKU/brand/size) change. */
interface PriorLearned {
  sku: string;
  brand?: string;
  size?: string;
  aisle: { number: string; description: string; side?: string } | null;
  aisleCapturedAt: string | null;
}

/**
 * Upsert learned (ingredient, location) SKU mappings into the D1 `sku_cache` table
 * (the indexed lookup the matcher reads). Each entry is tagged with the caller's
 * resolved `locationId` (D7) so a cross-tenant cache hit revalidates against the
 * right store, and stamped `last_used` today (for revalidation/pruning). A key that
 * is already cached is skipped ONLY when its learned fields (SKU/brand/size, and the
 * aisle too when the fresh mapping carries one) are identical (D5) — a differing row
 * refreshes in place, so mappings converge organically with each order instead of
 * freezing at first capture. Keep-on-null: a fresh mapping with no `aisleLocation`
 * never overwrites a stored placement with NULL — it either skips (same SKU/brand/size)
 * or, on a genuine change, carries the prior row's placement forward. Only a PRESENT
 * fresh placement ever overwrites a stored one. The SKU cache is shared corpus — no
 * tenant column. Returns null (D1 has no commit sha).
 */
function makeCommitSkuCache(env: Env, getLocationId: () => Promise<string>) {
  return async (mappings: NewMapping[]): Promise<string | null> => {
    if (mappings.length === 0) return null;
    const locationId = await getLocationId();
    const existing = await readSkuCache(env);
    const have = new Map<string, PriorLearned>(
      existing.map((m) => [
        `${m.ingredient}\0${m.locationId ?? ""}`,
        { sku: m.sku, brand: m.brand, size: m.size, aisle: m.aisle ?? null, aisleCapturedAt: m.aisleCapturedAt ?? null },
      ]),
    );
    const stamp = today();
    const toWrite: NewSkuMapping[] = [];
    for (const m of mappings) {
      const key = `${m.ingredient}\0${locationId}`;
      const prior = have.get(key);
      // Only fold the aisle into the comparison when the FRESH mapping actually
      // carries one — an absent fresh placement must not make an otherwise-identical
      // row look changed (keep-on-null).
      const compareAisle = m.aisleLocation != null;
      const fresh = learnedFieldsKey({ sku: m.sku, brand: m.brand, size: m.size, aisle: m.aisleLocation }, compareAisle);
      const priorKey = prior && learnedFieldsKey(prior, compareAisle);
      // Identical learned fields → no write churn; a differing row upserts in place.
      if (priorKey === fresh) continue;
      // A present fresh placement wins outright; otherwise carry the prior row's
      // placement forward (if any) rather than clearing it.
      const aisle = m.aisleLocation ?? prior?.aisle ?? null;
      const capturedAt = m.aisleLocation ? stamp : (prior?.aisle ? prior.aisleCapturedAt : null);
      have.set(key, { sku: m.sku, brand: m.brand, size: m.size, aisle, aisleCapturedAt: capturedAt });
      toWrite.push({
        ingredient: m.ingredient,
        sku: m.sku,
        brand: m.brand,
        size: m.size,
        locationId,
        last_used: stamp,
        aisle_number: aisle ? aisle.number : null,
        aisle_description: aisle ? aisle.description : null,
        aisle_side: aisle?.side ?? null,
        aisle_captured_at: capturedAt,
      });
    }
    if (toWrite.length > 0) await upsertSkuMappings(env, toWrite);
    return null;
  };
}

/** Advance the resolved lines to status:in_cart, adding any missing list entries;
 *  returns the inserted-keys receipt the rollback compensates with. */
function makeAdvanceInCart(env: Env, username: string) {
  return async (lines: ResolvedLine[]): Promise<InCartAdvance> => {
    return advanceInCartRows(env, username, lines, today());
  };
}

/** Undo a failed-cart-write advance: pre-existing rows back to status:active,
 *  advance-inserted rows deleted (per the receipt). */
function makeRollbackInCart(env: Env, username: string) {
  return async (lines: ResolvedLine[], advance: InCartAdvance): Promise<void> => {
    await rollbackInCartRows(env, username, lines, advance.inserted);
  };
}

/**
 * The order-time flush as one shared operation. Resolves the WHOLE to-buy set — the
 * `active` grocery list ∪ the meal plan's server-derived ingredient needs ∪ caller
 * `menu_needs` (supplements; a plan-derived duplicate merges harmlessly on the canonical
 * id) − pantry on-hand — drops the order-scoped `exclude` lines before resolution, then
 * runs `placeOrder` (checkpoint batching, the three independent best-effort writes,
 * preview short-circuit). Underived planned recipes ride the result so no caller
 * silently under-buys. Tool-observable behavior with no plan and no new params is
 * IDENTICAL to the pre-extraction closure.
 */
export async function runPlaceOrder(
  env: Env,
  tenantId: string,
  input: PlaceOrderInput,
  wiring: OrderWiring,
): Promise<PlaceOrderOutcome> {
  const kv = env.KROGER_KV as unknown as KvStore;
  const userClient = createKrogerUserClient(env, kv, tenantId);
  const commitSkuCache = makeCommitSkuCache(env, wiring.getLocationId);
  const advanceInCart = makeAdvanceInCart(env, tenantId);
  const rollbackInCart = makeRollbackInCart(env, tenantId);

  const list = await readGroceryList(env, tenantId);
  const pantryNames = await readPantryNames(env, tenantId);
  // The canonical-id normalizer for the SKU-cache write key — same funnel the matcher
  // keys its cache read on, so a learned mapping stores under the key it's looked up by.
  const ingredientCtx = await ingredientContext(env);

  // Server-side plan derivation (D4): the same `deriveMenuNeeds` the to-buy view reads,
  // unioned with caller `menu_needs` — supplements (open-world side ingredients,
  // spontaneous extras), no longer the bulk plan expansion. The canonical-id merge in
  // `computeToBuy` dedups any caller-passed plan duplicate into one line.
  const derived = await deriveMenuNeeds(env, tenantId);
  // An in-flight (in_cart/ordered) row suppresses its DERIVED need — without this,
  // every repeat order would re-buy the lines the last order already carted. Caller
  // menu_needs are not suppressed (the unchanged pre-derivation baseline).
  const planNeeds = dropInFlightNeeds(derived.needs, list, (n) => ingredientCtx.resolve(n));
  const menuNeeds = [...planNeeds, ...(input.menu_needs ?? [])];

  // Key the user-supplied buy-name maps through the SAME funnel computeToBuy resolves
  // food keys by (user-supplied buy-names are treated as food), so they line up with
  // the food-keyed to-buy set. pantryNames already holds canonical ids (readPantryNames).
  const quantities: Record<string, number> = {};
  for (const [k, v] of Object.entries(input.quantities ?? {})) {
    quantities[ingredientCtx.resolve(k)] = v;
  }
  const includePartials = new Set((input.include_partials ?? []).map((n) => ingredientCtx.resolve(n)));

  const { to_buy, partials } = computeToBuy({
    list,
    menuNeeds,
    pantryNames,
    quantities,
    includePartials,
    resolve: (n) => ingredientCtx.resolve(n),
  });

  // Order-scoped exclude (D4/D6): resolved through the same funnel and dropped BEFORE
  // resolution — not resolved, not checkpointed, not carted; persisted nowhere.
  const excludeKeys = new Set((input.exclude ?? []).map((n) => ingredientCtx.resolve(n)));
  const lines = excludeKeys.size > 0 ? to_buy.filter((l) => !excludeKeys.has(l.key)) : to_buy;

  const overrides = new Map<string, Override>();
  for (const o of input.overrides ?? []) {
    overrides.set(ingredientCtx.resolve(o.name), { sku: o.sku, brand: o.brand, size: o.size ?? null });
  }

  const deps: PlaceOrderDeps = {
    resolve: (name) => wiring.resolve(name),
    revalidateSku: (sku) => wiring.revalidateSku(sku),
    normalize: (name) => normalizeIngredient(name, ingredientCtx.resolver.toId),
    commitSkuCache,
    cartAdd: async (cartLines) => {
      try {
        await userClient.addToCart(cartLines.map((l) => ({ upc: l.sku, quantity: l.quantity })));
      } catch (e) {
        throw toToolError(e);
      }
    },
    advanceInCart,
    rollbackInCart,
  };

  const result = await placeOrder(deps, lines, {
    overrides,
    preview: input.preview,
    resolveKey: (n) => ingredientCtx.resolve(n),
  });
  return { ...result, partials, underived: derived.underived };
}

// Package counts are constrained to positive integers within a sane ceiling so a
// fractional/oversized value can never reach the real Kroger cart (place_order is
// the only cart-writing tool). 99 is an arbitrary-but-ample per-line ceiling.
// Exported for direct schema testing — the MCP layer enforces it before the handler.
export const packageCount = z.number().int().positive().max(99);

const menuNeedShape = {
  name: z.string(),
  quantity: packageCount.optional(),
  for_recipes: z.array(z.string()).optional(),
};

const overrideShape = {
  name: z.string(),
  sku: z.string(),
  brand: z.string().optional(),
  size: z.string().nullable().optional(),
};

/** The tool's exact input schema, exported so the order route validates the SAME shape. */
export const PLACE_ORDER_INPUT_SHAPE = {
  menu_needs: z.array(z.object(menuNeedShape)).optional(),
  quantities: z.record(z.string(), packageCount).optional(),
  include_partials: z.array(z.string()).optional(),
  overrides: z.array(z.object(overrideShape)).optional(),
  exclude: z.array(z.string()).optional(),
  preview: z.boolean().optional(),
};

export function registerOrderTools(
  server: McpServer,
  env: Env,
  tenantId: string,
  wiring: OrderWiring,
): void {
  server.registerTool(
    "place_order",
    {
      description:
        "Order-time flush: resolve the WHOLE to-buy set against current Kroger availability, write the cart (PUT /v1/cart/add), and cache learned SKU mappings to the shared SKU cache. The to-buy set is the active grocery list ∪ the MEAL PLAN'S OWN INGREDIENT NEEDS − pantry on-hand, joined on canonical ingredient ids: the tool derives the plan's needs SERVER-SIDE from each planned recipe's derived full ingredient list — do NOT hand-expand planned recipes into `menu_needs`. `menu_needs` is for SUPPLEMENTS only (open-world side ingredients, spontaneous extras); passing an item the plan already derives (or the list already holds) is harmless — the canonical-id union merges duplicates into one line, never a double-buy. Planned recipes whose ingredient list is not yet derived are returned in `underived` (their items are NOT in the set — compensate explicitly rather than assuming they were bought). `exclude: [names]` drops lines from the to-buy set BEFORE resolution — an order-scoped opt-out (a derived line has no row to remove); it persists nowhere beyond this call. Ambiguous/unavailable items return as a single `checkpoint` (NOT added) for the user to disposition; pantry overlaps return as `partials` to prompt on (confirm via `include_partials`). Resolved items advance to status:in_cart BEFORE the cart write and are rolled back to active if the cart write fails (retryable); if the rollback itself fails, `list` reports `{ advanced: true, rolled_back: false }` — those items are marked in_cart with NO cart write (a visible under-buy), and a retried place_order will NOT re-add them. `overrides: [{ name, sku, brand?, size? }]` forces a specific SKU for a line — to disposition an ambiguous/unavailable item OR to lock a SKU you verified (e.g. an on-sale one from `kroger_prices`); a forced SKU bypasses the matcher but is still revalidated for current availability and returned with FRESH price/on_sale, and one that has gone unavailable is checkpointed rather than carted. NOTE: overrides pin the SKU, not the price — the cart write carries only SKU + quantity, so whether a sale price realizes is Kroger's call at fulfillment (against possibly-stale flyer data). Resolved lines carry `price`/`on_sale` so you can spot a lapsed deal at preview. SKU-cache commit and cart write are independent best-effort — partial status is reported honestly; the cart is never reported populated when its write failed (check `cart.code` for `reauth_required`). The mapping commit covers EVERY resolved line (cache hits included) and carries each resolved product's aisle placement when Kroger reports one; an already-cached row is skipped only when its learned fields (SKU/brand/size/aisle) are identical, otherwise refreshed in place — mappings and placements converge with each order (feeding read_to_buy's enrich walk). The ONLY tool that writes a Kroger cart. Default buy = 1 package per item; set a count via `menu_needs[].quantity` (or the `quantities` map, which overrides it). Lines that defaulted to 1 are returned with `assumed_quantity: true`. preview=true resolves and reports without writing anything.",
      inputSchema: PLACE_ORDER_INPUT_SHAPE,
    },
    (input) => runTool(() => runPlaceOrder(env, tenantId, input, wiring)),
  );
}
