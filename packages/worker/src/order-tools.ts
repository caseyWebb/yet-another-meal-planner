// place_order tool registration + the shared order operation (order-placement /
// member-app-grocery D4/D8). `runPlaceOrder` is the whole order-time flush as one
// operation — list+pantry reads → the server-side plan-needs derivation → funnel-keyed
// input maps → `computeToBuy` (∪ caller menu_needs − pantry) → order-scoped `exclude`
// → `placeOrder` over the real deps — called by the MCP tool (with buildServer's
// per-request closures as its wiring) and by `POST /api/grocery/order` (over
// `buildOrderWiring`, tools.ts). It is the ONLY path that writes a Kroger cart.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { OrderReviewStageSchema } from "@yamp/contract";
import type { Env } from "./env.js";
import type { KrogerCandidate } from "./kroger.js";
import { runTool, ToolError } from "./errors.js";
import {
  upsertSkuMappings,
  readSkuCache,
  ingredientContext,
  readIngredientCategoryMemo,
  type NewSkuMapping,
} from "./corpus-db.js";
import { normalizeIngredient, deriveSavings, type MatchContext, type MatchResult } from "./matching.js";
import { storedGroceryKey } from "./grocery.js";
import { departmentForGroceryLine } from "./department.js";
import { snapshotStatements, type SendSnapshot, type SnapshotLine } from "./spend.js";
import {
  computeToBuy,
  placeOrder,
  type InCartAdvance,
  type NewMapping,
  type Override,
  type PlaceOrderDeps,
  type ResolvedLine,
  type RevalidatedSku,
  type SkuCacheCommitReceipt,
  type ToBuyItem,
} from "./order.js";
import type { PlaceOrderInput, PlaceOrderOutcome } from "./order-shapes.js";

// The op's input/outcome shapes live in the leaf order-shapes.ts (member-app-grocery D9
// — the app harness types its order fixtures against them); re-exported unchanged.
export type { PlaceOrderInput, PlaceOrderOutcome } from "./order-shapes.js";
import { deriveMenuNeeds, dropInFlightNeeds, readGroceryDecisionInputs } from "./to-buy.js";
import { createKrogerUserClient, toToolError, type KvStore } from "./kroger-user.js";
import {
  readGroceryList,
  readPantryNames,
  advanceInCartRows,
  rollbackInCartRows,
  mintEventId,
  type SendBatch,
} from "./session-db.js";

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
  /** Injectable cart boundary for deterministic tests; production omits it. */
  cartAdd?(lines: ResolvedLine[]): Promise<void>;
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
export function makeCommitSkuCache(env: Env, getLocationId: () => Promise<string>) {
  return async (mappings: NewMapping[]): Promise<SkuCacheCommitReceipt> => {
    if (mappings.length === 0) return { inserted: [], updated: [], unchanged: [] };
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
    const inserted: string[] = [];
    const updated: string[] = [];
    const unchanged: string[] = [];
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
      if (priorKey === fresh) {
        unchanged.push(m.ingredient);
        continue;
      }
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
      (prior ? updated : inserted).push(m.ingredient);
    }
    if (toWrite.length > 0) await upsertSkuMappings(env, toWrite);
    // Receipts describe authoritative post-write state, not the optimistic pre-read.
    // A concurrent writer that wins after our comparison is surfaced as a cache
    // conflict; callers report the cache leg failed without overstating learning.
    if (toWrite.length > 0) {
      const after = new Map((await readSkuCache(env)).map((m) => [`${m.ingredient}\0${m.locationId ?? ""}`, m]));
      for (const intended of toWrite) {
        const actual = after.get(`${intended.ingredient}\0${locationId}`);
        if (!actual || actual.sku !== intended.sku || (actual.brand ?? undefined) !== intended.brand || (actual.size ?? undefined) !== intended.size ||
          (actual.aisle?.number ?? null) !== intended.aisle_number || (actual.aisle?.description ?? null) !== intended.aisle_description || (actual.aisle?.side ?? null) !== intended.aisle_side) {
          throw new ToolError("conflict", `SKU cache changed concurrently for ${intended.ingredient}`);
        }
      }
    }
    return { inserted, updated, unchanged };
  };
}

