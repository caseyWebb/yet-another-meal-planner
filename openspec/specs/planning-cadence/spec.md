# planning-cadence Specification

## Purpose
TBD - created by archiving change planning-cadence. Update Purpose after archive.
## Requirements
### Requirement: Planning cadence is a first-class profile field

The system SHALL store a per-tenant `planning_cadence_days` field — an integer number of days naming how far out the caller plans and shops — as part of the caller's profile, written through the same profile write path as other profile fields and captured during onboarding (`configure-yamp-profile`).

#### Scenario: A caller sets their planning cadence during onboarding

- **WHEN** a caller is asked how far out they plan or shop and answers with a choice (e.g. "a few days," "weekly," "two weeks")
- **THEN** the resolved number of days is persisted to their profile as `planning_cadence_days`

#### Scenario: An unset planning cadence does not block planning

- **WHEN** a caller with no `planning_cadence_days` set calls `propose_meal_plan`
- **THEN** the planner still produces a plan, falling back to a default planning window rather than erroring

### Requirement: The planning window drives the weather forecast horizon

`propose_meal_plan` SHALL derive a planning **window**, in days, from the caller's `planning_cadence_days`, and SHALL request the weather forecast for that window's horizon instead of a fixed horizon.

#### Scenario: A longer cadence requests a longer forecast

- **WHEN** a caller's `planning_cadence_days` is 14
- **THEN** the weather forecast is requested for a 14-day horizon, not a fixed 7-day horizon

#### Scenario: The forecast horizon still respects the underlying weather API's bounds

- **WHEN** the derived window exceeds what the weather forecast source supports
- **THEN** the request is clamped to the source's supported range rather than failing

### Requirement: The planning window bounds night-vibe slot count, not cooking frequency

The number of night-vibe slots `propose_meal_plan` shapes for a plan SHALL be the caller's `default_cooking_nights` count applied **within** the planning window, so that changing the planning window alone SHALL NOT change how many nights per window the caller intends to cook.

#### Scenario: A longer window with the same cooking-nights count plans the same number of nights

- **WHEN** a caller's `default_cooking_nights` is 3 and their `planning_cadence_days` changes from 7 to 14
- **THEN** the resulting plan still shapes 3 night-vibe slots (subject to any explicit `nights` override), not 6

### Requirement: Period-aware vibe repeatability

Within one planning window, a night vibe SHALL be eligible to be sampled into more than one slot when its cadence period divides evenly into the window more than once: specifically, a vibe's maximum occurrences per plan SHALL be `max(1, floor(window / vibe_period))`, where `window` is the planning window in days and `vibe_period` is that vibe's `cadence_days`. This replaces sampling the palette's weighted pool via at-most-once selection.

#### Scenario: A weekly vibe recurs in a two-week plan

- **WHEN** a vibe's `cadence_days` is 7 and the planning window is 14 days
- **THEN** that vibe may be sampled into up to 2 slots in the resulting plan

#### Scenario: A monthly vibe still appears at most once in a two-week plan

- **WHEN** a vibe's `cadence_days` is 30 and the planning window is 14 days
- **THEN** that vibe may be sampled into at most 1 slot in the resulting plan

#### Scenario: A short window preserves today's at-most-once behavior

- **WHEN** the planning window is shorter than or equal to a vibe's `cadence_days`
- **THEN** that vibe may be sampled into at most 1 slot, matching the existing single-occurrence behavior

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

### Requirement: Recipe-level repetition is unaffected

Allowing a night vibe to recur within a plan SHALL NOT itself cause the same recipe to be selected twice in one plan; recipe-level diversity across the plan SHALL continue to be enforced independently of vibe recurrence.

#### Scenario: A recurring vibe selects two different recipes

- **WHEN** a vibe is sampled into two slots of the same plan
- **THEN** the two slots resolve to two different recipes, not the same recipe twice

