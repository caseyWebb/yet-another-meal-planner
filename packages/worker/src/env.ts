// Worker environment. The authored corpus lives in an R2 bucket bound as `CORPUS`
// (read/written through src/corpus-store.ts) — there is NO GitHub App, installation
// token, or data repo on the data path. All per-tenant/operational data is in D1;
// "which tenant" is the OAuth grant's `tenantId` prop on each request (tenant.ts).
// Kroger client_credentials (reads) stay a single app-level secret shared by all.

import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  // --- Instacart Marketplace handoff. OPTIONAL operator configuration. ---
  /** Instacart Developer Platform API key. Secret; set with `wrangler secret`. */
  INSTACART_API_KEY?: string;
  /** Fixed API environment selector. Both this and the key are required. */
  INSTACART_API_ENV?: "development" | "production" | string;

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
   * Local-dev escape: when set to exactly `1` AND the request host is loopback
   * (`localhost`/`127.0.0.1`/`::1`) AND the Access vars are unset, `/admin*` is served without
   * verification so `wrangler dev` can run the panel. The loopback gate makes it structurally
   * inert in any deployed context — a stray `1` on a deployed Worker cannot open the panel (it
   * stays 404), and `/health` surfaces the dangerous config as `exposed`. Never set in a
   * deployed Worker. (Only the literal `1` enables it; e.g. `"true"` is a no-op.)
   */
  ADMIN_DEV_BYPASS?: string;
  /**
   * OPTIONAL: the tenant id (allowlisted username) the Members roster badges as "owner". A
   * plain, non-secret var — the operator's identity is already known out-of-band, so this is
   * an explicit declaration rather than an inference from onboarding order (no tenant is
   * structurally "first"). Unset means NO member is shown as owner (no badge), never a guess.
   */
  OWNER_TENANT_ID?: string;
  /**
   * OPTIONAL invite-code grace control (webauthn-passkey-auth). While unset or any value other
   * than `"off"`, LEGACY standing invite codes still authenticate at `/login` and `/authorize`
   * so members onboarded before passkeys migrate organically. Set to exactly `"off"` (in the
   * operator's own `wrangler.jsonc` `vars`) once every member has enrolled a passkey: legacy
   * standing codes then stop authenticating everywhere, leaving passkeys and single-use bootstrap
   * codes (onboarding/rotation) as the only way in. Default-on so deploying this locks no one out.
   * Non-secret, operator-owned (the deploy merge passes the operator's `vars`).
   */
  INVITE_GRACE?: string;

  // --- Member app version-skew stamp (member-app-shell). OPTIONAL, non-secret. ---
  /**
   * The deployed code SHA, injected by the operator deploy (`wrangler deploy --var
   * APP_BUILD:<sha>`) — the Worker side of the member app's version-skew contract. Echoed
   * on every `/api` response as `X-App-Build` and returned by `GET /api/version`; the SPA
   * compares it against its own embedded `VITE_APP_BUILD` (the deploy stamps the same SHA
   * into both). UNSET (local dev, tests, the Playwright harnesses) both sides read `"dev"`,
   * so skew detection is inert locally by construction.
   */
  APP_BUILD?: string;

  // --- Operator identity for member setup copy (connect-modal). OPTIONAL, non-secret. ---
  /**
   * The operator's display name the member app's Connect-to-Claude modal templates into its
   * copy ("updates {name} ships"). Falls back to `OWNER_TENANT_ID`; unset both and the copy
   * says "your operator". Operator-owned `vars` entry (the deploy merge passes it through).
   */
  OPERATOR_NAME?: string;
  /**
   * The operator's plugin-marketplace repo slug (`<owner>/<data-repo>`) the connect modal
   * renders as its copyable marketplace-add step. Stamped automatically by the operator
   * deploy (`data-deploy.yml` passes `--var MARKETPLACE_REPO:<caller repo>` — the data repo
   * IS the marketplace), so operators set nothing. UNSET (local dev without `.dev.vars`)
   * the modal degrades to ask-your-operator copy; it never fabricates a slug.
   */
  MARKETPLACE_REPO?: string;

  // --- AGPL §13 source offer (open-source-license). OPTIONAL, non-secret. ---
  /**
   * The source location `/source` offers, satisfying AGPL section 13 for users interacting over the
   * network. UNSET, `/source` names the upstream repository — which is correct for the standard
   * self-hosting flow: a data repo created from the template runs this code UNMODIFIED (it calls the
   * upstream reusable workflow `@main`), so the upstream repo already IS the corresponding source and
   * the operator sets nothing. Only a GENUINE FORK that modifies the Worker sets this, to point
   * `/source` at its own modified source. Non-secret and operator-owned (the deploy merge passes the
   * operator's `vars`, strips the maintainer's).
   */
  SOURCE_URL?: string;

  // --- Observability (background-job-health). All OPTIONAL secrets. ---
  /** ntfy topic URL for the optional Worker-side failure push (e.g. `https://ntfy.sh/<topic>`). Unset → no push. */
  NTFY_URL?: string;
  /** Optional bearer token for a protected ntfy topic. */
  NTFY_TOKEN?: string;

  // --- Usage observability (usage-observability). OPTIONAL operator config. ---
  /**
   * Cloudflare account tag for the GraphQL Analytics API the operator Usage view queries
   * (`/admin/usage`). Non-secret identifier. UNSET (with or without `CF_ANALYTICS_TOKEN`)
   * makes the Usage view report "not configured" rather than failing.
   */
  CF_ACCOUNT_ID?: string;
  /**
   * A **read-only** Cloudflare API token (Account Analytics: Read) the Usage view uses to read
   * account-wide KV-operation and Workers-AI-neuron usage from the GraphQL Analytics API. Secret,
   * OPTIONAL — set via `wrangler secret`, never committed (the repo is public). When unset, the
   * Usage view reports "not configured". Reads only; it can mutate nothing. The Usage **trends**
   * panel reuses this same token for the Analytics Engine SQL API (it reads the `yamp_usage`
   * dataset); confirm the token's scope also grants AE SQL read on a connected account.
   */
  CF_ANALYTICS_TOKEN?: string;
  /**
   * OPTIONAL non-secret mapping from a Cloudflare KV `namespace_id` (the opaque hex id the
   * GraphQL Analytics API reports) to the `wrangler.jsonc` binding name it corresponds to —
   * `KROGER_KV`/`TENANT_KV`/`OAUTH_KV` — so the Usage view's per-namespace KV meters can show a
   * friendly label instead of a raw id. A Worker cannot resolve this itself at runtime (the
   * `KVNamespace` binding exposes no id accessor), so it is operator-pasted once, the same moment
   * the operator already records each namespace's id when pinning it into `wrangler.jsonc` (see
   * docs/SELF_HOSTING.md "Persisting your namespace + database ids"): comma-separated
   * `id:BINDING` pairs, e.g. `a1b2…:KROGER_KV,c3d4…:OAUTH_KV`. Unset, or an id with no entry,
   * renders that namespace "unlabeled" (its raw id, a generic color) rather than being dropped —
   * aggregate totals stay accurate either way.
   */
  KV_NAMESPACE_LABELS?: string;

  // --- Usage trends (usage-trends). Code-level binding, no operator config. ---
  /**
   * Workers Analytics Engine dataset (`yamp_usage`) the background jobs emit one
   * tenant-clean data point to per run (the **history** tier, complementing the `job_health`
   * D1 **liveness** tier) — job name, outcome, duration, and summary counts, never a per-tenant
   * id. Read back by the Usage trends panel via the AE SQL API (`src/usage.ts`). OPTIONAL: an
   * unbound deployment makes `recordUsagePoint` a silent no-op (`USAGE_AE?.`). AE `writeDataPoint`
   * is non-blocking and draws on neither the KV nor the D1 budget. Code-level binding (no
   * operator-owned id), propagated by the deploy merge (`scripts/merge-wrangler-config.mjs`
   * allowlist), like `ai`/`assets`. The blob/double slot layout is a documented positional
   * contract (`docs/SCHEMAS.md`); a later change must not reorder existing slots.
   */
  USAGE_AE?: AnalyticsEngineDataset;

  // --- Tool usage trends (tool-usage-trends). Code-level binding, no operator config. ---
  /**
   * Workers Analytics Engine dataset (`yamp_tool`) every MCP tool call emits one
   * tenant-clean data point to — the request-path **history** tier (per-tool frequency +
   * performance), sibling to the per-job `USAGE_AE`. Carries the tool name, the call outcome
   * (`ok`/`error`), and the call duration, never a tenant id or call arguments. Emitted once
   * from the `buildServer` registration decorator (`src/tools.ts`) via `recordToolPoint`
   * (`src/health.ts`), read back by the Usage tool panel via the AE SQL API (`src/usage.ts`).
   * OPTIONAL: an unbound deployment makes `recordToolPoint` a silent no-op (`TOOL_AE?.`). AE
   * `writeDataPoint` is non-blocking and draws on neither the KV nor the D1 budget. Code-level
   * binding (no operator-owned id, like `USAGE_AE`), propagated by the deploy merge
   * (`scripts/merge-wrangler-config.mjs` copies the whole `analytics_engine_datasets` array).
   * The blob/double slot layout is a documented positional contract (`docs/SCHEMAS.md`); a
   * later change must not reorder existing slots.
   */
  TOOL_AE?: AnalyticsEngineDataset;

  // --- AI usage attribution (ai-usage-attribution). Code-level binding, no operator config. ---
  /**
   * The Workers Analytics Engine dataset (`yamp_ai`) every `env.AI.run` inference emits one
   * tenant-clean data point to via the `src/ai.ts` gateway (`recordAiPoint`) — the per-ACTIVITY
   * neuron-attribution tier (activity, model, trigger, outcome, duration, tokens, estimated
   * neurons), a THIRD sibling to the per-job `USAGE_AE` and per-tool `TOOL_AE`. It attributes which
   * of the ~13 AI activities spends the neurons the account-level analytics reports only by model,
   * and captures cron, import, and request spend (below the embedding cache). Read back by the Usage
   * page's AI panel via the AE SQL API (`src/usage.ts`). OPTIONAL: an unbound deployment makes
   * `recordAiPoint` a silent no-op (`AI_AE?.`). AE `writeDataPoint` is non-blocking and draws on
   * neither the KV nor the D1 budget. Code-level binding (no operator-owned id, like `USAGE_AE`/
   * `TOOL_AE`), propagated by the deploy merge (`scripts/merge-wrangler-config.mjs` copies the whole
   * `analytics_engine_datasets` array). The blob/double slot layout is a documented positional
   * contract (`docs/SCHEMAS.md`); a later change must not reorder existing slots.
   */
  AI_AE?: AnalyticsEngineDataset;

  // --- KV (ephemeral infra only; all domain data is in D1) ---
  /**
   * Per-tenant Kroger refresh tokens (`kroger:refresh:<tenant>`) plus short-lived
   * PKCE verifiers keyed by `state`, plus the warmed flyer cache (`flyer:*`). Bound in
   * wrangler.jsonc. (Background-job health is in D1's `job_health` table, not here.)
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

  // --- Static assets (member-app-shell + operator-admin) ---
  /**
   * Workers Static Assets binding over the ONE merged assets root (`assets/`, a
   * gitignored artifact built fresh at CI/deploy time): the member SPA at `/`
   * (`index.html` + hashed chunks, built by `packages/app`; SPA fallback via
   * `not_found_handling`) AND the admin panel's SPA bundle under `assets/admin/`
   * (built by the admin app's Vite build, `packages/admin-app` → `assets/admin/`, served
   * at the unchanged `/admin/*` URLs). The Hono admin app (`src/admin/app.ts`) gates every
   * `/admin*` request behind Cloudflare Access, serves the typed `/admin/api/*` routes
   * itself, and falls back to `env.ASSETS.fetch()` for `/admin/assets/*` plus the SPA
   * shell on any other GET — past the Access gate, so that static surface is gated too.
   * `run_worker_first` enumerates every Worker-owned path so the member SPA's own fallback
   * can never shadow one. Code-level binding (no operator id); propagated by the deploy
   * merge (`scripts/merge-wrangler-config.mjs` allowlist).
   */
  ASSETS: Fetcher;

  // --- R2 (authored corpus) ---
  /**
   * The authored-corpus R2 bucket: the `recipes/` and `guidance/` markdown trees, the
   * source of truth for human-authored content (r2-corpus-store). The Worker
   * reads/lists/writes the corpus through `src/corpus-store.ts` (createR2CorpusStore) —
   * there is no GitHub App or installation token on the data path. Hand-edited via
   * Obsidian (S3-compatible sync to the same bucket). Code-level binding propagated by
   * the deploy merge; the bucket itself is provisioned per operator in their own
   * Cloudflare account.
   */
  CORPUS: R2Bucket;

  // --- Injected by @cloudflare/workers-oauth-provider ---
  /** Provider helpers (`parseAuthRequest`, `lookupClient`, `completeAuthorization`, …). */
  OAUTH_PROVIDER: OAuthHelpers;
}
