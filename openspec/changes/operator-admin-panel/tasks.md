# Tasks

> Ordering note: groups 1–6 are additive and safe to land while the Actions-based
> flow still exists. Group 7 (retire the onboard/revoke Actions) is **last on
> purpose** — it must follow a deployed, Access-configured, end-to-end-verified
> panel, or there would be no way to onboard during the gap.

## 1. Access gate (Worker)
- [ ] 1.1 Add `jose` (Web-Crypto build) to `package.json`.
- [ ] 1.2 Add `requireAccess(request, env, expectedAud)` (in `src/admin.ts`): fetch + cache the team JWKS in `KROGER_KV` (short TTL, re-fetch on unknown `kid`), verify the `Cf-Access-Jwt-Assertion` signature + `aud` + issuer, return the verified claims or a `403`; small clock-skew leeway; fail closed on any error.
- [ ] 1.3 `src/env.ts`: drop `HEALTH_TOKEN`; add operator-owned vars `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` (non-secret identifiers, documented like `GITHUB_APP_ID`).
- [ ] 1.4 Opt-in / fails-closed: `/admin*` responds `404` when `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` are unset; `403` when set but the assertion is missing/invalid.
- [ ] 1.5 Dev-only bypass: honor `ADMIN_DEV_BYPASS=1` (gitignored `.dev.vars`) **only** when the Access vars are absent, so `wrangler dev` can serve the panel locally and the bypass can't engage in a configured deployment. Update `.dev.vars.example`.

## 2. Admin API (Worker)
- [ ] 2.1 `GET /admin/api/tenants` — list canonical ids from `tenant:*` (operational only; no domain data).
- [ ] 2.2 `POST /admin/api/tenants` `{username, invite_code?}` — onboard: canonicalize, generate a code when absent, write `tenant:<id>` + `invite:<code> → <id>`, return `{username, invite_code, connector_url}` with `connector_url = ${new URL(request.url).origin}/mcp`. Never log the code.
- [ ] 2.3 `POST /admin/api/tenants/:id/rotate` — mint a new invite mapping, delete prior `invite:* → id` mappings (located by scanning `invite:*`), leave the allowlist entry + per-tenant data intact.
- [ ] 2.4 `DELETE /admin/api/tenants/:id` — revoke: delete `tenant:<id>`, delete every `invite:* → id` (by scan), delete `kroger:refresh:<id>`, and purge per-tenant D1 (every tenant-scoped table + attributed notes) in one `db.batch` through `src/db.ts`.
- [ ] 2.5 Centralize the per-tenant table list in one exported constant (reused by revoke) so a future table can't silently escape the purge; structured errors throughout (no throws across the handler boundary).
- [ ] 2.6 `test/admin.test.ts` — onboard writes both keys + returns origin-derived connector URL; rotate replaces the code and invalidates the old; revoke clears KV (allowlist + all matching invites + Kroger token) and batches the D1 deletes; `requireAccess` admits a valid assertion and rejects missing/bad-aud/bad-sig; `404` when unconfigured.

## 3. Admin SPA (Elm) + build
- [ ] 3.1 Add the `admin/` Elm source tree: `admin/elm.json`, `admin/src/Main.elm` (list / onboard / revoke / rotate against `/admin/api/*`; show the invite code + connector URL once), `admin/index.html`.
- [ ] 3.2 Add `scripts/build-admin.mjs` — deterministic, `--check` validate-only mode (mirrors `build-plugin.mjs`): runs `elm make`, copies `index.html`, writes a committed `admin/dist/`. Wire an `aubr` script (e.g. `build:admin`).
- [ ] 3.3 Commit `admin/dist/**`; gitignore the source map. CI runs `build-admin --check` to catch drift (same gate style as the plugin build).

## 4. wrangler + config merge
- [ ] 4.1 `wrangler.jsonc`: add the `assets` binding (directory `admin/dist`, bound) and set `workers_dev: false`. Route `/admin/api/*` worker-first so the API reaches the handler rather than a static 404 (`run_worker_first` glob or the version's equivalent — confirm against the deployed wrangler).
- [ ] 4.2 `scripts/merge-wrangler-config.mjs`: add `assets` to the code-level allowlist so it survives the operator merge (the silent-drop trap). Add a merge test asserting `assets` is present in the merged output.

## 5. Open `/health`, drop `HEALTH_TOKEN`
- [ ] 5.1 `src/health.ts`: remove the `HEALTH_TOKEN` branches; serve the aggregate payload unauthenticated; coarsen the D1 probe to a boolean (drop the raw `storage_error` string from the public payload).
- [ ] 5.2 `src/index.ts`: route `/admin*` through `requireAccess`; leave `/health` open. Update `test/` for the open endpoint + the coarsened `d1` field.

## 6. Docs + specs lockstep
- [ ] 6.1 `docs/ARCHITECTURE.md`: add the admin as the 4th no-tenant surface (cron / email / health / admin); record the Access-gates-`/admin`-only posture and the open-`/health` decision; note the `assets` merge-allowlist entry.
- [ ] 6.2 `docs/SELF_HOSTING.md`: replace the "run the Onboard/Revoke Action" flow with "open `/admin`"; add the one-time Cloudflare Access setup (an app scoped to `/admin*` only — **never the hostname root**, or it gates `/mcp`), the `ACCESS_*` vars, and `workers_dev:false`; update the `/health` section (open + tenant-clean; restrict at the edge if desired). Soften the "why the data repo is private" framing (blocker removed; full public flip is a later change).
- [ ] 6.3 Update the surface/route inventory wherever the public fetch routes are enumerated.

## 7. Retire the Actions-based flow (LAST — after 1–6 are deployed + verified)
- [ ] 7.1 Code repo: delete `.github/workflows/data-onboard.yml` and `.github/workflows/data-revoke.yml`.
- [ ] 7.2 Data repo (`groceries-agent-data`): delete the `onboard.yml` / `revoke.yml` callers.
- [ ] 7.3 Template repo (`groceries-agent-data-template`): delete the `onboard.yml` / `revoke.yml` callers and update any template README referencing them.

## 8. Verify
- [ ] 8.1 `aubr typecheck`, `aubr test`, `aubr test:tooling`, `aubr build:admin --check` all green.
- [ ] 8.2 Local: `wrangler dev` with `ADMIN_DEV_BYPASS=1` — onboard a test member, confirm the code shows once and `tenant:*`/`invite:*` are written; rotate; revoke and confirm the KV keys + local D1 rows are gone; `/health` answers with no token and no raw `d1.error`.
- [ ] 8.3 Post-deploy: with the Access app live, confirm `/admin` requires an Access session, `*.workers.dev` is closed (`workers_dev:false`), and `/mcp` / `/authorize` are unaffected. Onboard / rotate / revoke a real member end-to-end before doing group 7.
- [ ] 8.4 `openspec validate operator-admin-panel --strict` passes.
