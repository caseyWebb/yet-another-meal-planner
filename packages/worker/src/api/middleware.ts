// The shared `/api` middleware skeleton (member-api): implemented once in P0 and
// inherited unchanged by every later area — the ToolError→HTTP-status map (one table,
// no per-route mapping), the `X-App-Build` version-skew header on every response, the
// CSRF guard on every state-changing request, and the per-route usage point to the
// existing TOOL_AE dataset. NO CORS: the surface is same-origin by construction and
// never emits an `Access-Control-Allow-*` header (a spec'd negative guarantee).

import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "../env.js";
import { ToolError } from "../errors.js";
import { recordToolPoint } from "../health.js";
import type { ApiEnv } from "../session.js";

/** The Worker-side build id: the deploy-stamped code SHA, `"dev"` when unstamped (local/tests). */
export function appBuild(env: Pick<Env, "APP_BUILD">): string {
  return env.APP_BUILD ?? "dev";
}

/**
 * `X-App-Build` on every `/api` response — the API side of the version-skew contract
 * (the SPA compares it against its embedded `VITE_APP_BUILD`). Error responses built by
 * `onApiError` set it themselves (a thrown error unwinds past this middleware's tail).
 */
export const buildHeader: MiddlewareHandler<ApiEnv> = async (c, next) => {
  await next();
  c.res.headers.set("X-App-Build", appBuild(c.env));
};

/**
 * CSRF defense (member-session-auth): every non-GET/HEAD `/api` request — login included;
 * the SPA's fetch wrapper always sends it — must carry the `X-App-Csrf` header (any value:
 * a custom header forces a CORS preflight cross-origin, which same-origin policy then
 * denies, so a bare form-shaped POST riding the SameSite=Lax cookie can't carry it), and
 * when the browser supplies `Sec-Fetch-Site` it must be `same-origin`/`none` (reject
 * `cross-site` AND `same-site`). Rejection is a structured `csrf_rejected` 403, before
 * any handler runs. `SameSite=Lax` is the belt; this is the suspenders.
 */
export const csrfGuard: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    if (!c.req.header("X-App-Csrf")) {
      return c.json({ error: "csrf_rejected" as const, message: "Missing X-App-Csrf header" }, 403);
    }
    const site = c.req.header("Sec-Fetch-Site");
    if (site && site !== "same-origin" && site !== "none") {
      return c.json({ error: "csrf_rejected" as const, message: "Cross-site request rejected" }, 403);
    }
  }
  await next();
};

/**
 * The MATCHED route pattern (e.g. `/api/session`, never the raw URL) — the usage point's
 * low-cardinality, tenant-clean name. Falls back to the mount's wildcard for a request no
 * route matched (an `/api` 404), keeping even that bucket bounded.
 */
function matchedPattern(c: Context): string {
  const routes = c.req.matchedRoutes;
  for (let i = routes.length - 1; i >= 0; i--) {
    const r = routes[i];
    if (r.method !== "ALL" && !r.path.endsWith("*")) return r.path;
  }
  return "/api/*";
}

/**
 * One best-effort usage point per `/api` request to the existing TOOL_AE dataset —
 * `recordToolPoint`'s exact point shape with an `api:`-prefixed name (`api:POST
 * /api/session`), so app usage reads beside tool usage in the admin Usage panel with no
 * new AE binding. Non-blocking and swallow-on-failure by `recordToolPoint`'s contract;
 * a thrown error is recorded as an error outcome and re-thrown for `onApiError`.
 */
export const usagePoint: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const startedAt = Date.now();
  let threw = false;
  try {
    await next();
  } catch (e) {
    threw = true;
    throw e;
  } finally {
    const ok = !threw && c.res.status < 400;
    recordToolPoint(c.env, `api:${c.req.method.toUpperCase()} ${matchedPattern(c)}`, {
      ok,
      durationMs: Date.now() - startedAt,
    });
  }
};

/** Parse a JSON request body, mapping a malformed payload to a structured 400 (never a raw 500). */
export async function jsonBody<T>(c: Context): Promise<T> {
  try {
    return await c.req.json<T>();
  } catch {
    throw new ToolError("validation_failed", "request body must be JSON");
  }
}

/** The ONE ToolError-code → HTTP-status table for the member API (no route maps its own). */
function statusForToolError(err: ToolError): 400 | 401 | 403 | 404 | 405 | 409 | 412 | 500 | 503 {
  const code = err.code;
  if (code === "validation_failed") return 400;
  if (code === "not_found") return 404;
  if (code === "unsupported") return 405;
  // `conflict` is 409 — except when it IS a failed `If-Match` precondition (the class (a)
  // two-writer race, marked by the shared precondition helper's context), which is 412.
  if (code === "conflict") return err.context.precondition ? 412 : 409;
  if (code === "insufficient_permission") return 403;
  if (code === "reauth_required") return 401;
  if (code === "storage_error" || code === "index_unavailable" || code === "upstream_unavailable") return 503;
  return 500; // unrecognized codes degrade to a structured 500
}

/**
 * The `/api` error boundary: a structured `ToolError` surfaces as its mapped status with
 * its `toShape()` body (the SPA branches on the code); anything else degrades to a
 * structured `{ error: "internal", message }` 500 — never a raw stack or an empty reply.
 * Sets `X-App-Build` itself: a thrown error unwinds past `buildHeader`'s tail.
 */
export function onApiError(err: Error, c: Context<ApiEnv>): Response {
  const res =
    err instanceof ToolError
      ? c.json(err.toShape(), statusForToolError(err))
      : c.json({ error: "internal", message: err instanceof Error ? err.message : String(err) }, 500);
  res.headers.set("X-App-Build", appBuild(c.env));
  return res;
}
