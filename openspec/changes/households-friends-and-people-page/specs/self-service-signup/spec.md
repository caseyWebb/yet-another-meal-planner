## ADDED Requirements

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

## MODIFIED Requirements

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
