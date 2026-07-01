// The operator admin app on Hono (operator-admin rewrite). Mounts under the existing
// Worker's `fetch` at `/admin` (no second Worker), reusing `requireAccess` verbatim as
// middleware. Pages are server-rendered by calling the Worker's own `src/` operation
// functions directly; interactive islands call the typed `/admin/api/*` routes via `hc`.
// Both transports call the SAME `src/` functions — one source of truth per operation.

import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { validator } from "hono/validator";
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
  krogerConsentLink,
  randomInviteCode,
  type AdminDeps,
} from "../admin.js";
import { buildHealthPayload, readJobRuns, HEALTH_JOBS, type JobRun } from "../health.js";
import { corpusCounts, memberDetail, recipeTitles } from "../admin-data.js";
import { MembersPage } from "./pages/members.js";
import { MemberDetailPage, PendingMemberDetailPage, sectionOfSlug } from "./pages/member-detail.js";
import { StatusPage } from "./pages/status.js";
import { registerDataRoutes } from "./pages/data.js";
import { fetchUsage, fetchUsageTrends, fetchToolUsage } from "../usage.js";
import { UsagePage } from "./pages/usage.js";
import { readDiscoveryLog, readDiscoveryRowById, deleteDiscoveryRow } from "../discovery-db.js";
import { buildDiscoveryDeps, processCandidate, DEFAULT_CONFIG } from "../discovery-sweep.js";
import { addDiscoveryRejection } from "../corpus-db.js";
import { canonicalizeUrl } from "../url.js";
import { LogsPage } from "./pages/logs.js";
import { getDiscoveryConfig, putDiscoveryConfig, analyzeDiscovery, dryRunDiscovery, testFeed, getOperatorConfig, putOperatorConfig, listCorpus, addCorpus, deleteCorpus } from "./config-api.js";
import { registerConfigRoutes } from "./pages/config.js";
import { Layout } from "./ui/layout.js";
import { buildHealthRollup, renderHealthDock } from "./ui/health-dock.js";

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

// The global service-health dock (operator-admin): injected into every admin HTML page so the
// healthy/degraded rollup is present on every area, not only Status. One chokepoint after the
// gate — it builds the same `buildHealthPayload` the Status home uses (no new Worker route) and
// splices the dock (SSR pill + island props + island script) before `</body>`. Acts only on
// `text/html` responses, so `/admin/api/*` JSON and static island/asset fetches pass through.
// Exported (not just inlined into `app.use`) so a test can exercise the exact middleware through
// a real Hono dispatch, rather than re-implementing its decision logic.
export const injectHealthDock: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  await next();
  const contentType = c.res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return;
  const html = await c.res.text();
  if (!html.includes("</body>")) {
    c.res = new Response(html, c.res);
    return;
  }
  const rollup = buildHealthRollup(await buildHealthPayload(c.env, HEALTH_JOBS));
  const headers = new Headers(c.res.headers);
  headers.delete("content-length");
  c.res = new Response(html.replace("</body>", renderHealthDock(rollup) + "</body>"), {
    status: c.res.status,
    statusText: c.res.statusText,
    headers,
  });
};

app.use("*", injectHealthDock);

// Tools/operations throw structured `ToolError`s; surface them as their structured shape +
// status (a structured error is data, never an unhandled 500).
app.onError((err, c) => {
  if (err instanceof ToolError) return c.json(err.toShape(), statusForToolError(err.code));
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: "upstream_unavailable", message }, 500);
});

// The number of recent runs the Status uptime sparkline shows per job (the retention cap in
// src/health.ts is larger — this is just the display window the mock's density calls for).
const STATUS_SPARKLINE_WINDOW = 30;

// Home (`/admin`) is the Status service-health view, SSR'd from the same `buildHealthPayload`
// the public `/health` uses (no client fetch, no decoder), plus the corpus stat-tile counts and
// each job's recent run history (for the uptime sparkline + healthy/unhealthy-since label).
app.get("/", async (c) => {
  const [payload, counts] = await Promise.all([buildHealthPayload(c.env, HEALTH_JOBS), corpusCounts(c.env)]);
  const runsByJob: Record<string, JobRun[]> = {};
  await Promise.all(
    HEALTH_JOBS.map(async (name) => {
      runsByJob[name] = await readJobRuns(c.env, name, STATUS_SPARKLINE_WINDOW);
    }),
  );
  return c.html(page(<StatusPage payload={payload} counts={counts} runsByJob={runsByJob} />));
});

