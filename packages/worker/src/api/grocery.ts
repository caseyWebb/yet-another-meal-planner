// The `grocery` area (member-app-core + member-app-grocery): the list read, the
// row-level writes keyed by canonical ingredient id (class (b), replayable — an add
// re-delivery merges, a remove re-delivery reports converged), the DERIVED to-buy view
// (`GET /grocery/to-buy` → the same `computeToBuyView` the `read_to_buy` tool wraps),
// and the order flow (`POST /grocery/order` → the same `runPlaceOrder` the `place_order`
// tool wraps, over fresh `buildOrderWiring` deps; ONLINE-ONLY — the cart write is not
// idempotent, so the client never queues/replays it). The member boundary accepts
// `active | in_cart | ordered` for `status` — `ordered` is the user-asserted
// mark-order-placed advance; the shared op layer's W3 transition guard (legal only from
// `in_cart`, stamps `ordered_at`) is the enforcement on every path. Session-gated per route.

import { Hono } from "hono";
import { z } from "zod";
import { ToolError } from "../errors.js";
import { requireSession, type ApiEnv } from "../session.js";
import { jsonWithEtag } from "./etag.js";
import { jsonBody } from "./middleware.js";
import { readGroceryListReified, addGroceryRow, updateGroceryRow, removeGroceryRow, isoDay } from "../session-db.js";
import { computeToBuyView } from "../to-buy.js";
import { suggestSubstitutions } from "../substitutions.js";
import { runPlaceOrder, PLACE_ORDER_INPUT_SHAPE } from "../order-tools.js";
import { buildOrderWiring } from "../tools.js";
import { readPreferences } from "../profile-db.js";
import { KROGER_STORE } from "../flyer-warm.js";
import type { GroceryAddInput, GroceryUpdateInput } from "../grocery.js";

const KINDS = new Set(["grocery", "household", "other"]);
const SOURCES = new Set(["ad_hoc", "menu", "pantry_low", "stockup"]);
/** The member boundary's writable statuses. `ordered` is P3's mark-order-placed advance —
 *  the route allowlist only; the W3 guard in `updateGroceryRow` enforces the transition. */
const MEMBER_STATUSES = new Set(["active", "in_cart", "ordered"]);

/** The order route validates the tool's EXACT input shape (one contract, D7). */
const orderInput = z.object(PLACE_ORDER_INPUT_SHAPE);

