// The Retrospective read area (member-app-core): a session-gated, ETagged adapter
// over the shared tenant-scoped Spend analyzer. The route accepts no public tenant
// selector and performs no direct storage access or write.

import { Hono } from "hono";
import { ToolError } from "../errors.js";
import { requireSession, type ApiEnv } from "../session.js";
import { readSpendAnalyzer, type SpendRange } from "../spend.js";
import { jsonWithEtag } from "./etag.js";

const SPEND_RANGES: readonly SpendRange[] = ["4w", "8w", "12w"];

export const retrospectiveArea = new Hono<ApiEnv>()
  .get("/retrospective/spend", requireSession, async (c) => {
    const rawRange = c.req.query("range") ?? "8w";
    if (!(SPEND_RANGES as readonly string[]).includes(rawRange)) {
      throw new ToolError("validation_failed", "range must be 4w | 8w | 12w");
    }
    const tenant = c.get("tenant");
    return jsonWithEtag(c, await readSpendAnalyzer(c.env, tenant.id, rawRange as SpendRange));
  });
