// The operator admin app on Hono (operator-admin rewrite). Mounts under the existing
// Worker's `fetch` at `/admin` (no second Worker), reusing `requireAccess` verbatim as
// middleware. Pages are server-rendered by calling the Worker's own `src/` operation
// functions directly; interactive islands call the typed `/admin/api/*` routes via `hc`.
// Both transports call the SAME `src/` functions — one source of truth per operation.
// The typed route surface (mutations + the SPA's aggregate reads) lives in ./api.ts
// (JSX-free, so the worker package can export its `AdminApp` type to the admin app).

import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { Env } from "../env.js";
import { ToolError } from "../errors.js";
import { requireAccess } from "../admin.js";
import { listTenants } from "../admin.js";
import {
  buildHealthPayload,
  readJobRuns,
  readAllJobRuns,
  readJobRunById,
  HEALTH_JOBS,
  JOB_RUNS_PER_JOB_CAP,
  type JobRun,
} from "../health.js";
import { corpusCounts, memberDetail, recipeTitles } from "../admin-data.js";
import { registerApiRoutes, adminDeps, STATUS_SPARKLINE_WINDOW } from "./api.js";
import { MembersPage } from "./pages/members.js";
import { MemberDetailPage, PendingMemberDetailPage, sectionOfSlug } from "./pages/member-detail.js";
import { StatusPage } from "./pages/status.js";
import { registerDataRoutes } from "./pages/data.js";
import { fetchUsage, fetchUsageTrends, fetchToolUsage } from "../usage.js";
import { UsagePage } from "./pages/usage.js";
import { readInsights } from "../insights.js";
import { InsightsPage } from "./pages/insights.js";
import { readDiscoveryCandidates } from "../discovery-db.js";
import { readSatelliteLiveness } from "../ingest-db.js";
import { readRejections, getQuarantine, DEFAULT_SOURCE_QUALITY_WINDOW_MS } from "../satellite-audit-db.js";
import { LogsPage, PAGE_SIZE as LOGS_PAGE_SIZE } from "./pages/logs.js";
import { DiscoveryPage } from "./pages/discovery.js";
import { SatellitesPage } from "./pages/satellites.js";
import { NormalizePage, parseQuery } from "./pages/normalize.js";
import { readNormalizationPage, readNodesPage } from "../normalize-admin.js";
import { readReconcileObservability } from "../reconcile-admin.js";
import { readAuditObservability, readAuditSurface } from "../audit-admin.js";
import { registerConfigRoutes } from "./pages/config.js";
import { buildHealthRollup, renderHealthDock } from "./ui/health-dock.js";

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