/** The substitutions route validates the tool's exact input shape (one contract, D1). */
const substitutionsInput = z.object({
  names: z.array(z.string()).optional(),
  max_lines: z.number().int().positive().optional(),
});

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
    const items = await readGroceryListReified(c.env, tenant.id);
    return jsonWithEtag(c, { items });
  })
  // The derived to-buy view (D1/D3): one shared op with the MCP read_to_buy tool.
  // Pure D1 read (no Kroger, no AI, no writes); ETagged like every JSON GET.
  // `?enrich=1` (member-app-differentiators D6, generalized by inline-substitution-
  // hints D2) opts into the enriched read — captured sku_cache placements +
  // graph-derived departments AND per-line substitute hints (`substitutes[]`) +
  // `flyer_as_of`, at most one Kroger Locations resolve, zero product searches; the
  // default stays byte-identical (the param is part of the ETagged representation —
  // the client keys its cache on it, and since the enriched body itself carries
  // `substitutes`/`flyer_as_of`, a warmed flyer or pantry/identity-graph edit that
  // changes what would be served changes the ETag too — D8).
  .get("/grocery/to-buy", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const view = await computeToBuyView(c.env, tenant.id, { enrich: c.req.query("enrich") === "1" });
    return jsonWithEtag(c, view);
  })
  // The alternatives-only substitution read (inline-substitution-hints D4): one shared
  // op with the suggest_substitutions tool, over fresh order wiring. Member-initiated
  // and ONLINE-ONLY (D12) — no ETag, never offline-queued or replayed; read-only on
  // the server (the op writes nothing; acting on a suggestion reuses the existing
  // writes). The sibling/pantry/flyer hints this op used to also carry now ride
  // `GET /grocery/to-buy?enrich=1` instead.
  .post("/grocery/substitutions", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const parsed = substitutionsInput.safeParse(await jsonBody<unknown>(c));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ToolError("validation_failed", `${issue?.path.join(".") || "body"}: ${issue?.message ?? "invalid"}`);
    }
    const result = await suggestSubstitutions(c.env, tenant.id, parsed.data, buildOrderWiring(c.env, tenant.id));
    return c.json(result);
  })
  // The order flow (D7): the place_order op behind the tool's exact input/result shape.
  // Preview and commit are the same endpoint discriminated by `preview` (the op's own
  // contract). Gated to Kroger-online fulfillment BEFORE any resolution — a non-Kroger
  // primary gets a structured `unsupported` naming the correct flow (the satellite
  // pull-list's 409-with-direction precedent), never a cart write.
  .post("/grocery/order", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const parsed = orderInput.safeParse(await jsonBody<unknown>(c));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ToolError("validation_failed", `${issue?.path.join(".") || "body"}: ${issue?.message ?? "invalid"}`);
    }
    const prefs = await readPreferences(c.env, tenant.id);
    const stores = prefs?.stores as Record<string, unknown> | undefined;
    const primary =
      typeof stores?.primary === "string" && stores.primary.trim() ? stores.primary.trim().toLowerCase() : KROGER_STORE;
    if (primary !== KROGER_STORE) {
      const fulfillment = typeof stores?.fulfillment === "string" ? stores.fulfillment : null;
      throw new ToolError(
        "unsupported",
        fulfillment === "satellite"
          ? "the primary store is satellite-fulfilled — the cart is filled by the satellite helper, not a Kroger order"
          : "the primary store is a walk store — shop it as an in-store walk, not a Kroger order",
        { primary, flow: fulfillment === "satellite" ? "satellite-cart-fill" : "in-store-walk" },
      );
    }
    const result = await runPlaceOrder(c.env, tenant.id, parsed.data, buildOrderWiring(c.env, tenant.id));
    return c.json(result);
  })
  // Add — canonical-id upsert: a re-added name MERGES into its row (replay-safe). Also
  // the MATERIALIZE write for a derived (plan-origin) view line: same canonical key, so
  // the stored row and the derived need merge in every later read (D6). An optional `id`
  // materializes an accepted sibling swap: it is an ALREADY-CANONICAL key (validated as a live
  // survivor, not re-resolved in addGroceryRow) that becomes the row's key, while the row's `name`
  // stores a clean human display (the posted `name` when present, else the identity node's label) —
  // so name OR id is required.
  .post("/grocery/items", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const body = await jsonBody<Record<string, unknown>>(c);
    const name = str(body.name)?.trim();
    const id = str(body.id)?.trim();
    if (!name && !id) throw new ToolError("validation_failed", "name or id is required");
    const input: GroceryAddInput = { ...coerceCommon(body) };
    if (name) input.name = name;
    if (id) input.id = id;
    // Optional taste-substitution capture signal — the recipe ingredient this add stands in for.
    const substitutesFor = str(body.substitutes_for)?.trim();
    if (substitutesFor) input.substitutes_for = substitutesFor;
    const { item, merged } = await addGroceryRow(c.env, tenant.id, input, isoDay(Date.now()));
    return c.json({ item, merged });
  })
  // Patch — the boundary accepts active | in_cart | ordered; the shared op's W3 guard
  // enforces the transition (ordered is legal ONLY from in_cart and stamps ordered_at —
  // an illegal transition is a structured validation_failed either way).
  .patch("/grocery/items/:name", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const name = c.req.param("name");
    const body = await jsonBody<Record<string, unknown>>(c);
    const patch = coerceCommon(body);
    if (body.status !== undefined) {
      if (!MEMBER_STATUSES.has(String(body.status))) {
        throw new ToolError(
          "validation_failed",
          'status must be "active", "in_cart", or "ordered" (the user-asserted order-placed advance)',
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
