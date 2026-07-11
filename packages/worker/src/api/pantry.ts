// The `pantry` area (member-app-core): the pantry read (category/location/prepared
// filters) and the row ops — add/remove/verify/dispose keyed by canonical ingredient id
// (class (b): replayable upserts; dispose keyed on its client-minted waste `event_id`)
// plus the mark-verified stamp. The needs-verification section is CLIENT-derived from
// served fields (no new backend query). Session-gated per route.

import { Hono } from "hono";
import { ToolError } from "../errors.js";
import { requireSession, type ApiEnv } from "../session.js";
import { jsonWithEtag } from "./etag.js";
import { jsonBody } from "./middleware.js";
import { readPantry, applyPantryRowOps, markPantryVerifiedRows, isoDay } from "../session-db.js";
import type { PantryOperation } from "../pantry-write.js";

const OPS = new Set(["add", "remove", "verify", "dispose"]);
/** The dispose fields passed through to the shared op (semantic shape validation —
 *  required reason, event-id/date formats — lives in `applyPantryRowOps`, so the tool
 *  and this route enforce identical rules). */
const DISPOSE_FIELDS = ["disposition", "reason", "event_id", "occurred_at"] as const;

export const pantryArea = new Hono<ApiEnv>()
  .get("/pantry", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const items = await readPantry(c.env, tenant.id, {
      category: c.req.query("category"),
      location: c.req.query("location"),
      preparedOnly: c.req.query("prepared_only") === "true",
    });
    return jsonWithEtag(c, { items });
  })
  .post("/pantry/ops", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const body = await jsonBody<{ operations?: unknown }>(c);
    if (!Array.isArray(body.operations) || body.operations.length === 0) {
      throw new ToolError("validation_failed", "operations must be a non-empty array");
    }
    const operations: PantryOperation[] = body.operations.map((raw, i) => {
      const o = (raw ?? {}) as Record<string, unknown>;
      if (typeof o.op !== "string" || !OPS.has(o.op)) {
        throw new ToolError("validation_failed", `operations[${i}].op must be add | remove | verify | dispose`);
      }
      const op: PantryOperation = { op: o.op as PantryOperation["op"] };
      if (o.item !== undefined) {
        if (o.item === null || typeof o.item !== "object" || Array.isArray(o.item)) {
          throw new ToolError("validation_failed", `operations[${i}].item must be an object`);
        }
        op.item = o.item as Record<string, unknown>;
      }
      if (o.name !== undefined) {
        if (typeof o.name !== "string") throw new ToolError("validation_failed", `operations[${i}].name must be a string`);
        op.name = o.name;
      }
      for (const field of DISPOSE_FIELDS) {
        if (o[field] !== undefined) {
          if (typeof o[field] !== "string") {
            throw new ToolError("validation_failed", `operations[${i}].${field} must be a string`);
          }
          (op as unknown as Record<string, unknown>)[field] = o[field];
        }
      }
      return op;
    });
    const result = await applyPantryRowOps(c.env, tenant.id, operations, isoDay(Date.now()));
    return c.json({
      applied: result.applied,
      conflicts: result.conflicts,
      ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
    });
  })
  .post("/pantry/verify", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const body = await jsonBody<{ items?: unknown }>(c);
    if (!Array.isArray(body.items) || body.items.some((s) => typeof s !== "string")) {
      throw new ToolError("validation_failed", "items must be an array of pantry item names");
    }
    const { verified, missing } = await markPantryVerifiedRows(c.env, tenant.id, body.items as string[], isoDay(Date.now()));
    return c.json({ verified, missing });
  });
