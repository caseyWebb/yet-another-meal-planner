## MODIFIED Requirements

### Requirement: Invite-code login mints a revocable KV-backed session

The Worker SHALL expose `POST /api/session` taking an invite code, resolved through the existing `resolveInvite` mapping (`invite:<code>` → allowlisted username in `TENANT_KV`) — the same operator-issued code that bootstraps the member's Claude.ai connection. The invite code is a SINGLE-USE BOOTSTRAP, not a standing credential: it authenticates a login while it remains valid, but it is consumed once the member enrolls a passkey (see the `passkey-auth` capability), after which the passkey is the durable credential. On success `POST /api/session` SHALL mint a session record `session:<token>` in `TENANT_KV` (token: at least 256 bits from a cryptographically secure source, never logged; value: the tenant id plus created/refreshed timestamps; KV `expirationTtl` ~90 days as the single expiry authority), set the session cookie, and return the member's tenant identity. Acceptance of an invite code at login SHALL be governed by the operator grace control (see `operator-admin`): while grace is on, a legacy standing code logs in; once grace is off, only a fresh single-use bootstrap code (e.g. issued by rotation for recovery) is accepted. An unknown code, a code whose member is no longer on the allowlist, and (when grace is off) a rejected legacy code SHALL all produce the same structured `unauthorized` 401 — no response may distinguish them. Login attempts SHALL be rate-limited per client IP by the shared fixed-window KV limiter (fail-open on KV errors), answering over-limit attempts with a structured `rate_limited` 429.

#### Scenario: A valid bootstrap code logs in

- **WHEN** a member POSTs a valid, unconsumed invite/bootstrap code to `/api/session`
- **THEN** a `session:<token>` record is written to `TENANT_KV` with a ~90-day TTL, the session cookie is set, and the response returns the member's tenant identity

#### Scenario: Unknown, revoked, and grace-rejected codes are indistinguishable

- **WHEN** a login is attempted with a code that does not exist, a code whose member has been removed from the allowlist, and — with grace off — a legacy standing code
- **THEN** all attempts receive the same structured `unauthorized` 401 response

#### Scenario: A member re-enters with a passkey, not the code

- **WHEN** a member who has enrolled a passkey returns after their session expired
- **THEN** they sign back in with a passkey assertion (see `passkey-auth`), and their consumed invite code no longer authenticates

#### Scenario: Login attempts are rate-limited

- **WHEN** a client IP exceeds the fixed login-attempt window
- **THEN** further attempts from that IP receive a structured `rate_limited` 429 until the window rolls over, and a KV failure in the limiter itself never blocks a valid login (fail-open)
