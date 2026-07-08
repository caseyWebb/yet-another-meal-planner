## 1. Verification library + crypto foundation

- [ ] 1.1 Smoke-test `@simplewebauthn/server` on `workerd`: add it to `packages/worker`, import the registration/authentication verifiers, and confirm it bundles and runs under `wrangler dev` + a trivial vitest-workers test. If it fails, fall back to hand-rolled WebCrypto verification (ES256 `-7` + RS256 `-257`, manual CBOR/COSE decode) modeled on the `crypto.subtle` usage in `src/oauth.ts`. Record the outcome in `design.md` Open Questions.
- [ ] 1.2 Decide and pin the RP ID source (exact host vs registrable domain) and origin derivation from the request; add a helper that resolves RP ID + expected origin from the Worker's own host.

## 2. Credential store (D1)

- [ ] 2.1 Add migration `packages/worker/migrations/d1/NNNN_webauthn_credentials.sql`: `webauthn_credentials(tenant TEXT, credential_id TEXT PRIMARY KEY, public_key TEXT/BLOB, sign_count INTEGER, transports TEXT, label TEXT, created_at INTEGER, last_used_at INTEGER)` + `idx_webauthn_tenant ON (tenant)`.
- [ ] 2.2 Add `src/db.ts` (or a `src/webauthn-db.ts` following the `session-db.ts` pattern) helpers: insert credential, list-by-tenant, get-by-credential-id, update counter + `last_used_at`, count-by-tenant, delete-by-tenant. All throw-free (`storage_error`), never touching `env.DB` directly.
- [ ] 2.3 Add `webauthn_credentials` to `TENANT_TABLES` in `src/admin.ts` so revocation purges it in the same batch.

## 3. WebAuthn core module

- [ ] 3.1 `src/webauthn.ts`: registration-options builder (`residentKey: "required"`, `attestation: "none"`, ES256+RS256, user handle = tenant id) and registration verification → the stored credential fields.
- [ ] 3.2 Authentication-options builder (empty `allowCredentials`, discoverable) and assertion verification against a stored public key; return the resolved credential id + updated counter (counter stored, never enforced — see spec).
- [ ] 3.3 Challenge lifecycle in KV: mint single-use `webauthn:chal:<id>` with short TTL, consume-once semantics, deleted on use. Pick the namespace per existing convention (KROGER_KV ephemeral vs TENANT_KV identity-adjacent) and document it.

## 4. Invite-code lifecycle + grace control

- [ ] 4.1 Structure new invite records as JSON `{ tenant, single_use: true, expires_at }` with a KV TTL in `onboard()`/`rotate()` (`src/admin.ts`); make `resolveInvite` (`src/tenant.ts`) parse both the new JSON shape and the legacy bare-string value (backward compatible).
- [ ] 4.2 Add the operator grace control as a Worker `var` in `src/env.ts` + `packages/worker/wrangler.jsonc` (default = on). Confirm a plain `var` needs no `scripts/merge-wrangler-config.mjs` allowlist change (only new binding *types* do); add it there if it does.
- [ ] 4.3 Consume-on-enrollment: on a tenant's first passkey enrollment (0 → 1 credentials), delete every `invite:*` mapping for that tenant (reuse the `deleteInvitesFor` scan from `src/admin.ts`).
- [ ] 4.4 Enforce grace at both login surfaces: a legacy bare-string code is accepted only while grace is on; single-use JSON bootstrap codes are always honored (until consumed/expired) regardless of grace. Keep uniform `unauthorized` errors (no oracle).

## 5. Member `/api` passkey endpoints

- [ ] 5.1 New Hono sub-app `src/api/passkey.ts` (mounted in `src/api/app.ts`): enroll-begin + enroll-finish (both `requireSession`; enroll-finish writes the credential and fires 4.3), passkey-login-begin + passkey-login-finish (unauthenticated; login-finish verifies the assertion, re-checks the allowlist via `resolveTenant`, and mints the session with `createSession` + `setSessionCookie`), and connect-approve (`requireSession`, binds tenant → approval ref).
- [ ] 5.2 Rate-limit passkey-login and connect-approve per IP via `src/rate-limit.ts` (fail-open, `rate_limited` 429); enforce `X-App-Csrf` (already global on non-GET `/api`).
- [ ] 5.3 Add every new route path to `assets.run_worker_first` in `packages/worker/wrangler.jsonc`; add an app-suite passthrough spec representative.

