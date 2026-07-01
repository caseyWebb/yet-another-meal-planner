// Kroger user-context client (kroger-user-auth capability). Distinct from the
// read-side `client_credentials` client in kroger.ts: a cart write needs USER
// context, so this implements the `authorization_code` + PKCE grant and the
// single-use/rotating refresh-token rotation the design calls for.
//
// State model (design "KV for the rotating refresh token"), now PER-TENANT (D8):
//   - Each tenant's refresh token lives at its own KV key `kroger:refresh:<tenant>`.
//   - Access tokens are held ONLY in isolate memory, in a PER-TENANT cache — there
//     is no module-level single-token cache that could serve one tenant's token to
//     another (the old singleton was a multi-tenancy correctness bug).
//   - On refresh, the NEW refresh token is written to KV *before* the new access
//     token is used for any Kroger request, so a crash mid-refresh cannot strand
//     the account on a token Kroger has already consumed.
//   - A Kroger-rejected refresh surfaces as a structured `reauth_required` (run
//     the one-time /oauth/init again), never a silent failure or generic 5xx.
//   - The read-side `client_credentials` client (kroger.ts) is unaffected: it is
//     app-level and shared by all tenants.

import type { Env } from "./env.js";
import { ToolError } from "./errors.js";
import { KrogerError } from "./kroger.js";

const AUTHORIZE_URL = "https://api.kroger.com/v1/connect/oauth2/authorize";
const TOKEN_URL = "https://api.kroger.com/v1/connect/oauth2/token";
const CART_ADD_URL = "https://api.kroger.com/v1/cart/add";
// The documented scope for PUT /v1/cart/add. This alone yields a user-context
// token usable for the cart API; profile.compact is NOT requested (it isn't
// granted on the public-tier app and triggers invalid_scope at authorize).
export const CART_SCOPE = "cart.basic:write";
/** Per-tenant KV key for the rotating Kroger refresh token. */
export const refreshKeyFor = (tenantId: string): string => `kroger:refresh:${tenantId}`;
/** The KV key prefix every tenant's refresh-token key shares (for a prefix `list`). */
export const KROGER_REFRESH_PREFIX = "kroger:refresh:";
const EXPIRY_SKEW_MS = 30_000;

/** Thrown when Kroger rejects the stored refresh token; maps to `reauth_required`. */
export class ReauthRequiredError extends Error {
  constructor(message = "Kroger refresh token rejected; re-run the one-time /oauth/init authorization") {
    super(message);
    this.name = "ReauthRequiredError";
  }
}

/** A single cart line: a resolved Kroger SKU (UPC) and a package quantity. */
export interface CartLine {
  upc: string;
  quantity: number;
}

