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
import { buildEmbedDeps, runEmbedJob } from "./recipe-embeddings.js";
import { buildFacetDeps, runFacetJob } from "./recipe-classify.js";
import { buildProjectionDeps, runProjectionJob } from "./recipe-projection.js";
import { buildDiscoveryDeps, runDiscoverySweepJob } from "./discovery-sweep.js";
import { loadDiscoveryConfig } from "./discovery-calibration.js";
import { createR2CorpusStore } from "./corpus-store.js";
import { handleHealthRequest, handleHealthSvgRequest, writeJobHealth, notifyFailure } from "./health.js";
import { handleAdmin } from "./admin.js";
import { handleCookbook } from "./cookbook.js";
import type { KvStore } from "./kroger-user.js";

/**
 * The gated MCP API. Only reached for `/mcp` requests the provider has already
 * authenticated; `ctx.props` is the grant's props. We re-check `tenantId` against
 * the allowlist and serve a server scoped to that tenant — no tool can reach
 * another tenant's data.
 */
const apiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const props = (ctx as unknown as { props?: { tenantId?: string } }).props;
    const resolved = await resolveTenant(env, props?.tenantId, directoryFromEnv(env));
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
    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) return handleAdmin(request, env);
    if (url.pathname === "/cookbook" || url.pathname.startsWith("/cookbook/")) return handleCookbook(request, env);
    if (url.pathname === "/health.svg") return handleHealthSvgRequest(env);
    if (url.pathname === "/health") return handleHealthRequest(env);
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
    await writeJobHealth(env.KROGER_KV as unknown as KvStore, "email", {
      ok,
      last_run_at: startedAt,
      summary,
    }).catch(() => {});
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
    const kv = env.KROGER_KV as unknown as KvStore;
    const corpus = createR2CorpusStore(env.CORPUS);
    // Phase 1: the facet classify pass (derives the descriptive facets the projection merges)
    // + the flyer warm (independent of the index), in parallel. Classify runs BEFORE the
    // projection so the projection materializes the EFFECTIVE facets (recipe-facet-derivation).
    const phase1 = await Promise.allSettled([
      runWarmJob(env, buildWarmDeps(env)),
      runFacetJob(env, buildFacetDeps(env, corpus)),
    ]);
    // Phase 2: the index projection (merges the fresh classified facets + authored overrides).
    const phase2 = await Promise.allSettled([runProjectionJob(env, buildProjectionDeps(env, corpus), kv)]);
    // Phase 3: the recipe-derived reconcile (describe → embed; reads the fresh index).
    const phase3 = await Promise.allSettled([runEmbedJob(env, buildEmbedDeps(env))]);
    // Phase 4: the sweep runs after the index + embeddings are fresh (it dedups + matches against
    // them). Load the operator's stored config (sparse override merged over DEFAULT_CONFIG).
    const sweepConfig = await loadDiscoveryConfig(env);
    const phase4 = await Promise.allSettled([runDiscoverySweepJob(env, buildDiscoveryDeps(env), kv, sweepConfig)]);
    const failed = [...phase1, ...phase2, ...phase3, ...phase4].find((r) => r.status === "rejected");
    if (failed && failed.status === "rejected") throw failed.reason;
  },
};
