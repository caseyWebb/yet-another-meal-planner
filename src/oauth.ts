// The /oauth/* route group (kroger-user-auth + mcp-server capabilities). Two
// routes drive the one-time Kroger consent:
//   - GET /oauth/init     → redirect to Kroger's authorize endpoint (PKCE + state)
//   - GET /oauth/callback → verify `state`, exchange the code, store the refresh token
//
// Kroger's redirect carries no credential, so these paths are reached without
// the connector's OAuth bearer. They are secured instead by OAuth `state` (CSRF)
// + PKCE: the per-flow verifier is held in KV keyed by `state` with a short TTL,
// so a forged/replayed callback whose state has no stored verifier is rejected
// with no token exchange.

import type { Env } from "./env.js";
import { normalizeTenantId } from "./tenant.js";
import {
  createKrogerUserClient,
  type KrogerUserClient,
  type KvStore,
} from "./kroger-user.js";

const PKCE_TTL_SECONDS = 600;
const pkceKey = (state: string): string => `kroger:pkce:${state}`;

// The Kroger consent link is minted from an AUTHENTICATED context (the
// `kroger_login_url` MCP tool, which knows the caller's grant tenant, or the
// Access-gated admin surface) and carries a single-use nonce that `/oauth/init`
// redeems to the initiating tenant. The tenant is therefore never taken from
// unauthenticated request input — closing the cross-tenant token-binding hole.
const AUTH_NONCE_TTL_SECONDS = 600;
const authNonceKey = (nonce: string): string => `kroger:authnonce:${nonce}`;

/** The record stored under a consent nonce: the authenticated tenant it is bound to. */
interface NonceRecord {
  tenant: string;
}

/** The per-flow record stored under the state key: the PKCE verifier + the tenant
 * that initiated the flow, so the callback stores the refresh token under that
 * tenant's key (kroger-user-auth: "state SHALL be bound to the initiating tenant"). */
interface FlowRecord {
  verifier: string;
  tenant: string;
}

