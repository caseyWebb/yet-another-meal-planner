## Context

The operator `/admin` surface (operator-admin capability) mints invite codes and purges all per-tenant data. It is the 4th no-tenant surface and is gated by **Cloudflare Access verified in-Worker**: `requireAccess` (`src/admin.ts`) validates the `Cf-Access-Jwt-Assertion` against the team JWKS (signature + `aud` + issuer) as defense-in-depth against the `*.workers.dev` bypass, and `workers_dev:false` removes that bypass hostname. The surface is opt-in and fails closed (`404` when `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` are unset, `403` on a bad/absent assertion). This was a deliberate choice over Access-as-OIDC-in-front (the MCP surface used that first and moved off it so friends needn't join the operator's Access org).

Two residual holes remain — both in the "self-hoster mis-set-up Access" story — and the gate's posture is silent:

1. `requireAccess` extracts the `email` claim (`admin.ts:116`) but never checks it. Security rests entirely on the Access *policy* being scoped to only the operator; a loose policy or a wrong/pasted `ACCESS_AUD` admits the wrong identity.
2. `ADMIN_DEV_BYPASS` is honored exactly in the no-Access-config branch (`admin.ts:106`) — the "forgot Access" state — returning `{status:"ok"}`. `.dev.vars.example` even ships it `="1"`. If that flag reaches a deployed Worker, the admin panel is wide open.

This change keeps the existing reverse-proxy + JWT-assertion-verify mechanism and closes both, plus makes the posture observable.

## Goals / Non-Goals

**Goals:**
- Defense-in-depth on *which* identity the gate admits, without forcing extra setup or risking operator self-lockout.
- Make the `ADMIN_DEV_BYPASS` footgun structurally inert in any deployed context, so "forgot Access" can never become "open admin."
- Surface the gate's posture on `/health` and `/health.svg` so a misconfiguration is loud, not silent — and so the report can never drift from the real gate.

**Non-Goals:**
- OIDC / Access-for-SaaS / generic SSO — explicitly declined; in-Worker JWT verification is sufficient.
- Making the email allowlist required (it stays optional defense-in-depth).
- A dedicated ntfy push on `exposed` — `exposed → 503` already rides the existing monitor→alert path; a per-hit push would need dedup. Future option.
- The public recipe site (public by design).

## Decisions

1. **Email allowlist is OPTIONAL, default-off, and its absence is visible.** A new comma-separated non-secret var `ACCESS_ALLOWED_EMAILS`. Set → the verified `email` claim must match (case-insensitive, trimmed) or `403`. Unset → admit any valid JWT (unchanged), but `/health` reports `email_allowlist: false` so "relying on the Access policy alone" is a visible posture, not a silent gap. *Alternative considered:* required-when-Access-configured (treat as a 3rd Access var, `404` until set). Rejected for v1: it duplicates a correctly-scoped Access policy by mandate, adds setup friction, and `404`-locks an operator who forgets it. Optional + visible matches the repo's "emit truthful state; decide policy outside" stance, and is trivially upgradeable to required later.

2. **The dev bypass is gated on a loopback request host.** `ADMIN_DEV_BYPASS` is honored only when `URL(request.url).hostname` is `localhost` / `127.0.0.1` / `::1`, so it is structurally inert in any deployed context regardless of the flag; otherwise the surface stays `disabled` (`404`). A `console.warn` fires whenever the bypass engages, so even local use is loud. This removes the "flag leaks to prod = open admin" failure entirely for the realistic fat-finger case, while keeping `wrangler dev` (which serves on `localhost`) working.

3. **One shared gate-disposition helper feeds both the gate and `/health`.** The "what do we do for a request with no valid token" decision (`gated` / `dev-bypass` / `disabled`) is extracted into a pure `adminGateDisposition(env, { isLoopback })`. `requireAccess` calls it with the request's real host; `adminPosture(env)` calls it with `isLoopback: true` to ask "*could* the bypass admit here?" — true exactly when the bypass is set without Access. Because both go through the one helper, a future edit that drops the loopback guard flips the gate **and** `exposed` together — the report cannot drift from the gate. Crucially this makes the posture a pure function of `env`: `/health` needs no request, so `buildHealthPayload` and the two health handlers keep their existing signatures (no threading, no churn in their callers/tests).

