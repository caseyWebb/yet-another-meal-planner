## Why

The operator `/admin` surface mints invite codes and purges every tenant's data, and it is gated by Cloudflare Access verified in-Worker (`requireAccess`, `src/admin.ts`). Two residual holes remain in that gate, both in the "self-hoster mis-set-up Access" story:

1. The Worker verifies the Access JWT's **signature, `aud`, and issuer** but never checks **whose** token it is — it extracts the `email` claim and ignores it. A too-loose Access policy, or a wrong/pasted `ACCESS_AUD`, admits the wrong identity to a full-control surface.
2. The local-dev escape `ADMIN_DEV_BYPASS` fires only in the *no-Access-config* branch — i.e. exactly the "forgot to set up Access" state — and there returns `{status:"ok"}`, so the flag leaking into a deployed Worker means a wide-open admin panel.

And the gate's posture is **invisible**: a misconfiguration is silent until someone tries to use (or abuse) `/admin`. We want to keep the existing reverse-proxy + JWT-assertion-verify mechanism (no OIDC, no generic SSO) and close these holes plus make the posture observable.

## What Changes

- **Email allowlist (optional defense-in-depth).** A new optional non-secret var `ACCESS_ALLOWED_EMAILS` (comma-separated). When set, the verified `email` claim must match (case-insensitive, trimmed) or the request is denied (`403`). When unset, behavior is unchanged (any valid JWT admitted) — but the posture is surfaced on `/health` so "relying on the Access policy alone" is visible, not silent.
- **Disarm the `ADMIN_DEV_BYPASS` footgun.** The dev bypass is gated on a **loopback request host** (`localhost` / `127.0.0.1` / `::1`), so it is structurally inert in any deployed context regardless of the flag; otherwise the surface stays `disabled` (`404`). A loud `console.warn` fires whenever the bypass actually engages.
- **Observable admin posture on `/health` and `/health.svg`.** The gate's no-token disposition is extracted into one pure helper shared by `requireAccess` and `/health`, so the readout cannot drift from the real gate. `/health` gains a tenant-clean `admin` section of booleans (`access_configured`, `email_allowlist`, `dev_bypass_set`, `exposed`); `exposed` (would a tokenless `/admin` request be admitted on a non-loopback host) flips overall `ok` → `/health` returns `503` (riding the existing monitor→alert path). `/health.svg` gains an `admin` row (green `gated` / amber `disabled` / muted `dev` / red `exposed`), with the red `exposed` state kept on the **public** badge as an intentional loud signal.

Non-breaking: every new var is optional; with all unset, behavior is unchanged except the new (safe) `admin` section on the health responses.

## Capabilities

### New Capabilities
<!-- None — this hardens existing capabilities. -->

### Modified Capabilities
- `operator-admin`: the Access gate requirement gains the email-allowlist check and the guarantee that the dev bypass cannot admit in a deployed (non-loopback) context.
- `background-job-health`: the `/health` endpoint and `/health.svg` badge requirements gain the tenant-clean `admin` posture section/row and the `exposed → degraded` (`503` / red) behavior.

## Impact

- **Code:** `src/admin.ts` (allowlist check, loopback-gated bypass, shared no-token disposition helper, warn), `src/health.ts` (admin posture section, `ok` flip on `exposed`, badge admin row; the two health handlers take the request for loopback detection), `src/index.ts` (thread `request` into the health handlers), `src/env.ts` + `.dev.vars.example` (document `ACCESS_ALLOWED_EMAILS`; update `ADMIN_DEV_BYPASS` to loopback-only semantics).
- **Config:** one new optional non-secret var (`ACCESS_ALLOWED_EMAILS`); no new secrets, no new bindings, no new dependency.
- **Docs (lockstep):** `docs/SELF_HOSTING.md` step 6 (recommend the allowlist; note `/health` posture as gate-is-live confirmation; loopback bypass), `docs/ARCHITECTURE.md` (admin gate), `docs/SCHEMAS.md` only if the `/health` payload shape is documented there.
- **Out of scope:** OIDC / Access-for-SaaS / generic SSO (declined; JWT verify suffices), the public recipe site, a dedicated ntfy push on `exposed` (future option), and making the allowlist required.
