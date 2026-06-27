## Why

Each operator's **private** data repo README is their control-plane home page, but it shows nothing about whether the Worker behind it is healthy. The Worker already exposes `/health` (token-gated JSON, `200`/`503`), yet seeing it means curling a URL or standing up an uptime monitor — there is no at-a-glance signal where the operator already looks. Because the data repo is private, the `HEALTH_TOKEN` can live there safely, which makes a **self-rendered** status badge feasible with no third-party badge service: the Worker renders its own health as an SVG and the README embeds it.

## What Changes

- **NEW** A `/health.svg?token=<HEALTH_TOKEN>` variant on the Worker's fetch path that renders the **existing** `/health` payload as an SVG **card** — a healthy/degraded headline plus one row per background job (ok / fail / never-run + relative last-run) and a D1 row. Built from `buildHealthPayload()`, so it inherits the same tenant-data-free guarantee. Unlike the JSON endpoint, the SVG returns **`200` always** (degraded state is shown by color, not HTTP status) because GitHub's image proxy may not render a non-`200` image; it sets `content-type: image/svg+xml` and a short `Cache-Control` so the badge refreshes on a TTL. Same token gate as `/health` (unset → `404`, wrong → `401`).
- **CHANGE** `HEALTH_TOKEN` posture: from a Worker **secret** to an optional plaintext **`var`** in the operator's `wrangler.jsonc`. This is **additive** — the Worker reads `env.HEALTH_TOKEN` the same way, so the secret form keeps working; the var is the recommended path when you want the badge (the deploy can read it to build the URL, and it flows to the Worker through the existing config merge unchanged).
- **NEW** The deploy **optionally** stamps a badge into the data repo README — an idempotent `<!-- health-badge:start -->` / `<!-- health-badge:end -->` marker block carrying `https://<WORKER_HOST>/health.svg?token=<HEALTH_TOKEN>`, committed back the same way KV/D1 ids are pinned. `WORKER_HOST` is the existing repo variable (reused via the thin caller, exactly as `build-plugin.yml` passes `mcp_url`); the token is read from the operator's `wrangler.jsonc`. Absent either → skip with a warning (consistent with `/health` being opt-in).
- **CHANGE** Pin-back (the README badge **and** the existing KV/D1 ids) is framed as **explicitly optional**: when the deploy cannot commit back — no `contents: write`, or the operator prefers manual — it prints the exact ready-to-paste badge snippet to the job summary (as onboard does for the invite code). The manual paste is a genuine one-time step (token + host are stable). A documented, supported workflow rather than just a graceful warning.
- **Docs (same pass — no-drift rule):** `docs/SELF_HOSTING.md` (token-as-var, the badge, the manual runbook, pin-back-as-optional), `docs/TOOLS.md` (the `/health.svg` route + the `200`-always SVG contract vs. `/health`'s `200`/`503` JSON). The data-template repo (separate repo) gets the README marker block, the `deploy.yml` caller wiring, and a commented `HEALTH_TOKEN` example var.

No breaking changes: the SVG is new, the token posture is additive, and the README stamping is opt-in.

## Capabilities

### New Capabilities
<!-- None. The SVG variant extends the existing /health endpoint (background-job-health); the
     token-as-var + README stamping extend the deploy (operator-provisioning). -->

### Modified Capabilities
- `background-job-health`: add the `/health.svg` SVG card variant — token-gated like `/health`, `200`-always, `image/svg+xml`, TTL-cached, tenant-data-free — rendered from the existing aggregate payload.
- `operator-provisioning`: `HEALTH_TOKEN` may be supplied as an operator `var`; the deploy optionally stamps the README health badge from `WORKER_HOST` + the token and pins it back; and pin-back (README badge + KV/D1 ids) is an explicitly optional, manual-supported path (graceful fallback prints the snippet to the job summary, no `contents: write` required).

## Impact

- **Worker code**: `src/health.ts` (SVG card renderer + `.svg` handler, reusing `buildHealthPayload()`); `src/index.ts` (route `/health.svg`). No change to `env.ts` (`HEALTH_TOKEN` already typed optional) or to `scripts/merge-wrangler-config.mjs` (vars already operator-only).
- **CI/deploy**: `.github/workflows/data-deploy.yml` (optional `worker_host` input; a README-stamp step that builds the snippet, replace-or-inserts the marker block, commits back with the existing graceful-warn, and always writes the snippet to `$GITHUB_STEP_SUMMARY`).
- **Data-template repo** (`caseyWebb/groceries-agent-data-template`, separate repo — cross-repo tasks): `deploy.yml` caller passes `worker_host: ${{ vars.WORKER_HOST }}`; `README.md` gains the marker block + a short note; `wrangler.jsonc` gains a commented `HEALTH_TOKEN` example var.
- **Tests**: `test/health.test.ts` covers the SVG variant (`404` unset, `401` wrong token, `200` + `image/svg+xml` when healthy, `200` not `503` when degraded, tenant-clean output, never-run renders amber).
- **Docs**: `docs/SELF_HOSTING.md`, `docs/TOOLS.md` (per the no-drift rule).
- **Security/privacy**: the SVG is aggregate-only and token-gated; the token is exposed only inside the **private** data repo (raw markdown) and, once rendered, inside GitHub's image-proxy URL visible only to repo members. The endpoint gates an already-tenant-clean payload.
- **Non-goals**: real-time/live status (GitHub proxies and caches README images — the badge is TTL-refreshed and glanceable; real alerting stays the uptime monitor's job); a public (token-less) badge variant; a staleness policy in the badge (staleness stays the monitor's concern).
