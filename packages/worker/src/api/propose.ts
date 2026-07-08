// The `propose` area (member-app-propose): the member app's propose surface as a thin
// adapter over the shared op — `POST /api/propose` calls the SAME `runProposeMealPlan`
// the MCP tool wraps (one contract, D7). The forecast shapes the proposal server-side
// inside that op; the app has no client-side weather read. The propose POST is a
// STATELESS READ-SHAPED POST: no writes, safe to repeat, neither D8 write class (commit
// rides P1's class (b) plan ops) and NOT ETag'd (bodies vary; client caches by request key).
// The propose session lives client-side ONLY — nothing here persists state (the spec'd
// negative guarantee); determinism ("same request body, same week") IS session resume.
// Session-gated per route.

import { Hono } from "hono";
import { z } from "zod";
import { ToolError } from "../errors.js";
import { requireSession, type ApiEnv } from "../session.js";
import { jsonBody } from "./middleware.js";
import { runProposeMealPlan, PROPOSE_INPUT_SHAPE } from "../meal-plan-proposal-tool.js";
import { buildProposeDeps } from "../tools.js";

/** The tool's exact input schema (one contract — the shape is shared, not re-declared). */
const proposeInput = z.object(PROPOSE_INPUT_SHAPE);

export const proposeArea = new Hono<ApiEnv>()
  .post("/propose", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const parsed = proposeInput.safeParse(await jsonBody<unknown>(c));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ToolError("validation_failed", `${issue?.path.join(".") || "body"}: ${issue?.message ?? "invalid"}`);
    }
    const result = await runProposeMealPlan(c.env, tenant, parsed.data, buildProposeDeps(c.env, tenant.id));
    return c.json(result);
  });
