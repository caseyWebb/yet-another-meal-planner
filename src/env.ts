// Worker environment. Repo access is via a GitHub App (D3): the App id is a
// non-secret var, the private key is a secret (wrangler secret put). There is ONE
// private data repo (operator-owned, no org); its coordinates are global vars.
// "Which tenant" is a `users/<username>/` path prefix within that repo, derived
// from the OAuth grant's `tenantId` prop on each request (tenant.ts). Kroger
// client_credentials (reads) stay a single app-level secret shared by all.

import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  // --- GitHub App (repo reads/writes via short-lived installation tokens) ---
  /** GitHub App id (numeric, as string). Non-secret var. */
  GITHUB_APP_ID: string;
  /** GitHub App private key, PKCS#8 PEM. Secret. */
  GITHUB_APP_PRIVATE_KEY: string;
  /**
   * Installation id of the App install on the operator's account that covers the
   * data repo. Global (one repo, one install). Non-secret var. OPTIONAL: when
   * unset, the Worker resolves it at runtime from the App's installations
   * (`GET /repos/{owner}/{repo}/installation`) and caches it. Set it to pin/skip
   * the lookup (e.g. an established deployment).
   */
  GITHUB_INSTALLATION_ID?: string;

  // --- The single private data repo (recipes/ + reference data + users/<id>/). Global. ---
  /** Data repo owner (the operator's personal account), e.g. "caseyWebb". */
  DATA_OWNER: string;
  /** Data repo name, e.g. "groceries-agent-data". */
  DATA_REPO: string;
  /** Ref to read the data repo at, e.g. "main". */
  DATA_REF: string;

  // --- Kroger client_credentials (search/flyer/prices). App-level, shared. ---
  /** Kroger Developer (public tier) client_credentials client ID. Secret. */
  KROGER_CLIENT_ID: string;
  /** Kroger Developer (public tier) client_credentials client secret. Secret. */
  KROGER_CLIENT_SECRET: string;
  /**
   * Kroger `authorization_code` app client ID (user-context: cart writes).
   * Secret, OPTIONAL: when unset, the user-auth client falls back to
   * KROGER_CLIENT_ID — one Kroger app carrying BOTH grants. Used by kroger-user.ts.
   */
  KROGER_OAUTH_CLIENT_ID?: string;
  /** Kroger `authorization_code` app client secret. Secret, OPTIONAL (falls back to KROGER_CLIENT_SECRET). */
  KROGER_OAUTH_CLIENT_SECRET?: string;

  // --- Operator admin surface (operator-admin). OPTIONAL, non-secret identifiers. ---
  /**
   * Cloudflare Access team domain (e.g. `myteam.cloudflareaccess.com`) — the JWKS
   * source for verifying the admin surface's `Cf-Access-Jwt-Assertion`. With this
   * and `ACCESS_AUD` set, `/admin*` requires a valid Access session; UNSET disables
   * the admin surface (404). Non-secret (an identifier; the gate is the Access app).
   */
  ACCESS_TEAM_DOMAIN?: string;
  /** Cloudflare Access application audience (AUD) tag the admin JWT must carry. Non-secret. */
  ACCESS_AUD?: string;
  /**
   * OPTIONAL comma-separated allowlist of operator email addresses — defense-in-depth beyond
   * the Access policy. When set, a verified assertion's `email` claim must match one entry
   * (case-insensitive, trimmed) or `/admin*` is denied (403). When unset, any assertion that
   * passes signature/`aud`/issuer verification is admitted (prior behavior), and `/health`
   * reports `email_allowlist: false`. Non-secret; the addresses are never exposed by `/health`.
   */
  ACCESS_ALLOWED_EMAILS?: string;
  /**
   * Local-dev escape: when `1` AND the request host is loopback (`localhost`/`127.0.0.1`/`::1`)
   * AND the Access vars are unset, `/admin*` is served without verification so `wrangler dev`
   * can run the panel. The loopback gate makes it structurally inert in any deployed context —
   * a stray `1` on a deployed Worker cannot open the panel (it stays 404), and `/health`
   * surfaces the dangerous config as `exposed`. Never set in a deployed Worker.
   */
  ADMIN_DEV_BYPASS?: string;

  // --- Observability (background-job-health). All OPTIONAL secrets. ---
  /** ntfy topic URL for the optional Worker-side failure push (e.g. `https://ntfy.sh/<topic>`). Unset → no push. */
  NTFY_URL?: string;
  /** Optional bearer token for a protected ntfy topic. */
  NTFY_TOKEN?: string;

  // --- KV (ephemeral infra only; all domain data is in D1) ---
  /**
   * Per-tenant Kroger refresh tokens (`kroger:refresh:<tenant>`) plus short-lived
   * PKCE verifiers keyed by `state`, plus the warmed flyer cache and background-job
   * health records (`flyer:*`, `health:job:*`). Bound in wrangler.jsonc.
   */
  KROGER_KV: KVNamespace;
  /**
   * Operational mapping only (D9): the tenant directory / allowlist (`tenant:<id>`)
   * and the invite codes (`invite:<code>` -> username). NO domain data lives here.
   */
  TENANT_KV: KVNamespace;
  /**
   * OAuth 2.1 provider storage (clients, codes, grants, tokens — hashed). Required
   * by `@cloudflare/workers-oauth-provider`; the binding MUST be named `OAUTH_KV`.
   */
  OAUTH_KV: KVNamespace;

  // --- D1 (domain data) ---
  /**
   * The system of record for domain/operational data and derived projections
   * (recipe index, profile, session state, cooking log, notes, registries, …), per
   * `cloudflare-storage-architecture`: the queryable, relational, admin-editable,
   * strongly-consistent tier. KV above is now ephemeral infra only — no domain data.
   *
   * Tools NEVER touch `env.DB` directly; all access goes through `src/db.ts`, which
   * owns prepared statements, the batch/transaction helper, and structured-error
   * mapping. Id-less in `wrangler.jsonc`: auto-provisioned per operator on deploy and
   * pinned back into their config. Domain data is migrated slice by slice.
   */
  DB: D1Database;

  // --- Workers AI (semantic recipe search) ---
  /**
   * Workers AI binding for in-Cloudflare embeddings (`@cf/baai/bge-base-en-v1.5`,
   * 768-dim). Used by `src/embedding.ts` to embed the query string on the recipe
   * semantic-search hot path — keeping the match in the Worker, off the caller's
   * token budget. No external key/secret. Build-time RECIPE embedding is a separate
   * path (the Node build can't use this binding); see the semantic-recipe-search design.
   */
  AI: Ai;

  // --- Static assets (operator-admin) ---
  /**
   * Workers Static Assets binding serving the admin SPA committed under `admin/dist/`.
   * `handleAdmin` serves the shell/bundle via `env.ASSETS.fetch()` after the Access
   * gate, so the static surface is gated too. Code-level binding (no operator id);
   * propagated by the deploy merge (`scripts/merge-wrangler-config.mjs` allowlist).
   */
  ASSETS: Fetcher;

  // --- Injected by @cloudflare/workers-oauth-provider ---
  /** Provider helpers (`parseAuthRequest`, `lookupClient`, `completeAuthorization`, …). */
  OAUTH_PROVIDER: OAuthHelpers;
}