/** Minimal KV surface used here; Cloudflare's KVNamespace satisfies it, and tests inject an in-memory map. */
export interface KvStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  /** List keys by prefix (single page is fine for callers that paginate themselves, like the
   *  admin's Kroger-linked roster check — a friend-group-sized KV namespace fits one page). */
  list(options?: { prefix?: string; cursor?: string }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

export interface KrogerUserClient {
  /** Build the Kroger authorize URL for the one-time consent (PKCE S256 + state). */
  buildAuthorizeUrl(redirectUri: string, state: string, codeChallenge: string): string;
  /** Exchange an authorization code (+ PKCE verifier) for tokens; persists the refresh token. */
  exchangeCode(code: string, codeVerifier: string, redirectUri: string): Promise<void>;
  /** A valid user-context access token, refreshed transparently from KV on expiry. */
  getAccessToken(): Promise<string>;
  /** Add lines to the Kroger cart via PUT /v1/cart/add (write-only; no read/remove). */
  addToCart(lines: CartLine[]): Promise<void>;
}

/** Isolate-lifetime cache of one tenant's user access token (the refresh token lives in KV). */
export interface UserTokenCache {
  token: { accessToken: string; expiresAt: number } | null;
}

// Per-tenant isolate caches, keyed by tenant id. A tenant only ever reads its own
// entry, so one tenant's cached access token can never be served to another.
const moduleCaches = new Map<string, UserTokenCache>();
function tenantCache(tenantId: string): UserTokenCache {
  let c = moduleCaches.get(tenantId);
  if (!c) {
    c = { token: null };
    moduleCaches.set(tenantId, c);
  }
  return c;
}

export interface KrogerUserClientOptions {
  fetch?: typeof fetch;
  cache?: UserTokenCache;
  now?: () => number;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

export function createKrogerUserClient(
  env: Env,
  kv: KvStore,
  tenantId: string,
  opts: KrogerUserClientOptions = {},
): KrogerUserClient {
  const doFetch = opts.fetch ?? fetch;
  const cache = opts.cache ?? tenantCache(tenantId);
  const now = opts.now ?? (() => Date.now());
  const refreshKey = refreshKeyFor(tenantId);

  // One Kroger app may carry both grants: fall back to the client_credentials
  // creds when the authorization_code-specific secrets aren't set separately.
  const clientId = env.KROGER_OAUTH_CLIENT_ID || env.KROGER_CLIENT_ID;
  const clientSecret = env.KROGER_OAUTH_CLIENT_SECRET || env.KROGER_CLIENT_SECRET;

  function basicAuth(): string {
    return btoa(`${clientId}:${clientSecret}`);
  }

  function buildAuthorizeUrl(redirectUri: string, state: string, codeChallenge: string): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: CART_SCOPE,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  /** POST the token endpoint; `reauthOnReject` maps a 4xx to ReauthRequiredError (refresh path). */
  async function postToken(body: URLSearchParams, reauthOnReject: boolean): Promise<TokenResponse> {
    const res = await doFetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth()}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!res.ok) {
      // A 4xx on refresh means the refresh token is invalid/consumed → re-auth.
      // (A 4xx on the initial code exchange is a genuine upstream/config error.)
      if (reauthOnReject && res.status >= 400 && res.status < 500) {
        throw new ReauthRequiredError();
      }
      throw new KrogerError(res.status, `Kroger token request failed (${res.status})`);
    }
    return (await res.json()) as TokenResponse;
  }

  async function exchangeCode(code: string, codeVerifier: string, redirectUri: string): Promise<void> {
    const json = await postToken(
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
      false,
    );
    if (!json.access_token || !json.refresh_token) {
      throw new KrogerError(502, "Kroger code-exchange response missing tokens");
    }
    // Persist the refresh token first; only then cache the access token for use.
    await kv.put(refreshKey, json.refresh_token);
    cache.token = {
      accessToken: json.access_token,
      expiresAt: now() + (json.expires_in ?? 1800) * 1000,
    };
  }

  async function refresh(): Promise<string> {
    const stored = await kv.get(refreshKey);
    if (!stored) {
      throw new ReauthRequiredError("No Kroger refresh token stored; run the one-time /oauth/init");
    }
    const json = await postToken(
      new URLSearchParams({ grant_type: "refresh_token", refresh_token: stored }),
      true,
    );
    if (!json.access_token) {
      throw new KrogerError(502, "Kroger refresh response missing access_token");
    }
    // Single-use rotation: write the NEW refresh token to KV BEFORE the new
    // access token is used for any request. If Kroger rotated it (it does), a
    // crash here cannot strand us on the consumed token.
    if (json.refresh_token) {
      await kv.put(refreshKey, json.refresh_token);
    }
    cache.token = {
      accessToken: json.access_token,
      expiresAt: now() + (json.expires_in ?? 1800) * 1000,
    };
    return json.access_token;
  }

  async function getAccessToken(): Promise<string> {
    if (cache.token && cache.token.expiresAt > now() + EXPIRY_SKEW_MS) {
      return cache.token.accessToken;
    }
    return refresh();
  }

  async function addToCart(lines: CartLine[]): Promise<void> {
    if (lines.length === 0) return;
    const body = JSON.stringify({
      items: lines.map((l) => ({ upc: l.upc, quantity: l.quantity })),
    });
    for (let attempt = 1; attempt <= 2; attempt++) {
      const token = await getAccessToken();
      const res = await doFetch(CART_ADD_URL, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body,
      });
      if (res.ok || res.status === 204) return;
      // A 401 likely means a stale access token; drop it and refresh once.
      if (res.status === 401 && attempt === 1) {
        cache.token = null;
        continue;
      }
      throw new KrogerError(res.status, `Kroger cart write failed (${res.status})`);
    }
  }

  return { buildAuthorizeUrl, exchangeCode, getAccessToken, addToCart };
}

/**
 * Map a user-client throw to the structured-error convention at a tool boundary.
 * ReauthRequiredError → `reauth_required`; everything else → `upstream_unavailable`.
 * (KrogerError already carries an upstream-ish message.)
 */
export function toToolError(e: unknown): ToolError {
  if (e instanceof ReauthRequiredError) {
    return new ToolError("reauth_required", e.message);
  }
  const message = e instanceof Error ? e.message : String(e);
  return new ToolError("upstream_unavailable", message);
}

/** Test helper: clear all per-tenant isolate token caches. */
export function __resetUserTokenCache(): void {
  moduleCaches.clear();
}
