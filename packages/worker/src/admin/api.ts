// The typed `/admin/api/*` route surface (operator-admin): every mutation/preview route the
// panel calls plus the per-screen aggregate READ routes the admin SPA renders from (admin-spa
// D4 — one read per screen, assembling the exact same `src/` reads the panel has always used).
// JSX-free by design: the worker package's `"./admin-api"` export points here so the admin app
// (`packages/admin-app`) can infer `AdminApp` for its `hc` client without pulling any server
// JSX through its typecheck. `registerApiRoutes` chains onto the gated `/admin` Hono app, so
// request/response types accumulate for the client with zero codegen.

import { Hono } from "hono";
import type { BlankSchema } from "hono/types";
import { validator } from "hono/validator";
import type { Env } from "../env.js";
import { db } from "../db.js";
import { appBuild } from "../api/middleware.js";
import { ToolError } from "../errors.js";
import type { KvStore } from "../kroger-user.js";
import {
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
  HEALTH_JOBS,
  JOB_RUNS_PER_JOB_CAP,
  type JobRun,
} from "../health.js";
import {
  corpusCounts,
  memberDetail,
  recipeTitles,
  recipeList,
  recipeDetail,
  recipeFacets,
  searchRecipes,
  storeList,
  storeDetail,
  guidanceListing,
  guidanceObject,
  type SearchMode,
  type RecipeFacetRow,
} from "../admin-data.js";
import { parseMarkdown } from "../parse.js";
import { parseMarkdownDocument, renderMarkdown } from "./markdown.js";
import { fetchUsage, fetchUsageTrends, fetchToolUsage } from "../usage.js";
import { readInsights } from "../insights.js";
import { readDiscoveryLog, readDiscoveryCandidates, readDiscoveryRowById, deleteDiscoveryRow } from "../discovery-db.js";
import { mintIngestKey, revokeIngestKey, readSatelliteLiveness } from "../ingest-db.js";
import { readRejections, getQuarantine, setQuarantine, clearQuarantine, DEFAULT_SOURCE_QUALITY_WINDOW_MS } from "../satellite-audit-db.js";
import { directoryFromEnv, normalizeTenantId } from "../tenant.js";
import { buildDiscoveryDeps, processCandidate, DEFAULT_CONFIG } from "../discovery-sweep.js";
import { addDiscoveryRejection, addAliases, deleteAlias, enqueueNovelTerms, deleteNormalizationLog } from "../corpus-db.js";
import { canonicalizeUrl } from "../url.js";
import { readNormalizationPage, readNodesPage } from "../normalize-admin.js";
import { readReconcileObservability } from "../reconcile-admin.js";
import { readAuditObservability, readAuditSurface } from "../audit-admin.js";
import { CONTRACT_VERSION } from "@grocery-agent/contract";
import { getDiscoveryConfig, putDiscoveryConfig, analyzeDiscovery, dryRunDiscovery, testFeed, getOperatorConfig, putOperatorConfig, listCorpus, addCorpus, deleteCorpus } from "./config-api.js";

/** The injectable surface the member-lifecycle operations close over (real bindings here). */
export function adminDeps(env: Env): AdminDeps {
  return {
    tenantKv: env.TENANT_KV,
    krogerKv: env.KROGER_KV as unknown as KvStore,
    oauthKv: env.OAUTH_KV as unknown as KvStore,
    db: db(env),
    randomCode: randomInviteCode,
  };
}

function connectorUrl(reqUrl: string): string {
  return `${new URL(reqUrl).origin}/mcp`;
}

/** The observation kinds a source-audit quarantine flag may key on (matches the ledger's `kind`). */
const QUARANTINE_KINDS: readonly string[] = ["recipe", "sale", "order"];
/** Cap the operator quarantine note before it lands in D1 (matches the local-reject `sample` bound). */
const QUARANTINE_NOTE_MAX = 256;

/** How many recent runs the Status view's per-job uptime sparkline shows (also the track's
 *  slot count, so a shorter history right-aligns against the NOW edge). */
export const STATUS_SPARKLINE_WINDOW = 30;

/** The Recipes list page-size selector's offered values and default (operator-data-explorer's
 *  "configurable page size, default 50"). */
export const RECIPES_PAGE_SIZES = [25, 50, 100] as const;
export const RECIPES_DEFAULT_PAGE_SIZE = 50;

/** Parse a `?size=` query value to one of `RECIPES_PAGE_SIZES`, defaulting for anything
 *  absent/unrecognized (never a caller-controlled arbitrary page size). */
function parsePageSize(raw: string | undefined): number {
  const n = Number(raw);
  return (RECIPES_PAGE_SIZES as readonly number[]).includes(n) ? n : RECIPES_DEFAULT_PAGE_SIZE;
}

