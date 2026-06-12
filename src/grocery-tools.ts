// Grocery-list CRUD tools (grocery-list capability). The buy list accumulates
// SKU-free intent across the week; resolution to a Kroger SKU and the cart write
// are deferred to order placement (Change 06b). Mutations persist via the atomic
// commit engine. Lifecycle: this change only ever writes `status: "active"`;
// the in_cart/ordered/received transitions land with place_order in 06b.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GitHubClient, TreeFile } from "./github.js";
import { readOptional } from "./gh-read.js";
import { parseToml } from "./parse.js";
import { stringifyTomlWithHeader } from "./serialize.js";
import { ToolError, runTool } from "./errors.js";
import { commitFiles } from "./commit.js";
import {
  addToGroceryList,
  removeGroceryItem,
  updateGroceryItem,
  type GroceryItem,
  type GroceryAddInput,
  type GroceryUpdateInput,
} from "./grocery.js";

export const GROCERY_LIST_PATH = "grocery_list.toml";
const PATH = GROCERY_LIST_PATH;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function coerceGroceryItem(raw: Record<string, unknown>): GroceryItem {
  return coerceItem(raw);
}

function coerceItem(raw: Record<string, unknown>): GroceryItem {
  return {
    name: typeof raw.name === "string" ? raw.name : "",
    quantity: typeof raw.quantity === "string" ? raw.quantity : "1",
    kind: (raw.kind as GroceryItem["kind"]) ?? "grocery",
    // Legacy items written before the domain facet read as "grocery".
    domain: typeof raw.domain === "string" ? raw.domain : "grocery",
    status: (raw.status as GroceryItem["status"]) ?? "active",
    source: (raw.source as GroceryItem["source"]) ?? "ad_hoc",
    for_recipes: Array.isArray(raw.for_recipes) ? (raw.for_recipes as string[]) : [],
    note: typeof raw.note === "string" ? raw.note : null,
    added_at: typeof raw.added_at === "string" ? raw.added_at : today(),
    ordered_at: typeof raw.ordered_at === "string" ? raw.ordered_at : null,
  };
}

/** Load the current list: its raw text (for header preservation), top-level data, and items. */
export async function loadGroceryList(
  gh: GitHubClient,
): Promise<{ text: string; data: Record<string, unknown>; items: GroceryItem[] }> {
  const text = (await readOptional(gh, PATH)) ?? "";
  const data = text ? parseToml(text, PATH) : {};
  const rawItems = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
  return { text, data, items: rawItems.map(coerceItem) };
}
const loadList = loadGroceryList;

export function serializeGroceryList(
  text: string,
  data: Record<string, unknown>,
  items: GroceryItem[],
): TreeFile {
  return { path: PATH, content: stringifyTomlWithHeader(text, { ...data, items }) };
}
const writeFile = serializeGroceryList;

/** One batched grocery-list op for `commit_changes`' `grocery_list_ops`. */
export interface GroceryListOp {
  op: "add" | "update" | "remove";
  /** Full add input for `add`; the partial patch for `update`. Ignored for `remove`. */
  item?: Record<string, unknown>;
  /** The item key for `update` / `remove`. */
  name?: string;
}

/**
 * Apply a batch of add/update/remove ops over the grocery list at `path`, in array
 * order, and return the file to commit (null when nothing changed) plus a per-op
 * applied/conflicts report — the same shape as buildMealPlanUpdate / buildPantryUpdate.
 * Same-name adds MERGE (addToGroceryList semantics, so a later op sees the earlier
 * one); an update/remove for an absent name is reported as a conflict, not thrown.
 * Reads/writes via the passed `gh` at the explicit `path` so commit_changes can
 * route it under the caller's `users/<username>/` subtree in the same atomic commit.
 */
export async function buildGroceryListUpdate(
  gh: GitHubClient,
  path: string,
  ops: GroceryListOp[],
): Promise<{ file: TreeFile | null; applied: unknown[]; conflicts: unknown[] }> {
  const todayDate = today();
  const text = (await readOptional(gh, path)) ?? "";
  const data = text ? parseToml(text, path) : {};
  const rawItems = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
  let items = rawItems.map(coerceItem);

  const applied: unknown[] = [];
  const conflicts: unknown[] = [];

  for (const op of ops) {
    if (op.op === "add") {
      const input = (op.item ?? {}) as unknown as GroceryAddInput;
      if (!input.name || !String(input.name).trim()) {
        conflicts.push({ op: "add", reason: "add requires item.name" });
        continue;
      }
      const result = addToGroceryList(items, input, todayDate);
      items = result.items;
      applied.push({ op: "add", name: result.item.name, merged: result.merged });
    } else if (op.op === "update") {
      const name = op.name ?? "";
      try {
        const result = updateGroceryItem(items, name, (op.item ?? {}) as GroceryUpdateInput);
        items = result.items;
        applied.push({ op: "update", name: result.item.name });
      } catch {
        conflicts.push({ op: "update", name, reason: "no grocery-list item with that name" });
      }
    } else {
      const name = op.name ?? "";
      const result = removeGroceryItem(items, name);
      if (result.found) {
        items = result.items;
        applied.push({ op: "remove", name });
      } else {
        conflicts.push({ op: "remove", name, reason: "no grocery-list item with that name" });
      }
    }
  }

  if (applied.length === 0) return { file: null, applied, conflicts };
  return { file: { path, content: stringifyTomlWithHeader(text, { ...data, items }) }, applied, conflicts };
}

export function registerGroceryListTools(server: McpServer, gh: GitHubClient): void {
  server.registerTool(
    "read_grocery_list",
    {
      description: "Return the current grocery list (the SKU-free buy list for the next order).",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        const { items } = await loadList(gh);
        return { items };
      }),
  );

  server.registerTool(
    "add_to_grocery_list",
    {
      description:
        "Add an item to the grocery list (ingredient/product level, no SKU). Re-adding an existing name merges into it (union for_recipes, reconcile quantity) rather than duplicating. New items start status=active. `domain` (default 'grocery') is the kind of store it's bought at (grocery | home-improvement | garden | pharmacy | …) — set it for a non-grocery item (e.g. '2x4 lumber' → 'home-improvement') so the in-store walk for that store-type includes it and a grocery walk excludes it.",
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
        const { text, data, items } = await loadList(gh);
        const result = addToGroceryList(items, input, today());
        const { commit_sha } = await commitFiles(
          gh,
          [writeFile(text, data, result.items)],
          `${result.merged ? "update" : "add"} grocery list: ${result.item.name}`,
        );
        return { item: result.item, merged: result.merged, commit_sha };
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
        const { text, data, items } = await loadList(gh);
        let result;
        try {
          result = updateGroceryItem(items, name, patch);
        } catch {
          throw new ToolError("not_found", `No grocery-list item named: ${name}`, { name });
        }
        const { commit_sha } = await commitFiles(
          gh,
          [writeFile(text, data, result.items)],
          `update grocery list: ${result.item.name}`,
        );
        return { item: result.item, commit_sha };
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
        const { text, data, items } = await loadList(gh);
        const { items: nextItems, found } = removeGroceryItem(items, name);
        if (!found) return { removed: false };
        const { commit_sha } = await commitFiles(
          gh,
          [writeFile(text, data, nextItems)],
          `remove from grocery list: ${name}`,
        );
        return { removed: true, commit_sha };
      }),
  );
}
