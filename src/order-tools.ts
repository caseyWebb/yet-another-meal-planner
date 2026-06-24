// place_order tool registration (order-placement capability). Wires the pure
// orchestrator in order.ts to the real I/O: the Change 05 matcher (resolution),
// the D1 grocery-list + pantry reads, and the user-context Kroger client (cart
// write). It is the ONLY tool that writes a Kroger cart.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import { runTool } from "./errors.js";
import { normalizeName } from "./grocery.js";
import { upsertSkuMappings, readSkuCache, type NewSkuMapping } from "./corpus-db.js";
import type { MatchContext, MatchResult } from "./matching.js";
import {
  computeToBuy,
  placeOrder,
  type NewMapping,
  type Override,
  type PlaceOrderDeps,
  type ResolvedLine,
} from "./order.js";
import { createKrogerUserClient, toToolError, type KvStore } from "./kroger-user.js";
import { readGroceryList, readPantryNames, advanceInCartRows } from "./session-db.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

type Resolver = (
  name: string,
  context?: MatchContext,
  bypassCache?: boolean,
) => Promise<MatchResult>;

/**
 * Upsert genuinely new (ingredient, location) SKU mappings into the D1 `sku_cache`
 * table (the indexed lookup the matcher reads). Each entry is tagged with the
 * caller's resolved `locationId` (D7) so a cross-tenant cache hit revalidates against
 * the right store, and stamped `last_used` today (for revalidation/pruning). The SKU
 * cache is shared corpus — no tenant column. Returns null (D1 has no commit sha).
 */
function makeCommitSkuCache(env: Env, getLocationId: () => Promise<string>) {
  return async (mappings: NewMapping[]): Promise<string | null> => {
    if (mappings.length === 0) return null;
    // Skip mappings already cached for the resolved location (the old (ingredient,sku)
    // de-dup, now keyed by the table's (ingredient, location_id) PK).
    const locationId = await getLocationId();
    const existing = await readSkuCache(env);
    const have = new Set(
      existing.map((m) => `${m.ingredient}\0${m.locationId ?? ""}`),
    );
    const stamp = today();
    const toWrite: NewSkuMapping[] = [];
    for (const m of mappings) {
      const key = `${m.ingredient}\0${locationId}`;
      if (have.has(key)) continue;
      have.add(key);
      toWrite.push({
        ingredient: m.ingredient,
        sku: m.sku,
        brand: m.brand,
        size: m.size,
        locationId,
        last_used: stamp,
      });
    }
    if (toWrite.length > 0) await upsertSkuMappings(env, toWrite);
    return null;
  };
}

/** Advance the resolved lines to status:in_cart, adding any missing list entries. */
function makeAdvanceInCart(env: Env, username: string) {
  return async (lines: ResolvedLine[]): Promise<void> => {
    await advanceInCartRows(env, username, lines, today());
  };
}

const menuNeedShape = {
  name: z.string(),
  quantity: z.number().optional(),
  for_recipes: z.array(z.string()).optional(),
};

const overrideShape = {
  name: z.string(),
  sku: z.string(),
  brand: z.string().optional(),
  size: z.string().nullable().optional(),
};

export function registerOrderTools(
  server: McpServer,
  env: Env,
  tenantId: string,
  resolve: Resolver,
  getLocationId: () => Promise<string>,
): void {
  // The SKU cache is shared corpus (the D1 `sku_cache` table); the grocery list +
  // pantry are this tenant's personal state (also D1-backed).
  const commitSkuCache = makeCommitSkuCache(env, getLocationId);
  const advanceInCart = makeAdvanceInCart(env, tenantId);

  server.registerTool(
    "place_order",
    {
      description:
        "Order-time flush: resolve the whole grocery list (∪ menu_needs − pantry on-hand) against current Kroger availability, write the cart (PUT /v1/cart/add), and cache learned SKU mappings to the shared SKU cache. Ambiguous/unavailable items return as a single `checkpoint` (NOT added) for the user to disposition; pantry overlaps return as `partials` to prompt on. Resolved items advance to status:in_cart only after a successful cart write. SKU-cache commit and cart write are independent best-effort — partial status is reported honestly; the cart is never reported populated when its write failed (check `cart.code` for `reauth_required`). The ONLY tool that writes a Kroger cart. Default buy = 1 package per item; set a count via `menu_needs[].quantity` (or the `quantities` map, which overrides it). Lines that defaulted to 1 are returned with `assumed_quantity: true`. preview=true resolves and reports without writing anything.",
      inputSchema: {
        menu_needs: z.array(z.object(menuNeedShape)).optional(),
        quantities: z.record(z.string(), z.number()).optional(),
        include_partials: z.array(z.string()).optional(),
        overrides: z.array(z.object(overrideShape)).optional(),
        preview: z.boolean().optional(),
      },
    },
    (input) =>
      runTool(async () => {
        const kv = env.KROGER_KV as unknown as KvStore;
        const userClient = createKrogerUserClient(env, kv, tenantId);

        const list = await readGroceryList(env, tenantId);
        const pantryNames = await readPantryNames(env, tenantId);

        const quantities: Record<string, number> = {};
        for (const [k, v] of Object.entries(input.quantities ?? {})) {
          quantities[normalizeName(k)] = v;
        }
        const includePartials = new Set((input.include_partials ?? []).map(normalizeName));

        const { to_buy, partials } = computeToBuy({
          list,
          menuNeeds: input.menu_needs,
          pantryNames,
          quantities,
          includePartials,
        });

        const overrides = new Map<string, Override>();
        for (const o of input.overrides ?? []) {
          overrides.set(normalizeName(o.name), { sku: o.sku, brand: o.brand, size: o.size ?? null });
        }

        const deps: PlaceOrderDeps = {
          resolve: (name) => resolve(name),
          commitSkuCache,
          cartAdd: async (lines) => {
            try {
              await userClient.addToCart(lines.map((l) => ({ upc: l.sku, quantity: l.quantity })));
            } catch (e) {
              throw toToolError(e);
            }
          },
          advanceInCart,
        };

        const result = await placeOrder(deps, to_buy, { overrides, preview: input.preview });
        return { ...result, partials };
      }),
  );
}
