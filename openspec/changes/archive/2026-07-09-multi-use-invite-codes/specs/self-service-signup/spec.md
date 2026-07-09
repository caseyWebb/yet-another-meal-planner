## ADDED Requirements

### Requirement: A group invite code admits bounded, self-service account creation

The Worker SHALL support an operator-issued GROUP INVITE CODE that authorizes bounded, self-service account creation. A group invite code SHALL carry a maximum redemption count (a cap), an optional expiry, and an optional operator label. Redeeming a group invite code — only from the member web app — SHALL create a NEW tenant whose id is a username chosen by the redeemer, provided the code has not reached its cap, has not expired, and has not been revoked. A group invite code SHALL NOT grant access to any existing tenant, and SHALL NOT authenticate on the MCP `/authorize` surface; a self-service member connects Claude.ai afterward through the existing cross-device approval (see `multi-tenancy` and `passkey-auth`). A tenant created this way SHALL be placed on the same operator allowlist as an operator-onboarded member and SHALL be subject to the same per-request re-check and revocation. Redemption attempts SHALL be rate-limited per client IP by the shared fixed-window limiter (fail-open on limiter errors), answering over-limit attempts with a structured `rate_limited` 429; the cap and expiry are the standing abuse bounds.

#### Scenario: Redeeming within the cap creates a new tenant

- **WHEN** a visitor redeems a valid group invite code that is below its cap, unexpired, and unrevoked, choosing an available username
- **THEN** the Worker creates a new isolated tenant for that username, places it on the allowlist, and the visitor is signed in as that tenant

#### Scenario: An exhausted, expired, or revoked code creates nothing

- **WHEN** a visitor redeems a group invite code that has reached its cap, passed its expiry, or been revoked
- **THEN** the Worker creates no tenant and rejects the redemption with a uniform structured error

#### Scenario: A group code never authorizes an existing tenant or the MCP surface

- **WHEN** a group invite code is presented at the MCP `/authorize` surface, or a redemption names an already-existing tenant
- **THEN** the Worker does not authorize or resolve any existing tenant and issues no token — a group code only ever creates a new allowlisted identity from an available username

### Requirement: Redemption atomically claims the username and spends one slot

Redemption SHALL claim the chosen username and spend exactly one redemption slot in a SINGLE ATOMIC operation, so the cap is enforced exactly and can never be over-spent under concurrency. If the chosen username is already taken — by an existing tenant (checked against the KV `tenant:<id>` allowlist) or by a concurrent claim (resolved by the strongly-consistent tenant registry; see `multi-tenancy`) — the operation SHALL roll back entirely: no tenant is created and NO slot is spent, and the redeemer SHALL be told the username is taken so they can choose another. Unlike the login surfaces, a "username taken" response is a permitted, deliberate disclosure — tenant ids are not secret within the group — whereas an exhausted, expired, revoked, or unknown code SHALL be rejected uniformly with no oracle. On success the slot is spent and the username is committed together: a new account is never created without spending a slot, and a slot is never spent without creating the account.

#### Scenario: Concurrent redemptions never exceed the cap

- **WHEN** more redemptions of a code are attempted concurrently than the code's remaining slots
- **THEN** exactly the remaining number succeed and the rest are rejected — the recorded used count never exceeds the cap

#### Scenario: A taken username rolls back and spends no slot

- **WHEN** a redemption names a username that is already taken
- **THEN** no tenant is created, the code's used count is unchanged, and the redeemer is told the username is taken

#### Scenario: Slot and account commit together

- **WHEN** a redemption succeeds
- **THEN** the code's used count increments by exactly one and the new tenant exists — and if either the slot spend or the tenant claim cannot commit, neither does

### Requirement: Group invite codes and usage persist in D1, separate from the bootstrap path

Group invite codes, their redemption counts, and their provenance SHALL persist in D1 — a `signup_invites` record keyed by the code (cap, used count, optional expiry, revoked state, optional label, timestamps) and a `signup_redemptions` record linking each created tenant to the code it came from — accessed only through `src/db.ts`, never `env.DB` directly. This store SHALL be SEPARATE from the KV `invite:<code>` single-use bootstrap path used by `onboard()`/`rotate()`, which is unchanged: a group invite code CREATES a tenant, whereas a KV bootstrap code RESOLVES an existing tenant. The two SHALL NOT share a namespace or a redemption path.

#### Scenario: A code's usage is queryable

- **WHEN** the operator surface reads a group invite code
- **THEN** its cap, used count, expiry, revoked state, and label are read from D1

#### Scenario: Provenance records the source code

- **WHEN** a tenant is created through a group invite code
- **THEN** a `signup_redemptions` row links that tenant to the code, so the operator can see which members joined via which code

#### Scenario: The KV bootstrap path is untouched

- **WHEN** the operator onboards or rotates a single named member
- **THEN** a KV `invite:<code>` single-use bootstrap is minted exactly as before, resolving an existing tenant, with no interaction with the D1 group-code store

### Requirement: A self-service account is an ordinary blank tenant with a recovery path

A tenant created by self-service signup SHALL be an ordinary tenant, isolated exactly as an operator-onboarded tenant, and SHALL start EMPTY — no seeded corpus, pantry, or plans. Redemption SHALL mint the standard member session (the same `session:<token>` record and `__Host-` cookie the login path mints; see `member-session-auth`) so the new member is immediately signed in to enroll a passkey. If the member does not complete enrollment, they SHALL remain able to resume from their live session cookie; if that session is lost before any passkey exists, the operator's existing `rotate()` primitive (see `operator-admin`) SHALL issue a single-use bootstrap that re-admits them to enroll. Revoking a group invite code SHALL halt further redemptions but SHALL NOT revoke or alter any account already created through it.

#### Scenario: A new account starts blank and signed in

- **WHEN** a visitor completes self-service signup
- **THEN** they are signed in with the standard session to a blank tenant and are prompted to enroll a passkey

#### Scenario: Half-onboarded recovery via rotate

- **WHEN** a self-service member loses their session before enrolling any passkey
- **THEN** the operator rotates their invite to issue a single-use bootstrap, which the member redeems once at `/login` to sign in and enroll a passkey

#### Scenario: Revoking a code leaves created accounts intact

- **WHEN** the operator revokes a group invite code through which members have already signed up
- **THEN** the code admits no further signups, and every account already created through it keeps its data and access