/** The order-context inputs the send-record snapshot is derived from (spend-telemetry),
 *  captured by `runPlaceOrder` where the three input sets are still distinguishable.
 *  Exported (with `buildKrogerSendSnapshot`) for direct mapping tests. */
export interface SnapshotContext {
  getLocationId(): Promise<string>;
  /** The to-buy line per canonical key — carries `for_recipes` (provenance input D6). */
  toBuyByKey: Map<string, ToBuyItem>;
  /** Stored grocery rows' kind/domain by key — the deterministic `household` override. */
  storedByKey: Map<string, { kind: string; domain: string }>;
  /** Keys of stored `grocery_list` rows (a line from the stored list is `planned`). */
  storedKeys: Set<string>;
  /** Keys of the server-derived plan needs (a plan-derived line is `planned`). */
  planKeys: Set<string>;
}

/**
 * Build the Kroger flush's send record from the resolved lines (design D1/D5/D6):
 * per-line resolution prices as the send-time quote (`unit_price` = promo when on sale
 * else regular; `savings` via the shared `deriveSavings`; `estimated: 0`), the D17
 * `department` via the shared grocery-line derivation (deterministic `household`
 * overrides immediate, identity-memo categories, NULL = pending), and the deterministic
 * provenance mapping (`planned` when the key came from the stored list or the derived
 * plan needs, or the merged `for_recipes` is non-empty; else `impulse` — a bare caller
 * extra). Store placement is never consulted (D17).
 */
export async function buildKrogerSendSnapshot(
  env: Env,
  tenant: string,
  lines: ResolvedLine[],
  ctx: SnapshotContext,
): Promise<{ send: SendSnapshot; snapLines: SnapshotLine[] }> {
  const locationId = await ctx.getLocationId();
  // One batched memo read for the food keys (a non-food line stamps `household`
  // deterministically and never consults the identity graph).
  const foodKeys = lines
    .map((l) => l.key)
    .filter((key) => {
      const stored = ctx.storedByKey.get(key);
      return (stored?.kind ?? "grocery") === "grocery" && (stored?.domain ?? "grocery") === "grocery";
    });
  const memo = foodKeys.length > 0 ? await readIngredientCategoryMemo(env, foodKeys) : new Map<string, string>();

  const send: SendSnapshot = {
    id: mintEventId(),
    tenant,
    store: "kroger",
    locationId,
    fulfillment: "kroger_online",
    orderListId: null,
    createdAt: new Date().toISOString(),
  };
  const snapLines: SnapshotLine[] = lines.map((l) => {
    const stored = ctx.storedByKey.get(l.key);
    const toBuy = ctx.toBuyByKey.get(l.key);
    const forRecipes = toBuy?.for_recipes ?? [];
    const planned = ctx.storedKeys.has(l.key) || ctx.planKeys.has(l.key) || forRecipes.length > 0;
    const onSale = l.on_sale ?? null;
    return {
      lineKey: l.key,
      name: l.name,
      sku: l.sku,
      brand: l.brand || null,
      size: l.size ?? null,
      quantity: l.quantity,
      priceRegular: l.price?.regular ?? null,
      pricePromo: l.price?.promo ?? null,
      onSale,
      unitPrice: l.price ? (onSale ? l.price.promo : l.price.regular) : null,
      savings: l.price ? (onSale ? deriveSavings(l.price) : 0) : null,
      estimated: 0,
      department: departmentForGroceryLine(
        { key: l.key, kind: stored?.kind, domain: stored?.domain },
        (k) => memo.get(k),
      ),
      provenance: planned ? "planned" : "impulse",
      forRecipes,
    };
  });
  return { send, snapLines };
}

/** Advance the resolved lines to status:in_cart, adding any missing list entries;
 *  returns the inserted-keys receipt the rollback compensates with. With a snapshot
 *  context, the send record is built here and composed into the SAME batch as the
 *  advance (the send exists iff the advance succeeded); a snapshot-BUILD failure
 *  degrades to a bare advance + `sendError` — it must never fail the flush (D4). */
