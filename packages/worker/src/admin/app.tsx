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
import { MembersPage } from "./pages/members.js";
import { MemberDetailPage, PendingMemberDetailPage, sectionOfSlug } from "./pages/member-detail.js";
import { StatusPage, STATUS_SPARKLINE_WINDOW } from "./pages/status.js";
import { registerDataRoutes } from "./pages/data.js";
import { fetchUsage, fetchUsageTrends, fetchToolUsage } from "../usage.js";
import { UsagePage } from "./pages/usage.js";
import { readInsights } from "../insights.js";
import { InsightsPage } from "./pages/insights.js";
import { readDiscoveryLog, readDiscoveryCandidates, readDiscoveryRowById, deleteDiscoveryRow } from "../discovery-db.js";
import { mintIngestKey, revokeIngestKey, readSatelliteLiveness } from "../ingest-db.js";
import { readRejections, getQuarantine, setQuarantine, clearQuarantine, DEFAULT_SOURCE_QUALITY_WINDOW_MS } from "../satellite-audit-db.js";
import { directoryFromEnv, normalizeTenantId } from "../tenant.js";
import { buildDiscoveryDeps, processCandidate, DEFAULT_CONFIG } from "../discovery-sweep.js";
import { addDiscoveryRejection } from "../corpus-db.js";
import { canonicalizeUrl } from "../url.js";
import { LogsPage, PAGE_SIZE as LOGS_PAGE_SIZE } from "./pages/logs.js";
import { DiscoveryPage } from "./pages/discovery.js";
import { SatellitesPage } from "./pages/satellites.js";
import { NormalizePage, parseQuery } from "./pages/normalize.js";
import { readNormalizationPage, readNodesPage } from "../normalize-admin.js";
import { readReconcileObservability } from "../reconcile-admin.js";
import { readAuditObservability, readAuditSurface } from "../audit-admin.js";
import { addAliases, deleteAlias, enqueueNovelTerms, deleteNormalizationLog } from "../corpus-db.js";
import { getDiscoveryConfig, putDiscoveryConfig, analyzeDiscovery, dryRunDiscovery, testFeed, getOperatorConfig, putOperatorConfig, listCorpus, addCorpus, deleteCorpus } from "./config-api.js";
import { registerConfigRoutes } from "./pages/config.js";
import { buildHealthRollup, renderHealthDock } from "./ui/health-dock.js";

