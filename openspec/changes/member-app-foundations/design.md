## Context

P0 of `docs/plans/web-app.md` (the ratified member-web-app plan; §11 defaults confirmed 2026-07-07). The Worker today: an OAuth 2.1 provider gating `/mcp`, the Access-gated Hono admin app at `/admin` (SSR + islands + typed `/admin/api/*` via `hc`), `/cookbook` public SSR, `/health*`, `/source`, and a plain-text banner at `/`. Assets: `wrangler.jsonc` binds `ASSETS` at `directory: "./admin/dist"` with `run_worker_first: ["/admin", "/admin/*"]` and no `not_found_handling` (unmatched asset requests fall through to the Worker). Identity building blocks that already exist and are reused, not duplicated: `resolveInvite` (`invite:<code>` → allowlisted username in `TENANT_KV`), `resolveTenant` (allowlist re-check + normalized `Tenant`, optional throttled `tenant_activity` touch), the ingest endpoint's fixed-window KV limiter (`src/ingest.ts` `underRateLimit`, `ingest:rl:<key>:<bucket>` in `KROGER_KV`, fail-open), and the admin `revoke()` purge (D1 batch → allowlist → invites → Kroger token).

All questions an implementer would otherwise resolve unilaterally are settled below (no spike tasks remain).

## Goals / Non-Goals

**Goals:**
- Invite code logs into a hello-world SPA at `/` in `wrangler dev` and in Playwright (P0 acceptance).
- Session auth complete: login/logout/middleware/CSRF/rate-limit/revocation.
- `/api` mount + the shared middleware skeleton (errors, ETag, `X-App-Build`, usage points) every later area inherits unchanged.
- `packages/app` + `packages/ui` scaffold on the plan's toolchain; wrangler assets config; deploy path filters; blocking Playwright gate from the first PR; `aubr` scripts.

**Non-Goals:**
- Any member page beyond login + the gated hello-world shell (P1+).
- Offline persistence, paused-mutation replay, the SW update-prompt UX (P5 — `vite-plugin-pwa` is scaffolded now so the shell is installable, but the offline layers land later).
- Per-area API routes beyond `session`/`version` (P1+), passkeys, CORS, admin SPA (P6).

## Decisions

### 1. Assets: one merged root at `packages/worker/assets/`; the `assets` key survives the deploy merge verbatim (verified — no allowlist change)

A Worker has one static-assets directory, and it must now carry both the member SPA (at `/`) and the existing admin islands/styles (at `/admin/*`). Decision: a new gitignored root `packages/worker/assets/`:

