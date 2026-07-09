## 1. D1 atomicity spike + schema

- [x] 1.1 Smoke-test D1 transaction semantics on `workerd`: confirm a `db.batch([...])` (or explicit transaction) runs a guarded `UPDATE ... WHERE used < max` + `INSERT ... ON CONFLICT` + a second `INSERT` as all-or-nothing (a conflicting insert rolls back the whole batch, so no `used` increment persists). Record the outcome in `design.md` Open Questions; if `batch()` can't guarantee it, adopt an explicit transaction wrapper.
- [x] 1.2 Add migration `packages/worker/migrations/d1/0047_self_service_signup.sql`: `tenants(id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, via_code TEXT)`; `signup_invites(code TEXT PRIMARY KEY, max_redemptions INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, expires_at INTEGER, revoked_at INTEGER, label TEXT, created_at INTEGER NOT NULL)`; `signup_redemptions(code TEXT NOT NULL, tenant TEXT NOT NULL, created_at INTEGER NOT NULL)` + an index on `signup_redemptions(code)`. Apply `--local` and confirm.

## 2. Stores (through src/db.ts)

- [x] 2.1 `src/db.ts` helpers for `signup_invites`: create (cap/expiry/label), read-one, list-active-with-usage, revoke (set `revoked_at`). All throw-free (`storage_error`), never touching `env.DB` directly.
- [x] 2.2 `src/db.ts` helper for the atomic redemption transaction (task 1.1 shape): guarded cap decrement + `tenants` insert-on-conflict + `signup_redemptions` insert, returning a discriminated result — `ok` (tenant claimed), `username_taken`, or `code_unusable` (exhausted/expired/revoked/unknown) — so callers never branch on raw D1 errors.
- [x] 2.3 `src/db.ts` helpers for the `tenants` registry: insert-on-conflict claim, exists-check, and an idempotent backfill upsert. Add `tenants` and `signup_redemptions` to the per-tenant purge set (`TENANT_TABLES` in `src/admin.ts`) so member revocation clears a member's `tenants` row and their `signup_redemptions` rows; `signup_invites` is operator-owned, not per-tenant, and is NOT purged on member revoke.

## 3. Signup core + backfill

- [x] 3.1 `src/signup.ts`: `redeemGroupCode(deps, code, chosenUsername)` — normalize the username (`normalizeTenantId`), reject reserved/operator names, reject if present in the KV `tenant:<id>` allowlist, then run the atomic D1 redemption (2.2); on `ok`, write the KV `tenant:<id>` allowlist entry (only after the D1 claim wins) and return the new tenant id. Map every non-`ok` outcome to the structured result the endpoint needs (uniform failure vs the explicit `username_taken`).
- [x] 3.2 Idempotent tenant-registry backfill: a routine that inserts every KV-allowlist tenant into `tenants` (upsert), safe to re-run. Wire it into the existing `scheduled()` reconcile (no new cron); confirm re-running changes nothing.

## 4. Member /api/signup endpoint

- [x] 4.1 New Hono sub-app `src/api/signup.ts` (mounted in `src/api/app.ts`), unauthenticated: `POST /api/signup` takes `{ code, username }`, calls `redeemGroupCode`, and on success mints the standard session (`createSession` + `setSessionCookie`, same as `POST /api/session`) and returns the new tenant identity. Return a distinct `username_taken` result; collapse unknown/exhausted/expired/revoked into one uniform `unauthorized`/`invalid` error (no oracle).
- [x] 4.2 Rate-limit `POST /api/signup` per client IP via `src/rate-limit.ts` (fail-open, `rate_limited` 429); it inherits the global `X-App-Csrf` requirement on non-GET `/api`. Confirm no `run_worker_first` entry is needed (covered by `/api/*`); add an app-suite passthrough representative if the suite asserts per-route.

## 5. Operator admin surface

- [x] 5.1 Lifecycle functions in `src/admin.ts`: `createGroupInvite(deps, { max, expiresAt?, label? })` (mint code, write `signup_invites`, return the code once), `listGroupInvites(deps)` (rows with live usage + provenance summary), `revokeGroupInvite(deps, code)` (set `revoked_at`; does not touch created accounts). Reuse the no-log guarantee from `onboard`.
- [x] 5.2 Admin API routes in `src/admin/api.ts`: `POST /api/invite-codes` (mint), `GET /api/invite-codes` (list with usage + provenance), `POST /api/invite-codes/:code/revoke`. Extend the exported `AdminApp` type consumed by the SPA via `hc`. Covered by the existing `/admin/*` `run_worker_first` entry — no enumeration change.

## 6. Member app — signup screen (packages/app)

- [x] 6.1 A `/signup` client route + screen: code + username fields, submit → `POST /api/signup`, on success land on the app shell and trigger the passkey-enrollment prompt (reuse the existing first-run enrollment path).
- [x] 6.2 A "have a group code?" affordance on `/login` linking to `/signup`; surface `username_taken` inline (choose another) and every other failure as one uniform error message.

## 7. Admin app — Invite codes section (packages/admin-app)

- [x] 7.1 Add an **Invite codes** section to the Members area: a mint dialog (cap required; optional expiry + label), a once-shown minted banner (reusing the members `Banner` show-once pattern), a roster of active codes with live usage (`used/max`, expiry, revoked, label) + provenance, and a revoke action with confirm. Build directly on the shared shadcn/ui + operator theme (one-time design-process exception per `design.md` D10).
- [x] 7.2 Export the built Invite-codes section as the seed for the rebuilt companion Claude Design project (hand the bundle/prompt to the operator); note the export in the PR so the exception is traceable.

## 8. Tests

- [x] 8.1 vitest (Worker): exact cap enforcement incl. concurrent redemptions never exceeding the cap; `username_taken` rolls back and spends no slot; expired/revoked/unknown codes create nothing and stay uniform; a chosen name colliding with an existing KV tenant is rejected pre-write; backfill idempotency; provenance rows written; member revoke purges the `tenants` + `signup_redemptions` rows but leaves `signup_invites`.
- [ ] 8.2 Admin Playwright (`packages/worker/admin/visual/`): new `invite-codes` page object + spec — mint a capped/expiring code (assert the once-shown banner + cap/expiry), list shows usage, revoke opens its confirm. Extend `seed.mjs` with a group-code fixture. Run `aubr test:admin` (web: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) and surface the per-area screenshots.
- [ ] 8.3 App Playwright (`packages/app` app/visual/, CDP virtual authenticator): signup with code + available username → session established → enrollment prompt; taken-username surfaced inline; invalid code fails uniformly.

## 9. Docs (lockstep)

- [x] 9.1 `docs/SCHEMAS.md`: the three new D1 tables (`tenants`, `signup_invites`, `signup_redemptions`) and the KV-bootstrap vs D1-group-code split.
- [x] 9.2 `docs/ARCHITECTURE.md`: tenants gain a strongly-consistent D1 uniqueness registry; the two-invite-systems split (resolve-existing vs create-new); the web-app-only self-service signup path.
- [x] 9.3 `docs/SELF_HOSTING.md`: minting a group code (cap/expiry/label), revoke semantics (halts signups, spares accounts), and the half-onboarded recovery via the session cookie or `rotate()`.
- [x] 9.4 Confirm `docs/TOOLS.md` is unchanged (no agent-facing MCP tool added) and note it in the PR checklist.
