## Context

Today one credential — an operator-issued invite code — authenticates a member on both member-facing surfaces:

- **Web app (`/login`)**: `POST /api/session` resolves `invite:<code>` → username via `resolveInvite` (`src/tenant.ts`), mints a 256-bit random session token in `TENANT_KV` (`session:<token>`) behind a `__Host-` cookie (`src/session.ts`), and `requireSession` re-checks the allowlist on every request.
- **Claude.ai MCP connect (`/authorize`)**: `handleAuthorize` (`src/authorize.ts`) renders an HTML consent form, resolves the same invite code, and calls `env.OAUTH_PROVIDER.completeAuthorization({ userId: tenantId, props: { tenantId } })`. The `@cloudflare/workers-oauth-provider` then owns `/token`, `/register`, discovery, and validates the bearer token on `/mcp`; `resolveTenant` re-checks the allowlist before any tool runs.

The invite code is a reusable bearer secret with no self-expiry, shared verbatim across both surfaces. Identity is flat: a *tenant is a person* (a username); there is no sub-tenant identity. The admin panel (`/admin`) is separately gated by Cloudflare Access and is out of scope here.

Constraints: the Worker runs on `workerd` — pure JS / WebCrypto only, no Node internals. `jose ^6` is already a dependency (Access JWT verification). Three KV namespaces exist: `OAUTH_KV` (provider store), `TENANT_KV` (`tenant:*` allowlist + `invite:*` + `session:*`), `KROGER_KV` (ephemeral infra incl. the Kroger PKCE nonce). All per-tenant relational data is D1, isolated by a `tenant` column.

## Goals / Non-Goals

**Goals:**
- Make a passkey the durable member credential; demote the invite code to a single-use bootstrap so no standing bearer secret remains after migration.
- Cover both member surfaces (web `/login` and Claude.ai `/authorize`) without depending on WebAuthn running inside Claude's OAuth browser.
- Preserve the existing identity model (tenant = person; allowlist re-check as the live authority) and revocation semantics.
- Ship behind a grace period so existing members migrate organically, with an operator-controlled hard cutover and an operator recovery path.

