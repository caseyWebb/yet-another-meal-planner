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

  // --- Observability (background-job-health). All OPTIONAL secrets. ---
  /**
   * Gate for the `/health` endpoint. When set, `/health` requires this token (query
   * `?token=` or `Authorization: Bearer`); when UNSET, `/health` is disabled (404).
   */
  HEALTH_TOKEN?: string;
  /** ntfy topic URL for the optional Worker-side failure push (e.g. `https://ntfy.sh/<topic>`). Unset → no push. */
  NTFY_URL?: string;
  /** Optional bearer token for a protected ntfy topic. */
  NTFY_TOKEN?: string;

  // --- KV ---
  /**
   * Shared corpus artifacts AND per-tenant profile/session state.
   *
   * Shared keys: `"index:recipes"` — the JSON-serialised recipe index written by
   * `build-indexes` on every recipe push (avoids a GitHub API call per invocation).
   *
   * Per-tenant keys (written by the Worker, never by CI):
   * - `profile:<username>` — JSON bundle of all stable profile fields
   *   (preferences, taste, diet_principles, kitchen, staples, overlay,
   *   ready_to_eat, stockup), each stored as its raw file content string.
   * - `state:<username>:pantry` — JSON array of pantry items.
   * - `state:<username>:meal_plan` — JSON array of planned meal entries.
   * - `state:<username>:grocery_list` — JSON array of grocery list items.
   */
  DATA_KV: KVNamespace;
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

  // --- Injected by @cloudflare/workers-oauth-provider ---
  /** Provider helpers (`parseAuthRequest`, `lookupClient`, `completeAuthorization`, …). */
  OAUTH_PROVIDER: OAuthHelpers;
}