/** Base64url (no padding) of raw bytes. */
function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A high-entropy PKCE code verifier (RFC 7636: 43–128 chars). */
export function generateVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** A high-entropy opaque `state` value for CSRF protection. */
export function generateState(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

/** S256 challenge: base64url(SHA-256(verifier)). */
export async function challengeFromVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** Injectable PKCE primitives so route handling is deterministic under test. */
export interface Pkce {
  generateVerifier(): string;
  generateState(): string;
  challengeFromVerifier(verifier: string): Promise<string>;
}

const defaultPkce: Pkce = { generateVerifier, generateState, challengeFromVerifier };

/**
 * Mint a single-use Kroger-consent nonce bound to an authenticated tenant and
 * return it. The caller MUST have established the tenant from a trusted context
 * (an MCP grant or the Access-gated admin surface) — this function does not, and
 * cannot, verify that. The nonce is never logged; it is returned only to the
 * authenticated caller and redeemed once at `/oauth/init`.
 */
export async function mintAuthNonce(kv: KvStore, tenant: string): Promise<string> {
  const bound = normalizeTenantId(tenant);
  // Precondition: callers pass an already-resolved tenant (the grant tenant in the
  // tool path, an allowlist-resolved id in the admin path). The throw is a guard for
  // a misuse that current callers can't hit; both call sites run inside a boundary
  // (`runTool` / the admin try-catch) that serializes it into a structured error.
  if (!bound) throw new Error("mintAuthNonce requires a tenant");
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const record: NonceRecord = { tenant: bound };
  await kv.put(authNonceKey(nonce), JSON.stringify(record), {
    expirationTtl: AUTH_NONCE_TTL_SECONDS,
  });
  return nonce;
}

/**
 * Redeem a consent nonce to its bound tenant, consuming it (single-use): the key
 * is deleted before the tenant is returned, so a second redemption — or one past
 * the TTL — yields null. An unknown or corrupt nonce also yields null.
 */
export async function redeemAuthNonce(kv: KvStore, nonce: string): Promise<string | null> {
  if (!nonce) return null;
  const raw = await kv.get(authNonceKey(nonce));
  if (!raw) return null;
  await kv.delete(authNonceKey(nonce)); // single-use: consume before returning
  try {
    const record = JSON.parse(raw) as NonceRecord;
    return record?.tenant ?? null;
  } catch {
    return null;
  }
}

/**
 * Build the Kroger consent link a member opens to authorize their account. Mints a
 * single-use nonce bound to `tenant` and embeds it in `<origin>/oauth/init?nonce=…`.
 * The one helper both the `kroger_login_url` MCP tool and the admin mint endpoint
 * call, so the two authenticated front doors stay identical.
 */
export async function buildKrogerConsentUrl(
  kv: KvStore,
  origin: string,
  tenant: string,
): Promise<string> {
  const nonce = await mintAuthNonce(kv, tenant);
  return `${origin}/oauth/init?nonce=${nonce}`;
}

export interface OAuthDeps {
  kv: KvStore;
  /** Build a Kroger user client bound to a specific tenant's refresh-token key. */
  clientFor: (tenantId: string) => KrogerUserClient;
  pkce?: Pkce;
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

/**
 * Handle an `/oauth/*` request. Pure with respect to its injected deps (kv,
 * Kroger client, PKCE) so the init→callback handshake and the forged-state
 * rejection are unit-testable without network or KV bindings.
 */
export async function handleOAuthRequest(deps: OAuthDeps, url: URL): Promise<Response> {
  const pkce = deps.pkce ?? defaultPkce;
  const redirectUri = `${url.origin}/oauth/callback`;

  if (url.pathname === "/oauth/init") {
    // The initiating tenant comes from a single-use nonce minted in an
    // authenticated context (the `kroger_login_url` tool or the admin surface),
    // never from request input — so a caller cannot start a Kroger flow for a
    // tenant it has not authenticated as. Redeeming consumes the nonce; the tenant
    // it carries is already the canonical (lowercase) id, so the refresh token
    // lands under the same `kroger:refresh:<id>` key the cart-write path reads.
    const tenant = await redeemAuthNonce(deps.kv, url.searchParams.get("nonce") ?? "");
    if (!tenant) {
      return text("Invalid or expired authorization link; start Kroger setup again", 400);
    }

    const verifier = pkce.generateVerifier();
    const state = pkce.generateState();
    const challenge = await pkce.challengeFromVerifier(verifier);
    const record: FlowRecord = { verifier, tenant };
    await deps.kv.put(pkceKey(state), JSON.stringify(record), { expirationTtl: PKCE_TTL_SECONDS });
    const authorizeUrl = deps.clientFor(tenant).buildAuthorizeUrl(redirectUri, state, challenge);
    return new Response(null, { status: 302, headers: { location: authorizeUrl } });
  }

  if (url.pathname === "/oauth/callback") {
    const err = url.searchParams.get("error");
    if (err) return text(`Kroger authorization failed: ${err}`, 400);

    const state = url.searchParams.get("state");
    if (!state) return text("Missing state", 400);

    // The stored flow record is the proof this callback corresponds to a flow WE
    // started. No record for this state → forged/replayed/expired → reject. The
    // record also carries the initiating tenant, so the refresh token lands under
    // that tenant's key.
    const raw = await deps.kv.get(pkceKey(state));
    if (!raw) return text("Invalid or expired state; restart authorization", 400);
    await deps.kv.delete(pkceKey(state));

    let record: FlowRecord;
    try {
      record = JSON.parse(raw) as FlowRecord;
    } catch {
      return text("Corrupt authorization state; restart authorization", 400);
    }
    if (!record?.verifier || !record.tenant) {
      return text("Corrupt authorization state; restart authorization", 400);
    }

    const code = url.searchParams.get("code");
    if (!code) return text("Missing code", 400);

    try {
      await deps.clientFor(record.tenant).exchangeCode(code, record.verifier, redirectUri);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return text(`Token exchange failed: ${message}`, 502);
    }
    return text("Kroger authorization complete. You can close this tab.", 200);
  }

  return text("Not found", 404);
}

/** Thin wrapper: build real deps from env + the KV binding, then handle. */
export function handleOAuth(env: Env, url: URL): Promise<Response> {
  const kv = env.KROGER_KV as unknown as KvStore;
  const clientFor = (tenantId: string): KrogerUserClient => createKrogerUserClient(env, kv, tenantId);
  return handleOAuthRequest({ kv, clientFor }, url);
}