**Non-Goals:**
- Passkeys / any change to the operator admin panel — `/admin` stays on Cloudflare Access.
- Same-device inline passkey at `/authorize` (deferred; needs an empirical test of WebAuthn inside Claude's OAuth webview).
- Per-device or sub-tenant identity beyond "N credentials belong to one tenant."
- Attestation / device-provenance verification (`attestation: "none"` — the friend-group trust model doesn't need it).

## Decisions

### D1 — MCP `/authorize` uses cross-device (second-screen) approval, not inline WebAuthn

The `/authorize` page renders inside whatever browser Claude.ai opens for OAuth consent — reliably capable on web/desktop, uncertain in the mobile app's webview. Rather than gamble the security goal on that:

- `GET /authorize` parses the `AuthRequest` (as today), mints a short-lived **approval reference** (`authz:<ref>` in KV, ~5 min TTL) holding the base64 `oauthReqInfo` and `status: "pending"`, and renders a page with a **deep link** to `https://<domain>/connect?authz=<ref>` (plus a QR fallback) and client-side polling.
- In the web app, `/connect?authz=<ref>` requires a passkey-authenticated session, shows "Connect Claude.ai?", and on approval `POST`s to an authenticated endpoint that binds the approving member's `tenantId` to the reference (`status: "approved"`).
- The poll endpoint, on first observing `approved`, calls `completeAuthorization({ request: oauthReqInfo, userId: tenantId, props: { tenantId } })`, marks the reference consumed, and returns `redirectTo`; the `/authorize` page navigates there.

**Why:** the passkey ceremony runs only in the web app (a reliable browser), so the webview-WebAuthn unknown is *dissolved*, not worked around. **Alternatives considered:** (a) inline `navigator.credentials.get()` on the `/authorize` page — rejected, hostage to webview support and would need a bearer fallback that reopens the hole; (b) a typed ephemeral ticket pasted into `/authorize` — works and kills the standing secret, but worse UX and still one manual secret in flight. The approval reference is opaque and useless without an authenticated approval, so exposure in a deep link/QR is not a credential leak. `completeAuthorization` is guarded to fire exactly once per reference.

### D2 — Discoverable, usernameless passkeys; user handle = tenant id

Registration uses `residentKey: "required"` / `userVerification: "preferred"`, with the WebAuthn user handle set to the tenant id. `/login` and `/connect` then call `navigator.credentials.get()` with an empty `allowCredentials`, and the browser account-picker resolves which member is signing in.

**Why:** maps cleanly onto tenant = person, needs no username field, and matches the existing single-field login ergonomics. **Alternative:** non-discoverable credentials keyed by a typed username — rejected (reintroduces a username field and a lookup step for no benefit here).

### D3 — Credentials in D1, ephemeral ceremony state in KV

New table `webauthn_credentials(tenant, credential_id PRIMARY KEY, public_key, sign_count, transports, label, created_at, last_used_at)` — one row per device, many per tenant, indexed by `tenant`. WebAuthn challenges (`webauthn:chal:<id>`) and MCP approval references (`authz:<ref>`) live in KV with short TTL.

**Why:** the credential set is durable relational per-tenant data (D1's tier; strong read-after-write for the counter/last-used writes on every auth), while challenges/references are ephemeral infra (KV's tier — the same shape as the Kroger PKCE nonce). Credential-store reads/writes go through `src/db.ts` (throw-free `storage_error` mapping), never `env.DB` directly. **Alternative:** everything in KV — rejected; KV's eventual consistency is a poor fit for the per-auth counter/last-used writes and the credential-list read.

### D4 — Store the signature counter, never enforce it

Persist `sign_count` for diagnostics but do not reject an assertion when it fails to advance. Synced passkeys (iCloud Keychain, Google Password Manager) report `0` and never increment; enforcing would reject legitimate logins. This matches current WebAuthn guidance for synced credentials.

### D5 — The invite code becomes a single-use bootstrap; grace governs legacy codes

- Invite records become structured (`invite:<code>` → JSON `{ tenant, single_use: true, expires_at }`) for codes issued going forward, with a KV TTL; `resolveInvite` parses both the new JSON shape and the legacy bare-string value (backward compatible).
- **Consume on enrollment, not login:** a member's *first* passkey enrollment (0 → 1 credentials) deletes every `invite:*` mapping for that tenant (the existing `deleteInvitesFor` scan in `src/admin.ts`). A member who logs in but doesn't enroll keeps a working code; the standing secret dies only once a passkey exists.
- **Grace flag** (a Worker `var`, default = on): while on, `/login` accepts a legacy invite code (mints a session as today) and `/authorize` offers a legacy invite-code fallback alongside the cross-device approval, so not-yet-enrolled members keep working during migration. Turning it off rejects **legacy bare-string** codes everywhere; **single-use JSON bootstrap** codes are always honored (until consumed/expired) regardless of the flag.

**Why a `var`, not admin UI or a D1 flag:** keeps the admin panel out of scope (no admin-ui Playwright work) and needs no new binding type. **Alternative:** an `operator_config` column toggled from `/admin` — more ergonomic (runtime flip) but pulls the admin panel into scope; deferred.

### D6 — `rotate()` is the recovery primitive that bypasses grace

`rotate()` (`src/admin.ts`) issues a fresh single-use JSON bootstrap code. Because single-use codes are honored regardless of the grace flag, `rotate()` is both the lost-all-devices recovery path and the way to admit a never-enrolled member after grace-off: the member redeems it at `/login` to mint a session **solely to enroll a passkey**, which consumes the code. `onboard()` issues the same single-use shape for new members.

### D7 — WebAuthn verification library

**Recommendation: use `@simplewebauthn/server`, pinned to a verified workerd-compatible version, with a hand-rolled WebCrypto fallback as the contingency.** Recent `@simplewebauthn/server` releases are isomorphic (WebCrypto-based, no hard Node-crypto dependency) and encapsulate the fiddly CBOR/COSE/clientDataJSON parsing that is easy to get subtly wrong. The very first implementation task verifies it imports, bundles, and runs under `wrangler dev` / vitest-workers; if it does not, fall back to hand-rolled WebCrypto verification supporting ES256 (`-7`) and RS256 (`-257`) with manual CBOR/COSE decode. **Why not hand-roll by default:** WebAuthn verification is security-critical and error-prone; a maintained library is the safer default when it runs on the platform. This is a code-compatibility question resolved during implementation (typecheck + smoke test), not from production data.

## Risks / Trade-offs

- **[WebAuthn library may not run on workerd]** → D7's first task is a bundle/smoke test; hand-rolled WebCrypto ES256/RS256 verification is the ready fallback (Kroger PKCE already uses `crypto.subtle` in `src/oauth.ts`).
- **[RP ID binds to the domain — a later domain change strands every credential]** → operator sets the final domain *before* shipping and before any enrollment (greenfield here, so no existing credentials); `SELF_HOSTING.md` documents this and the RP-ID choice (exact host vs registrable domain).
- **[Grace-off could lock out a never-enrolled or lost-device member]** → `rotate()` issues a grace-bypassing single-use bootstrap; documented as the recovery path. The operator is reachable in the friend-group model.
- **[Cross-device approval is a second-screen flow — a member could approve the wrong pending connection]** → the `/connect` screen names the requesting client and expires the reference in ~5 min; the reference is single-use; approval is CSRF-guarded (`X-App-Csrf`) and requires an authenticated session.
- **[New Worker routes silently swallowed if not enumerated]** → every new route (enroll, passkey-login, connect-approve, `/authorize` poll) is added to `assets.run_worker_first` in `wrangler.jsonc`; app-suite passthrough specs guard representatives.
- **[Login/approval endpoints are new brute-force / oracle surfaces]** → reuse `src/rate-limit.ts` (fixed-window per IP, fail-open) on passkey login, enrollment, and connect-approval; keep uniform structured errors (no distinguishing unknown vs revoked vs no-passkey).
- **[Approval reference or challenge replay]** → single-use + short TTL; `completeAuthorization` fires exactly once per reference; challenges are one-shot and deleted on use.

## Migration Plan

1. Operator moves to their **final domain** (before merge/deploy); pick the RP ID (exact host vs registrable domain).
2. Deploy with **grace on** (default). Apply the `webauthn_credentials` migration `--remote`. Nothing breaks: existing invite codes still authenticate on both surfaces.
3. Members migrate organically — on web login they are prompted to enroll a passkey; first enrollment consumes their invite code. Enrolled members thereafter use passkey login + cross-device MCP approval.
4. Once the roster shows every member enrolled (admin Members view already surfaces active/pending), the operator flips **grace off** (`var` + redeploy). Legacy standing codes stop authenticating; only passkeys + single-use bootstrap codes remain.
5. Recovery/late members: `rotate()` issues a grace-bypassing single-use bootstrap.

**Rollback:** flip grace back on (or revert the `var`) to restore invite-code authentication; the `webauthn_credentials` table and passkey endpoints are additive and can lie dormant. No destructive data change.

## Open Questions

- **Grace-flag home** — Worker `var` (recommended, admin-out-of-scope) vs. a runtime-toggleable `operator_config` column. Defaulting to `var` unless the operator wants a runtime flip without redeploy.
- **RP ID granularity** — exact host vs registrable domain; the operator decides with their final-domain choice (documented, not code-blocking).
- **`@simplewebauthn/server` workerd compatibility** — resolved by the first implementation task (smoke test); fallback is specified.
- **Deep-link scheme for `/connect`** — plain HTTPS deep link (works everywhere, opens the PWA if installed) is the default; a custom scheme is unnecessary.
