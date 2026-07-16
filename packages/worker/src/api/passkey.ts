// The `passkey` area (webauthn-passkey-auth / passkey-auth): the member-facing WebAuthn
// ceremonies and the cross-device connect approval, on the typed `/api` mount.
//
//   POST /passkey/register/options   (session) → registration options for the session's member
//   POST /passkey/register/verify    (session) → verify + store the credential; the member's first
//                                                 enrollment consumes THEIR bootstrap invite code
//   POST /passkey/login/options              → usernameless authentication options
//   POST /passkey/login/verify               → verify the assertion, resolve the credential's
//                                                 (tenant, member) pair through the shared resolver,
//                                                 mint the SAME session the invite-code path mints
//   GET  /connect/pending            (session) → the pending approval's client + verification code
//   POST /connect/approve            (session) → bind the approving (tenant, member) pair to a
//                                                 pending approval reference
//
// The login + approve endpoints are IP rate-limited (fail-open) and answer failures with ONE
// uniform `unauthorized` (no oracle). The crypto lives in src/webauthn.ts; storage in
// src/webauthn-db.ts; both go through src/db.ts / structured errors, never `env.DB` directly.

import { Hono } from "hono";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";
import {
  createSession,
  setSessionCookie,
  requireSession,
  type ApiEnv,
} from "../session.js";
import { resolveIdentity, directoryFromEnv } from "../tenant.js";
import { deleteInvitesForMember } from "../admin.js";
import { db } from "../db.js";
import { getMember } from "../members-db.js";
import { underRateLimit } from "../rate-limit.js";
import {
  beginRegistration,
  finishRegistration,
  beginAuthentication,
  finishAuthentication,
} from "../webauthn.js";
import {
  insertCredential,
  listCredentialsByTenant,
  countCredentialsByMember,
  touchCredential,
} from "../webauthn-db.js";
import { viewApproval, approveApproval } from "../connect-approval.js";

/** Per-IP fixed window for the unauthenticated / connection surfaces (mirrors login: 10/min). */
const PK_RL_MAX = 10;
const PK_RL_WINDOW_S = 60;

/** True when this IP is still under the window for `bucket`; false → caller returns 429. */
async function underLimit(env: ApiEnv["Bindings"], ip: string, bucket: string): Promise<boolean> {
  return underRateLimit(env.KROGER_KV, `${bucket}:rl:${ip}`, PK_RL_MAX, PK_RL_WINDOW_S, Date.now());
}

export const passkeyArea = new Hono<ApiEnv>()
  // --- Enrollment (session-gated: the enrolling identity IS the session's resolved member) ---
  .post("/passkey/register/options", requireSession, async (c) => {
    const { id: tenant, member } = c.get("tenant");
    const existing = await listCredentialsByTenant(c.env, tenant);
    // The ceremony's user handle is the member id; userName/userDisplayName the member's
    // handle. requireSession just verified liveness, so the row exists; the founding-
    // invariant fallback only papers over a revoke racing this request.
    const row = await getMember(db(c.env), member, tenant);
    const options = await beginRegistration(c.env, c.req.raw, { id: member, handle: row?.handle ?? member }, existing);
    return c.json(options);
  })
  .post("/passkey/register/verify", requireSession, async (c) => {
    const { id: tenant, member } = c.get("tenant");
    let body: { response?: RegistrationResponseJSON; label?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "validation_failed" as const, message: "Missing registration response" }, 400);
    }
    if (!body?.response) {
      return c.json({ error: "validation_failed" as const, message: "Missing registration response" }, 400);
    }
    const verified = await finishRegistration(c.env, c.req.raw, body.response);
    if (!verified) {
      return c.json({ error: "validation_failed" as const, message: "Could not verify passkey" }, 400);
    }
    const before = await countCredentialsByMember(c.env, tenant, member);
    await insertCredential(c.env, {
      tenant,
      member,
      credentialId: verified.credentialId,
      publicKey: verified.publicKey,
      signCount: verified.signCount,
      transports: verified.transports,
      label: typeof body.label === "string" && body.label.trim() ? body.label.trim() : null,
      createdAt: Date.now(),
    });
    // Consume-on-first-enrollment (0 → 1, per member): the bootstrap invite code stops
    // authenticating once THIS member's first passkey exists, killing their standing secret.
    if (before === 0) await deleteInvitesForMember(c.env.TENANT_KV, tenant, member);
    return c.json({ ok: true as const });
  })

  // --- Passkey login (unauthenticated; mints the same session the invite-code path does) ---
  .post("/passkey/login/options", async (c) => {
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    if (!(await underLimit(c.env, ip, "pklogin"))) {
      return c.json({ error: "rate_limited" as const, message: "Too many attempts — try again in a minute" }, 429);
    }
    const options = await beginAuthentication(c.env, c.req.raw);
    return c.json(options);
  })
  .post("/passkey/login/verify", async (c) => {
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    if (!(await underLimit(c.env, ip, "pklogin"))) {
      return c.json({ error: "rate_limited" as const, message: "Too many attempts — try again in a minute" }, 429);
    }
    let body: { response?: AuthenticationResponseJSON };
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const unauthorized = () =>
      c.json({ error: "unauthorized" as const, message: "That passkey didn't work" }, 401);
    if (!body?.response) return unauthorized();
    const assertion = await finishAuthentication(c.env, c.req.raw, body.response);
    if (!assertion) return unauthorized();
    // Resolve the credential's (tenant, member) pair through the shared resolver — a delisted
    // tenant's or revoked member's passkey is dead even if the row lingers (the same live
    // authority the MCP + session paths use), and every failure mode is this one uniform 401.
    const resolved = await resolveIdentity(
      c.env,
      assertion.credential.tenant,
      assertion.credential.member,
      directoryFromEnv(c.env),
      true,
    );
    if ("error" in resolved) return unauthorized();
    await touchCredential(c.env, assertion.credential.credentialId, assertion.newSignCount, Date.now());
    const token = await createSession(c.env.TENANT_KV, resolved.id, resolved.member);
    setSessionCookie(c, token);
    return c.json({ tenant: resolved });
  })

  // --- Cross-device connect approval (session-gated) ---
  .get("/connect/pending", requireSession, async (c) => {
    const ref = c.req.query("authz") ?? "";
    const view = await viewApproval(c.env, ref);
    if (!view) return c.json({ error: "not_found" as const, message: "That connection request expired" }, 404);
    return c.json({ client_name: view.clientName, code: view.code, status: view.status });
  })
  .post("/connect/approve", requireSession, async (c) => {
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    if (!(await underLimit(c.env, ip, "pkconnect"))) {
      return c.json({ error: "rate_limited" as const, message: "Too many attempts — try again in a minute" }, 429);
    }
    let ref = "";
    try {
      const body = await c.req.json<{ authz?: unknown }>();
      if (typeof body?.authz === "string") ref = body.authz;
    } catch {
      // fall through to the not_found below
    }
    const outcome = await approveApproval(c.env, ref, c.get("tenant").id, c.get("tenant").member);
    if (outcome === "not_found") {
      return c.json({ error: "not_found" as const, message: "That connection request expired" }, 404);
    }
    return c.json({ approved: true as const });
  });
