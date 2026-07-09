## MODIFIED Requirements

### Requirement: Identity is gated by a curated allowlist

Completing the OAuth authorization SHALL require the authenticating identity to be on an operator-curated allowlist; this is self-hosting for a known group, not open public registration. An identity not on the allowlist SHALL be denied authorization and SHALL NOT be issued a tenant token. The allowlist SHALL be operator-maintained: an identity joins it either by operator onboarding or by redeeming an operator-issued GROUP INVITE CODE (see `self-service-signup`) — a bounded, operator-authorized form of self-service that is capped, expiring, and revocable, NOT open registration. However an identity is admitted, every tenant SHALL be subject to the same per-request allowlist re-check and the same revocation. A group invite code authorizes the creation of a new allowlisted identity from an available username; it is not itself a standing credential and SHALL NOT grant access to any existing tenant.

#### Scenario: Allowlisted identity is admitted

- **WHEN** an identity on the allowlist completes the authorization flow
- **THEN** it is granted a tenant token mapped to that identity

#### Scenario: Unknown identity is denied

- **WHEN** an identity not on the allowlist attempts to authorize
- **THEN** the Worker denies the authorization and issues no token

#### Scenario: A group invite code admits a new bounded identity

- **WHEN** a visitor redeems a valid, non-exhausted, unexpired, unrevoked group invite code and chooses an available username
- **THEN** a new allowlisted tenant is created for that username and is thereafter resolved and re-checked exactly like any operator-onboarded tenant; a code that is exhausted, expired, or revoked adds no identity

## ADDED Requirements

### Requirement: Tenant ids are unique under concurrent self-service creation

The Worker SHALL guarantee tenant-id uniqueness even when identities are created concurrently through self-service signup. Tenant ids SHALL have a strongly-consistent registry in D1 (a `tenants` table keyed by the canonical lowercase id) that is the uniqueness authority: a self-service claim SHALL insert into this registry and SHALL fail if the id already exists, so two simultaneous claims of the same new username resolve to exactly one winner and the other is rejected. A self-service claim SHALL additionally reject an id already present in the KV `tenant:<id>` allowlist, so a chosen username can never collide with an already-onboarded member even before the registry is fully populated. The KV `tenant:<id>` allowlist directory SHALL remain the hot-path resolution authority and SHALL be written only after the registry claim wins. Existing tenants SHALL be backfilled into the registry so it is the complete record going forward; the backfill SHALL be idempotent and SHALL converge existing members with no operator action and no manual data surgery.

#### Scenario: Concurrent same-username claims yield exactly one tenant

- **WHEN** two visitors simultaneously redeem group codes and both choose the previously-unused username `bob`
- **THEN** the D1 registry admits exactly one of them, the other is rejected as taken, and only one `tenant:bob` allowlist entry is ever written

#### Scenario: A chosen username cannot collide with an existing member

- **WHEN** a self-service redemption chooses a username equal to an already-onboarded tenant id
- **THEN** the claim is rejected before any allowlist or registry write, and no slot is spent

#### Scenario: The registry backfill is idempotent

- **WHEN** the tenant-registry backfill runs over the existing KV allowlist, including more than once
- **THEN** every existing tenant appears exactly once in the registry and re-running the backfill changes nothing
