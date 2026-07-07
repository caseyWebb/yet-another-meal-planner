// The `grocery` area (member-app-core): the list read and the row-level writes, keyed
// by canonical ingredient id (class (b), replayable — an add re-delivery merges, a
// remove re-delivery reports converged). The member boundary accepts ONLY
// `active | in_cart` for `status` (D1/D9 — the web UI has no order-placed affordance);
// the shared op layer's W3 transition guard backstops every path. Session-gated per route.

import { Hono } from "hono";
import { ToolError } from "../errors.js";
import { requireSession, type ApiEnv } from "../session.js";
import { jsonWithEtag } from "./etag.js";
import { jsonBody } from "./middleware.js";
import { readGroceryList, addGroceryRow, updateGroceryRow, removeGroceryRow, isoDay } from "../session-db.js";
import type { GroceryAddInput, GroceryUpdateInput } from "../grocery.js";

const KINDS = new Set(["grocery", "household", "other"]);
const SOURCES = new Set(["ad_hoc", "menu", "pantry_low", "stockup"]);
/** The member boundary's writable statuses (never "ordered" — D1). */
const MEMBER_STATUSES = new Set(["active", "in_cart"]);

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** The patch fields shared by add and update, boundary-validated. */
function coerceCommon(o: Record<string, unknown>): GroceryUpdateInput {
  const patch: GroceryUpdateInput = {};
  if (o.quantity !== undefined) patch.quantity = String(o.quantity);
  if (o.kind !== undefined) {
    if (!KINDS.has(String(o.kind))) throw new ToolError("validation_failed", "kind must be grocery | household | other");
    patch.kind = o.kind as GroceryUpdateInput["kind"];
  }
  if (o.domain !== undefined) patch.domain = String(o.domain);
  if (o.source !== undefined) {
    if (!SOURCES.has(String(o.source))) {
      throw new ToolError("validation_failed", "source must be ad_hoc | menu | pantry_low | stockup");
    }
    patch.source = o.source as GroceryUpdateInput["source"];
  }
  if (o.for_recipes !== undefined) {
    if (!Array.isArray(o.for_recipes) || o.for_recipes.some((s) => typeof s !== "string")) {
      throw new ToolError("validation_failed", "for_recipes must be an array of strings");
    }
    patch.for_recipes = o.for_recipes as string[];
  }
  if ("note" in o) {
    if (o.note !== null && typeof o.note !== "string") {
      throw new ToolError("validation_failed", "note must be a string or null");
    }
    patch.note = o.note as string | null;
  }
  return patch;
}

export const groceryArea = new Hono<ApiEnv>()
  .get("/grocery", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const items = await readGroceryList(c.env, tenant.id);
    return jsonWithEtag(c, { items });
  })
  // Add — canonical-id upsert: a re-added name MERGES into its row (replay-safe).
  .post("/grocery/items", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const body = await jsonBody<Record<string, unknown>>(c);
    const name = str(body.name)?.trim();
    if (!name) throw new ToolError("validation_failed", "name is required");
    const input: GroceryAddInput = { name, ...coerceCommon(body) };
    const { item, merged } = await addGroceryRow(c.env, tenant.id, input, isoDay(Date.now()));
    return c.json({ item, merged });
  })
  // Patch — the boundary accepts only active | in_cart for status; the shared op's W3
  // guard backstops (an illegal transition is a structured validation_failed either way).
  .patch("/grocery/items/:name", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const name = c.req.param("name");
    const body = await jsonBody<Record<string, unknown>>(c);
    const patch = coerceCommon(body);
    if (body.status !== undefined) {
      if (!MEMBER_STATUSES.has(String(body.status))) {
        throw new ToolError(
          "validation_failed",
          'the member surface writes status as "active" or "in_cart" only — "ordered" belongs to the order flow',
          { name, to: String(body.status) },
        );
      }
      patch.status = body.status as GroceryUpdateInput["status"];
    }
    const item = await updateGroceryRow(c.env, tenant.id, name, patch);
    return c.json({ item });
  })
  // Remove — class (b): a second delivery finds nothing and reports converged.
  .delete("/grocery/items/:name", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const { found } = await removeGroceryRow(c.env, tenant.id, c.req.param("name"));
    return c.json({ removed: found });
  });
