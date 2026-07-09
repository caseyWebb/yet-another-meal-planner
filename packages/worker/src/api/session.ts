// The `session` area (member-session-auth): invite-code login, whoami, logout. The
// login body's invite code goes through the SAME `resolveInvite` mapping that
// provisions the Claude.ai connector — one operator-issued code per friend covers both
// surfaces, and re-entry after expiry reuses it. An unknown code and a revoked
// member's code are INDISTINGUISHABLE (one uniform `unauthorized` 401 — no oracle).
// Login is rate-limited per client IP by the shared fixed-window limiter (fail-open:
// a KV hiccup must never lock members out).

import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { resolveInvite, inviteAccepted } from "../tenant.js";
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
    const token = await createSession(c.env.TENANT_KV, inv.tenant);
    setSessionCookie(c, token);
    return c.json({ tenant: { id: inv.tenant } });
  })
  // Whoami — the SPA's boot check, and the ETag helper's living demonstrator.
  .get("/session", requireSession, async (c) => jsonWithEtag(c, { tenant: c.get("tenant") }))
  // Logout: delete the KV record (the token stops authenticating even if a copy of the
  // cookie value was retained) and expire the cookie. Idempotent — no session, same reply.
  .delete("/session", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await deleteSession(c.env.TENANT_KV, token);
    clearSessionCookie(c);
    return c.json({ logged_out: true });
  });
