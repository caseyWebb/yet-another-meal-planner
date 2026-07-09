## MODIFIED Requirements

### Requirement: Force-placement respects bucket quotas without producing mismatches

Pinned night vibes SHALL remain force-placed regardless of weather category, as today. **New-for-me discovery seeds** SHALL be force-placed as a tier below pinned and above overdue: an accepted discovery claims a slot within its weather-bucket quota (falling to a flex/`mild` slot when its bucket has none), so imported discoveries seed the plan on both the agent and web-app surfaces rather than competing purely on cadence weight. An overdue night vibe (per the existing `forceDueAt` tier) SHALL still be eventually force-placed once sufficiently overdue, but an overdue vibe whose bucket's category has a zero quota for the current planning window SHALL roll over rather than being opportunistically force-placed into a slot outside its bucket, unless and until it crosses the existing overdue escape hatch. New-for-me force-placement SHALL obey the same rule — it SHALL NOT place a discovery into a slot whose bucket its facets contradict, and a discovery that cannot be placed within quota SHALL roll over rather than force a mismatch. Force-placement SHALL remain seed-deterministic and SHALL NEVER produce an empty slot for lack of a weather-matching vibe.

#### Scenario: A pinned vibe is force-placed regardless of weather

- **WHEN** a pinned vibe's bucket has a zero quota for the planning window
- **THEN** the pinned vibe is still force-placed, as today

#### Scenario: A new-for-me discovery claims a slot within quota

- **WHEN** an accepted new-for-me discovery is passed to `sampleWeek` and its weather bucket has an available quota slot
- **THEN** the discovery is force-placed into that slot (below pinned, above overdue), seeding the plan

#### Scenario: A discovery with no matching quota rolls over rather than mismatching

- **WHEN** an accepted new-for-me discovery's bucket has a zero quota for the window
- **THEN** the discovery falls to a flex/`mild` slot if one exists, else rolls over — it is never force-placed into a contradicting bucket, and no slot is left empty for it

#### Scenario: An overdue vibe outside its bucket quota rolls over

- **WHEN** an overdue vibe's weather category has a zero quota for the current window and it has not crossed the overdue escape hatch
- **THEN** it rolls over rather than being force-placed into a slot outside its bucket
