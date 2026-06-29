// The operator admin app on Hono (operator-admin rewrite). Mounts under the existing
// Worker's `fetch` at `/admin` (no second Worker), reusing `requireAccess` verbatim as
// middleware. Pages are server-rendered by calling the Worker's own `src/` operation
// functions directly; interactive islands call the typed `/admin/api/*` routes via `hc`.
// Both transports call the SAME `src/` functions — one source of truth per operation.

import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { Env } from "../env.js";
import { db } from "../db.js";
import { ToolError } from "../errors.js";
import type { KvStore } from "../kroger-user.js";
import {
  requireAccess,
  listTenants,
  onboard,
  rotate,
  revoke,
  randomInviteCode,
  type AdminDeps,
} from "../admin.js";
import { buildHealthPayload, HEALTH_JOBS } from "../health.js";
import { MembersPage } from "./pages/members.js";
import { StatusPage } from "./pages/status.js";
import { registerDataRoutes } from "./pages/data.js";

/** The injectable surface the member-lifecycle operations close over (real bindings here). */
function adminDeps(env: Env): AdminDeps {
  return {
    tenantKv: env.TENANT_KV,
    krogerKv: env.KROGER_KV as unknown as KvStore,
    db: db(env),
    randomCode: randomInviteCode,
  };
}

/** The Cloudflare Access gate as middleware — `requireAccess` reused verbatim (the opt-in /
 *  dev-bypass / email-allowlist posture is the function's, unchanged). */
const accessGate: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const access = await requireAccess(c.req.raw, c.env);
  if (access.status === "disabled") return c.text("Not found", 404);
  if (access.status === "denied") return c.text("Forbidden", 403);
  await next();
};

/** Map a structured `ToolError`'s code to an HTTP status (mirrors `src/admin.ts` statusFor). */
function statusForToolError(code: string): 400 | 404 | 405 | 500 {
  if (code === "not_found") return 404;
  if (code === "validation_failed") return 400;
  if (code === "unsupported") return 405;
  return 500;
}

function connectorUrl(reqUrl: string): string {
  return `${new URL(reqUrl).origin}/mcp`;
}

/** Render a full HTML document for a page component, with a doctype. */
function page(node: { toString(): string }): string {
  return "<!doctype html>" + node.toString();
}

const app = new Hono<{ Bindings: Env }>().basePath("/admin");

app.use("*", accessGate);

// Tools/operations throw structured `ToolError`s; surface them as their structured shape +
// status (a structured error is data, never an unhandled 500).
app.onError((err, c) => {
  if (err instanceof ToolError) return c.json(err.toShape(), statusForToolError(err.code));
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: "upstream_unavailable", message }, 500);
});

// Home (`/admin`) is the Status service-health view, SSR'd from the same `buildHealthPayload`
// the public `/health` uses (no client fetch, no decoder).
app.get("/", async (c) => {
  const payload = await buildHealthPayload(c.env, HEALTH_JOBS);
  return c.html(page(<StatusPage payload={payload} />));
});

// SSR: the Members list, read by calling `listTenants` directly (no client fetch).
app.get("/members", async (c) => {
  const { tenants } = await listTenants(adminDeps(c.env));
  return c.html(page(<MembersPage props={{ members: tenants }} />));
});

// The typed mutation routes the Members island calls via `hc`. Chained so their
// request/response types accumulate into `AdminApp` for the client (zero codegen).
const routes = app
  .get("/api/tenants", async (c) => c.json(await listTenants(adminDeps(c.env))))
  .post("/api/tenants", async (c) => {
    const body = await c.req.json<{ username?: string; invite_code?: string }>();
    const result = await onboard(
      adminDeps(c.env),
      String(body.username ?? ""),
      body.invite_code != null ? String(body.invite_code) : undefined,
    );
    return c.json({ ...result, connector_url: connectorUrl(c.req.url) });
  })
  .post("/api/tenants/:id/rotate", async (c) => {
    const result = await rotate(adminDeps(c.env), decodeURIComponent(c.req.param("id")));
    return c.json({ ...result, connector_url: connectorUrl(c.req.url) });
  })
  .delete("/api/tenants/:id", async (c) => {
    return c.json(await revoke(adminDeps(c.env), decodeURIComponent(c.req.param("id"))));
  });

// Data explorer area (operator-data-explorer): read-only SSR views over D1 + the R2 corpus.
registerDataRoutes(app);

// Static islands + styles fall through to the ASSETS binding (already past the Access gate;
// `ASSETS.fetch` bypasses run_worker_first, so this never re-enters and loops).
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

/** The app type the client (`hc<AdminApp>()`) infers request/response types from. */
export type AdminApp = typeof routes;
export default app;
