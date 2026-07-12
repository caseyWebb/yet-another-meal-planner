// Grocery-list CRUD tools (grocery-list capability). The buy list accumulates
// SKU-free intent across the week; resolution to a Kroger SKU and the cart write
// are deferred to order placement. Mutations persist as D1 rows (src/session-db.ts).
// Lifecycle: new items start `active`; `active ⇄ in_cart` is freely writable here
// (place_order's resolution also advances resolved lines to `in_cart`); `ordered` is
// reached ONLY by the user-asserted advance from `in_cart` via update_grocery_list
// (which stamps `ordered_at`) or by the satellite receipt flush — the shared update
// op (session-db.ts) guards every other write of `ordered` with a structured
// `validation_failed` (W3).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import { runTool } from "./errors.js";
import { type GroceryItem, type GroceryAddInput, type GroceryUpdateInput } from "./grocery.js";
import { readGroceryListReified, addGroceryRow, updateGroceryRow, removeGroceryRow } from "./session-db.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function registerGroceryListTools(
  server: McpServer,
  env: Env,
  username: string,
): void {
  server.registerTool(
    "read_grocery_list",
    {
      description:
        "Return STORED grocery rows only (all statuses), including checked_at, row_version, updated_at, and internal sent_in. Checked is a durable shop mark orthogonal to status — it never means in_cart. For virtual plan needs and the checked-aware shopping partition use read_to_buy; when the member wants to see the interactive list use display_grocery_list.",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        const items = await readGroceryListReified(env, username);
        return { items };
      }),
  );

  server.registerTool(
    "add_to_grocery_list",
    {
      description:
        "Add an item to the grocery list (ingredient/product level, no SKU). Supply `name` (the member's surface form) and/or `id` — at least one is required. Re-adding an existing name merges into it (union for_recipes, reconcile quantity) rather than duplicating; a merge keeps the surviving row's existing display. New items start status=active. A PLANNED recipe's ingredient needs NO add — the to-buy set derives them from the meal plan automatically (`read_to_buy`); adding one anyway MATERIALIZES/pins it as an explicit row (do this to carry a quantity annotation or note, e.g. a double-batch scaling) — it upserts under the same canonical id, so the row and the derived need merge into one line, never a duplicate. `id` is an ALREADY-CANONICAL ingredient id (e.g. accepting a graph-sibling swap): when supplied it is treated as a canonical key — validated as a LIVE survivor, NOT re-resolved through the funnel — the row keys and dedups on it directly, and stores a clean human DISPLAY as its `name` (the posted `name` when present, else the identity node's curated label — never the raw id); the key and the display are stored separately, so the row keys on the id while rendering a clean name. An invalid or non-survivor id falls back to resolving `name`. It is food-only (a canonical id implies food). `domain` (default 'grocery') is the kind of store it's bought at (grocery | home-improvement | garden | pharmacy | …) — set it for a non-grocery item (e.g. '2x4 lumber' → 'home-improvement'). `substitutes_for` (optional) is the recipe ingredient this added item STANDS IN FOR when the add is a taste swap you or the member chose (e.g. `add_to_grocery_list('greek yogurt', substitutes_for: 'sour cream')`) — it only records the swap for later suggestions (best-effort, food items only); it does NOT change the row, its quantity, or the order, and a same-ingredient product/price swap needs none.",
      inputSchema: {
        name: z.string().optional(),
        id: z.string().optional(),
        quantity: z.string().optional(),
        kind: z.enum(["grocery", "household", "other"]).optional(),
        domain: z.string().optional(),
        source: z.enum(["ad_hoc", "menu", "pantry_low", "stockup"]).optional(),
        for_recipes: z.array(z.string()).optional(),
        note: z.string().nullable().optional(),
        substitutes_for: z.string().optional(),
      },
    },
    (input) =>
      runTool(async () => {
        const result = await addGroceryRow(env, username, input as GroceryAddInput, today());
        return { item: result.item, merged: result.merged };
      }),
  );

  server.registerTool(
    "update_grocery_list",
    {
      description:
        "Patch an existing grocery-list item by name. Every mutation advances row_version/updated_at and preserves checked_at unless the narrow checked tool changes it. Status is orthogonal to checked. `status: ordered` is accepted only as the compatible per-row in_cart purchase assertion; when a send id is available prefer mark_grocery_send_placed for an exact atomic whole-send assertion. Spend copies the persisted send-time quote verbatim and is never re-priced.",
      inputSchema: {
        name: z.string(),
        quantity: z.string().optional(),
        kind: z.enum(["grocery", "household", "other"]).optional(),
        domain: z.string().optional(),
        status: z.enum(["active", "in_cart", "ordered"]).optional(),
        source: z.enum(["ad_hoc", "menu", "pantry_low", "stockup"]).optional(),
        for_recipes: z.array(z.string()).optional(),
        note: z.string().nullable().optional(),
      },
    },
    ({ name, ...patch }) =>
      runTool(async () => {
        const item = await updateGroceryRow(env, username, name, patch as GroceryUpdateInput);
        return { item };
      }),
  );

  server.registerTool(
    "remove_from_grocery_list",
    {
      description:
        "Remove an item from the grocery list by name. A removal NEVER records spend — it is not a purchase assertion (it is also how a changed mind leaves the list). To record a purchase for an item still `in_cart`, advance it to `ordered` via update_grocery_list BEFORE removing it.",
      inputSchema: { name: z.string() },
    },
    ({ name }) =>
      runTool(async () => {
        const { found } = await removeGroceryRow(env, username, name);
        return { removed: found };
      }),
  );
}

// Exported for use by order-tools.ts (place_order reads the full list).
export { type GroceryItem, type GroceryAddInput };
