// Grocery-list CRUD tools (grocery-list capability). The buy list accumulates
// SKU-free intent across the week; resolution to a Kroger SKU and the cart write
// are deferred to order placement. Mutations persist as D1 rows (src/session-db.ts).
// Lifecycle: this module writes `status: "active"`; the in_cart transition lands with
// place_order.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import { runTool } from "./errors.js";
import { type GroceryItem, type GroceryAddInput, type GroceryUpdateInput } from "./grocery.js";
import { readGroceryList, addGroceryRow, updateGroceryRow, removeGroceryRow } from "./session-db.js";

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
      description: "Return the current grocery list (the SKU-free buy list for the next order).",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        const items = await readGroceryList(env, username);
        return { items };
      }),
  );

  server.registerTool(
    "add_to_grocery_list",
    {
      description:
        "Add an item to the grocery list (ingredient/product level, no SKU). Re-adding an existing name merges into it (union for_recipes, reconcile quantity) rather than duplicating. New items start status=active. `domain` (default 'grocery') is the kind of store it's bought at (grocery | home-improvement | garden | pharmacy | …) — set it for a non-grocery item (e.g. '2x4 lumber' → 'home-improvement').",
      inputSchema: {
        name: z.string(),
        quantity: z.string().optional(),
        kind: z.enum(["grocery", "household", "other"]).optional(),
        domain: z.string().optional(),
        source: z.enum(["ad_hoc", "menu", "pantry_low", "stockup"]).optional(),
        for_recipes: z.array(z.string()).optional(),
        note: z.string().nullable().optional(),
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
      description: "Patch an existing grocery-list item by name. `domain` (default 'grocery') is the store-type the item is bought at — set it to re-file an item onto a different store's in-store walk.",
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
      description: "Remove an item from the grocery list by name.",
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