// Home (`/admin`) is the Status service-health view, SSR'd from the same `buildHealthPayload`
// the public `/health` uses (no client fetch, no decoder), plus the corpus stat-tile counts and
// each job's recent run history (for the uptime sparkline + healthy/unhealthy-since label).
app.get("/", async (c) => {
  const [payload, counts, liveness, reconcile, audit] = await Promise.all([
    buildHealthPayload(c.env, HEALTH_JOBS),
    corpusCounts(c.env),
    readSatelliteLiveness(c.env),
    readReconcileObservability(c.env),
    readAuditObservability(c.env),
  ]);
  const runsByJob: Record<string, JobRun[]> = {};
  await Promise.all(
    HEALTH_JOBS.map(async (name) => {
      runsByJob[name] = await readJobRuns(c.env, name, STATUS_SPARKLINE_WINDOW);
    }),
  );
  return c.html(
    page(
      <StatusPage
        payload={payload}
        counts={counts}
        runsByJob={runsByJob}
        reconcile={reconcile}
        audit={audit}
        satellites={liveness.activeSatellites}
      />,
    ),
  );
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

// The typed `/admin/api/*` surface: every mutation/preview route the islands call plus the
// SPA's per-screen aggregate reads (admin-spa) — chained in ./api.ts so their request/response
// types accumulate into `AdminApp` for the `hc` client (zero codegen).
registerApiRoutes(app);

// Data explorer area (operator-data-explorer): read-only SSR views over D1 + the R2 corpus.
registerDataRoutes(app);

// Config area (operator-admin): the discovery calibration console (+ ranking/flyer + corpus editors).
registerConfigRoutes(app);

// Discovery area (operator-admin): the candidate-pipeline view — stat tiles, filter pills, and
// the paginated per-candidate progression-track cards, SSR'd from readDiscoveryCandidates. The
// area's SOLE content; it absorbed the candidate log formerly at /admin/logs/discovery (that
// route now redirects here — see the Logs section below).
// Normalization area (operator-admin): the ingredient-identity audit + override surface — three
// tabs (Decisions / Queue / Aliases), SSR'd from readNormalizationPage; the mutations hydrate via
// client/normalize.tsx. The Aliases tab subsumes the retired Config › Aliases editor.
app.get("/normalize", async (c) => {
  const query = parseQuery(new URL(c.req.url));
  const [data, reconcile, nodes, audit] = await Promise.all([
    readNormalizationPage(c.env, { now: Date.now() }),
    readReconcileObservability(c.env),
    readNodesPage(c.env),
    readAuditSurface(c.env),
  ]);
  return c.html(page(<NormalizePage data={data} query={query} now={Date.now()} reconcile={reconcile} nodes={nodes} audit={audit} />));
});

app.get("/discovery", async (c) => {
  const [candidates, liveness] = await Promise.all([readDiscoveryCandidates(c.env, 200), readSatelliteLiveness(c.env)]);
  const filter = c.req.query("filter") ?? "all";
  const pageParam = Number(c.req.query("page") ?? "1");
  const requestedPage = Number.isFinite(pageParam) && pageParam > 0 ? pageParam - 1 : 0;
  const ingest = {
    activeSatellites: liveness.stats.activeSatellites,
    fresh: liveness.stats.fresh,
    stale: liveness.stats.stale,
    pushedToday: liveness.funnel.arrival.received,
    warn: liveness.stats.stale > 0 || liveness.activeSatellites.some((s) => s.skew),
  };
  return c.html(
    page(<DiscoveryPage candidates={candidates} filter={filter} page={requestedPage} now={Date.now()} ingest={ingest} />),
  );
});

// Discovery › Satellites (satellite-source-audit): the satellite ingest liveness view + the
// per-source health audit. The rollup carries the compute-on-read quality dimension; the ledger +
// quarantine flags are fetched alongside it so the page can join the audit onto each source row and
// seed the quarantine island (windowed to the same reliability span the quality rollup uses).
app.get("/discovery/satellites", async (c) => {
  const now = Date.now();
  const [rollup, rejections, quarantine] = await Promise.all([
    readSatelliteLiveness(c.env, now),
    readRejections(c.env, { sinceMs: now - DEFAULT_SOURCE_QUALITY_WINDOW_MS, limit: 1000 }),
    getQuarantine(c.env),
  ]);
  return c.html(page(<SatellitesPage rollup={rollup} rejections={rejections} quarantine={quarantine} now={now} />));
});

// Insights area (group-insights): a group-wide popularity dashboard over the recipe corpus. SSR'd
// for first paint from the one `readInsights` group-aggregation reader, then hydrated into an
// interactive island (window / sort / expand) seeded from the emitted props block — no client
// fetch. Read-only; aggregates across all member-tenants (the admin surface is cross-tenant).
app.get("/insights", async (c) => {
  return c.html(page(<InsightsPage payload={await readInsights(c.env)} />));
});

// Usage area (usage-observability / usage-trends / tool-usage-trends): three SSR dashboards.
app.get("/usage", async (c) => {
  const [usage, trends, tools] = await Promise.all([fetchUsage(c.env), fetchUsageTrends(c.env), fetchToolUsage(c.env)]);
  return c.html(page(<UsagePage usage={usage} trends={trends} tools={tools} />));
});

// Logs area (operator-admin): the default content is the all-cron-jobs run log (job_runs,
// merged newest-first, SSR — query-param filter + pagination, native-disclosure expand). The
// `?run=<id>` param (the Status sparkline's deep-link) resolves server-side to the run's job
// filter + page + a highlighted, pre-expanded entry, falling back to the default view when the
// id is unresolvable (pruned past the retention cap). The Logs area does NOT host a
// candidate-level Discovery destination — that lives at the top-level Discovery area
// (/admin/discovery); the legacy /admin/logs/discovery route redirects there (below).
app.get("/logs", async (c) => {
  const runs = await readAllJobRuns(c.env, JOB_RUNS_PER_JOB_CAP * HEALTH_JOBS.length);
  const now = Date.now();
  const runId = c.req.query("run");
  if (runId) {
    const linked = await readJobRunById(c.env, runId);
    if (linked) {
      const filtered = runs.filter((r) => r.job === linked.job);
      const idx = filtered.findIndex((r) => r.id === linked.id);
      const resolvedPage = idx >= 0 ? Math.floor(idx / LOGS_PAGE_SIZE) : 0;
      return c.html(
        page(<LogsPage runs={runs} job={linked.job} page={resolvedPage} now={now} highlightId={linked.id} />),
      );
    }
    // The linked run is gone (pruned past the retention cap since the link was rendered) —
    // degrade to the default unfiltered, first-page view rather than an error.
  }
  const job = c.req.query("job") ?? "All";
  const pageParam = Number(c.req.query("page") ?? "1");
  const requestedPage = Number.isFinite(pageParam) && pageParam > 0 ? pageParam - 1 : 0;
  return c.html(page(<LogsPage runs={runs} job={job} page={requestedPage} now={now} />));
});
// Legacy destination — preserves any bookmark rather than 404ing (admin-ui-redesign-discovery).
app.get("/logs/discovery", (c) => c.redirect("/admin/discovery", 302));

// Static islands + styles fall through to the ASSETS binding (already past the Access gate;
// `ASSETS.fetch` bypasses run_worker_first, so this never re-enters and loops). The binding has
// `not_found_handling: "single-page-application"`, and that fallback answers a `.fetch()` miss
// with the member SPA's index.html at HTTP 200 — admin static assets are only ever js/css/images/
// maps, so an HTML response here means a genuine miss (typo'd island, renamed bundle) and must
// 404 for real rather than silently serving the SPA shell.
app.notFound(async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (res.headers.get("content-type")?.startsWith("text/html")) return c.text("Not found", 404);
  return res;
});

/** The app type the client (`hc<AdminApp>()`) infers request/response types from. */
export type { AdminApp } from "./api.js";
export default app;