/**
 * Register every typed `/admin/api/*` route on the gated admin app and return the chain
 * (its accumulated type is `AdminApp`, the `hc` client's schema). Reads assemble the SAME
 * `src/` functions the SSR pages call; mutations/previews are unchanged. Routes run behind
 * the app's `accessGate` (registered before this) and surface structured `ToolError`s via
 * the app's `onError` — data, never an unhandled 500.
 */
export function registerApiRoutes(app: Hono<{ Bindings: Env }, BlankSchema, "/admin">) {
  return (
    app
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
      // Discovery › Satellites source-audit (satellite-source-audit): the per-source quarantine toggle.
      // Operator-only (behind accessGate); the flag keys on {tenant, kind, source} — the SAME key the
      // intake quarantine check uses (off the carrying key's tenant, not the kind) — so setting it
      // actually suppresses that source's intake. `tenant` comes from the source's own audit row
      // (operator-global recipe/sale = null; a tenant-bound source carries its binding). Structured
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
      // per-candidate row actions. Retry/Delete reuse the sweep's own functions (shared logic, not a
      // re-implementation) — same outcome as the autonomous sweep.
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
      // Normalization area (operator-admin): the identity-graph mutations. Override + Add-alias both
      // write a HUMAN alias (source='human', which the auto cron never overwrites) via addAliases;
      // Re-queue re-enqueues the term for the next capture pass; the two deletes prune an alias row /
      // a failed decision row. All go through src/corpus-db.ts.
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
      })
      // ── The SPA's per-screen aggregate reads (admin-spa D4) ────────────────────────────────
      // One Access-gated GET per screen, assembling the exact reads the SSR pages composed —
      // no new `env.DB` access, no new read logic. Degraded payloads are DATA (200 + payload),
      // never a thrown 500 (the /health-derived posture, D6).
      //
      // The Status aggregate: the same `buildHealthPayload` the public /health serves, plus the
      // corpus stat-tile counts, each job's recent run history (uptime sparkline + since-label),
      // the reconcile/audit observability rows, and the active satellites. Also the global
      // health indicator's rollup source — the indicator subscribes to this same read (D6).
      .get("/api/status", async (c) => {
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
        // `appBuild` is the code SHA the Worker is actually running (deploy stamps it via
        // `--var APP_BUILD:<sha>`; "dev" locally) — the admin footer renders it so the operator
        // can confirm at a glance what's live. Mirrors the `contractVersion` precedent here.
        return c.json({
          payload,
          counts,
          runsByJob,
          reconcile,
          audit,
          satellites: liveness.activeSatellites,
          contractVersion: CONTRACT_VERSION,
          appBuild: appBuild(c.env),
        });
      })
      // Member detail: the roster row + the member-360 read + recipe-title resolution. A pending
      // member returns `{ row, detail: null }` ONLY — no per-tenant detail read is attempted for
      // data that does not exist yet (today's SSR guard, verbatim).
      .get("/api/members/:id", async (c) => {
        const id = decodeURIComponent(c.req.param("id"));
        const { tenants } = await listTenants(c.env, adminDeps(c.env));
        const row = tenants.find((t) => t.id === id);
        if (!row) throw new ToolError("not_found", `No member ${id} on the allowlist`);
        if (row.status === "pending") return c.json({ row, detail: null, titles: {} as Record<string, string> });
        const detail = await memberDetail(c.env, row.id);
        const slugs = [
          ...detail.meal_plan.map((p) => p.recipe),
          ...detail.cooking_log.map((r) => (typeof r.recipe === "string" ? r.recipe : null)).filter((s): s is string => !!s),
        ];
        const titles = Object.fromEntries(await recipeTitles(c.env, slugs));
        return c.json({ row, detail, titles });
      })
      // The all-jobs run log (Logs area): the whole bounded read; the SPA filters/paginates
      // client-side and resolves `?run=` against this payload (pruned id → default view).
      .get("/api/logs/runs", async (c) =>
        c.json({ jobs: HEALTH_JOBS, runs: await readAllJobRuns(c.env, JOB_RUNS_PER_JOB_CAP * HEALTH_JOBS.length) }),
      )
      // Data › Recipes: the cross-tier list/search assembly (keyword/hybrid + facet join),
      // server-parameterized — hybrid embeds the query (one Workers AI call), and pagination
      // stays server-side exactly as the SSR render sliced it.
      .get("/api/data/recipes", async (c) => {
        const query = c.req.query("q") ?? "";
        const mode: SearchMode = c.req.query("mode") === "hybrid" ? "hybrid" : "keyword";
        const requested = Math.max(0, Number(c.req.query("page") ?? "1") - 1);
        const size = parsePageSize(c.req.query("size"));
        const [{ recipes }, search, facetRows] = await Promise.all([
          recipeList(c.env),
          searchRecipes(c.env, query, mode),
          recipeFacets(c.env),
        ]);
        const bySlug = new Map(recipes.map((r) => [r.slug, r]));
        const results = search.results.filter((h) => bySlug.has(h.slug));
        const pages = Math.max(1, Math.ceil(results.length / size));
        const page = Math.min(requested, pages - 1);
        const hits = results.slice(page * size, page * size + size).map((h) => {
          const row = bySlug.get(h.slug)!;
          const facets: RecipeFacetRow = facetRows.get(h.slug) ?? { protein: null, cuisine: null, time_total: null };
          return { ...row, ...facets, score: h.score, semantic: h.semantic };
        });
        return c.json({ query, mode, resolvedMode: search.mode, size, page, pages, total: results.length, hits });
      })
      // Data › Recipe detail: the cross-tier record + the Worker-rendered markdown body (D8 —
      // one renderer, no `marked` in the browser) + the parsed R2 frontmatter for the KV panel.
      .get("/api/data/recipes/:slug", async (c) => {
        const detail = await recipeDetail(c.env, decodeURIComponent(c.req.param("slug")));
        const frontmatter = detail.source ? parseMarkdown(detail.source, "recipe source").frontmatter : null;
        const html = detail.status !== "orphaned" && detail.body ? renderMarkdown(detail.body) : null;
        return c.json({ ...detail, frontmatter, html });
      })
      .get("/api/data/stores", async (c) => c.json(await storeList(c.env)))
      .get("/api/data/stores/:slug", async (c) => c.json(await storeDetail(c.env, decodeURIComponent(c.req.param("slug")))))
      // Data › Guidance: a browse read discriminated on its params — `?gpath` renders one R2
      // object (frontmatter + Worker-rendered HTML, D8), else `?gprefix` lists a folder.
      .get("/api/data/guidance", async (c) => {
        const gpath = c.req.query("gpath");
        if (gpath) {
          const obj = await guidanceObject(c.env, gpath);
          const doc = parseMarkdownDocument(obj.markdown, "guidance object");
          return c.json({ kind: "object" as const, path: obj.key, frontmatter: doc.frontmatter, html: doc.html });
        }
        const prefix = c.req.query("gprefix") ?? "";
        const listing = await guidanceListing(c.env, prefix || undefined);
        return c.json({ kind: "listing" as const, prefix, listing });
      })
      // Insights: every window's precomputed aggregates in ONE payload — the SPA's window/sort/
      // expand toggles re-render from it with zero further requests (group-insights).
      .get("/api/insights", async (c) => c.json(await readInsights(c.env)))
      // Usage: the three observability dashboards. Not-configured / upstream-failure detail
      // states pass through STRUCTURALLY, as data — never a thrown 500.
      .get("/api/usage", async (c) => {
        const [usage, trends, tools] = await Promise.all([fetchUsage(c.env), fetchUsageTrends(c.env), fetchToolUsage(c.env)]);
        return c.json({ usage, trends, tools });
      })
      // Discovery: the bounded candidate read + the liveness-derived ingest strip (the SPA's
      // filter pills + pager work client-side over this one payload).
      .get("/api/discovery/candidates", async (c) => {
        const [candidates, liveness] = await Promise.all([readDiscoveryCandidates(c.env, 200), readSatelliteLiveness(c.env)]);
        return c.json({
          candidates,
          ingest: {
            activeSatellites: liveness.stats.activeSatellites,
            fresh: liveness.stats.fresh,
            stale: liveness.stats.stale,
            pushedToday: liveness.funnel.arrival.received,
            warn: liveness.stats.stale > 0 || liveness.activeSatellites.some((s) => s.skew),
          },
          now: Date.now(),
        });
      })
      // Discovery › Satellites: liveness rollup + the windowed rejection ledger + quarantine
      // flags — the SatellitesPage props, joined client-side exactly as the SSR page joined them.
      .get("/api/satellites", async (c) => {
        const now = Date.now();
        const [rollup, rejections, quarantine] = await Promise.all([
          readSatelliteLiveness(c.env, now),
          readRejections(c.env, { sinceMs: now - DEFAULT_SOURCE_QUALITY_WINDOW_MS, limit: 1000 }),
          getQuarantine(c.env),
        ]);
        return c.json({ rollup, rejections, quarantine, now });
      })
      // Normalize: the four per-tab reads, split so a tab switch fetches only its data and a
      // mutation invalidates narrowly (D4).
      .get("/api/normalization/page", async (c) => {
        const now = Date.now();
        return c.json({ data: await readNormalizationPage(c.env, { now }), now });
      })
      .get("/api/normalization/nodes", async (c) => c.json(await readNodesPage(c.env)))
      .get("/api/normalization/audit", async (c) => c.json(await readAuditSurface(c.env)))
      .get("/api/reconcile", async (c) => c.json(await readReconcileObservability(c.env)))
  );
}

/** The app type the client (`hc<AdminApp>()`) infers request/response types from. */
export type AdminApp = ReturnType<typeof registerApiRoutes>;
