## 1. Admin gate hardening (`src/admin.ts`)

- [ ] 1.1 Add a `isLoopbackHost(request)` helper matching `localhost` / `127.0.0.1` / `::1` (and bracketed `[::1]`) from `URL(request.url).hostname`.
- [ ] 1.2 Extract the no-token gate decision into a pure `adminGateDisposition(env, { isLoopback })` returning `gated` / `disabled` / `dev-bypass` / `exposed`, so both `requireAccess` and `/health` share one source of truth.
- [ ] 1.3 In `requireAccess`, gate `ADMIN_DEV_BYPASS` on `isLoopbackHost(request)` (inert otherwise → `disabled`), and `console.warn` when the bypass engages.
- [ ] 1.4 In `requireAccess`, after JWT verification, when `ACCESS_ALLOWED_EMAILS` is set require the verified `email` claim to be on the list (case-insensitive, trimmed); otherwise `denied` (403). Unset → admit (unchanged). Parse the list once (split on comma, trim, lowercase, drop empties).
- [ ] 1.5 Confirm `handleAdmin` still maps `disabled → 404`, `denied → 403`, `ok → serve`, with the new paths flowing through unchanged.

## 2. Health posture (`src/health.ts`, `src/index.ts`)

- [ ] 2.1 Add an `AdminPosture` shape (`access_configured`, `email_allowlist`, `dev_bypass_set`, `exposed`: all booleans) to `HealthPayload`.
- [ ] 2.2 Compute the posture from `env` + the request host via the shared `adminGateDisposition` helper (`exposed` = would-admit-tokenless on a non-loopback host); never include the allowlisted addresses.
- [ ] 2.3 Make overall `ok` false when `admin.exposed` is true (alongside the existing job-failure / D1-probe conditions).
- [ ] 2.4 Thread the `request` into `handleHealthRequest` and `handleHealthSvgRequest` (and `buildHealthPayload`), and update the `src/index.ts` call sites to pass `request`.
- [ ] 2.5 In `renderHealthSvg`, add an `admin` row: green `gated` / amber `disabled` / muted `dev` / red `exposed`, and render the headline degraded when `exposed`; keep the svg at `200` in all states and tenant-clean.

## 3. Config + env documentation (`src/env.ts`, `.dev.vars.example`)

- [ ] 3.1 Add `ACCESS_ALLOWED_EMAILS?: string` to `Env` with a doc comment (optional, non-secret, comma-separated; unset → admit any valid JWT).
- [ ] 3.2 Update the `ADMIN_DEV_BYPASS` doc comment to the loopback-only semantics (inert in any deployed context).
- [ ] 3.3 Update `.dev.vars.example`: note the loopback requirement for `ADMIN_DEV_BYPASS` and add a commented `ACCESS_ALLOWED_EMAILS` example.

## 4. Tests

- [ ] 4.1 `test/admin.test.ts`: dev bypass serves on a loopback host; is inert (→ `disabled`/404) on a non-loopback host even with the flag set.
- [ ] 4.2 `test/admin.test.ts`: email allowlist — in-list admits, off-list / missing-claim → 403, unset → admits any valid JWT (existing paths still pass).
- [ ] 4.3 Health tests: `admin` posture present in the payload with correct booleans; `exposed` flips `ok` → 503; the svg renders the `admin` row and stays `200`; payload + svg remain tenant-clean (no emails).

## 5. Docs lockstep

- [ ] 5.1 `docs/SELF_HOSTING.md` step 6: recommend `ACCESS_ALLOWED_EMAILS`; note `/health` admin posture as the gate-is-live confirmation; update the `ADMIN_DEV_BYPASS` note to loopback-only.
- [ ] 5.2 `docs/ARCHITECTURE.md`: admin gate now does email-allowlist + loopback bypass + health posture.
- [ ] 5.3 `docs/SCHEMAS.md`: add the `admin` section to the `/health` payload **only if** the health shape is documented there (skip otherwise).

## 6. Verify

- [ ] 6.1 `aubr typecheck` and `aubr test` green; rebuild the admin SVG-affecting paths are covered.
- [ ] 6.2 `openspec validate "harden-admin-access-gate" --strict` passes.
- [ ] 6.3 Apply-time: verify a deployed Worker cannot see a loopback `request.url` host (Host-spoofing); if it can, harden the dev signal per design Open Questions before deploy.
