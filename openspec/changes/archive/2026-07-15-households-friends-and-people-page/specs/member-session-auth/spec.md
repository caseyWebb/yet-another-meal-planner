## ADDED Requirements

### Requirement: Member-move re-keys live sessions atomically with the move

When a member moves households (the member-move primitive — leave, eviction, or household-accept), every live `session:*` record resolving to that member SHALL be re-written to carry the new tenant in the same operation, using the same KV session-scan idiom the revoke paths use and the same legacy-defaulting match (a pre-split record with no `member` field belongs to the founding member). A session record whose stored tenant disagrees with the member's current `members` row SHALL NOT resolve: the shared resolver's member-liveness check requires the `(id, tenant)` pairing, so a missed or raced record produces a structured `unauthorized` 401 rather than serving either household's context. Join-link redemption (see `self-service-signup`) SHALL mint the standard member-bound session exactly as signup does.

#### Scenario: A mover stays signed in

- **WHEN** a member with a live web session completes a household move
- **THEN** their session record now carries the new tenant, and their next `/api` request resolves in the new household with no re-login

#### Scenario: A stale tenant pairing never resolves

- **WHEN** a session record still carrying the old tenant is replayed after its member's move (a raced or missed re-write)
- **THEN** the request fails the resolver's `(id, tenant)` member-liveness pairing and receives a structured `unauthorized` 401 — it is never served in the old household's context