// SSR: the Members roster, read by calling `listTenants` directly (no client fetch).
app.get("/members", async (c) => {
  const { tenants } = await listTenants(c.env, adminDeps(c.env));
  return c.html(page(<MembersPage props={{ members: tenants }} />));
});

// SSR: member-detail, at its own deep-linkable URL per section (design.md decision 2). A
// pending member (no tenant_activity row yet) renders the not-yet-connected empty state and
// never attempts the `memberDetail` read (3.8) — there is nothing to read yet.
async function renderMemberDetail(c: { env: Env; req: { param(name: string): string } }, section: string) {
  const id = decodeURIComponent(c.req.param("id"));
  const { tenants } = await listTenants(c.env, adminDeps(c.env));
  const row = tenants.find((t) => t.id === id);
  if (!row) throw new ToolError("not_found", `No member ${id} on the allowlist`);
  if (row.status === "pending") return page(<PendingMemberDetailPage row={row} />);

  const detail = await memberDetail(c.env, row.id);
  const slugs = [
    ...detail.meal_plan.map((p) => p.recipe),
    ...detail.cooking_log.map((r) => (typeof r.recipe === "string" ? r.recipe : null)).filter((s): s is string => !!s),
  ];
  const titles = await recipeTitles(c.env, slugs);
  return page(<MemberDetailPage row={row} detail={detail} section={sectionOfSlug(section)} titles={titles} />);
}
app.get("/members/:id", async (c) => c.html(await renderMemberDetail(c, "profile")));
app.get("/members/:id/:section", async (c) => c.html(await renderMemberDetail(c, c.req.param("section"))));

// The typed mutation routes the Members island calls via `hc`. Chained so their
// request/response types accumulate into `AdminApp` for the client (zero codegen).
const routes = app
  .get("/api/tenants", async (c) => c.json(await listTenants(c.env, adminDeps(c.env))))
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
  // Mint a single-use Kroger consent link for an allowlisted member (for one with no /mcp session yet).
  .post("/api/tenants/:id/kroger-login", async (c) =>
    c.json(await krogerConsentLink(c.env, adminDeps(c.env), decodeURIComponent(c.req.param("id")), new URL(c.req.url).origin)),
  )
  .delete("/api/tenants/:id", async (c) => {
    return c.json(await revoke(adminDeps(c.env), decodeURIComponent(c.req.param("id"))));
  })
  // Logs › Discovery: the row actions the Logs island calls. Retry/Delete reuse the sweep's
  // own functions (shared logic, not a re-implementation) — same outcome as the autonomous sweep.
  .get("/api/logs/discovery", async (c) => c.json({ entries: await readDiscoveryLog(c.env, 200) }))
  .post("/api/discovery/:id/retry", async (c) => {
    const id = c.req.param("id");
    const row = await readDiscoveryRowById(c.env, id);
    if (!row) throw new ToolError("not_found", `No discovery row with id ${id}`);
    if (row.outcome !== "error" && row.outcome !== "failed") {
      throw new ToolError("unsupported", `Row ${id} has outcome "${row.outcome}" — only error/failed rows can be retried`);
    }
    const deps = buildDiscoveryDeps(c.env);
    const members = await deps.loadMembers();
    const corpus = await deps.loadCorpusVectors();
    await processCandidate(
      deps,
      DEFAULT_CONFIG,
      { url: row.url ?? "", title: row.title ?? "", summary: null, source: row.source ?? "", existingRowId: id, attempts: row.attempts },
      { triageVec: null, members, corpus, importedVectors: [], nowMs: Date.now() },
      { bypassCap: true },
    );
    return c.json(await readDiscoveryRowById(c.env, id));
  })
  .delete("/api/discovery/:id", async (c) => {
    const id = c.req.param("id");
    const row = await readDiscoveryRowById(c.env, id);
    if (!row) throw new ToolError("not_found", `No discovery row with id ${id}`);
    if (row.url) {
      await addDiscoveryRejection(c.env, {
        url: canonicalizeUrl(row.url),
        reason: "operator-deleted",
        rejectedBy: "admin",
        rejectedAt: new Date().toISOString(),
      });
    }
    await deleteDiscoveryRow(c.env, id);
    return c.json({ deleted: id });
  })
  // Config › Calibration: the discovery knob store + analyze/dry-run previews + the edge feed-probe.
  .get("/api/discovery/config", async (c) => c.json(await getDiscoveryConfig(c.env)))
  .put("/api/discovery/config", async (c) => c.json(await putDiscoveryConfig(c.env, await c.req.json())))
  .post("/api/discovery/analyze", async (c) => c.json(await analyzeDiscovery(c.env, await c.req.json())))
  .post("/api/discovery/dry-run", async (c) => c.json(await dryRunDiscovery(c.env, await c.req.json())))
  .post("/api/discovery/test-feed", async (c) => c.json(await testFeed(c.env, await c.req.json())))
  // Config › Ranking + Flyer: the operator ranking/flyer config store.
  .get("/api/operator-config", async (c) => c.json(await getOperatorConfig(c.env)))
  .put("/api/operator-config", async (c) => c.json(await putOperatorConfig(c.env, await c.req.json())))
  // Config › shared-corpus editors: list/add/remove the five group-wide lookup tables. The add
  // route declares its JSON body via a validator so the typed client accepts it alongside :table.
  .get("/api/corpus/:table", async (c) => c.json(await listCorpus(c.env, c.req.param("table"))))
  .post("/api/corpus/:table", validator("json", (v) => v as Record<string, unknown>), async (c) =>
    c.json(await addCorpus(c.env, c.req.param("table"), c.req.valid("json"))),
  )
  .delete("/api/corpus/:table/:key", async (c) =>
    c.json(await deleteCorpus(c.env, c.req.param("table"), decodeURIComponent(c.req.param("key")))),
  );

