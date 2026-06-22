// place_order tool registration (order-placement capability). Wires the pure
// orchestrator in order.ts to the real I/O: the Change 05 matcher (resolution),
// the KV grocery-list + pantry reads, and the user-context Kroger client (cart
// write). It is the ONLY tool that writes a Kroger cart.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import type { GitHubClient, TreeFile } from "./github.js";
import { readOptional } from "./gh-read.js";
import { parseToml } from "./parse.js";
import { stringifyTomlWithHeader } from "./serialize.js";
import { runTool } from "./errors.js";
import { commitFiles } from "./commit.js";
import { normalizeName, type GroceryItem } from "./grocery.js";
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
import { getGroceryListState, writeGroceryListState, getPantryState } from "./user-kv.js";

const SKU_CACHE_PATH = "skus/kroger.toml";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

type Resolver = (
  name: string,
  context?: MatchContext,
  bypassCache?: boolean,
) => Promise<MatchResult>;

/**
 * Read the shared skus/kroger.toml, append only genuinely new (ingredient, sku)
 * pairs, commit. Each new entry is tagged with the caller's resolved `locationId`
 * (D7) so a cross-tenant cache hit can be revalidated against the right store.
 * `gh` here is the SHARED (root) client — the SKU cache lives in the shared corpus.
 */
function makeCommitSkuCache(gh: GitHubClient, getLocationId: () => Promise<string>) {
  return async (mappings: NewMapping[]): Promise<string | null> => {
    const text = (await readOptional(gh, SKU_CACHE_PATH)) ?? "";
    const data = text ? parseToml(text, SKU_CACHE_PATH) : {};
    const existing = Array.isArray(data.mappings)
      ? (data.mappings as Record<string, unknown>[])
      : [];
    const seen = new Set(existing.map((m) => `${String(m.ingredient)}\0${String(m.sku)}`));

    const additions: Record<string, unknown>[] = [];
    let locationId: string | null = null;
    for (const m of mappings) {
      const key = `${m.ingredient}\0${m.sku}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (locationId === null) locationId = await getLocationId();
      const entry: Record<string, unknown> = { ingredient: m.ingredient, sku: m.sku };
      if (m.brand) entry.brand = m.brand;
      if (m.size) entry.size = m.size;
      if (locationId) entry.locationId = locationId;
      additions.push(entry);
    }
    if (additions.length === 0) return null;

    const file: TreeFile = {
      path: SKU_CACHE_PATH,
      content: stringifyTomlWithHeader(text, { ...data, mappings: [...existing, ...additions] }),
    };
    const { commit_sha } = await commitFiles(
      gh,
      [file],
      `cache SKU mappings: ${additions.map((a) => a.ingredient).join(", ")}`,
    );
    return commit_sha;
  };
}

/** Advance the resolved lines to status:in_cart, adding any missing list entries. */
function makeAdvanceInCart(
  dataKv: KVNamespace,
  username: string,
) {
  return async (lines: ResolvedLine[]): Promise<void> => {
    const items = await getGroceryListState(dataKv, username);
    const next: GroceryItem[] = items.map((it) => ({ ...it, for_recipes: [...it.for_recipes] }));
    const indexByKey = new Map(next.map((it, i) => [normalizeName(it.name), i]));

    for (const line of lines) {
      const key = normalizeName(line.name);
      const idx = indexByKey.get(key);
      if (idx != null) {
        next[idx] = { ...next[idx], status: "in_cart" };
      } else {
        // A menu need that wasn't on the list yet — track it through the lifecycle.
        next.push({
          name: line.name,
          quantity: "1",
          kind: "grocery",
          domain: "grocery",
          status: "in_cart",
          source: "menu",
          for_recipes: [],
          note: null,
          added_at: today(),
          ordered_at: null,
        });
      }
    }

    await writeGroceryListState(dataKv, username, next);
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
  sharedGh: GitHubClient,
  env: Env,
  tenantId: string,
  resolve: Resolver,
  getLocationId: () => Promise<string>,
): void {
  // The SKU cache is shared corpus (root client); the grocery list + pantry are
  // this tenant's personal state (KV-backed).
  const dataKv = env.DATA_KV;
  const commitSkuCache = makeCommitSkuCache(sharedGh, getLocationId);
  const advanceInCart = makeAdvanceInCart(dataKv, tenantId);

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

        const list = await getGroceryListState(dataKv, tenantId);

        const pantryItems = await getPantryState(dataKv, tenantId);
        const pantryNames = new Set<string>(
          pantryItems
            .map((p) => (typeof p.name === "string" ? normalizeName(p.name) : null))
            .filter((n): n is string => n !== null),
        );

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
