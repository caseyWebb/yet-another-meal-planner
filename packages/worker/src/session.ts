// Member web sessions (member-session-auth). The member-facing analog of the MCP
// surface's OAuth grant: `POST /api/session` resolves an operator-issued invite code
// (the SAME code that provisions the Claude.ai connector — see `resolveInvite`) and
// mints a revocable, KV-backed session whose token rides an `__Host-` cookie. The
// session record lives in TENANT_KV (`session:<token>`, beside `tenant:*`/`invite:*` —
// identity-adjacent operational state, never domain data); KV `expirationTtl` is the
// SINGLE expiry authority (no second clock to drift). `requireSession` is the
// member-facing analog of `requireAccess`: cookie → KV record → the SAME
// `resolveTenant` allowlist re-check the MCP path runs, so a revoked member's live
// session stops resolving on their next request, before any purge runs.

import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env } from "./env.js";
import { resolveTenant, directoryFromEnv, type Tenant } from "./tenant.js";

/** The KV key prefix session records live under in TENANT_KV. */
export const SESSION_PREFIX = "session:";
/** Session lifetime: ~90 days, enforced by KV `expirationTtl` (the single expiry clock). */
export const SESSION_TTL_S = 90 * 24 * 60 * 60;
/**
 * Rolling-refresh throttle: the middleware re-puts the record (fresh TTL) only when the
 * last refresh is older than this — the `touchTenantActivity` pattern, so a chatty
 * session costs at most one KV extension write per day, never one per request.
 */
export const SESSION_REFRESH_THROTTLE_MS = 24 * 60 * 60 * 1000;
/**
 * The session cookie. `__Host-` gives the strongest prefix guarantees (Secure, no
 * Domain, Path=/ — no subdomain planting); browsers treat `localhost`/`127.0.0.1` as
 * trustworthy origins, so it works under `wrangler dev` and the Playwright harness.
 */
export const SESSION_COOKIE = "__Host-session";

/** What `session:<token>` stores (epoch ms). The token itself is only ever the key suffix. */
export interface SessionRecord {
  /** The member's canonical tenant id (re-checked against the allowlist on every request). */
  tenant: string;
  created_at: number;
  refreshed_at: number;
}

/** Base64url (no padding) — the token alphabet is cookie- and KV-key-safe. */
function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Mint a session for `tenant`: a 32-byte (256-bit) token from `crypto.getRandomValues`
 * — unguessable, never logged — written as `session:<token>` with the ~90-day TTL.
 * Returns the token for the cookie.
 */
export async function createSession(kv: KVNamespace, tenant: string, now: number = Date.now()): Promise<string> {
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const record: SessionRecord = { tenant, created_at: now, refreshed_at: now };
  await kv.put(`${SESSION_PREFIX}${token}`, JSON.stringify(record), { expirationTtl: SESSION_TTL_S });
  return token;
}

/** Read a session record, or null when the token is unknown/expired (KV TTL) or malformed. */
export async function readSession(kv: KVNamespace, token: string): Promise<SessionRecord | null> {
  if (!token) return null;
  const raw = await kv.get(`${SESSION_PREFIX}${token}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SessionRecord;
    if (typeof parsed?.tenant !== "string" || !parsed.tenant) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Delete a session record (logout / revocation). Idempotent. */
export async function deleteSession(kv: KVNamespace, token: string): Promise<void> {
  if (!token) return;
  await kv.delete(`${SESSION_PREFIX}${token}`);
}

/**
 * The throttled rolling refresh: re-put the record with a fresh ~90-day TTL (and an
 * updated `refreshed_at`) ONLY when the last refresh is older than the one-day throttle
 * — otherwise a no-op. Best-effort: a refresh failure must never fail the request it
 * rides alongside (the session is still valid on its current TTL).
 */
export async function refreshSession(
  kv: KVNamespace,
  token: string,
  record: SessionRecord,
  now: number = Date.now(),
): Promise<void> {
  if (now - record.refreshed_at <= SESSION_REFRESH_THROTTLE_MS) return;
  try {
    const refreshed: SessionRecord = { ...record, refreshed_at: now };
    await kv.put(`${SESSION_PREFIX}${token}`, JSON.stringify(refreshed), { expirationTtl: SESSION_TTL_S });
  } catch (e) {
    console.warn("[session] rolling refresh failed:", e instanceof Error ? e.message : e);
  }
}

/** Set the session cookie (login). `__Host-` requires Secure + Path=/ + no Domain — hono enforces. */
export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
    maxAge: SESSION_TTL_S,
  });
}

/** Expire the session cookie (logout). */
export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
}

/** The Hono context shape every `/api` route sees: bindings + the resolved tenant. */
export type ApiEnv = { Bindings: Env; Variables: { tenant: Tenant } };

/**
 * Session middleware for the member `/api` surface — mounted on every route except
 * login and `/api/version`. Cookie → KV record → `resolveTenant` (allowlist re-check,
 * `recordSeen: true` — a session-authenticated API request is genuine member activity,
 * same as an MCP call; the touch is throttled + best-effort). Missing/unknown/expired/
 * unresolvable sessions get the structured `unauthorized` 401 (uniform — the SPA
 * branches on the code and shows login). A resolving request rides the throttled
 * rolling refresh, then the handler sees the SAME normalized `Tenant` the MCP path builds.
 */
export const requireSession: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const unauthorized = (message: string) => c.json({ error: "unauthorized" as const, message }, 401);
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return unauthorized("No session");
  const record = await readSession(c.env.TENANT_KV, token);
  if (!record) return unauthorized("No session");
  const resolved = await resolveTenant(c.env, record.tenant, directoryFromEnv(c.env), true);
  if ("error" in resolved) return unauthorized("No session");
  await refreshSession(c.env.TENANT_KV, token, record);
  c.set("tenant", resolved);
  await next();
};
