# Tasks

> Ordering note: groups 1–6 are additive and safe to land while the Actions-based
> flow still exists. Group 7 (retire the onboard/revoke Actions) is **last on
> purpose** — it must follow a deployed, Access-configured, end-to-end-verified
> panel, or there would be no way to onboard during the gap.

> **Status (apply session):** groups 1–6 implemented and verified locally
> (`typecheck`, full `vitest`, `test:tooling`, `openspec validate --strict`, and a
> `wrangler deploy --dry-run` confirming the `assets` + `run_worker_first` config).
> **Two items are blocked by the sandbox, not by code:**
> (a) the committed `admin/dist/` bundle (3.3) and `build:admin --check` (8.1) need
> Elm's package registry (`package.elm-lang.org`), which the sandbox network policy
> blocks — run `aubr build:admin` in CI / a connected dev box; (b) group 7 + the
> post-deploy checks (8.2 full run, 8.3) are gated on a real deploy + Cloudflare
> Access setup.

## 1. Access gate (Worker)
- [x] 1.1 `jose` (Web-Crypto build) is a dependency (already in `package.json`).
- [x] 1.2 Add `requireAccess(request, env, getKeySet?)` (in `src/admin.ts`): cache the team JWKS per team domain (jose `createRemoteJWKSet`), verify the `Cf-Access-Jwt-Assertion` signature + `aud` + issuer with a 5s clock tolerance, return `ok`/`disabled`/`denied`; fail closed on any error.
- [x] 1.3 `src/env.ts`: drop `HEALTH_TOKEN`; add operator-owned vars `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` (+ the `ADMIN_DEV_BYPASS` dev escape and the `ASSETS` Fetcher binding).
- [x] 1.4 Opt-in / fails-closed: `/admin*` is `404` when the Access vars are unset; `403` when set but the assertion is missing/invalid.
- [x] 1.5 Dev-only bypass: honor `ADMIN_DEV_BYPASS=1` only when the Access vars are absent; documented in `.dev.vars.example`.

## 2. Admin API (Worker)
- [x] 2.1 `GET /admin/api/tenants` — list canonical ids from `tenant:*` (operational only).
- [x] 2.2 `POST /admin/api/tenants` `{username, invite_code?}` — onboard; `connector_url = ${origin}/mcp`. Never logs the code.
- [x] 2.3 `POST /admin/api/tenants/:id/rotate` — mint a new invite, delete prior `invite:* → id` by scan; allowlist + data untouched.
- [x] 2.4 `DELETE /admin/api/tenants/:id` — revoke: delete `tenant:<id>` + every `invite:* → id` + `kroger:refresh:<id>` + per-tenant D1 (every tenant-scoped table + attributed notes) in one `db.batch`.
- [x] 2.5 Centralize the per-tenant table list (`TENANT_TABLES`/`AUTHOR_TABLES`) so a future table can't escape the purge; structured errors across the handler boundary.
- [x] 2.6 `test/admin.test.ts` — onboard/list/rotate/revoke + `requireAccess` (disabled/dev/denied) + `handleAdmin` gate + origin-derived connector URL (15 tests, green).

## 3. Admin SPA (Elm) + build
- [x] 3.1 `admin/` Elm source: `elm.json`, `src/Main.elm` (list / onboard / revoke / rotate; show the code once), `index.html`.
- [x] 3.2 `scripts/build-admin.mjs` — deterministic, `--check` mode (mirrors `build-plugin.mjs`); `build:admin` npm script; outputs `admin/dist/admin/{elm.js,index.html}`.
- [ ] 3.3 **(blocked: Elm registry)** Commit `admin/dist/**` (gitignore re-include added; Elm cache ignored). Run `aubr build:admin` where `package.elm-lang.org` is reachable, then commit the bundle.

## 4. wrangler + config merge
- [x] 4.1 `wrangler.jsonc`: `assets` binding (`directory: ./admin/dist`, `run_worker_first: ["/admin","/admin/*"]`) + `workers_dev: false`. Confirmed valid via `wrangler deploy --dry-run`.
- [x] 4.2 `scripts/merge-wrangler-config.mjs`: `assets` propagates verbatim from code (like `ai`); merge test asserts it survives + is in the curated key set.

## 5. Open `/health`, drop `HEALTH_TOKEN`
- [x] 5.1 `src/health.ts`: removed the token branches; serve the aggregate payload unauthenticated; coarsen the D1 probe to a boolean (no raw `storage_error` string).
- [x] 5.2 `src/index.ts`: route `/admin*` through `handleAdmin`; `/health` open (`handleHealthRequest(env)`); `test/health.test.ts` updated for the open + coarsened endpoint.

## 6. Docs + specs lockstep
- [x] 6.1 `docs/ARCHITECTURE.md`: `/health` open + the new "Operator admin surface" (4th no-tenant surface, Access posture, `assets` allowlist).
- [x] 6.2 `docs/SELF_HOSTING.md`: onboarding via `/admin` + the one-time Cloudflare Access setup (`/admin*` scope only), the `ACCESS_*` vars, `/health` open, the security-summary reframe.
- [x] 6.3 `docs/SCHEMAS.md`: `/health` (open, coarsened) + the `/admin/api/*` surface; `src/index.ts` route comment lists `/admin`.

## 7. Retire the Actions-based flow (LAST — after 1–6 are deployed + verified)
- [ ] 7.1 **(deploy-gated)** Code repo: delete `.github/workflows/data-onboard.yml` and `.github/workflows/data-revoke.yml`.
- [ ] 7.2 **(deploy-gated)** Data repo (`groceries-agent-data`): delete the `onboard.yml` / `revoke.yml` callers.
- [ ] 7.3 **(deploy-gated)** Template repo (`groceries-agent-data-template`): delete the callers; clean the SELF_HOSTING control-plane workflow table + the lines 11/37–48 "private repo keeps invite codes secret" framing.

## 8. Verify
- [x] 8.1 `typecheck`, `vitest` (659 pass), `test:tooling` (117 pass) green. **`build:admin --check` blocked** on Elm registry access (run in CI/dev).
- [ ] 8.2 **(needs the built bundle)** Local `wrangler dev` with `ADMIN_DEV_BYPASS=1`: onboard/rotate/revoke a test member, confirm KV + local D1 effects and the code shows once; `/health` answers with no token and no raw `d1.error`. (Unit-tested now; full local run pending the dist build.)
- [ ] 8.3 **(deploy-gated)** Post-deploy: `/admin` requires an Access session, `*.workers.dev` is closed, `/mcp` unaffected; onboard/rotate/revoke a real member end-to-end before group 7.
- [x] 8.4 `openspec validate operator-admin-panel --strict` passes.
