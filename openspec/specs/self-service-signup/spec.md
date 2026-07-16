# self-service-signup Specification

## Purpose
TBD - created by archiving change multi-use-invite-codes. Update Purpose after archive.
## Requirements
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

Group invite codes, their redemption counts, and their provenance SHALL persist in D1 — a `signup_invites` record keyed by the code (cap, used count, optional expiry, revoked state, optional label, timestamps) and a `signup_redemptions` record linking each created tenant to the code it came from — accessed only through `src/db.ts`, never `env.DB` directly. The deployment holds THREE deliberately separate invite kinds, distinguished by authority and effect, and they SHALL NOT share a namespace or a redemption path: the KV `invite:<code>` single-use bootstrap (operator-minted; RESOLVES an existing `(tenant, member)` for login; unchanged, used by `onboard()`/`rotate()`), the D1 group invite code (operator-minted; CREATES a standalone tenant, capped), and the D1 `member_invites` link (member-minted; creates a RELATIONSHIP — household membership or a friendship — and an account when the redeemer has none; see `social-graph`). A group invite code CREATES a tenant, a KV bootstrap code RESOLVES an existing member, and a member invite link ATTACHES its redeemer to the inviter's household or befriends their household.

#### Scenario: A code's usage is queryable

- **WHEN** the operator surface reads a group invite code
- **THEN** its cap, used count, expiry, revoked state, and label are read from D1

#### Scenario: Provenance records the source code

- **WHEN** a tenant is created through a group invite code
- **THEN** a `signup_redemptions` row links that tenant to the code, so the operator can see which members joined via which code

#### Scenario: The KV bootstrap path is untouched

- **WHEN** the operator onboards or rotates a single named member
- **THEN** a KV `invite:<code>` single-use bootstrap is minted exactly as before, resolving an existing member, with no interaction with the D1 group-code store or the member-invite store

#### Scenario: The three kinds never cross

- **WHEN** a member invite token is presented to the group-code redemption path or to `/login`, or a group code is presented to `/join/:token`
- **THEN** each path rejects the foreign kind uniformly — no invite kind resolves or redeems on another kind's path

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

### Requirement: Signup forks on member invite links; a link creates the account AND the relationship

The self-service surface SHALL redeem member invite links (`/join/:token` — an SPA route absorbed by the asset fallback with its reads/writes under the existing `/api/*` dispatch; NO new `run_worker_first` entry) as a fork of signup, dispatching on token kind: a HOUSEHOLD-tier link mints a new MEMBER (server-minted ULID id, redeemer-chosen handle validated by the one handle grammar) inside the inviter's existing tenant, subject to the household size bound; a FRIEND-tier link creates a NEW tenant exactly as a group-code signup does PLUS the friendship edge to the inviter's household, committed together. A GROUP code continues to create a standalone tenant and SHALL mint no edge. Redemption SHALL consume the single-use token atomically with what it creates (claim-then-create with a refund on collision, the group-code idiom), mint the standard member-bound session so the redeemer is signed in to enroll a passkey, and be rate-limited per client IP by the shared fixed-window limiter. The token read (`GET`) SHALL return the inviter handle and tier for a valid token, and one uniform `invalid_or_expired` state for unknown, expired, revoked, and already-redeemed tokens. A signed-in redeemer SHALL be routed to the relationship flow instead of account creation: household tier converts to the household-accept flow (member-move rules per `multi-tenancy`), friend tier creates the edge after an explicit confirmation, idempotently when already friends.

#### Scenario: A household link mints a member, not a tenant

- **WHEN** a signed-out visitor redeems a valid household-tier link choosing the handle `grandma_j`
- **THEN** no new tenant is created; a `members` row with a ULID id and handle `grandma_j` exists under the inviter's tenant, the token is consumed in the same operation, and the visitor holds the standard member-bound session with the passkey-enroll prompt

#### Scenario: A friend link mints a tenant plus the edge

- **WHEN** a signed-out visitor redeems a valid friend-tier link choosing the username `bob`
- **THEN** tenant `bob` exists as an ordinary blank self-service tenant AND exactly one friendship edge {`bob`, inviter household} exists, committed together with the token consumption

#### Scenario: Group codes mint no edge

- **WHEN** a visitor signs up with an operator group invite code
- **THEN** a standalone tenant is created exactly as before and the `friendships` table is untouched

#### Scenario: Dead tokens are uniform

- **WHEN** visitors open an unknown token, an expired token, a revoked token, and an already-redeemed token
- **THEN** all four receive the same `invalid_or_expired` response with nothing distinguishing the causes

#### Scenario: A signed-in redeemer gets the relationship, not an account

- **WHEN** an existing member opens a friend-tier link from another household and confirms
- **THEN** no account is created and the friendship edge exists (idempotently if it already did), while a household-tier link routes them into the household-accept flow with its confirmation and floors

