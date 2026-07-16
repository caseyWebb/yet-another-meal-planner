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
import { ToolError, runTool } from "./errors.js";
import { type GroceryItem, type GroceryAddInput, type GroceryUpdateInput } from "./grocery.js";
import { addGroceryRow, updateGroceryRow, removeGroceryRow } from "./session-db.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const ADD_DESCRIPTION =
  "Add an item to the grocery list (ingredient/product level, no SKU). Supply `name` (the member's surface form) and/or `id` — at least one is required. Re-adding an existing name merges into it (union for_recipes, reconcile quantity) rather than duplicating; a merge keeps the surviving row's existing display. New items start status=active. A PLANNED recipe's ingredient needs NO add — the to-buy set derives them from the meal plan automatically (`read_to_buy`); adding one anyway MATERIALIZES/pins it as an explicit row (do this to carry a quantity annotation or note, e.g. a double-batch scaling) — it upserts under the same canonical id, so the row and the derived need merge into one line, never a duplicate. `id` is an ALREADY-CANONICAL ingredient id (e.g. accepting a graph-sibling swap): when supplied it is treated as a canonical key — validated as a LIVE survivor, NOT re-resolved through the funnel — the row keys and dedups on it directly, and stores a clean human DISPLAY as its `name` (the posted `name` when present, else the identity node's curated label — never the raw id); the key and the display are stored separately, so the row keys on the id while rendering a clean name. An invalid or non-survivor id falls back to resolving `name`. It is food-only (a canonical id implies food). `domain` (default 'grocery') is the kind of store it's bought at (grocery | home-improvement | garden | pharmacy | …) — set it for a non-grocery item (e.g. '2x4 lumber' → 'home-improvement'). `substitutes_for` (optional) is the recipe ingredient this added item STANDS IN FOR when the add is a taste swap you or the member chose (e.g. substitutes_for: 'sour cream') — it only records the swap for later suggestions (best-effort, food items only); it does NOT change the row, its quantity, or the order, and a same-ingredient product/price swap needs none.";

const ADD_OP_SCHEMA = {
  name: z.string().optional(),
  id: z.string().optional(),
  quantity: z.string().optional(),
  kind: z.enum(["grocery", "household", "other"]).optional(),
  domain: z.string().optional(),
  source: z.enum(["ad_hoc", "menu", "pantry_low", "stockup"]).optional(),
  for_recipes: z.array(z.string()).optional(),
  note: z.string().nullable().optional(),
  substitutes_for: z.string().optional(),
};

/** One `update_grocery_list` operation — the `update_pantry` ops idiom. `add`/`update`
 *  share most fields (unused ones ignored per op); `remove` needs only `name`. */
const GROCERY_OP_SCHEMA = z.object({
  op: z.enum(["add", "update", "remove"]),
  name: z.string().optional(),
  id: z.string().optional(),
  quantity: z.string().optional(),
  kind: z.enum(["grocery", "household", "other"]).optional(),
  domain: z.string().optional(),
  status: z.enum(["active", "in_cart", "ordered"]).optional(),
  source: z.enum(["ad_hoc", "menu", "pantry_low", "stockup"]).optional(),
  for_recipes: z.array(z.string()).optional(),
  note: z.string().nullable().optional(),
  substitutes_for: z.string().optional(),
});

type GroceryOp = z.infer<typeof GROCERY_OP_SCHEMA>;

/** One `applied` entry the ops-form (or its old-form conversion) reports back. */
type GroceryOpApplied =
  | { op: "add"; item: GroceryItem; merged?: true }
  | { op: "update"; item: GroceryItem }
  | { op: "remove"; name: string; removed: boolean };

interface GroceryOpConflict {
  op: "add" | "update" | "remove";
  name?: string;
  reason: string;
  code?: string;
}

/**
 * Apply one grocery-list operation against D1, returning what it did. Never throws a
 * `ToolError` for a per-op semantic failure (an update/remove target that doesn't
 * resolve, an illegal status transition) — the ops-form caller (below) catches those
 * into a `conflicts` entry so one bad op in a multi-op call never sinks the rest; an
 * unexpected (non-ToolError) failure still propagates.
 */
