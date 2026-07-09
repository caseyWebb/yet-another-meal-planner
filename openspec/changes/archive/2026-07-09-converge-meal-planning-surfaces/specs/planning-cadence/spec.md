## MODIFIED Requirements

### Requirement: Repeatability sampling stays deterministic and precedence-preserving

The bounded-multiplicity sampling SHALL remain deterministic given the same seed and inputs, and SHALL preserve the precedence order: pinned vibes are placed first, then **new-for-me discovery seeds** (accepted imports claiming a slot before cadence-weighted fills), then overdue (debt-forced) vibes, then the remaining slots are filled from the weighted pool honoring each vibe's occurrence cap. The new-for-me tier SHALL be seed-deterministic like the others and SHALL respect weather-bucket quotas (the `weather-bucket-planning` capability). Vibes and discoveries that do not fit SHALL continue to roll over.

#### Scenario: Precedence order includes new-for-me between pinned and overdue

- **WHEN** a planning window has a pinned vibe, an accepted new-for-me discovery, and an overdue vibe competing for slots
- **THEN** the pinned vibe is placed first, the discovery next, the overdue vibe after, and the remaining slots fill from the weighted pool — all deterministic given the seed

#### Scenario: Sampling stays deterministic with the new tier

- **WHEN** `sampleWeek` runs twice with the same seed, palette, discoveries, and forecast
- **THEN** it produces the identical week both times, including identical new-for-me placements

#### Scenario: Overflow rolls over

- **WHEN** more pinned + new-for-me + overdue claims exist than slots
- **THEN** the ones that do not fit roll over rather than displacing a higher-precedence placement