function makeAdvanceInCart(env: Env, username: string, snapshotCtx?: SnapshotContext) {
  return async (lines: ResolvedLine[]): Promise<InCartAdvance> => {
    let send: SendBatch | undefined;
    let sendError: string | undefined;
    if (snapshotCtx) {
      try {
        const { send: record, snapLines } = await buildKrogerSendSnapshot(env, username, lines, snapshotCtx);
        send = { id: record.id, statements: snapshotStatements(env, record, snapLines) };
      } catch (e) {
        sendError = e instanceof Error ? e.message : String(e);
      }
    }
    const receipt = await advanceInCartRows(env, username, lines, today(), send);
    return { ...receipt, sendId: send?.id, ...(sendError ? { sendError } : {}) };
  };
}

/** Undo a failed-cart-write advance: pre-existing rows back to status:active,
 *  advance-inserted rows deleted (per the receipt), and the advance's send record
 *  deleted alongside (no phantom order survives a failed cart write). */
function makeRollbackInCart(env: Env, username: string) {
  return async (lines: ResolvedLine[], advance: InCartAdvance): Promise<void> => {
    await rollbackInCartRows(env, username, lines, advance.inserted, advance.sendId);
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
  execution: { beforeCommit?(resolved: ResolvedLine[], checkpoint: import("./order-shapes.js").CheckpointLine[]): Promise<void> | void } = {},
): Promise<PlaceOrderOutcome> {
  const kv = env.KROGER_KV as unknown as KvStore;
  const userClient = createKrogerUserClient(env, kv, tenantId);
  const commitSkuCache = makeCommitSkuCache(env, wiring.getLocationId);
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
  const decisions = await readGroceryDecisionInputs(env, tenantId, planNeeds, list, (n) => ingredientCtx.resolve(n));
  for (const key of decisions.includePartials) includePartials.add(key);

  const { to_buy, partials } = computeToBuy({
    list,
    menuNeeds,
    pantryNames,
    quantities,
    includePartials,
    suppressedKeys: decisions.suppressedKeys,
    resolve: (n) => ingredientCtx.resolve(n),
  });

  // Order-scoped exclude (D4/D6): resolved through the same funnel and dropped BEFORE
  // resolution — not resolved, not checkpointed, not carted; persisted nowhere.
  const excludeKeys = new Set((input.exclude ?? []).map((n) => ingredientCtx.resolve(n)));
  const lines = excludeKeys.size > 0 ? to_buy.filter((l) => !excludeKeys.has(l.key)) : to_buy;

  // The send-record snapshot's inputs (spend-telemetry D6), captured HERE where the
  // three origin sets are still distinguishable: stored-list keys ∪ derived-plan keys
  // (→ `planned`), stored rows' kind/domain (the `household` override), and each line's
  // merged to-buy `for_recipes`. Built from data already in hand — no extra reads.
  const advanceInCart = makeAdvanceInCart(env, tenantId, {
    getLocationId: wiring.getLocationId,
    toBuyByKey: new Map(lines.map((l) => [l.key, l])),
    storedByKey: new Map(
      list.map((it) => [storedGroceryKey(it, (n) => ingredientCtx.resolve(n)), { kind: it.kind, domain: it.domain }]),
    ),
    storedKeys: new Set(list.map((it) => storedGroceryKey(it, (n) => ingredientCtx.resolve(n)))),
    planKeys: new Set(planNeeds.map((n) => ingredientCtx.resolve(n.name))),
  });

  const overrides = new Map<string, Override>();
  for (const o of input.overrides ?? []) {
    overrides.set(ingredientCtx.resolve(o.name), { sku: o.sku, brand: o.brand, size: o.size ?? null });
  }

  const deps: PlaceOrderDeps = {
    resolve: (name) => wiring.resolve(name),
    revalidateSku: (sku) => wiring.revalidateSku(sku),
    normalize: (name) => normalizeIngredient(name, ingredientCtx.resolver.toId),
    commitSkuCache,
    cartAdd: wiring.cartAdd ?? (async (cartLines) => {
      try {
        await userClient.addToCart(cartLines.map((l) => ({ upc: l.sku, quantity: l.quantity })));
      } catch (e) {
        throw toToolError(e);
      }
    }),
    advanceInCart,
    rollbackInCart,
  };

  const result = await placeOrder(deps, lines, {
    overrides,
    preview: input.preview,
    resolveKey: (n) => ingredientCtx.resolve(n),
    beforeCommit: execution.beforeCommit,
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
  stage: OrderReviewStageSchema.optional(),
  preview_fingerprint: z.string().optional(),
  cleared_cart_ack: z.boolean().optional(),
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
        "Order-time flush: resolve the WHOLE to-buy set against current Kroger availability, write the cart (PUT /v1/cart/add), and cache learned SKU mappings to the shared SKU cache. The to-buy set is the active grocery list ∪ the MEAL PLAN'S OWN INGREDIENT NEEDS − pantry on-hand, joined on canonical ingredient ids: the tool derives the plan's needs SERVER-SIDE from each planned recipe's derived full ingredient list — do NOT hand-expand planned recipes into `menu_needs`. `menu_needs` is for SUPPLEMENTS only (open-world side ingredients, spontaneous extras); passing an item the plan already derives (or the list already holds) is harmless — the canonical-id union merges duplicates into one line, never a double-buy. Planned recipes whose ingredient list is not yet derived are returned in `underived` (their items are NOT in the set — compensate explicitly rather than assuming they were bought). `exclude: [names]` drops lines from the to-buy set BEFORE resolution — an order-scoped opt-out (a derived line has no row to remove); it persists nowhere beyond this call. Ambiguous/unavailable items return as a single `checkpoint` (NOT added) for the user to disposition; pantry overlaps return as `partials` to prompt on (confirm via `include_partials`). Resolved items advance to status:in_cart BEFORE the cart write and are rolled back to active if the cart write fails (retryable); if the rollback itself fails, `list` reports `{ advanced: true, rolled_back: false }` — those items are marked in_cart with NO cart write (a visible under-buy), and a retried place_order will NOT re-add them. `overrides: [{ name, sku, brand?, size? }]` forces a specific SKU for a line — to disposition an ambiguous/unavailable item OR to lock a SKU you verified (e.g. an on-sale one from `kroger_prices`); a forced SKU bypasses the matcher but is still revalidated for current availability and returned with FRESH price/on_sale, and one that has gone unavailable is checkpointed rather than carted. NOTE: overrides pin the SKU, not the price — the cart write carries only SKU + quantity, so whether a sale price realizes is Kroger's call at fulfillment (against possibly-stale flyer data). Resolved lines carry `price`/`on_sale` so you can spot a lapsed deal at preview. SKU-cache commit and cart write are independent best-effort — partial status is reported honestly; the cart is never reported populated when its write failed (check `cart.code` for `reauth_required`). A real (non-preview) flush also persists a SEND RECORD — a per-line snapshot of the resolved picks and their resolution-time prices (send-time QUOTES: the cart write carries only SKU + quantity, so fulfillment may differ) — written atomically with the list advance and reported in `send` ({ recorded, id?, error? }); it is the spend-telemetry source materialized when the user later asserts the order was placed (the `in_cart → ordered` advance). A rolled-back cart write deletes it (no phantom order), and a snapshot failure never blocks the flush — `send.recorded: false` with the reason, rows advance without telemetry. The mapping commit covers EVERY resolved line (cache hits included) and carries each resolved product's aisle placement when Kroger reports one; an already-cached row is skipped only when its learned fields (SKU/brand/size/aisle) are identical, otherwise refreshed in place — mappings and placements converge with each order (feeding read_to_buy's enrich walk). The ONLY tool that writes a Kroger cart. Default buy = 1 package per item; set a count via `menu_needs[].quantity` (or the `quantities` map, which overrides it). Lines that defaulted to 1 are returned with `assumed_quantity: true`. preview=true resolves and reports without writing anything.",
      inputSchema: PLACE_ORDER_INPUT_SHAPE,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    (input) => runTool(async () => {
      if (input.preview_fingerprint) {
        const { sendOrderReview } = await import("./order-review.js");
        return sendOrderReview(env, tenantId, {
          stage: input.stage,
          preview_fingerprint: input.preview_fingerprint,
          cleared_cart_ack: input.cleared_cart_ack ?? false,
        }, { wiring });
      }
      return runPlaceOrder(env, tenantId, input, wiring);
    }),
  );
}