// Data explorer area (operator-data-explorer): read-only SSR views over D1 + the R2 corpus.
registerDataRoutes(app);

// Config area (operator-admin): the discovery calibration console (+ ranking/flyer + corpus editors).
registerConfigRoutes(app);

// Discovery area (operator-admin): a top-level slot for the autonomous candidate-pipeline view.
// This foundation change lands the routed placeholder so the IA exists; the pipeline body is a
// downstream change.
app.get("/discovery", (c) =>
  c.html(
    page(
      <Layout title="Discovery · grocery-agent admin" active="/admin/discovery">
        <div class="status-head">
          <h2>Discovery</h2>
        </div>
        <div class="card">
          <section>
            <p class="muted">
              The candidate-pipeline view is coming soon. Discovery outcomes are currently visible under{" "}
              <a href="/admin/logs/discovery">Logs › Discovery</a>.
            </p>
          </section>
        </div>
      </Layout>,
    ),
  ),
);

// Usage area (usage-observability / usage-trends / tool-usage-trends): three SSR dashboards.
app.get("/usage", async (c) => {
  const [usage, trends, tools] = await Promise.all([fetchUsage(c.env), fetchUsageTrends(c.env), fetchToolUsage(c.env)]);
  return c.html(page(<UsagePage usage={usage} trends={trends} tools={tools} />));
});

// Logs area (operator-admin): the discovery sweep's outcome log (master/detail), SSR'd; the
// entries hydrate as an island for per-row retry/delete + the detail dialog.
app.get("/logs", async (c) => c.html(page(<LogsPage entries={await readDiscoveryLog(c.env, 200)} />)));
app.get("/logs/discovery", async (c) => c.html(page(<LogsPage entries={await readDiscoveryLog(c.env, 200)} />)));

// Static islands + styles fall through to the ASSETS binding (already past the Access gate;
// `ASSETS.fetch` bypasses run_worker_first, so this never re-enters and loops).
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

/** The app type the client (`hc<AdminApp>()`) infers request/response types from. */
export type AdminApp = typeof routes;
export default app;
