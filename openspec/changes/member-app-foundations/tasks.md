## 1. Rate limiter extraction + session store

- [x] 1.1 Extract the fixed-window KV limiter from `src/ingest.ts` into `src/rate-limit.ts` as `underRateLimit(kv, key, max, windowS, now)` (fail-open, `expirationTtl: windowS * 2`); ingest calls it with its existing `ingest:rl:<keyId>:<bucket>` keys in `KROGER_KV` — behavior-identical, existing ingest tests stay green unmodified.
- [x] 1.2 `src/session.ts`: session store over `TENANT_KV` — `createSession(kv, tenant)` (32-byte `crypto.getRandomValues` token, base64url; `session:<token>` → `{ tenant, created_at, refreshed_at }`, `expirationTtl` 90d), `readSession`, `deleteSession`, and the throttled rolling refresh (re-put with fresh TTL only when `refreshed_at` is >24h old), per design Decisions 3–4.
- [x] 1.3 `src/session.ts`: cookie helpers (`__Host-session`; HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age 90d; clear-cookie for logout) and the `requireSession` Hono middleware — cookie → KV → `resolveTenant(env, record.tenant, directoryFromEnv(env), true)` → `c.set("tenant", …)`; missing/expired/unresolvable → structured `{ error: "unauthorized" }` 401 (design Decision 5).
- [x] 1.4 Vitest coverage (`test/session.test.ts`): mint/read round-trip; expiry (TTL honored via injected now); rolling refresh throttle (no re-put <24h, re-put after); middleware yields the same normalized `Tenant` as the MCP path; a delisted tenant's live session stops resolving; logout deletes the record.

## 2. Session area + CSRF on the `/api` mount

- [x] 2.1 `src/api/app.ts`: the `/api` Hono app (`basePath("/api")`, `Variables: { tenant: Tenant }`), chained per-area routing, `export type MemberApi = typeof routes`; dispatched from `src/index.ts` `defaultHandler` for `/api` + `/api/*` before the `/admin` dispatch.
- [x] 2.2 Shared middleware (design Decision 9): `onError` `ToolError`-code → status table (`validation_failed`→400, `not_found`→404, `unsupported`→405, `storage_error`/`index_unavailable`/`upstream_unavailable`→503, default 500) with structured bodies; API-layer codes `unauthorized`→401, `csrf_rejected`→403, `rate_limited`→429 share the body shape; `X-App-Build: env.APP_BUILD ?? "dev"` on every response; no `Access-Control-Allow-*` anywhere.
- [x] 2.3 CSRF middleware on all non-GET/HEAD `/api` requests (login included): require the `X-App-Csrf` header, and reject `Sec-Fetch-Site: cross-site`/`same-site` when the header is present → `{ error: "csrf_rejected" }` 403 (design Decision 7).
- [x] 2.4 `src/api/session.ts` area: `POST /api/session` (rate limit `login:rl:<CF-Connecting-IP>` 10/min via `src/rate-limit.ts` → 429; `resolveInvite` → uniform `{ error: "unauthorized" }` 401 on null; mint session + Set-Cookie + return `{ tenant }`), `GET /api/session` whoami (session-gated, served through `jsonWithEtag`), `DELETE /api/session` logout (delete KV record + clear cookie).
- [x] 2.5 `jsonWithEtag(c, value)` helper: weak ETag (`W/"<sha-256-hex>"` via `crypto.subtle`) + `If-None-Match` → empty-body 304 (design Decision 9).
- [x] 2.6 `GET /api/version` → `{ build: env.APP_BUILD ?? "dev" }`, unauthenticated; add `APP_BUILD?: string` to `src/env.ts` with a doc comment (deploy-injected, design Decision 11).
- [x] 2.7 Usage points: emit `recordToolPoint(env, "api:<METHOD> <routePath>", { ok, durationMs })` per `/api` request from the shared middleware — matched route pattern, never the raw URL; best-effort (design Decision 9).
- [x] 2.8 Revocation: `revoke()` in `src/admin.ts` also scans `session:*` in `TENANT_KV` and deletes records whose `tenant` matches, after the existing purge steps (design Decision 10); extend its tests.
- [x] 2.9 Vitest coverage (`test/api.test.ts`): login happy path sets the cookie + returns `{ tenant }`; unknown code → uniform 401; rate limit → 429; missing CSRF header on POST → 403; `Sec-Fetch-Site: cross-site` → 403; whoami 401 without cookie, 200 + ETag with; matching `If-None-Match` → 304; logout invalidates; a thrown `ToolError("not_found", …)` surfaces as 404 with the structured body; every response carries `X-App-Build`; no CORS headers on any response.

