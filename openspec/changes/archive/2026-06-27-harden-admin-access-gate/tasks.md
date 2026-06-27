## 1. Admin gate hardening (`src/admin.ts`)

- [x] 1.1 Add a `isLoopbackHost(request)` helper matching `localhost` / `127.0.0.1` / `::1` (and bracketed `[::1]`) from `URL(request.url).hostname`.
- [x] 1.2 Extract the no-token gate decision into a pure `adminGateDisposition(env, { isLoopback })` returning `gated` / `dev-bypass` / `disabled`, so both `requireAccess` and the `/health` posture share one source of truth.
- [x] 1.3 In `requireAccess`, gate `ADMIN_DEV_BYPASS` on `isLoopbackHost(request)` (inert otherwise → `disabled`), and `console.warn` when the bypass engages.
- [x] 1.4 In `requireAccess`, after JWT verification, when `ACCESS_ALLOWED_EMAILS` is set require the verified `email` claim to be on the list (case-insensitive, trimmed); otherwise `denied` (403). Unset → admit (unchanged). Parse the list once (split on comma, trim, lowercase, drop empties).
- [x] 1.5 Confirm `handleAdmin` still maps `disabled → 404`, `denied → 403`, `ok → serve` (unchanged — `AccessResult` shape preserved).

## 2. Health posture (`src/health.ts`)

- [x] 2.1 Add an `AdminPosture` shape (`access_configured`, `email_allowlist`, `dev_bypass_set`, `exposed`: all booleans) and an `adminPosture(env)` helper to `src/admin.ts`; add `admin: AdminPosture` to `HealthPayload`.
- [x] 2.2 Compute the posture from `env` via the shared `adminGateDisposition` helper (`exposed` = bypass-would-admit, i.e. dev bypass set without Access); never include the allowlisted addresses.
- [x] 2.3 Make overall `ok` false when `admin.exposed` is true (alongside the existing job-failure / D1-probe conditions).
- [x] 2.4 ~~Thread the request into the health handlers.~~ **Obviated:** the posture is a pure function of `env` (`exposed` asks the deployed-risk question via `adminGateDisposition(env, { isLoopback: true })`), so `buildHealthPayload` and both handlers keep their existing signatures — no request threading, no `src/index.ts` change, existing health tests untouched.
- [x] 2.5 In `renderHealthSvg`, add an `admin` row: green `gated` / muted `disabled` / muted `dev` / red `exposed`, with the headline degraded when `exposed` (driven by `payload.ok`); svg stays `200` in all states and tenant-clean.

## 3. Config + env documentation (`src/env.ts`, `.dev.vars.example`)

- [x] 3.1 Add `ACCESS_ALLOWED_EMAILS?: string` to `Env` with a doc comment (optional, non-secret, comma-separated; unset → admit any valid JWT).
- [x] 3.2 Update the `ADMIN_DEV_BYPASS` doc comment to the loopback-only semantics (inert in any deployed context).
- [x] 3.3 Update `.dev.vars.example`: note the loopback requirement for `ADMIN_DEV_BYPASS` and add a commented `ACCESS_ALLOWED_EMAILS` example.

## 4. Tests

- [x] 4.1 `test/admin.test.ts`: dev bypass serves on a loopback host; is inert (→ `disabled`/404) on a non-loopback host even with the flag set. (Existing bypass-based routing tests moved to a loopback host.)
- [x] 4.2 `test/admin.test.ts`: email allowlist — in-list admits (case-insensitive), off-list / missing-claim → 403, unset → admits any valid JWT (real RS256 assertions via `jose` + an injected key set). Plus `adminPosture` unit tests.
- [x] 4.3 Health tests: `admin` posture present with correct booleans; `exposed` flips `ok` → 503; the svg renders the `admin` row (gated/exposed) and stays `200`; payload + svg remain tenant-clean (no emails).

## 5. Docs lockstep

- [x] 5.1 `docs/SELF_HOSTING.md` step 6: recommend `ACCESS_ALLOWED_EMAILS`; add a `curl /health` gate-is-live check (`admin.access_configured` / `exposed`); update the `ADMIN_DEV_BYPASS` note to loopback-only.
- [x] 5.2 `docs/ARCHITECTURE.md`: admin gate now does email-allowlist + loopback bypass + health posture (`exposed` → degraded).
- [x] 5.3 `docs/SCHEMAS.md`: added the `admin` section to the `/health` payload and the `admin` row to `/health.svg`; extended the operator-admin surface notes.

## 6. Verify

- [x] 6.1 `aubr typecheck` clean; `aubr test` green (687 passed / 9 skipped live).
- [x] 6.2 `openspec validate "harden-admin-access-gate" --strict` passes.
- [x] 6.3 Host-spoofing of the loopback signal: reasoned through — a deployed Worker only runs for a route that matched its real hostname, so `URL(request.url).hostname` reflects that host, not `localhost`; a forged `Host`/`:authority` can't make production see loopback (and reaching the Worker at all requires a real bound hostname). A live deployed probe is out of scope for this environment; the `/health` `exposed` alarm is the standing backstop if the assumption ever breaks. No dev-signal hardening needed.
