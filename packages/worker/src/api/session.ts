// The `session` area (member-session-auth): invite-code login, whoami, logout. The
// login body's invite code goes through the SAME `resolveInvite` mapping that
// provisions the Claude.ai connector — one operator-issued code per friend covers both
// surfaces, and re-entry after expiry reuses it. The resolved `(tenant, member)` pair
// runs through the shared identity resolver, and the minted session is bound to it. An
// unknown code, a revoked member's code, and a delisted tenant's code are
// INDISTINGUISHABLE (one uniform `unauthorized` 401 — no oracle). Login is
// rate-limited per client IP by the shared fixed-window limiter (fail-open: a KV
// hiccup must never lock members out).

import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { resolveInvite, inviteAccepted, resolveIdentity, directoryFromEnv } from "../tenant.js";
import { loadDeploymentProfile, operatorConfig } from "../deployment.js";
import { underRateLimit } from "../rate-limit.js";
import {
  createSession,
  deleteSession,
  requireSession,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
  type ApiEnv,
} from "../session.js";
import { jsonWithEtag } from "./etag.js";

/** Login attempts per client IP per fixed window (design: 10/min). Counters live in
 *  KROGER_KV beside the ingest limiter's (ephemeral infra, self-expiring). */
const LOGIN_RL_MAX = 10;
const LOGIN_RL_WINDOW_S = 60;

export const sessionArea = new Hono<ApiEnv>()
  // Login: invite code → session cookie. Counts EVERY attempt against the IP window
  // (before resolution — a guessing loop burns its budget whether codes exist or not).
  .post("/session", async (c) => {
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    if (!(await underRateLimit(c.env.KROGER_KV, `login:rl:${ip}`, LOGIN_RL_MAX, LOGIN_RL_WINDOW_S, Date.now()))) {
      return c.json({ error: "rate_limited" as const, message: "Too many attempts — try again in a minute" }, 429);
    }
    let code = "";
    try {
      const body = await c.req.json<{ invite_code?: unknown }>();
      if (typeof body?.invite_code === "string") code = body.invite_code.trim();
    } catch {
      // A malformed body falls through to the same uniform 401 as an unknown code.
    }
    const inv = code ? await resolveInvite(c.env.TENANT_KV, code) : null;
    if (!inv || !inviteAccepted(inv, c.env)) {
      // UNIFORM for unknown / expired / revoked / grace-rejected legacy code — never distinguish.
      return c.json({ error: "unauthorized" as const, message: "That invite code didn't work" }, 401);
    }
    // The shared resolver: member liveness (a code whose member was revoked is dead even if
    // the mapping lingers) + the lazy founding-member convergence — same uniform 401 on failure.
    const resolved = await resolveIdentity(c.env, inv.tenant, inv.member, directoryFromEnv(c.env));
    if ("error" in resolved) {
      return c.json({ error: "unauthorized" as const, message: "That invite code didn't work" }, 401);
    }
    const token = await createSession(c.env.TENANT_KV, resolved.id, resolved.member);
    setSessionCookie(c, token);
    return c.json({ tenant: resolved });
  })
  // Whoami — the SPA's boot check, and the ETag helper's living demonstrator. Besides
  // the tenant identity it carries the deployment-level config member surfaces need:
  // the D9 profile and the operator identity the connect modal templates its setup
  // steps from (connect-modal). Non-secret deployment vars; unset ones are nulls.
  .get("/session", requireSession, async (c) =>
    jsonWithEtag(c, {
      tenant: c.get("tenant"),
      // The ONE profile accessor (src/deployment.ts) — the shipped D1 config channel;
      // NULL/unset resolves to "self-hosted".
      profile: await loadDeploymentProfile(c.env),
      operator: operatorConfig(c.env),
    }),
  )
  // Logout: delete the KV record (the token stops authenticating even if a copy of the
  // cookie value was retained) and expire the cookie. Idempotent — no session, same reply.
  .delete("/session", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await deleteSession(c.env.TENANT_KV, token);
    clearSessionCookie(c);
    return c.json({ logged_out: true });
  });
