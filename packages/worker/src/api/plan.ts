// The `plan` area (member-app-core): the meal-plan read (flat, meal-ordered rows, each
// carrying its opaque row `id` — THE address for row-level edits and the class (b)
// replay key) and the row-level ops write — the D26-final contract: id-keyed add
// (client-minted ULID idempotency), remove split idempotency, set unique-or-candidates,
// `duplicate: true` as the one duplication spelling — through the SAME
// watermark-preserving composition the update_meal_plan tool uses, so a plan add from
// the app advances new-for-me exactly like an agent-side add. Session-gated per route.

import { Hono } from "hono";
import { ToolError } from "../errors.js";
import { requireSession, type ApiEnv } from "../session.js";
import { jsonWithEtag } from "./etag.js";
import { jsonBody } from "./middleware.js";
import { readMealPlan } from "../session-db.js";
import { applyMealPlanOpsForTenant } from "../cooking-tools.js";
import { PLAN_MEALS, type MealPlanOp, type PlanMeal } from "../meal-plan.js";

const OPS = new Set(["add", "remove", "set"]);

/** Boundary-validate one op into the pure layer's shape (unknown fields dropped). */
function coerceOp(raw: unknown, i: number): MealPlanOp {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (typeof o.op !== "string" || !OPS.has(o.op)) {
    throw new ToolError("validation_failed", `ops[${i}].op must be add | remove | set`);
  }
  const op: MealPlanOp = { op: o.op as MealPlanOp["op"] };
  if ("id" in o && o.id !== undefined) {
    if (typeof o.id !== "string" || !o.id) {
      throw new ToolError("validation_failed", `ops[${i}].id must be a row id string`);
    }
    op.id = o.id;
  }
  if ("recipe" in o && o.recipe !== undefined) {
    if (typeof o.recipe !== "string" || !o.recipe) {
      throw new ToolError("validation_failed", `ops[${i}].recipe must be a recipe slug`);
    }
    op.recipe = o.recipe;
  }
  if (op.id === undefined && op.recipe === undefined) {
    throw new ToolError("validation_failed", `ops[${i}] needs an id or a recipe`);
  }
  if ("meal" in o && o.meal !== undefined) {
    if (typeof o.meal !== "string" || !(PLAN_MEALS as readonly string[]).includes(o.meal)) {
      throw new ToolError("validation_failed", `ops[${i}].meal must be breakfast | lunch | dinner | project`);
    }
    op.meal = o.meal as PlanMeal;
  }
  if ("duplicate" in o && o.duplicate !== undefined) {
    if (typeof o.duplicate !== "boolean") {
      throw new ToolError("validation_failed", `ops[${i}].duplicate must be a boolean`);
    }
    op.duplicate = o.duplicate;
  }
  if ("planned_for" in o) {
    if (o.planned_for !== null && typeof o.planned_for !== "string") {
      throw new ToolError("validation_failed", `ops[${i}].planned_for must be a date string or null`);
    }
    op.planned_for = o.planned_for as string | null;
  }
  if ("sides" in o && o.sides !== undefined) {
    if (!Array.isArray(o.sides) || o.sides.some((s) => typeof s !== "string")) {
      throw new ToolError("validation_failed", `ops[${i}].sides must be an array of strings`);
    }
    op.sides = o.sides as string[];
  }
  if ("from_vibe" in o) {
    if (o.from_vibe !== null && typeof o.from_vibe !== "string") {
      throw new ToolError("validation_failed", `ops[${i}].from_vibe must be a string or null`);
    }
    op.from_vibe = o.from_vibe as string | null;
  }
  return op;
}

export const planArea = new Hono<ApiEnv>()
  .get("/plan", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const planned = await readMealPlan(c.env, tenant.id);
    return jsonWithEtag(c, { planned });
  })
  .post("/plan/ops", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const body = await jsonBody<{ ops?: unknown }>(c);
    if (!Array.isArray(body.ops) || body.ops.length === 0) {
      throw new ToolError("validation_failed", "ops must be a non-empty array");
    }
    const ops = body.ops.map(coerceOp);
    const { applied, conflicts } = await applyMealPlanOpsForTenant(c.env, tenant.id, ops);
    return c.json({ applied, conflicts });
  });
