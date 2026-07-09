# passkey-auth Specification

## Purpose
TBD - created by archiving change webauthn-passkey-auth. Update Purpose after archive.
## Requirements
### Requirement: Passkey enrollment binds a discoverable credential to a tenant

An authenticated member SHALL be able to enroll a WebAuthn passkey bound to their tenant. Enrollment SHALL require an already-established session (bootstrap-code or passkey), so the enrolling identity is the resolved tenant. The registration ceremony SHALL request a discoverable credential (`residentKey: "required"`) whose user handle is the member's canonical tenant id, SHALL use `attestation: "none"`, and SHALL support at least the ES256 (`-7`) and RS256 (`-257`) algorithms. On successful verification the Worker SHALL persist one `webauthn_credentials` row keyed by the credential id (public key, initial signature counter, transports, an optional label, timestamps), scoped to the tenant. A member MAY hold multiple credentials (multiple devices); enrolling an additional credential while already authenticated SHALL NOT require an operator-issued code. The member's FIRST successful enrollment (transition from zero to one credential) SHALL consume every invite mapping resolving to that tenant, so the bootstrap code stops authenticating once a passkey exists.

#### Scenario: An authenticated member enrolls a passkey

- **WHEN** a member with a valid session completes the registration ceremony
- **THEN** a `webauthn_credentials` row is written for their tenant with the credential id, public key, and initial counter, and the response confirms enrollment

#### Scenario: First enrollment consumes the bootstrap code

- **WHEN** a member enrolls their first passkey while an `invite:*` mapping to their tenant still exists
- **THEN** every invite mapping resolving to that tenant is deleted, and that code no longer authenticates on any surface

#### Scenario: Adding a second device needs no operator code

- **WHEN** a member who already holds a passkey enrolls another credential from an authenticated session
- **THEN** a second `webauthn_credentials` row is written for the same tenant and no operator-issued code is required

#### Scenario: Enrollment requires a session

- **WHEN** an unauthenticated request attempts to begin or complete enrollment
- **THEN** the Worker rejects it with a structured `unauthorized` 401 and writes no credential

### Requirement: Passkey authentication signs a member into the web app

The Worker SHALL expose a passkey login ceremony on the member `/api` surface that authenticates a member from a discoverable-credential assertion with no username supplied (empty `allowCredentials`). The Worker SHALL issue a single-use challenge, verify the returned assertion against the stored public key for the asserted credential id, resolve the credential's tenant, re-check that tenant against the allowlist, and on success mint the SAME `session:<token>` record and `__Host-` cookie the bootstrap-code path mints. A failed or unverifiable assertion, an unknown credential id, and a credential whose tenant is no longer allowlisted SHALL all produce the same structured `unauthorized` 401 — no response may distinguish them. Passkey login attempts SHALL be rate-limited per client IP by the shared fixed-window limiter (fail-open), answering over-limit attempts with a structured `rate_limited` 429.

#### Scenario: A registered passkey logs in

- **WHEN** a member completes the passkey assertion for a credential enrolled to an allowlisted tenant
- **THEN** the assertion is verified against the stored public key, a `session:<token>` record and `__Host-` cookie are minted, and the response returns the member's tenant identity

#### Scenario: Failure modes are indistinguishable

- **WHEN** login is attempted with an unverifiable assertion, an unknown credential id, and a credential whose tenant has been delisted
- **THEN** all three receive the same structured `unauthorized` 401

#### Scenario: Passkey login is rate-limited

- **WHEN** a client IP exceeds the fixed login-attempt window
- **THEN** further attempts receive a structured `rate_limited` 429, and a limiter KV failure never blocks a valid login (fail-open)

### Requirement: The WebAuthn signature counter is stored but never enforced

The Worker SHALL persist the authenticator signature counter returned on each assertion but SHALL NOT reject an assertion because the counter failed to advance. Synced passkeys report a zero or non-incrementing counter, so counter regression SHALL NOT be treated as a cloning signal that blocks login.

#### Scenario: A non-incrementing counter still authenticates

- **WHEN** a valid assertion arrives whose signature counter is zero or not greater than the stored value
- **THEN** the login succeeds and the stored counter is updated to the asserted value

### Requirement: The Claude.ai connection is authorized by cross-device approval

Authorizing the Claude.ai MCP connection SHALL NOT require a passkey ceremony inside Claude's OAuth browser. On a valid `GET /authorize`, the Worker SHALL mint a short-lived, single-use approval reference (stored in KV with a TTL on the order of minutes, holding the parsed OAuth request), render a page offering a deep link to the member web app's `/connect` screen carrying the reference, a scannable QR encoding of that link, and the full link shown for copying to another device, display a short human-readable verification code, and poll for approval. A passkey-authenticated member opening `/connect` for that reference SHALL see the same verification code and the requesting client, and on approval the Worker SHALL bind the approving member's tenant to the reference server-side. Once approved, the Worker SHALL complete the OAuth authorization EXACTLY ONCE for that reference — issuing the grant with the bound tenant in its props — and redirect the client back. An unapproved reference SHALL NOT complete; an expired or already-consumed reference SHALL be rejected.

#### Scenario: Member approves the connection from the web app

- **WHEN** a member opens the `/connect` deep link for a pending reference, confirms the matching verification code, and approves while holding a passkey session
- **THEN** their tenant is bound to the reference, the polling `/authorize` page completes the OAuth grant with that tenant in its props, and the client is redirected back

#### Scenario: The approval reference is single-use and expiring

- **WHEN** an approval reference is redeemed a second time, or after its TTL has elapsed
- **THEN** the Worker rejects it and completes no additional authorization

#### Scenario: No approval, no grant

- **WHEN** the `/authorize` page polls a reference that no member has approved
- **THEN** no OAuth grant is issued and no token is minted

### Requirement: Passkey credentials persist in a per-tenant D1 table

The Worker SHALL store enrolled passkeys in a `webauthn_credentials` D1 table with the credential id as the primary key and a `tenant` column, one row per device, accessed only through `src/db.ts` (never `env.DB` directly). Multiple rows MAY share a tenant. The table SHALL be included among the per-tenant tables purged on member revocation.

#### Scenario: Credentials are tenant-scoped rows

- **WHEN** a member enrolls passkeys on two devices
- **THEN** two rows exist in `webauthn_credentials` with the same `tenant` and distinct credential ids

#### Scenario: Revocation purges a member's credentials

- **WHEN** the operator revokes a member
- **THEN** all `webauthn_credentials` rows for that tenant are deleted

