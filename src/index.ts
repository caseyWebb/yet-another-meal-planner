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
import { handleHealthRequest, writeJobHealth, notifyFailure } from "./health.js";
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
    return createMcpHandler(buildServer(env, resolved))(request, env, ctx);
  },
};

/**
 * Everything that isn't the gated MCP API. The provider itself serves `/token`,
 * `/register`, and the discovery metadata; we own the invite-code `/authorize`
 * UI, the Kroger `/oauth/*` callback (its own PKCE flow), and a health line.
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
    if (url.pathname === "/health") return handleHealthRequest(request, env);
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
   * Cron-driven flyer warm (flyer-cache-warming). One trigger fires on a short
   * cadence; each tick advances the cursor sweep (`flyer-warm.ts`) — building the
   * plan, scanning the next batch, or no-opping when the sweep is complete. Thin by
   * design: all logic + the free-tier per-tick budgeting live in `runWarmTick`. A
   * failed tick is logged and retried next tick (the cursor only advances on success).
   */
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    // Health record, optional ntfy push, and the platform-honest rethrow all live in
    // runWarmJob (testable with injected deps).
    await runWarmJob(env, buildWarmDeps(env));
  },
};