- `scripts/build-admin.mjs` retargets its output from `admin/dist/admin/*` to `assets/admin/*` — **served URLs are unchanged by construction** (`/admin/islands/*.js`, `/admin/styles.css`), so no admin page/island reference changes; the `admin-ui` suite gates it.
- `packages/app`'s Vite build writes `index.html` + hashed chunks to `assets/` (outDir `../worker/assets`, `emptyOutDir: false`; Vite's default `assets/` subdir gives immutable-hashed URLs under `/assets/*`, which collides with nothing). Each builder cleans only its own subtree (`assets/admin/` vs. the app's `index.html` + `assets/` subdir) so build order doesn't matter.
- `wrangler.jsonc`: `assets.directory: "./assets"`, `not_found_handling: "single-page-application"`, `run_worker_first` per Decision 2.

**Merge verification (plan §2 asked for this explicitly):** `scripts/merge-wrangler-config.mjs` propagates `assets` as a whole-object copy — `if (code.assets !== undefined) out.assets = code.assets;` — so `directory`, `binding`, `run_worker_first`, **and the new `not_found_handling` sub-key pass through untouched**; no per-sub-key allowlist exists to extend. `tests/merge-wrangler-config.test.mjs` gains a regression case pinning that `not_found_handling` and the expanded `run_worker_first` array survive the merged output, so a future merge refactor can't silently drop them.

### 2. `run_worker_first` enumerates every Worker-owned path; the enumeration is a standing discipline

With `not_found_handling: "single-page-application"`, any path not routed to the Worker first returns the SPA shell — so the enumeration is now the routing contract. From the router (`src/index.ts`) plus the OAuth provider's own endpoints (`apiRoute: "/mcp"`, `authorizeEndpoint: "/authorize"`, `tokenEndpoint: "/token"`, `clientRegistrationEndpoint: "/register"`, `.well-known` discovery) the full list is:

```jsonc
"run_worker_first": [
  "/mcp", "/mcp/*",
  "/token", "/register", "/.well-known/*",
  "/authorize",
  "/oauth/*",
  "/satellite/*",
  "/api", "/api/*",
  "/admin", "/admin/*",
  "/cookbook", "/cookbook/*",
  "/health", "/health.svg",
  "/source"
]
```

(17 rules — far under wrangler's 100-rule cap. `/satellite/*` covers the satellite pull channel's claim/results/order endpoints as one wildcard, so new satellite endpoints under the prefix don't need individual entries.) The `GET /` liveness banner branch in `defaultHandler` is removed (unreachable — assets now own `/`); `/health` remains the machine liveness check. **Discipline rule (spec'd + documented in CONTRIBUTING.md):** adding a Worker-owned route means adding its `run_worker_first` entry in the same change, or the SPA fallback silently swallows it — the same class of trap as the merge allowlist, guarded the same way (stated rule + Playwright passthrough assertions on `/health` and `/cookbook`).

### 3. Session store: `TENANT_KV` `session:<token>`, 90d rolling TTL, throttled refresh

- **Key/value:** `session:<token>` in `TENANT_KV` (identity-adjacent state, beside `tenant:*` and `invite:*`), value `{ tenant, created_at, refreshed_at }` (epoch ms), written with `expirationTtl: 90d` — KV expiry is the single source of session expiry (no second clock to drift).
- **Token:** 32 bytes from `crypto.getRandomValues`, base64url — 256 bits, unguessable; the token is the KV key suffix and is never logged.
- **Rolling lifetime:** the middleware re-puts the record (fresh 90d TTL, updated `refreshed_at`) only when `now − refreshed_at > 24h` — the `touchTenantActivity` throttle pattern, so a chatty session costs ≤1 KV write/day, not one per request. Expired session → 401 → the SPA shows login; re-entry is the invite code (§11.2 — no passwords, no email).
- **Docs:** the key shape + value schema land in `docs/SCHEMAS.md` (new "Web sessions (KV)" section, beside the warmed-flyer-cache KV section).

### 4. Cookie: `__Host-session`, HttpOnly, Secure, SameSite=Lax, Path=/

`__Host-` gives the strongest prefix guarantees (Secure, no Domain, Path=/ — no subdomain planting). Browsers treat `http://127.0.0.1`/`localhost` as trustworthy origins, so Secure-prefixed cookies work under `wrangler dev` and the Playwright harness — and the P0 acceptance (login in Playwright against `wrangler dev`) empirically gates exactly this. `Max-Age` 90d, refreshed alongside the KV re-put. Logout (`DELETE /api/session`) deletes the KV record and expires the cookie. Cookie read/write via hono's cookie helpers.

### 5. Session middleware: the member-facing analog of `requireAccess`, yielding the same `Tenant` the MCP path builds

`requireSession` (in `src/session.ts`, mounted on every `/api` route except login/version): parse cookie → KV get → `resolveTenant(env, record.tenant, directoryFromEnv(env), /* recordSeen */ true)` → set `tenant` on the Hono context (`Variables: { tenant: Tenant }`). The allowlist re-check on every request means a revoked member's live session stops resolving immediately, before any purge runs — the exact posture of the MCP path ("the token may still exist in the OAuth store"). `recordSeen: true` because a session-authenticated API request is genuine member activity, same as an MCP call; the touch is already throttled + best-effort. Missing/unknown/expired session → structured `{ error: "unauthorized", message }` 401 (the SPA branches on the code).

### 6. Login: `POST /api/session`, uniform 401, rate-limited by the extracted ingest limiter

- Body `{ invite_code }` → `resolveInvite(env.TENANT_KV, code)` → username or null. Null (unknown code, or code whose member left the allowlist) → uniform `{ error: "unauthorized" }` 401 — no oracle distinguishing "no such code" from "revoked member". Success → mint session (Decision 3), set cookie (Decision 4), return the whoami shape `{ tenant }`. The invite code stays valid — one code per friend provisions both the Claude connector and web login, and re-entry after expiry reuses it (plan §3, §11.2); rotation/revocation remain the invalidation paths.
- **Rate limit:** extract the fixed-window limiter from `src/ingest.ts` into `src/rate-limit.ts` as `underRateLimit(kv, key, max, windowS, now)` — ingest calls it with its existing `ingest:rl:<keyId>:<bucket>` keys in `KROGER_KV` (behavior-identical, its tests unchanged); login calls it with `login:rl:<ip>:<bucket>` (IP from `CF-Connecting-IP`, `"unknown"` fallback), **10/min**, same fail-open posture (a KV hiccup must not lock members out). Over-limit → `{ error: "rate_limited" }` 429. Counter keys live in `KROGER_KV` beside ingest's (ephemeral infra, self-expiring).
- `GET /api/session` = whoami (session-gated, returns `{ tenant }`) — the SPA's boot check.

### 7. CSRF: required custom header on all state-changing `/api` requests + `Sec-Fetch-Site` verification; no CORS

Middleware on every non-GET/HEAD `/api` request (including login itself — the SPA always sends it): require an `X-App-Csrf` header (any value; a custom header forces a CORS preflight cross-origin, which same-origin policy then blocks — bare form-shaped POSTs can't carry it), and when `Sec-Fetch-Site` is present require `same-origin`/`none` (reject `cross-site`/`same-site`). Rejection → `{ error: "csrf_rejected" }` 403. `SameSite=Lax` is the belt; this is the suspenders. **No `Access-Control-Allow-*` header is ever emitted on `/api`** — same-origin by construction (plan §3), spec'd as a negative guarantee.

### 8. `/api` mount and the `hc` pattern (mirrors `/admin/api/*`)

- `src/api/app.ts`: `new Hono<{ Bindings: Env; Variables: { tenant: Tenant } }>().basePath("/api")`, dispatched from `defaultHandler` before the `/admin` dispatch (`/api` + `/api/*`). Per-area sub-apps under `src/api/` (P0: `session.ts`; later areas are new files) chained with `.route()` so request/response types accumulate; `export type MemberApi = typeof routes` — per-area sub-apps keep `hc` type-checking fast as areas accrue (plan §4).
- **Types-only consumption:** `packages/worker/package.json` gains `"exports": { "./api": "./src/api/app.ts" }` (raw-TS export, the `@grocery-agent/contract` precedent); `packages/app` depends on `@grocery-agent/worker` as a devDependency and does `import type { MemberApi }` for `hc<MemberApi>("/")` — no workerd code can reach the browser bundle (type-only imports erase). The app's tsconfig loads `@cloudflare/workers-types` + `skipLibCheck` so the server type graph resolves under the DOM lib — the exact `src/admin/client/tsconfig.json` precedent.
- Routes call `src/` operation functions and throw `ToolError`; nothing under `src/api/` touches `env.DB` directly (the `src/db.ts` rule).

### 9. Shared `/api` middleware skeleton (errors, build header, ETag, usage) — implemented once in P0, inherited by every later area

- **Errors:** `onError` maps structured `ToolError` codes → status in one table: `validation_failed`→400, `not_found`→404, `unsupported`→405, `storage_error`/`index_unavailable`/`upstream_unavailable`→503, default 500; bodies stay the structured `toShape()` so the SPA branches on the code. Two API-layer codes (not `ToolError` codes — no tool produces them) share the body shape: `unauthorized`→401 (session middleware), `csrf_rejected`→403, `rate_limited`→429.
- **`X-App-Build`:** set on every `/api` response from `env.APP_BUILD ?? "dev"` (Decision 11). `GET /api/version` → `{ build }`, unauthenticated (a build id is not tenant data, and the SPA needs it pre-login for the update prompt).
- **ETag helper:** `jsonWithEtag(c, value)` — weak ETag (`W/"<hex>"`) from a SHA-256 over the serialized JSON via `crypto.subtle`, honoring `If-None-Match` with an empty-body 304. P0 applies it to the whoami read as the living demonstrator; P1's GETs adopt it per the plan's two-writer contract (§6). Per-endpoint cheaper hash inputs (row `updated_at`) can replace the body hash later without changing the helper's contract.
- **Usage:** one point per `/api` request to the existing `TOOL_AE` dataset via `recordToolPoint(env, "api:<METHOD> <routePath>", { ok, durationMs })` — the existing point shape (`indexes/blobs: [name, ok|error]`, `doubles: [durationMs]`), the matched route pattern (never the raw URL — low-cardinality, tenant-clean), best-effort and non-blocking. Reusing `TOOL_AE` makes app usage visible next to tool usage (plan §4) with **no new AE binding**, so no merge-allowlist or Env change.

### 10. Revocation purges web sessions (and the middleware makes purge latency moot)

`revoke()` in `src/admin.ts` additionally lists `session:*` in `TENANT_KV` and deletes records whose `tenant` matches — the same scan-by-value pattern `deleteInvitesFor` uses, bounded at friend-group scale (≤ a few dozen live sessions; expired ones age out via TTL). Ordered with the existing posture: D1 purge first, then delist, then invites/Kroger/sessions. Even if a session key were missed, Decision 5's allowlist re-check already locks the member out on their next request.

### 11. Version stamp: deploy-injected, `"dev"` locally

`data-deploy.yml` computes `BUILD=$(git -C _code rev-parse --short HEAD)` once and (a) exports `VITE_APP_BUILD=$BUILD` for the app build step and (b) appends `--var APP_BUILD:$BUILD` to the `wrangler deploy` command. `env.ts` gains optional `APP_BUILD?: string`; unset (local dev, tests, harness) both sides read `"dev"`, so skew detection is inert locally by construction. The SPA embeds `import.meta.env.VITE_APP_BUILD ?? "dev"` and compares against the `X-App-Build` response header (the comparison UI is P5; the contract ships now so a week-old cached bundle can already be detected).

### 12. Toolchain picks (web-verified 2026-07; plan §8's Rust-preference applied)

| Concern | Pick | Rationale / caveat |
|---|---|---|
| Bundler/dev server | **`vite` ^8** (8.1.x current) | Vite 8 (stable 2026-03) ships **Rolldown as the default bundler** — the plan's "plain Vite once Rolldown is its default" branch is the live one; the `rolldown-vite` alias package is obsolete. |
| React transform | **`@vitejs/plugin-react` ^6** | Uses the Oxc React transform natively; `@vitejs/plugin-react-oxc` was deprecated/merged into it; `-swc` only warranted for SWC-plugin users. No Babel. |
| React | **`react`/`react-dom` ^19** | Per plan. |
| PWA | **`vite-plugin-pwa` ^1.3** (≥1.3.0 required) | 1.3.0 added the `vite ^8` peer range (1.2.0's gap was declaration-only, issues #918/#923); pins Workbox 7.4. `registerType: "prompt"` per §11.3. |
| CSS | **`tailwindcss` + `@tailwindcss/vite` ^4.3** | Oxide engine; the Vite plugin peers `^8`. CSS-first config, no `tailwind.config.js`. |
| Components | **shadcn/ui via the `shadcn` CLI** | Official Tailwind v4 + React 19 support (`@theme`, `data-slot`, `components.json`); components are vendored source into `packages/ui`, not a runtime dep. |
| Data/router | **`@tanstack/react-query` ^5, `@tanstack/react-router` ^1 + `@tanstack/router-plugin`** | Router plugin peers Vite 8; the old rolldown-vite HMR issue is closed. **Avoid TanStack Start** (its Vite 8 SSR issues don't apply to plain SPA routing, which is all we use). Persist/IndexedDB packages (`@tanstack/react-query-persist-client`, `idb-keyval`) are P5, named here so P5 doesn't re-research. |
| Lint/format | **`oxlint` + `@biomejs/biome`** (format only) | Per plan §8; no ESLint/Prettier in the new packages. The design bundle's `_adherence.oxlintrc.json` seeds the oxlint config. |
| Typecheck/tests | **`tsc` + Playwright** | No production-stable native replacements yet (plan §8's "keep the standard" branch). |

Install hygiene: any new build-gated dep surfaced by `aube install` gets an explicit `aube.allowBuilds` decision in the root `package.json` (the `package-manager` spec's clean-install requirement); native prebuilds (Rolldown, Oxide) ship as napi binaries and are expected to need none.

### 13. `packages/ui`: raw-TS workspace exports + the theme stylesheet

`@grocery-agent/ui` exports raw TS (`"exports": { ".": "./src/index.ts", "./theme.css": "./src/theme.css" }` — the `@grocery-agent/contract` precedent; the app's bundler compiles it). P0 contents: the `cn` util, the Tailwind v4 `@theme` token stylesheet translated from the design bundle (`docs/plans/web-app-design/`, Basecoat↔shadcn tokens map near-1:1), and the shadcn/ui primitives the P0 screens need (Button, Input, Card, Label) vendored via the shadcn CLI (`components.json` lives in `packages/ui`). The app's entry CSS: `@import "tailwindcss"; @import "@grocery-agent/ui/theme.css";` + `@source` directives covering both the app's `src/` and the ui package's `src/` so utility classes used inside shared components are compiled.

### 14. Dev orchestration: a small spawner script, not an unverifiable package-manager flag

`aubr dev:app` = root `scripts/dev-app.mjs`: spawns `wrangler dev` (cwd `packages/worker`) and `vite` (cwd `packages/app`) as children, forwards SIGINT/SIGTERM, exits non-zero if either dies. `packages/app/vite.config.ts` sets `server.proxy: { "/api": "http://127.0.0.1:8787" }` so the SPA dev server (HMR at :5173) hits the real Worker for auth/data; cookies flow because the proxy is same-origin from the browser's view. Deliberately **not** `aube --parallel run dev`: aube's support for pnpm's `--parallel` couldn't be verified (docs unreachable from this environment), and a 20-line committed script is deterministic either way. `aubr dev` stays plain `wrangler dev` (serves the last-built SPA from `assets/` — the no-HMR path the harness also uses).

### 15. App Playwright harness: `packages/worker/app/visual/`, sibling and mirror of `admin/visual/`

- **Location:** inside `packages/worker` — the harness boots the *Worker* (which serves the app), reuses the existing seed machinery, and keeps one Playwright dep/version. Layout mirrors `admin/visual/`: `pages/` (`login.page.ts`, `home.page.ts` extending an app `base.page.ts`), `fixtures.ts`, `registry.ts`, `specs/` (login flow: bad code → uniform error; good code → hello-world shell; logout → back to login; passthrough: `/health` + `/cookbook` still Worker-served), `setup.mjs`, its own `tsconfig.json` wired into `aubr typecheck`.
- **Config/scripts:** `playwright.app.config.ts` beside the admin config (`testDir: app/visual/specs`, `PW_APP_PORT` default 8788 so both suites can coexist); worker script `test:app": "playwright test -c playwright.app.config.ts"`, root `test:app` filter. `setup.mjs` builds the app (`aubr build:app`) + admin bundle, applies migrations, seeds, then `wrangler dev --local`.
- **Seed:** extend the shared `admin/visual/seed.mjs` `kvEntries()` with a deterministic invite mapping (`invite:PW-APP-INVITE` → the existing active member) — one fixture set for both suites.
- **CI:** a blocking `app-ui` job mirroring `admin-ui` (mise + aube ci + Playwright cache + `aubr test:app`), added to `trigger-deploy`'s `needs`. Screenshots publish to the same orphan `admin-screenshots` branch under `pr-<n>-app/` (no collision with the admin job's `pr-<n>/` — each job `rm -rf`s only its own directory; the existing fetch-rebase retry absorbs cross-job races) with its own sticky-comment marker `<!-- app-ui-screenshots -->`, path-filtered to `packages/app/`, `packages/ui/`, `packages/worker/app/visual/`, `packages/worker/src/api/`, `packages/worker/src/session.ts`, `playwright.app.config.ts`.
- Web sessions: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, same as the admin suite.

## Risks / Trade-offs

- **SPA fallback shadowing a Worker route** → the single biggest structural risk; mitigated by Decision 2's enumeration + spec'd discipline rule + Playwright passthrough assertions + the merge regression test pinning the config survives deploy.
- **`__Host-` cookie under plain-HTTP dev** → relies on browsers' trustworthy-origin treatment of `127.0.0.1`; the P0 Playwright acceptance exercises exactly this path, so a regression is caught by the gate, not in the field. Fallback if an environment ever breaks it: drop to an un-prefixed name — a one-line change with no data migration (sessions live server-side).
- **Invite code as a reusable login credential** → codes are bearer-ish by design (plan records the rejected alternatives); mitigations: rate-limited login, uniform 401, codes rotate/revoke in `/admin`, sessions are revocable server-side.
- **Assets-root move churn** (build-admin output path, gitignore, docs) → contained; URLs unchanged by construction and `admin-ui` gates them.
- **KV `list()` scan on revoke** → O(sessions), fine at friend-group scale; TTL keeps the keyspace small. Not a hot path.
- **Vite 8 build-perf regressions reported in a minority of setups** → accepted; benchmark only if the app build becomes CI-noticeable.
- **Two Playwright suites double the browser-gate wall time** → separate jobs run in parallel in CI; locally each suite is invoked on demand.

## Migration Plan

1. Land everything in one change (it is only additive to runtime surfaces; the only removed behavior is the `/` banner). Order inside the PR: rate-limit extraction → session store/middleware → `/api` mount → workspaces/scaffold → assets config → harness/CI → docs.
2. No data migration: sessions are new KV state; no D1 schema change (`migrations/d1/` untouched).
3. Deploy: normal merge auto-kicks the data-repo deploy; the merged wrangler config carries the new assets block (verified by the merge test); first deploy serves the SPA at `/`. Operators do nothing.
4. Rollback: revert the PR — sessions in KV expire on their own; the banner returns with the revert.

## Open Questions

None — all resolved above (assets-merge behavior, Worker-owned path list, session/CSRF/rate-limit concretes, `hc` typing path, toolchain versions, harness shape, CI/deploy wiring).
