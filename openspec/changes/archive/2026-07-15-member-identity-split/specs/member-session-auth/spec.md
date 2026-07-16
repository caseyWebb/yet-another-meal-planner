## MODIFIED Requirements

### Requirement: Invite-code login mints a revocable KV-backed session

The Worker SHALL expose `POST /api/session` taking an invite code, resolved through the existing `resolveInvite` mapping (`invite:<code>` in `TENANT_KV`) — the same operator-issued code that bootstraps the member's Claude.ai connection. Invite resolution SHALL yield a `(tenant, member)` pair: a bootstrap invite record carries its member id, and a record minted before the member-identity split (including a legacy bare-username mapping) SHALL resolve to the founding member (`member = tenant`) under the uniform legacy-defaulting rule. The invite code is a SINGLE-USE BOOTSTRAP, not a standing credential: it authenticates a login while it remains valid, but it is consumed once its member enrolls a passkey (see the `passkey-auth` capability), after which the passkey is the durable credential. On success `POST /api/session` SHALL mint a session record `session:<token>` in `TENANT_KV` (token: at least 256 bits from a cryptographically secure source, never logged; value: the tenant id, the member id, and created/refreshed timestamps; KV `expirationTtl` ~90 days as the single expiry authority), set the session cookie, and return the member's identity. Acceptance of an invite code at login SHALL be governed by the operator grace control (see `operator-admin`): while grace is on, a legacy standing code logs in; once grace is off, only a fresh single-use bootstrap code (e.g. issued by rotation for recovery) is accepted. An unknown code, a code whose tenant is no longer on the allowlist, a code whose member no longer exists, and (when grace is off) a rejected legacy code SHALL all produce the same structured `unauthorized` 401 — no response may distinguish them. Login attempts SHALL be rate-limited per client IP by the shared fixed-window KV limiter (fail-open on KV errors), answering over-limit attempts with a structured `rate_limited` 429.

#### Scenario: A valid bootstrap code logs in bound to its member

- **WHEN** a member POSTs a valid, unconsumed invite/bootstrap code to `/api/session`
- **THEN** a `session:<token>` record holding the resolved tenant id AND member id is written to `TENANT_KV` with a ~90-day TTL, the session cookie is set, and the response returns the member's identity

#### Scenario: A pre-split invite logs in as the founding member

- **WHEN** a login is attempted with an invite record that predates the member-identity split and carries no member field
- **THEN** it resolves to `(tenant, founding member)` and the minted session record carries `member` equal to the tenant id

#### Scenario: Unknown, revoked, and grace-rejected codes are indistinguishable

- **WHEN** a login is attempted with a code that does not exist, a code whose tenant has been removed from the allowlist, a code whose member has been revoked, and — with grace off — a legacy standing code
- **THEN** all attempts receive the same structured `unauthorized` 401 response

#### Scenario: A member re-enters with a passkey, not the code

- **WHEN** a member who has enrolled a passkey returns after their session expired
- **THEN** they sign back in with a passkey assertion (see `passkey-auth`), and their consumed invite code no longer authenticates

#### Scenario: Login attempts are rate-limited

- **WHEN** a client IP exceeds the fixed login-attempt window
- **THEN** further attempts from that IP receive a structured `rate_limited` 429 until the window rolls over, and a KV failure in the limiter itself never blocks a valid login (fail-open)

### Requirement: Session middleware resolves the same Tenant as the MCP path

Session-gated `/api` routes SHALL run a middleware that reads the cookie, loads the session record, and resolves the `(tenant, member)` identity through the SAME shared resolver the MCP path uses — the allowlist re-check on the tenant, the member-liveness check against the `members` table, and the uniform legacy-defaulting rule (a session record without a `member` field, minted before the split, resolves to the founding member) — yielding an identical, normalized identity context (the resolved `Tenant` carrying its member id) and firing the same throttled, best-effort tenant-activity touch (an authenticated app request is genuine member activity). The rolling session-lifetime refresh SHALL re-write the record with its member id, so live legacy sessions converge to the new shape organically. Because the allowlist and member liveness are re-checked on every request, a member removed from the allowlist OR removed from the `members` table SHALL be locked out on their next request even if their session record still exists. Missing, unknown, or unresolvable sessions SHALL produce a structured `unauthorized` 401.

#### Scenario: A session yields the canonical tenant-and-member context

- **WHEN** an authenticated `/api` request arrives
- **THEN** the route handler receives the same normalized identity — resolved tenant plus member — that the MCP path builds, and no route runs without it

#### Scenario: A legacy session record resolves to the founding member and converges

- **WHEN** an authenticated request arrives with a session record that predates the split (no `member` field) and the record is due its throttled refresh
- **THEN** the request resolves to the founding member, and the refreshed record is re-written carrying `member` equal to the tenant id

#### Scenario: Delisting locks out a live session immediately

- **WHEN** a member is removed from the allowlist while holding a valid session cookie
- **THEN** their next `/api` request fails the allowlist re-check and receives a structured `unauthorized` 401, before any session purge runs

#### Scenario: Member-revoke locks out a live session immediately

- **WHEN** a member's `members` row is removed (member-revoke) while their tenant remains allowlisted and their session record still exists
- **THEN** their next `/api` request fails the member-liveness check and receives a structured `unauthorized` 401
