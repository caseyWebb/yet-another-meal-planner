// The `log` area (member-app-core): the bounded most-recent-first cooking-log read
// (D4), the log-a-cook write through the SAME shared `logCooked` op the MCP tool uses
// — with route-level dedupe ON keyed on `(date, meal, type, recipe|name)` (a NULL meal
// matches NULL only; this is cooking_log DEDUPE identity only, never plan-row
// identity), so a replayed mutation cannot double-log (D8) — and the tenant-scoped
// delete-by-id member correction. Session-gated per route.

import { Hono } from "hono";
import { ToolError } from "../errors.js";
import { requireSession, type ApiEnv } from "../session.js";
import { jsonWithEtag } from "./etag.js";
import { jsonBody } from "./middleware.js";
import { readCookingLog, deleteCookingLogRow } from "../cooking-tools.js";
import { logCooked, type LogCookedInput } from "../cooking-write.js";

const TYPES = new Set(["recipe", "ready_to_eat", "ad_hoc"]);
const MEALS = new Set(["breakfast", "lunch", "dinner", "project"]);

export const logArea = new Hono<ApiEnv>()
  .get("/log", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const rawLimit = c.req.query("limit");
    const limit = rawLimit !== undefined ? Number(rawLimit) : undefined;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw new ToolError("validation_failed", "limit must be a positive integer");
    }
    const entries = await readCookingLog(c.env, tenant.id, { limit });
    return jsonWithEtag(c, { entries });
  })
  // Log a cook — the shared op with dedupe ON: an identical (date, type, recipe|name)
  // replay answers { deduped: true } and inserts nothing (the MCP tool stays append-always).
  .post("/log", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const body = await jsonBody<Record<string, unknown>>(c);
    if (typeof body.type !== "string" || !TYPES.has(body.type)) {
      throw new ToolError("validation_failed", "type must be recipe | ready_to_eat | ad_hoc");
    }
    const input: LogCookedInput = { type: body.type as LogCookedInput["type"] };
    for (const key of ["date", "recipe", "name", "protein", "cuisine"] as const) {
      const v = body[key];
      if (v !== undefined) {
        if (typeof v !== "string") throw new ToolError("validation_failed", `${key} must be a string`);
        input[key] = v;
      }
    }
    if (body.meal !== undefined) {
      if (typeof body.meal !== "string" || !MEALS.has(body.meal)) {
        throw new ToolError("validation_failed", "meal must be breakfast | lunch | dinner | project");
      }
      input.meal = body.meal as LogCookedInput["meal"];
    }
    if (body.plan_row_id !== undefined) {
      if (typeof body.plan_row_id !== "string" || !body.plan_row_id) {
        throw new ToolError("validation_failed", "plan_row_id must be a row id string");
      }
      input.plan_row_id = body.plan_row_id;
    }
    const result = await logCooked(c.env, tenant.id, input, { dedupe: true });
    return c.json(result);
  })
  // Delete one of the caller's own entries — class (b): a second delivery converges.
  .delete("/log/:id", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id < 1) {
      throw new ToolError("validation_failed", "id must be a positive integer");
    }
    const { found } = await deleteCookingLogRow(c.env, tenant.id, id);
    return c.json({ removed: found });
  });
