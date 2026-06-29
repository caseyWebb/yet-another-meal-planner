## ADDED Requirements

### Requirement: Feed polling is bounded per tick by a persisted rotation cursor

The sweep SHALL poll the shared `feeds` table in a per-tick **bounded batch** rather than fetching every feed each tick — making real the feed half of the existing "bound work per tick on the external cap via a cursor-swept bounded batch like the flyer warm" requirement (the recipe-page half is already enforced by `fetchMaxPerTick`; the feed fan-out was not). Each tick it SHALL select at most `feedFetchMaxPerTick` feeds, advance a **persisted rotation cursor** so subsequent ticks poll the next feeds, and wrap around — so the **add-only** feed set can grow without the per-tick feed-fetch count exceeding the external-subrequest budget shared with the flyer warm in the same `scheduled()` invocation. `feedFetchMaxPerTick` SHALL be a member of the sweep's tunable `DiscoveryConfig` (operator-overridable like the other per-tick caps), sized so `flyer + recipe-page + feed` external fetches stay within one invocation's budget.

Feeds not polled on a given tick SHALL simply be polled on a later tick (their candidates are discovered later, not lost). The rotation cursor SHALL be **best-effort** ephemeral state: losing it (eviction, cold start) SHALL restart the rotation without incorrectness, because candidate dedup makes a re-poll of an already-evaluated feed a no-op. Feed selection SHALL be **deterministic** given the feed set and the cursor position (a stable ordering) so the selection logic is unit-testable independent of the live feed set and KV.

#### Scenario: More feeds than the per-tick cap are polled across ticks

- **WHEN** the feed set has more entries than `feedFetchMaxPerTick`
- **THEN** a single tick fetches at most `feedFetchMaxPerTick` feeds, advances the cursor, and the remaining feeds are fetched on subsequent ticks

#### Scenario: Rotation wraps to cover every feed

- **WHEN** successive ticks advance the cursor past the end of the feed set
- **THEN** the cursor wraps and every feed is polled within a bounded number of ticks (no feed is starved)

#### Scenario: An added feed is reached within a bounded number of ticks

- **WHEN** a new feed is added to the add-only feed set
- **THEN** the rotation reaches and polls it within a bounded number of ticks rather than only after an unbounded delay

#### Scenario: Losing the cursor does not cause double-imports

- **WHEN** the persisted cursor is lost and the rotation restarts, re-polling recently-polled feeds
- **THEN** candidate dedup (corpus `source_url` / `discovery_rejections` / the discovery log) makes the re-poll a no-op and nothing is imported twice
