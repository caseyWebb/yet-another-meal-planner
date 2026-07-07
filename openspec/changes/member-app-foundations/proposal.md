## Why

The member web app plan (`docs/plans/web-app.md`, ratified 2026-07-07 with all §11 defaults confirmed) needs its foundations before any member-facing page can land: today the Worker has no member session (the only auth surfaces are the MCP OAuth provider and the Access-gated `/admin`), no `/api` JSON surface for a browser client, no frontend workspaces, and `/` serves a plain-text liveness banner. P0 lays all of that down as one independently-green change: an invite code logs into a hello-world SPA at `/` in `wrangler dev` and in Playwright — with the CI gate, deploy wiring, and docs in place from the first PR so every later phase (P1 member core → P6 admin SPA) only adds routes and pages.

## What Changes

- **NEW first-party cookie session auth** for members: `POST /api/session` takes an invite code (`resolveInvite`, the same code that provisions the Claude connector), mints a KV-backed revocable session (90d rolling), and sets an `HttpOnly` `SameSite=Lax` cookie. Session middleware is the member-facing analog of `requireAccess`, resolving the same `Tenant` context the MCP path builds (allowlist re-check on every request). CSRF defense = same-origin cookie + a required custom header on all state-changing `/api` requests (+ `Sec-Fetch-Site` verification); login is rate-limited by the same fixed-window KV limiter the ingest endpoint uses (extracted, not duplicated). No CORS, ever.
- **NEW `/api` mount**: per-area Hono sub-apps (the `/admin/api/*` + typed `hc` pattern), P0 shipping the `session` area + `GET /api/version`, with the shared middleware skeleton every later area inherits — structured `ToolError`→HTTP-status mapping in one place, an `X-App-Build` header on every response, a weak-ETag/`If-None-Match` helper, and a per-route usage point to the existing `TOOL_AE` dataset.
- **NEW frontend workspaces** `packages/app` (member SPA, React 19 + Vite 8 on the Rolldown core + TanStack Query/Router + `vite-plugin-pwa`) and `packages/ui` (shared shadcn/ui components + Tailwind v4 theme tokens, consumed via `workspace:*`). P0 ships the login screen + a session-gated hello-world shell.
- **CHANGE Worker asset serving**: one merged assets root (`packages/worker/assets/`, gitignored) serves the SPA at `/` (replacing the liveness banner; `/health` remains the machine check) **and** the existing admin islands/styles at their unchanged URLs. `not_found_handling: "single-page-application"` + `run_worker_first` enumerating every Worker-owned path so the SPA fallback can never shadow `/mcp`, `/api/*`, `/authorize`, `/oauth/*`, `/satellite/*`, `/token`, `/register`, `/.well-known/*`, `/cookbook*`, `/admin*`, `/health*`, `/source`. Verified: the deploy merge propagates the whole `assets` object verbatim, so the new sub-keys survive with **no allowlist change** (a regression test pins it).
- **NEW Playwright harness for the app** (`packages/worker/app/visual/`, mirroring `admin/visual/`: page objects, seeded `wrangler dev`, per-area screenshots) and a **blocking `app-ui` CI job** from this first PR, gating `trigger-deploy` like `admin-ui` does.
- **CHANGE build/deploy wiring**: `aubr build:app` + `aubr test:app` + `aubr dev:app` (Vite dev proxying `/api` to `wrangler dev`); CI builds the app like it builds the admin bundle; `trigger-deploy` path filters gain `packages/app/**` + `packages/ui/**`; the operator deploy builds the SPA before `wrangler deploy` and stamps the code SHA into both the bundle (`VITE_APP_BUILD`) and the Worker (`--var APP_BUILD`) for the version-skew contract.
- **CHANGE member revocation** to also purge the member's web sessions (alongside the existing allowlist/invite/Kroger/D1 purge); independent of the purge, the middleware's allowlist re-check locks a revoked member out immediately.

## Capabilities

### New Capabilities

- `member-session-auth`: the invite-code → cookie-session login, session store + middleware, CSRF posture, login rate limiting, logout, and revocation semantics for the member web surface.
- `member-api`: the `/api` mount — per-area typed Hono sub-apps calling the same `src/` operations tools call, the shared error/ETag/`X-App-Build` middleware, `GET /api/version`, and per-route usage observability.
- `member-app-shell`: the member SPA workspaces and toolchain, serving at `/` via Workers Static Assets with SPA fallback + `run_worker_first` enumeration, the build-id stamp, and the dev/build scripts.
- `app-ui-testing`: the member app's Playwright surface — the page-object harness, the blocking `app-ui` CI gate, and screenshot publishing (mirror of `admin-ui-testing`).

### Modified Capabilities

- `operator-admin`: member revocation additionally purges the member's web sessions.
- `build-automation`: CI/typecheck coverage and deploy path filters extend to the new packages; the deploy builds the member app and stamps the build id.

## Impact

- **Code**: new `src/api/` (app + session area + middleware), `src/session.ts` (store + cookie + middleware), `src/rate-limit.ts` (limiter extracted from `src/ingest.ts`), `src/admin.ts` (revoke purges sessions), `src/index.ts` (`/api` dispatch; liveness banner removed), `src/env.ts` (`APP_BUILD?`), `scripts/build-admin.mjs` (output retargets to `assets/admin/`), new `packages/app` + `packages/ui`, root `scripts/dev-app.mjs`, new `app/visual/` harness + `playwright.app.config.ts`.
- **Config**: `wrangler.jsonc` `assets` block (`directory: "./assets"`, `not_found_handling`, expanded `run_worker_first`); root + worker `package.json` scripts; `pnpm-workspace.yaml` already covers `packages/*`; `aube-lock.yaml` grows the frontend deps (build-gated deps get explicit `aube.allowBuilds` decisions); `.gitignore` (assets root).
- **CI/deploy**: `ci.yml` (build the app in `test`, new blocking `app-ui` job, `trigger-deploy` needs + path filters), `data-deploy.yml` (build app + `APP_BUILD` stamp). No new secrets; the public repo stays secret-free.
- **Docs (same pass)**: `docs/ARCHITECTURE.md` (member app surface, session auth, serving/version-skew), `docs/SCHEMAS.md` (session KV shape, rate-limit keys, `TOOL_AE` api points), `docs/SELF_HOSTING.md` (invite codes now also grant web login), `README.md`, `CLAUDE.md` (build commands, packages), `CONTRIBUTING.md` (new packages + the `run_worker_first` enumeration rule), `src/admin/CLAUDE.md` (assets path). `docs/TOOLS.md` untouched (no tool contract change in P0).
- **Risk**: the SPA fallback shadowing a Worker route (mitigated by the enumerated `run_worker_first` + a spec'd discipline rule + Playwright coverage of `/health` + `/cookbook` passthrough); session fixation/guessing (128-bit+ random token, KV TTL, uniform 401, rate-limited login); the assets-root move breaking admin URLs (URLs are unchanged by construction; `admin-ui` suite gates it).
- **Non-goals**: any member page beyond login + hello-world (P1), offline persistence/paused mutations (P5), passkeys, CORS, server-side propose state, admin SPA (P6).