/** The injectable surface the member-lifecycle operations close over (real bindings here). */
function adminDeps(env: Env): AdminDeps {
  return {
    tenantKv: env.TENANT_KV,
    krogerKv: env.KROGER_KV as unknown as KvStore,
    oauthKv: env.OAUTH_KV as unknown as KvStore,
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

/** The observation kinds a source-audit quarantine flag may key on (matches the ledger's `kind`). */
const QUARANTINE_KINDS: readonly string[] = ["recipe", "sale", "order"];
/** Cap the operator quarantine note before it lands in D1 (matches the local-reject `sample` bound). */
const QUARANTINE_NOTE_MAX = 256;

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
  // Config › Ingest Keys: the satellite key roster (recipe-ingestion). GET returns the liveness
  // rollup's per-satellite rows (label/prefix/sources/status/versions/skew — no secret); mint
  // returns the plaintext secret ONCE; revoke is immediate.
  .get("/api/ingest/keys", async (c) => c.json({ satellites: (await readSatelliteLiveness(c.env)).satellites }))
  .post("/api/ingest/keys", validator("json", (v) => v as { label?: string; tenant?: string | null }), async (c) => {
    const body = c.req.valid("json");
    const label = String(body.label ?? "").trim();
    if (!label) throw new ToolError("validation_failed", "an ingest key needs a satellite label");
    // Optional tenant BINDING (satellite-pull-channel): absent/blank = operator-global. A bound
    // tenant is resolved against the SAME allowlist the rest of /admin* uses; a non-allowlisted
    // target mints nothing. The binding is immutable for the key's life.
    let tenant: string | null = null;
    const rawTenant = body.tenant == null ? "" : String(body.tenant).trim();
    if (rawTenant) {
      const id = normalizeTenantId(rawTenant);
      if (!(await directoryFromEnv(c.env).get(id))) {
        throw new ToolError("validation_failed", `tenant ${id} is not on the allowlist`, { field: "tenant" });
      }
      tenant = id;
    }
    return c.json(await mintIngestKey(c.env, label, Date.now(), tenant));
  })
  .post("/api/ingest/keys/:id/revoke", async (c) =>
    c.json({ id: c.req.param("id"), revoked: await revokeIngestKey(c.env, c.req.param("id")) }),
  )
  // Discovery › Satellites source-audit (satellite-source-audit): the per-source quarantine toggle
  // the audit island hits. Operator-only (behind accessGate); the flag keys on {tenant, kind, source}
  // — the SAME key the intake quarantine check uses (off the carrying key's tenant, not the kind) — so
  // setting it actually suppresses that source's intake. `tenant` comes from the source's own audit
  // row (operator-global recipe/sale = null; a tenant-bound source carries its binding). Structured
  // ToolErrors surface via app.onError; satellite-audit-db maps D1 failures to storage_error.
  .post(
    "/api/satellites/quarantine",
    validator("json", (v) => v as { kind?: string; source?: string; tenant?: string | null; note?: string }),
    async (c) => {
      const body = c.req.valid("json");
      const kind = String(body.kind ?? "").trim();
      const source = String(body.source ?? "").trim();
      if (!kind || !source) throw new ToolError("validation_failed", "quarantine needs a kind and a source");
      if (!QUARANTINE_KINDS.includes(kind)) {
        throw new ToolError("validation_failed", `quarantine kind must be one of ${QUARANTINE_KINDS.join(", ")}`, { field: "kind" });
      }
      const tenant = body.tenant == null || body.tenant === "" ? null : String(body.tenant);
      const note = body.note?.trim() ? body.note.trim().slice(0, QUARANTINE_NOTE_MAX) : null;
      await setQuarantine(c.env, { tenant, kind, source }, note);
      return c.json({ quarantined: true, kind, source, tenant });
    },
  )
  .post(
    "/api/satellites/quarantine/clear",
    validator("json", (v) => v as { kind?: string; source?: string; tenant?: string | null }),
    async (c) => {
      const body = c.req.valid("json");
      const kind = String(body.kind ?? "").trim();
      const source = String(body.source ?? "").trim();
      if (!kind || !source) throw new ToolError("validation_failed", "un-quarantine needs a kind and a source");
      if (!QUARANTINE_KINDS.includes(kind)) {
        throw new ToolError("validation_failed", `quarantine kind must be one of ${QUARANTINE_KINDS.join(", ")}`, { field: "kind" });
      }
      const tenant = body.tenant == null || body.tenant === "" ? null : String(body.tenant);
      const cleared = await clearQuarantine(c.env, { tenant, kind, source });
      return c.json({ cleared, kind, source, tenant });
    },
  )
  // Discovery: the raw log read (kept as a stable JSON surface at its existing path) and the
  // per-candidate row actions the Discovery island calls. Retry/Delete reuse the sweep's own
  // functions (shared logic, not a re-implementation) — same outcome as the autonomous sweep.
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
  )
  // Normalization area (operator-admin): the identity-graph mutations the Normalize island calls.
  // Override + Add-alias both write a HUMAN alias (source='human', which the auto cron never
  // overwrites) via addAliases; Re-queue re-enqueues the term for the next capture pass; the two
  // deletes prune an alias row / a failed decision row. All go through src/corpus-db.ts.
  .post("/api/normalization/alias", validator("json", (v) => v as { variant?: string; canonicalId?: string }), async (c) => {
    const { variant, canonicalId } = c.req.valid("json");
    if (!variant?.trim() || !canonicalId?.trim()) {
      throw new ToolError("validation_failed", "A non-empty variant and canonical id are required");
    }
    const updated = await addAliases(c.env, [{ variant, canonical: canonicalId }]);
    return c.json({ updated });
  })
  .delete("/api/normalization/alias/:variant", async (c) =>
    c.json({ removed: await deleteAlias(c.env, decodeURIComponent(c.req.param("variant"))) }),
  )
  .post("/api/normalization/requeue", validator("json", (v) => v as { term?: string }), async (c) => {
    const term = c.req.valid("json").term;
    if (!term?.trim()) throw new ToolError("validation_failed", "A non-empty term is required");
    await enqueueNovelTerms(c.env, [term.trim()]);
    return c.json({ requeued: term.trim() });
  })
  .delete("/api/normalization/decision/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) throw new ToolError("validation_failed", "A numeric decision id is required");
    return c.json({ removed: await deleteNormalizationLog(c.env, id) });
  });

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
export type AdminApp = typeof routes;
export default app;