## 6. MCP `/authorize` cross-device approval

- [ ] 6.1 Rework `src/authorize.ts`: on GET, parse the `AuthRequest`, mint a single-use `authz:<ref>` KV record (short TTL) holding the base64 `oauthReqInfo` + `status: "pending"` + a derived short verification code; render a second-screen page (deep link to `/connect?authz=<ref>`, QR encoding, verification code) plus client-side polling. Preserve the malformed-request 400 on GET and POST.
- [ ] 6.2 Add the approval-poll endpoint: on first observing `status: "approved"`, call `env.OAUTH_PROVIDER.completeAuthorization({ request: oauthReqInfo, userId: tenantId, props: { tenantId } })` EXACTLY ONCE (mark the ref consumed), return `redirectTo`; reject expired/consumed refs.
- [ ] 6.3 Keep the grace-gated legacy invite-code fallback on `/authorize` (accepted only while grace is on) so not-yet-enrolled members can still connect during migration.
- [ ] 6.4 Add the poll endpoint path to `assets.run_worker_first`.

## 7. Admin surface

- [ ] 7.1 `onboard()` mints a single-use bootstrap (4.1); response still surfaces the code once, never logged.
- [ ] 7.2 `rotate()` mints a grace-bypassing single-use bootstrap (the recovery primitive); confirm `revoke()` purges `webauthn_credentials` via the `TENANT_TABLES` batch (2.3).

## 8. Member app UI (`packages/app`)

- [ ] 8.1 `/login`: add passkey sign-in (discoverable `navigator.credentials.get()`, empty `allowCredentials`) as the primary affordance; keep invite-code entry as the bootstrap path; keep uniform error copy.
- [ ] 8.2 First-run enrollment prompt after a bootstrap-code login (drives the enroll ceremony against the authenticated session); an account-menu "Add a device" for self-service add.
- [ ] 8.3 New `/connect` route: reads `?authz=<ref>`, shows the requesting client + verification code, and an Approve action (POST to connect-approve). Add any needed `packages/ui` primitives.

## 9. Docs (lockstep)

- [ ] 9.1 `docs/ARCHITECTURE.md`: identity model — the two credential paths (web-app passkey login + cross-device MCP approval) and the invite code as single-use bootstrap.
- [ ] 9.2 `docs/SCHEMAS.md`: the `webauthn_credentials` D1 table, the new invite-record JSON shape, and the new KV key shapes (`webauthn:chal:*`, `authz:*`).
- [ ] 9.3 `docs/SELF_HOSTING.md`: final-domain-before-enrollment warning + RP ID choice, the member enrollment flow, grace rollout + grace-off, and `rotate()` as the recovery path.
- [ ] 9.4 `docs/TOOLS.md`: only if an MCP tool contract changed (expected: no change — verify and note).

## 10. Tests

- [ ] 10.1 vitest (`test/webauthn.test.ts`): registration + assertion verification (valid, tampered, unknown credential), counter stored-not-enforced, challenge single-use.
- [ ] 10.2 vitest: invite-code lifecycle — single-use JSON parsing + legacy bare-string, consume-on-first-enrollment, grace on/off acceptance, `rotate()` recovery bypasses grace.
- [ ] 10.3 vitest: `/authorize` approval flow — ref single-use/expiry, `completeAuthorization` fires exactly once, no-approval → no grant; and revoke purges `webauthn_credentials`.
- [ ] 10.4 Playwright app suite (`app/visual/`, CDP virtual authenticator, `aubr test:app`): enroll → passkey-login round-trip, bootstrap-code login → enrollment prompt, and the `/connect` cross-device approval.

## 11. Finalize

- [ ] 11.1 `aubr typecheck` + `aubr test` + `aubr test:app` green; apply the migration locally (`wrangler d1 migrations apply DB --local`).
- [ ] 11.2 Run `/verify` on the enroll → passkey-login → cross-device-approval flow against local `wrangler dev`.
- [ ] 11.3 `openspec validate "webauthn-passkey-auth" --strict`; run `/code-review` on the branch diff before opening the PR.