4. **`exposed` degrades health; the public red badge is an intentional signal.** `exposed` (the dev bypass is set on a surface Access doesn't protect — the only safeguard is then the loopback guard) flips overall `ok` → `/health` returns `503` (existing monitor→alert path) and the `/health.svg` `admin` row plus headline render red (the svg still returns `200`, per its existing image-proxy rule). The loopback guard means the panel itself is still `404` on a deployed host, but the configuration is alarm-worthy, so health degrades to surface the mistake — this also catches a code regression that removes the guard (then the gate genuinely opens and `exposed` is already firing). **Keeping the red `exposed` state on the public badge is deliberate, not a leak:** it fails loud precisely during the empty-panel setup window — before the operator has trusted the panel with anything sensitive — the cheapest possible time to catch the misconfig; and an attacker learns nothing they couldn't get by simply requesting `/admin`. *Alternative considered:* hide posture on the public badge / only show it on JSON `/health`. Rejected — the loud public signal is the point.

5. **Posture is booleans only; never the emails.** The `/health` `admin` section and the svg `admin` row carry only booleans (`access_configured`, `email_allowlist`, `dev_bypass_set`, `exposed`) and a coarse state word — never the allowlisted addresses — preserving the endpoint's tenant-data-free, safe-to-expose invariant.

## Risks / Trade-offs

- **[Host-spoofing the loopback signal]** — if a deployed Worker can be tricked (e.g. a forged `Host`) into seeing a `localhost`/`127.0.0.1`/`::1` URL host, the loopback gate could be defeated *when the bypass flag is also set*. → **Mitigation:** apply-time verification that a deployed Worker cannot see a loopback `request.url` host; if it can, harden the dev signal (e.g. additionally gate on `request.cf` absence, or drop the env bypass). The `/health` `exposed` alarm + `503` is the backstop regardless, so any residual exposure is loud rather than silent.
- **[Public badge advertises a misconfig]** — the red `exposed` state is visible to anyone. → **Accepted** (Decision 4): the exposure is discoverable by hitting `/admin` anyway; the signal is operator-facing and most valuable before the panel holds anything.
- **[Drift between the health report and the real gate]** — a posture readout that lies is worse than none. → **Mitigation:** Decision 3's single shared helper makes the report and the gate the same code path.
- **[Allowlist case/format mismatch locks out the operator]** — an email-claim casing or whitespace mismatch could `403` a legitimate operator. → **Mitigation:** case-insensitive, trimmed comparison; the allowlist is opt-in, so the default path is unaffected, and `/health` shows `email_allowlist: true` to confirm it's active.

## Migration Plan

Purely additive; no data migration, no new binding, no new secret. Order:

1. Ship the Worker changes (`requireAccess` allowlist + loopback bypass + shared disposition helper; `adminPosture` on `/health` + `/health.svg`, env-only so no handler signature change) and tests.
2. Update docs in lockstep (`SELF_HOSTING` step 6, `ARCHITECTURE`, `SCHEMAS` if the health shape is documented; no `TOOLS.md` change).
3. Deploy. Existing deployments are unaffected (all new vars optional; default behavior unchanged except the new safe `admin` section on health responses).
4. Operators optionally set `ACCESS_ALLOWED_EMAILS` and can confirm gate posture via `curl /health | jq .admin`.

Rollback: revert the Worker change; no persisted state depends on it.

## Open Questions

- **Loopback host robustness** (carried from Risks): confirm at apply time whether a deployed Worker can ever see a loopback `request.url` host. If yes, choose the hardened dev signal then. Does not block the proposal — the `exposed` alarm covers it.
