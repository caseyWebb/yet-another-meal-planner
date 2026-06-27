## 1. Worker — `/health.svg` SVG card

- [x] 1.1 In `src/health.ts`, add a pure-JS `renderHealthSvg(payload)` that string-templates an SVG **card** from a `HealthPayload`: a healthy/degraded headline (mirrors `payload.ok`) plus one row per job (`HEALTH_JOBS` order) showing ok/fail/never-run + a relative last-run ("2h ago", from `generated_at - last_run_at`), and a D1 row. Use a monospace font + fixed columns (no font-metric math). Colors: ok=green, fail=red, never-run=amber. Escape all interpolated text.
- [x] 1.2 Add a `handleHealthSvgRequest(request, env)` (or extend the health module) reusing `buildHealthPayload(...)`: same token gate as `/health` (404 when `HEALTH_TOKEN` unset, 401 on missing/wrong token via `?token=` or `Authorization: Bearer`), but respond **200 always** with `content-type: image/svg+xml` and a short `Cache-Control` (~120s). Never throw out of the handler.
- [x] 1.3 In `src/index.ts`, route `url.pathname === "/health.svg"` to the new handler (alongside the existing `/health` line).

## 2. Worker — tests

- [x] 2.1 Extend `test/health.test.ts`: `/health.svg` responds 404 when `HEALTH_TOKEN` unset and 401 on wrong/missing token.
- [x] 2.2 Healthy case: 200, `content-type: image/svg+xml`, body is SVG and contains each job row + D1 (use a fake KV/D1 like the existing `/health` tests).
- [x] 2.3 Degraded case (a failing job and/or failing D1 probe): still **200** (not 503), and the SVG reflects the degraded state.
- [x] 2.4 Never-run case renders the pending/amber style for the cold job; assert it is distinct from healthy/failing.
- [x] 2.5 Tenant-clean assertion: the SVG body contains no per-tenant identifiers (mirror the existing `/health` no-tenant-data test).

## 3. Deploy workflow (code repo) — optional README stamping

- [x] 3.1 In `.github/workflows/data-deploy.yml`, add an optional `worker_host` `workflow_call` input.
- [x] 3.2 Add a step that reads `HEALTH_TOKEN` from the operator's `wrangler.jsonc` (via `stamp-readme-badge.mjs token`, JSON5 parse) and, when both it and `worker_host` are present, builds the badge snippet `![grocery-mcp health](https://<worker_host>/health.svg?token=<token>)`.
- [x] 3.3 Stamp the data-repo README: replace content between `<!-- health-badge:start -->` / `<!-- health-badge:end -->` markers if present, else insert the marker block immediately after the first heading. Implemented as `scripts/stamp-readme-badge.mjs` (pure helpers + `token`/`stamp` CLI, mirroring `merge-wrangler-config.mjs`).
- [x] 3.4 Commit the README back using the **same graceful posture** as the id pin-back step (warn, don't fail, when `git push` is denied for lack of `contents: write`).
- [x] 3.5 **Always** write the ready-to-paste badge snippet to `$GITHUB_STEP_SUMMARY` (as `data-onboard.yml` surfaces the invite code), whether or not the commit succeeded. Skip the whole step with a clear note when `HEALTH_TOKEN` or `worker_host` is absent.
- [x] 3.6 Added `tests/stamp-readme-badge.test.mjs` (wired into `test:tooling`) covering: replace-between-markers, insert-after-first-heading, prepend-when-no-heading, idempotent re-run, URL shape, and the token read.

## 4. Data-template repo (cross-repo — `caseyWebb/groceries-agent-data-template`, branch `claude/data-repo-health-badge-vag3ik`)

- [x] 4.1 In the template `deploy.yml` caller, pass `worker_host: ${{ vars.WORKER_HOST }}` into the reusable `data-deploy.yml` (mirroring how `build-plugin.yml` passes `mcp_url`). (template commit `88d9c58`)
- [x] 4.2 In the template `README.md`, add the `<!-- health-badge:start -->`/`<!-- health-badge:end -->` marker block under the first heading and a short "health badge" note (what it shows, that it needs `HEALTH_TOKEN` + `WORKER_HOST`, that it refreshes on a TTL).
- [x] 4.3 In the template `wrangler.jsonc`, add a commented `HEALTH_TOKEN` example var.

## 5. Docs (code repo — same pass, no-drift)

- [x] 5.1 `docs/SELF_HOSTING.md`: document `HEALTH_TOKEN` as an optional var (recommended when you want the badge) vs. the existing secret; the health badge and how it's stamped; and a **manual runbook** for operators without `contents: write` (copy the snippet from the deploy job summary into the README once).
- [x] 5.2 `docs/SELF_HOSTING.md`: reframe pin-back (README badge **and** KV/D1 ids) as explicitly **optional/manual-supported** — extended the existing "Persisting your ids" pick-one section to tie the badge to the same `contents: write`-or-paste posture.
- [x] 5.3 Documented the `/health.svg` route + **200-always, `image/svg+xml`, TTL-cached** contract in `docs/SCHEMAS.md` and `docs/ARCHITECTURE.md` — where `/health` already lives (TOOLS.md is the MCP-tool contract; `/health*` are HTTP routes, not MCP tools). Noted `/health` stays `200`/`503` JSON and monitors target `/health`, not `.svg`.

## 6. Validate & verify

- [x] 6.1 `tsc --noEmit` clean; `vitest run` green (652 passed, 9 live skipped); `test:tooling` green (121 passed, incl. the new stamper test).
- [x] 6.2 Rendered the real `renderHealthSvg` for healthy/degraded/never-run and rasterized them on light + dark panels (bundled Chromium) — layout is clean and theme-neutral; never-run shows amber without flipping the headline. Resolved the design's theming open question.
- [x] 6.3 `openspec validate "data-repo-health-badge" --strict` passes.
- [x] 6.4 Contract docs updated in lockstep (SCHEMAS.md, ARCHITECTURE.md, SELF_HOSTING.md). PR not opened (no explicit request); template to be filled when/if a PR is opened.
