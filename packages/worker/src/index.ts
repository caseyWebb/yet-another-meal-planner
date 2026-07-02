// Worker entry (multi-tenancy §3). The Worker is an OAuth 2.1 provider: every
// member connects their own Claude.ai, completes the invite-code authorize flow
// (authorize.ts), and gets an access token whose grant `props` carry their
// `tenantId`. @cloudflare/workers-oauth-provider validates the token on `/mcp`,
// implements `/token` + `/register` + `.well-known` discovery, and hands us the
// props. We resolve the tenant and build a per-tenant MCP server — stateless, no
// Durable Objects. The OAuth provider is the gate.

import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp";
import type { Env } from "./env.js";
import { buildServer } from "./tools.js";
import { resolveTenant, directoryFromEnv } from "./tenant.js";
import { handleOAuth } from "./oauth.js";
import { handleAuthorize } from "./authorize.js";
import { handleInboundEmail, rejectReasonFor, type InboundMessage } from "./email.js";
import { buildWarmDeps, runWarmJob } from "./flyer-warm.js";
import { buildSaleScanPlanDeps, runSaleScanPlanJob } from "./sale-scan-plan.js";
import { buildEmbedDeps, runEmbedJob } from "./recipe-embeddings.js";
import { runNightVibeVectorJob } from "./night-vibe-vector.js";
import { runReconcileSignalsJob } from "./reconcile-signals.js";
import { runArchetypeDerivationJob } from "./night-vibe-suggest.js";
import { buildFacetDeps, runFacetJob } from "./recipe-classify.js";
import { buildProjectionDeps, runProjectionJob } from "./recipe-projection.js";
import { buildDiscoveryDeps, runDiscoverySweepJob } from "./discovery-sweep.js";
import { buildNormalizeDeps, runNormalizeJob } from "./ingredient-normalize.js";
import { buildReconfirmDeps, runReconfirmJob } from "./ingredient-reconfirm.js";
import { buildAliasAuditDeps, runAliasAuditJob } from "./ingredient-alias-audit.js";
import { buildEdgeAuditDeps, runEdgeAuditJob } from "./ingredient-edge-audit.js";
import { runSkuRekeyJob } from "./sku-cache-rekey.js";
import { runReconcileJob } from "./grocery-pantry-reconcile.js";
import { loadDiscoveryConfig } from "./discovery-calibration.js";
import { loadOperatorConfig } from "./operator-config.js";
import { createR2CorpusStore } from "./corpus-store.js";
import { handleHealthRequest, handleHealthSvgRequest, writeJobHealth, writeJobRun, recordUsagePoint, notifyFailure } from "./health.js";
import { handleCookbook } from "./cookbook.js";
import { handleSource } from "./source.js";
import { handleIngest } from "./ingest.js";
import { handleSatelliteClaim, handleSatelliteResults } from "./satellite.js";
import adminApp from "./admin/app.js";

/**
 * The gated MCP API. Only reached for `/mcp` requests the provider has already
 * authenticated; `ctx.props` is the grant's props. We re-check `tenantId` against
 * the allowlist and serve a server scoped to that tenant — no tool can reach
 * another tenant's data.
 */
const apiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const props = (ctx as unknown as { props?: { tenantId?: string } }).props;
    // recordSeen=true: this IS the MCP hot path, so a successful resolution here is a
    // genuine "tenant is active" signal (best-effort, throttled — see touchTenantActivity).
    const resolved = await resolveTenant(env, props?.tenantId, directoryFromEnv(env), true);
    if ("error" in resolved) {
      return new Response(JSON.stringify(resolved), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    // The request origin is the Worker's own public host (the operator's domain) — passed
    // to buildServer so `recipe_site_url` can resolve the Worker-hosted cookbook.
    const origin = new URL(request.url).origin;
    return createMcpHandler(buildServer(env, resolved, origin))(request, env, ctx);
  },
};

/**
 * Everything that isn't the gated MCP API. The provider itself serves `/token`,
 * `/register`, and the discovery metadata; we own the invite-code `/authorize`
 * UI, the Kroger `/oauth/*` callback (its own PKCE flow), the Cloudflare
 * Access-gated `/admin` operator surface, and the open `/health` line.
 */
const defaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response("grocery-mcp ok — connect a Claude.ai MCP client to /mcp\n", {
        headers: { "content-type": "text/plain" },
      });
    }
    if (url.pathname === "/authorize") return handleAuthorize(request, env);
    if (url.pathname.startsWith("/oauth/")) return handleOAuth(env, url);
    // Key-authed carve-out from the Access gate: exactly POST /admin/api/ingest is
    // authenticated by an ingest key in handleIngest (a headless satellite has no Access JWT),
    // handled BEFORE the /admin dispatch so it never reaches the admin app's Access
    // middleware. Every other /admin* path stays Access-gated (adminApp below).
    if (url.pathname === "/admin/api/ingest") return handleIngest(request, env);
    // The satellite PULL CHANNEL (satellite-pull-channel), sibling to the push above but on
    // top-level `/satellite/*` paths — OUTSIDE `/admin*`, so the Access gate never applies;
    // the SAME ingest-key bearer auth + rate limit is their sole gate. Outbound-only: the
    // satellite initiates every call; the Worker opens nothing toward it.
    if (url.pathname === "/satellite/tasks/claim") return handleSatelliteClaim(request, env);
    if (url.pathname === "/satellite/results") return handleSatelliteResults(request, env);
    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      // The operator admin panel (Hono SSR + islands), gated by Cloudflare Access in the app
      // middleware. `run_worker_first` routes /admin* here before any static asset is served.
      return adminApp.fetch(request, env);
    }
    if (url.pathname === "/cookbook" || url.pathname.startsWith("/cookbook/")) return handleCookbook(request, env);
    if (url.pathname === "/health.svg") return handleHealthSvgRequest(env);
    if (url.pathname === "/health") return handleHealthRequest(env);
    // AGPL §13 source offer (open and tenant-clean) — see src/source.ts.
    if (url.pathname === "/source") return handleSource(env);
    return new Response("Not found", { status: 404 });
  },
};

const oauthProvider = new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler,
  defaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["mcp"],
});

