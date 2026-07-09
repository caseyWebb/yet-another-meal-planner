// The member `/api/signup` area (self-service-signup): unauthenticated, the sibling of
// `/api/session` but it CREATES a tenant from a group invite code + a chosen username rather
// than resolving an existing one. On success it mints the same session the login path mints,
// so the new member is signed in to enroll a passkey. Rate-limited per IP; inherits the global
// X-App-Csrf guard. No `run_worker_first` entry needed — it nests under the `/api/*` wildcard.

import { Hono } from "hono";
import { underRateLimit } from "../rate-limit.js";
import { createSession, setSessionCookie, type ApiEnv } from "../session.js";
import { redeemGroupCode } from "../signup.js";

const SIGNUP_RL_MAX = 10;
const SIGNUP_RL_WINDOW_S = 60;

export const signupArea = new Hono<ApiEnv>().post("/signup", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  if (!(await underRateLimit(c.env.KROGER_KV, `signup:rl:${ip}`, SIGNUP_RL_MAX, SIGNUP_RL_WINDOW_S, Date.now()))) {
    return c.json({ error: "rate_limited" as const, message: "Too many attempts — try again in a minute" }, 429);
  }

  let code = "";
  let username = "";
  try {
    const body = await c.req.json<{ code?: unknown; username?: unknown }>();
    if (typeof body?.code === "string") code = body.code;
    if (typeof body?.username === "string") username = body.username;
  } catch {
    // A malformed body falls through to redeemGroupCode, which returns a uniform failure.
  }

  const outcome = await redeemGroupCode(c.env, code, username);
  switch (outcome.kind) {
    case "ok": {
      const token = await createSession(c.env.TENANT_KV, outcome.tenant);
      setSessionCookie(c, token);
      return c.json({ tenant: { id: outcome.tenant } });
    }
    case "username_taken":
      // Deliberate, bounded disclosure (design D9) — unlike login, signup must tell you a
      // name is taken so you can choose another. Tenant ids are not secret within the group.
      return c.json({ error: "username_taken" as const, message: "That username is taken — try another" }, 409);
    case "invalid_username":
      return c.json({ error: "validation_failed" as const, message: outcome.message }, 400);
    case "code_unusable":
      // Unknown / exhausted / expired / revoked all collapse to one uniform failure (no oracle).
      return c.json({ error: "unauthorized" as const, message: "That invite code didn't work" }, 401);
  }
});