## 3. Frontend workspaces

- [x] 3.1 Scaffold `packages/ui` (`@grocery-agent/ui`): raw-TS exports (`.` → `src/index.ts`, `./theme.css`), `cn` util, Tailwind v4 `@theme` tokens translated from `docs/plans/web-app-design/` (`project/cookbook/`), shadcn `components.json`, and the P0 primitives (Button, Input, Card, Label) vendored via the shadcn CLI; `typecheck` script; oxlint + biome configs (seed oxlint from the design bundle's `_adherence.oxlintrc.json`).
- [x] 3.2 Scaffold `packages/app` (`@grocery-agent/app`): `vite` ^8, `@vitejs/plugin-react` ^6, `@tanstack/react-router` ^1 + `@tanstack/router-plugin`, `@tanstack/react-query` ^5, `tailwindcss` + `@tailwindcss/vite` ^4.3, `vite-plugin-pwa` ≥1.3 (`registerType: "prompt"`, minimal manifest + shell precache), `@grocery-agent/ui` `workspace:*`, `hono` (for `hc`), `@grocery-agent/worker` as a types-only devDependency; scripts `dev` (vite), `build` (vite build), `typecheck`, `lint` (oxlint), `format` (biome). Record `aube.allowBuilds` decisions for any newly build-gated dep so `aube install` stays clean.
- [x] 3.3 `vite.config.ts`: outDir `../worker/assets` with `emptyOutDir: false` + a pre-build clean of only the app's own outputs (`index.html`, the hashed `assets/` subdir); `server.proxy["/api"]` → `http://127.0.0.1:8787`; `VITE_APP_BUILD` embedded (default `"dev"`).
- [x] 3.4 Worker `package.json`: add `"exports": { "./api": "./src/api/app.ts" }`; app-side typed client `hc<MemberApi>("/")` via `import type` only, with the `X-App-Csrf` header set on every mutation by the shared fetch wrapper; app `tsconfig.json` mirrors the `src/admin/client/tsconfig.json` posture (DOM lib + `@cloudflare/workers-types` + `skipLibCheck`).
- [x] 3.5 P0 screens: `/login` (invite-code form → `POST /api/session`, structured-error display for `unauthorized`/`rate_limited`) and the session-gated `/` hello-world shell (whoami on boot; 401 → redirect to `/login`; logout button) — TanStack Router history-API routes, no hash routing.

## 4. Worker asset serving

- [x] 4.1 Retarget `scripts/build-admin.mjs` output from `admin/dist/admin/*` to `assets/admin/*` (served URLs unchanged); update `.gitignore`/`packages/worker/.gitignore` (`assets/` replaces `admin/dist/`), and the `admin/dist` references in `admin/visual/setup.mjs` comments, `ci.yml`/`data-deploy.yml` comments, and `src/admin/CLAUDE.md`.
- [x] 4.2 `wrangler.jsonc`: `assets.directory: "./assets"`, `not_found_handling: "single-page-application"`, `run_worker_first` = the 17-path enumeration from design Decision 2, with a comment carrying the discipline rule (new Worker route ⇒ new entry, same trap class as the merge allowlist).
- [x] 4.3 Remove the `GET /` liveness-banner branch from `src/index.ts` `defaultHandler` (assets own `/` now; `/health` remains the machine check).
- [x] 4.4 Extend `tests/merge-wrangler-config.test.mjs`: the merged output preserves `assets.not_found_handling` and the full `run_worker_first` array verbatim (regression-pins design Decision 1's verification).

## 5. Scripts, CI, deploy

- [x] 5.1 Root `package.json` scripts: `build:app`, `test:app` (workspace filters), `dev:app` (`node scripts/dev-app.mjs`); new root `scripts/dev-app.mjs` spawning `wrangler dev` (cwd `packages/worker`) + `vite` (cwd `packages/app`), forwarding signals, exiting non-zero when either child dies (design Decision 14).
- [x] 5.2 `ci.yml` `test` job: add a `Build member app` step (`aubr build:app`) beside the admin build so a broken SPA build fails CI before deploy; recursive `typecheck` picks up both new packages via their scripts.
- [x] 5.3 `ci.yml`: new blocking `app-ui` job mirroring `admin-ui` (mise, aube ci + store cache, Playwright browser cache, `aubr test:app`; concurrency group `app-ui-…`; screenshots to the `admin-screenshots` branch under `pr-<n>-app/` with sticky marker `<!-- app-ui-screenshots -->`, path-filtered per design Decision 15; artifact upload always); add `app-ui` to `trigger-deploy`'s `needs`.
- [x] 5.4 `ci.yml` `trigger-deploy` path filter: add `packages/app/` and `packages/ui/`.
- [x] 5.5 `data-deploy.yml`: compute `BUILD=$(git -C _code rev-parse --short HEAD)`; add a `Build member app` step (`aubr build:app`, env `VITE_APP_BUILD=$BUILD`) after the admin build; append `--var APP_BUILD:$BUILD` to the wrangler `deploy` command (design Decision 11).

## 6. App Playwright harness (blocking from this PR)

- [ ] 6.1 Extend `admin/visual/seed.mjs` `kvEntries()` (+ `seed.d.mts`) with the deterministic invite mapping `invite:PW-APP-INVITE` → the seeded active member.
- [ ] 6.2 `packages/worker/app/visual/`: `setup.mjs` (build app + admin → migrate → seed → `wrangler dev --local` on `PW_APP_PORT`, default 8788), `base.page.ts` + `pages/login.page.ts` + `pages/home.page.ts` (routes, landmarks, `captureForReview` screenshots), `fixtures.ts`, `registry.ts`, its own `tsconfig.json` added to the worker `typecheck` script.
- [ ] 6.3 Specs: login flow (bad code → uniform error rendered; good code → hello-world landmark; logout → back to `/login`), an all-areas smoke (landmark + screenshot per registered page), and Worker-path passthrough (`/health` returns the health JSON, `/cookbook` returns SSR HTML — not the SPA shell).
- [ ] 6.4 `playwright.app.config.ts` + worker script `test:app`; verify locally with `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers aubr test:app` and surface the screenshots for review.

## 7. Docs (same pass — no drift)

- [ ] 7.1 `docs/ARCHITECTURE.md`: the member web app surface — session auth (invite → KV session, cookie, CSRF, revocation), the `/api` mount + shared middleware, SPA serving (`assets/`, SPA fallback, `run_worker_first` enumeration + discipline rule), the version-skew contract (`APP_BUILD`/`X-App-Build`/`/api/version`).
- [ ] 7.2 `docs/SCHEMAS.md`: new "Web sessions (KV)" section (`session:<token>` value shape, TTL/rolling semantics, `TENANT_KV`), the `login:rl:*` counter keys beside a note on the extracted limiter, and a note on `TOOL_AE` carrying `api:*` points in the tool-usage section.
- [ ] 7.3 `docs/SELF_HOSTING.md`: invite codes now also grant web login — member instructions (open `https://<your-worker-host>/`, enter the invite code), the revoke text gains sessions, security-notes mention of the session cookie.
- [ ] 7.4 `README.md` (the member app in the surfaces overview) and `CLAUDE.md` (packages/app + packages/ui blurb; `aubr dev:app`, `build:app`, `test:app`; the assets root; the `run_worker_first` rule), plus `CONTRIBUTING.md` (new-package toolchain: oxlint/biome, no ESLint; the Worker-owned-path rule).
- [ ] 7.5 `src/admin/CLAUDE.md`: assets output path (`assets/admin/`) and the shared assets root.

## 8. Ship

- [ ] 8.1 `aubr typecheck`, `aubr test`, `aubr test:tooling` green (new packages included); `aubr build:app` + `aubr build:admin` both populate `assets/` cleanly in either order.
- [ ] 8.2 `aubr test:admin` green (admin URLs unchanged after the assets move) and `aubr test:app` green — the P0 acceptance: the seeded invite code logs into the hello-world SPA at `/` under `wrangler dev`, in Playwright.
- [ ] 8.3 After merge + deploy: the operator's deployed Worker serves the SPA at `/`, `/api/version` returns the stamped SHA matching the `X-App-Build` header, and `/mcp` + `/cookbook` + `/admin` + `/health` behave unchanged.