async function applyOneGroceryOp(env: Env, username: string, op: GroceryOp): Promise<GroceryOpApplied> {
  if (op.op === "add") {
    const result = await addGroceryRow(env, username, op as GroceryAddInput, today());
    return result.merged ? { op: "add", item: result.item, merged: true } : { op: "add", item: result.item };
  }
  if (op.op === "remove") {
    if (!op.name) throw new ToolError("validation_failed", "a remove operation requires a name");
    const { found } = await removeGroceryRow(env, username, op.name);
    return { op: "remove", name: op.name, removed: found };
  }
  // "update"
  if (!op.name) throw new ToolError("validation_failed", "an update operation requires a name");
  const { name, op: _op, id: _id, substitutes_for: _sf, ...patch } = op;
  const item = await updateGroceryRow(env, username, name, patch as GroceryUpdateInput, today());
  return { op: "update", item };
}

export function registerGroceryListTools(
  server: McpServer,
  env: Env,
  username: string,
): void {
  // add_to_grocery_list / remove_from_grocery_list: one-deprecation-window dispatch
  // aliases onto ops-form update_grocery_list's add/remove operations (mcp-tool-gating
  // D3) — identical requests/responses, no warnings injection. There is no
  // read_grocery_list successor tool (grocery-list): read_to_buy is the reasoning read,
  // display_grocery_list the member-facing verb, read_grocery_snapshot the app-plane
  // boot read — one list surface per plane.
  server.registerTool(
    "add_to_grocery_list",
    { description: ADD_DESCRIPTION, inputSchema: ADD_OP_SCHEMA },
    (input) =>
      runTool(async () => {
        const result = await addGroceryRow(env, username, input as GroceryAddInput, today());
        return { item: result.item, merged: result.merged };
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

  server.registerTool(
    "update_grocery_list",
    {
      description:
        "Apply grocery-list operations — `{ op: \"add\"|\"update\"|\"remove\", … }` (the update_pantry ops idiom), one call per turn's worth of writes, with per-op applied/conflicts reporting so one bad op never sinks the rest. `add` carries the FULL add_to_grocery_list contract: " +
        ADD_DESCRIPTION +
        " `update` patches an existing item by `name` — every mutation advances row_version/updated_at and preserves checked_at unless the narrow checked tool changes it; status is orthogonal to checked; `status: \"ordered\"` is accepted only as the compatible per-row in_cart purchase assertion (when a send id is available prefer mark_grocery_send_placed for an exact atomic whole-send assertion); an illegal transition is reported as a conflict, not a thrown error. `remove` deletes by `name` and never records spend. For one deprecation window the OLD single-patch call form — `{ name, ...patch }` with no `operations` — is still accepted and converted to a single update operation, returning the bare `{ item }` shape identically to before.",
      inputSchema: {
        operations: z.array(GROCERY_OP_SCHEMA).optional(),
        // The deprecated single-patch form (one window; shape-detected when `operations`
        // is absent) — the former standalone update_grocery_list(name, ...patch) contract.
        name: z.string().optional(),
        quantity: z.string().optional(),
        kind: z.enum(["grocery", "household", "other"]).optional(),
        domain: z.string().optional(),
        status: z.enum(["active", "in_cart", "ordered"]).optional(),
        source: z.enum(["ad_hoc", "menu", "pantry_low", "stockup"]).optional(),
        for_recipes: z.array(z.string()).optional(),
        note: z.string().nullable().optional(),
      },
    },
    (input) =>
      runTool(async () => {
        if (Array.isArray(input.operations)) {
          const applied: GroceryOpApplied[] = [];
          const conflicts: GroceryOpConflict[] = [];
          for (const op of input.operations) {
            try {
              applied.push(await applyOneGroceryOp(env, username, op));
            } catch (e) {
              if (e instanceof ToolError) {
                conflicts.push({ op: op.op, name: op.name, reason: e.message, code: e.code });
              } else {
                throw e;
              }
            }
          }
          return { applied, conflicts };
        }
        // Old single-patch form (deprecation window; mcp-tool-gating D3): identical
        // result shape to the retired standalone tool — a failure throws (never a
        // conflicts entry), matching the old contract exactly.
        if (typeof input.name !== "string") {
          throw new ToolError(
            "validation_failed",
            "update_grocery_list requires either `operations` or the deprecated single-item `name` form",
          );
        }
        const { name, operations: _ops, ...patch } = input;
        const item = await updateGroceryRow(env, username, name, patch as GroceryUpdateInput, today());
        return { item };
      }),
  );
}

// Exported for use by order-tools.ts (place_order reads the full list).
export { type GroceryItem, type GroceryAddInput };
