## Why

The operator-issued invite code is a **standing, reusable bearer secret**: whoever holds the string can connect their own Claude.ai to a member's tenant *and* sign into the member web app, indefinitely, and the same code works on both surfaces. It is phishable, never expires on its own, and is shared verbatim across two independent auth surfaces. Passkeys replace it with a phishing-resistant, device-bound, non-bearer credential — while keeping the operator's central onboarding and revocation model intact.

## What Changes

- **Passkeys become the durable member credential** on both member-facing auth surfaces. The invite code is demoted to a **single-use bootstrap** that is consumed the moment a passkey is enrolled — it is no longer a standing credential. **BREAKING** (rollout-gated): once an operator turns grace off, legacy standing invite codes stop authenticating anywhere.
- **Member web app (`/login`)** gains discoverable/usernameless passkey login: `residentKey: required`, the passkey user handle is the tenant id, so there is no username field. Enrollment happens from an authenticated session; adding another device is self-service (no operator token) once a member already holds a passkey/session.
- **Claude.ai MCP connect (`/authorize`)** moves from typing an invite code to **cross-device / second-screen approval**. The `/authorize` page (rendered in Claude's OAuth browser) mints a short-lived single-use approval reference, shows a deep link into the web app plus a QR fallback, and polls; the member approves inside the passkey-authenticated web app; approval binds the tenant to the reference server-side; the poll completes the OAuth grant. **The passkey ceremony only ever runs in the web app** — a reliable browser — so no WebAuthn support is required inside Claude's OAuth webview.
- **Invite-code lifecycle**: every issued code becomes single-use and is consumed on passkey enrollment (consumed on *enrollment*, not on login — a member who cannot enroll immediately is nudged, not stranded). A **grace flag** lets existing codes keep working at both `/login` and `/authorize` until each is consumed; turning grace off ends acceptance of legacy standing codes.
- **`rotate()` becomes the permanent recovery primitive**: it issues a fresh single-use bootstrap code that is valid regardless of the grace flag — the lost-all-devices recovery path and the way to admit a never-enrolled member after grace-off.
- **New `webauthn_credentials` D1 table** (one row per device, many per tenant); the WebAuthn signature counter is **stored but never enforced** (synced iCloud/Google passkeys report `0` and would otherwise be rejected). New ephemeral KV state for WebAuthn challenges and MCP approval references (short TTL, mirroring the Kroger PKCE nonce pattern).
- **Out of scope**: the operator admin panel (`/admin`) stays on Cloudflare Access. **Deferred (not in this change)**: same-device inline passkey at `/authorize`, gated on a future empirical test of WebAuthn inside Claude's OAuth webview.

## Capabilities

### New Capabilities
- `passkey-auth`: WebAuthn passkey enrollment and authentication for members — credential registration (discoverable, tenant-bound), passkey login on the web app, the cross-device second-screen approval that authorizes the Claude.ai MCP connection, the `webauthn_credentials` store, and the counter-stored-not-enforced rule.

### Modified Capabilities
- `member-session-auth`: web `/login` accepts a passkey assertion in addition to the (now single-use, grace-gated) invite code; the invite code is consumed on first passkey enrollment.
- `multi-tenancy`: the `/authorize` identity step (in the "Worker is a multi-tenant OAuth 2.1 provider" requirement) changes from invite-code entry to cross-device approval that redeems a passkey-authenticated approval reference, with a grace-gated legacy invite-code fallback; the invite-code identity step becomes a single-use bootstrap. The allowlist gate and per-request re-check remain the live authority (unchanged).
- `operator-admin`: minted invite codes (onboarding) are single-use bootstraps; `rotate()` is defined as the recovery primitive that issues a grace-bypassing single-use bootstrap; member revocation additionally purges the member's `webauthn_credentials`; the operator grace-off control is introduced.
- `member-app-shell`: the "invite code opens the member app" requirement is extended so the login screen also offers passkey sign-in and a first-run enrollment prompt, and the app serves the `/connect` cross-device approval screen.

## Impact

- **Worker (`packages/worker/src/`)**: new passkey module (registration/authentication verification), new `/api` Hono sub-app routes (enroll, passkey login, connect-approval), the `/authorize` handler reworked into the second-screen/poll flow (`authorize.ts`), invite-code consume-on-enrollment + grace logic (`tenant.ts`, `session.ts`, `api/session.ts`), `rotate()`/grace control (`admin.ts`).
- **D1**: new migration `migrations/d1/NNNN_webauthn_credentials.sql`; `src/db.ts` helpers for the new table.
- **KV**: new short-TTL keys for WebAuthn challenges and MCP approval references.
- **Member app (`packages/app/`)**: passkey enrollment UI, passkey-login affordance on `/login`, and the `/connect` approval screen; `packages/ui` primitives as needed.
- **Config/routing**: new routes added to `assets.run_worker_first` in `packages/worker/wrangler.jsonc`; if a new binding type is introduced, it must be added to the deploy merge allowlist (`scripts/merge-wrangler-config.mjs`).
- **Dependencies**: `jose ^6` already present; evaluate `@simplewebauthn/server` (workerd compatibility) vs. hand-rolled WebCrypto COSE verification (decided in `design.md`). Pure-JS / WebCrypto only (`workerd`).
- **Docs (lockstep)**: `docs/ARCHITECTURE.md` (identity model / the two credential paths), `docs/SCHEMAS.md` (new D1 table + KV key shapes), `docs/SELF_HOSTING.md` (final-domain-before-enrollment warning, RP ID choice, member enrollment flow, grace rollout, `rotate()` recovery). `docs/TOOLS.md` only if an MCP tool contract changes (expected: none).
- **Operator sequencing**: the operator sets their **final domain before this ships and before any member enrolls** — the WebAuthn RP ID binds to the domain, so a pre-move enrollment would be stranded. Greenfield here, so domain-first → ship → enroll carries no stranded-credential risk.
- **Tests**: vitest for WebAuthn verification, invite-code single-use/consume-on-enrollment, grace on/off, `rotate()` recovery; member-app Playwright (`app/visual/`, CDP virtual authenticator) for enroll / passkey-login / cross-device-approval. No admin-ui changes.