/**
 * The OAuth provider owns `fetch` (the gated MCP API + OAuth endpoints). We add an
 * `email()` handler in the SAME Worker for inbound newsletter discovery — Cloudflare
 * Email Routing delivers forwarded recipe newsletters here. It runs without an OAuth
 * session (mail carries no token): discovery sources are shared, so the handler reads
 * the shared allowlist and writes the shared inbox directly.
 *
 * We AWAIT the handler (not waitUntil) so we can `setReject` a failure in-session:
 * the sender gets a bounce with the reason (debuggable forwarding) instead of a
 * silent drop. A genuine success — or an accepted message whose links were all
 * duplicates — is taken silently (`rejectReasonFor` returns null).
 */
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return oauthProvider.fetch(request, env, ctx);
  },
  async email(message: InboundMessage, env: Env): Promise<void> {
    const startedAt = Date.now();
    let reason: string | null;
    let ok = true;
    let summary: Record<string, unknown>;
    try {
      const result = await handleInboundEmail(message, env);
      console.log("[email] " + JSON.stringify(result)); // one structured line per message
      reason = rejectReasonFor(result);
      // Tenant-clean: gate outcome only — never the `from` address.
      summary = { accepted: result.accepted, reason: result.reason, written: result.written };
    } catch (e) {
      ok = false;
      const msg = e instanceof Error ? e.message : String(e);
      console.error("inbound email handler failed:", msg);
      reason = "A processing error occurred while indexing the message.";
      summary = { error: msg };
      await notifyFailure(env, "email", msg);
    }
    // Best-effort health record; a write failure must not change the reject decision.
    await writeJobHealth(env, "email", {
      ok,
      last_run_at: startedAt,
      summary,
    }).catch(() => {});
    // Per-run history record (job_runs), beside the job_health upsert — best-effort, same shape.
    await writeJobRun(env, "email", {
      ok,
      ran_at: startedAt,
      duration_ms: Date.now() - startedAt,
      summary,
    });
    // History point (usage-trends): doubles = [duration_ms, accepted(0|1), written(0|1)]. The boolean
    // gate outcomes are emitted as 0/1 so the trend stays purely numeric; tenant-clean (no `from`).
    recordUsagePoint(env, "email", {
      ok,
      durationMs: Date.now() - startedAt,
      counts: [summary.accepted === true ? 1 : 0, summary.written === true ? 1 : 0],
    });
    if (reason) message.setReject(reason);
  },
  /**
   * The single cron trigger drives FOUR jobs each tick — kept under one trigger so the
   * free-tier cron-count limit never bites:
   *   * flyer warm (flyer-cache-warming) — the cursor sweep in `flyer-warm.ts`.
   *   * recipe-index projection (r2-corpus-store) — `recipe-projection.ts` reads the R2
   *     corpus, validates it, and rebuilds the D1 `recipes` index (replacing the retired
   *     CI build). It writes the index the recipe-derived reconcile reads, so it runs
   *     BEFORE the embed job in the same tick.
   *   * recipe-derived reconcile (semantic recipe search) — `recipe-embeddings.ts` refills
   *     the description/embedding table from the freshly-projected `recipes` facets via
   *     `env.AI`. It draws on the INTERNAL-subrequest budget, not the flyer's external one.
   *   * discovery sweep (background-discovery-sweep) — `discovery-sweep.ts` polls feeds +
   *     the email inbox, classifies/taste-matches/imports via `env.AI`, and logs each
   *     outcome. It runs LAST so dedup + matching see a fresh index AND fresh embeddings.
   * The flyer warm is independent of the index, so it runs ALONGSIDE the projection; the
   * embed job runs after so it sees the fresh index; the discovery sweep runs after that.
   * Each writes its own health record + optional ntfy push, and any hard failure is rethrown
   * so the platform's native cron status reflects it.
   */
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const corpus = createR2CorpusStore(env.CORPUS);
    // Load operator config once; used for flyer warm pacing and sweep (below).
    const operatorConfig = await loadOperatorConfig(env).catch(() => null);
    // Phase 1: the facet classify pass (derives the descriptive facets the projection merges)
    // + the flyer warm (independent of the index), in parallel. Classify runs BEFORE the
    // projection so the projection materializes the EFFECTIVE facets (recipe-facet-derivation).
    const warmConfig = operatorConfig
      ? { batchUnits: operatorConfig.flyerBatchUnits, refreshMs: operatorConfig.flyerRefreshHours * 60 * 60 * 1000 }
      : {};
    // The sale-scan producer is a sibling of the flyer warm (NOT folded in): it only ENQUEUES
    // `sale-scan` tasks for non-Kroger stores (the satellite scans), spending zero external
    // subrequests. Refresh-gated on the same daily cadence as the flyer warm (operator-tunable).
    const saleScanConfig = operatorConfig ? { refreshMs: operatorConfig.flyerRefreshHours * 60 * 60 * 1000 } : {};
    const phase1 = await Promise.allSettled([
      runWarmJob(env, buildWarmDeps(env), warmConfig),
      runSaleScanPlanJob(env, buildSaleScanPlanDeps(env), saleScanConfig),
      runFacetJob(env, buildFacetDeps(env, corpus)),
      // The ingredient-normalization capture job is independent of the recipe pipeline
      // (it drains the novel-term queue); it rides the internal env.AI/D1 budget like classify.
      runNormalizeJob(env, buildNormalizeDeps(env)),
      // The periodic re-confirm pass runs AFTER the capture pass so it sees the freshest registry:
      // it re-examines edgeless concrete auto-nodes against the now-denser graph and enriches them
      // (adds satisfies edges / merges a clear synonym). Bounded + one-shot-stamped, so it quiesces
      // to a no-op once the under-connected backlog is drained.
      runReconfirmJob(env, buildReconfirmDeps(env)),
      // Re-key stale FOOD grocery/pantry rows onto the canonical id (D2 backfill). Idempotent +
      // bounded; a no-op once every row is canonical, so it self-terminates. Independent of the
      // recipe pipeline (touches only the per-tenant pantry/grocery tables). The job wrapper records
      // the `grocery-reconcile` health + per-run history the Normalize › Reconcile card reads back.
      runReconcileJob(env),
      // The normalization re-audit passes (normalization-decision-reaudit): converge the
      // pre-hardening AUTO backlog to the hardened rules with no operator action. Both are
      // bounded per tick, one-shot-stamped (`audited_at`; new decisions are born-stamped), and
      // quiesce to a no-op once the backlog drains — the same ≈0-LLM steady state as capture.
      //   * alias audit — self-aliases stamp free; every other auto mapping gets one hardened
      //     classifier re-decision, applied through capture's own commit (re-point / mint /
      //     orphan merge). Rides the internal env.AI/D1 budget.
      runAliasAuditJob(env, buildAliasAuditDeps(env)),
      //   * edge audit — deletes rep-resolved self-loops deterministically, resolves 2-cycles
      //     with one direction check, validates standing satisfies edges (drop on no).
      runEdgeAuditJob(env, buildEdgeAuditDeps(env)),
      // Re-key sku_cache rows onto the canonical id as capture moves resolution under them —
      // the cache's counterpart to the grocery/pantry reconcile above. Plain code, no LLM,
      // idempotent every tick (a converged pass plans nothing); no capture side effect, so
      // non-food legacy keys never enter the graph.
      runSkuRekeyJob(env),
    ]);
    // Phase 2: the index projection (merges the fresh classified facets + authored overrides).
    const phase2 = await Promise.allSettled([runProjectionJob(env, buildProjectionDeps(env, corpus))]);
    // Phase 3: the recipe-derived reconcile (describe → embed; reads the fresh index) plus the
    // per-vibe night-vibe embedding reconcile — both draw on the internal env.AI budget and are
    // change-driven (hash gates), so they coexist without competing for the flyer's 50-subrequest cap.
    const phase3 = await Promise.allSettled([runEmbedJob(env, buildEmbedDeps(env)), runNightVibeVectorJob(env)]);
    // Phase 4: the sweep runs after the index + embeddings are fresh (it dedups + matches against
    // them). Load the operator's stored config (sparse override merged over DEFAULT_CONFIG).
    const sweepConfig = await loadDiscoveryConfig(env);
    const phase4 = await Promise.allSettled([runDiscoverySweepJob(env, buildDiscoveryDeps(env), sweepConfig)]);
    // Phase 5: profile-reconciliation producers — the deterministic signal pass (no model) plus
    // the generative archetype-derivation pass (self-gated to ~daily; names new archetypes on the
    // small model and enqueues add_vibe proposals). Both feed the pending_proposals queue.
    const phase5 = await Promise.allSettled([runReconcileSignalsJob(env), runArchetypeDerivationJob(env)]);
    const failed = [...phase1, ...phase2, ...phase3, ...phase4, ...phase5].find((r) => r.status === "rejected");
    if (failed && failed.status === "rejected") throw failed.reason;
  },
};
