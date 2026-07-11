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

### Requirement: Period-aware vibe repeatability

Within one planning window, a meal vibe SHALL be eligible to be sampled into more than one slot when its cadence period divides evenly into the window more than once: specifically, a vibe's maximum occurrences per plan SHALL be `max(1, floor(window / vibe_period))`, where `window` is the planning window in days and `vibe_period` is that vibe's `cadence_days`. This replaces sampling the palette's weighted pool via at-most-once selection. The occurrence cap SHALL be **meal-orthogonal** (stories/02 Q3): it is computed from the window and the vibe's own period alone — never from a meal's slot supply — and a vibe's occurrences are counted within its own meal's sampling, since a vibe only ever competes for slots of its own meal.

#### Scenario: A weekly vibe recurs in a two-week plan

- **WHEN** a vibe's `cadence_days` is 7 and the planning window is 14 days
- **THEN** that vibe may be sampled into up to 2 slots in the resulting plan

#### Scenario: A monthly vibe still appears at most once in a two-week plan

- **WHEN** a vibe's `cadence_days` is 30 and the planning window is 14 days
- **THEN** that vibe may be sampled into at most 1 slot in the resulting plan

#### Scenario: A short window preserves today's at-most-once behavior

- **WHEN** the planning window is shorter than or equal to a vibe's `cadence_days`
- **THEN** that vibe may be sampled into at most 1 slot, matching the existing single-occurrence behavior

#### Scenario: The cap is independent of a meal's slot count

- **WHEN** a lunch vibe's `cadence_days` is 7, the window is 14 days, and the household's lunch cadence is 2 slots per window
- **THEN** the vibe's occurrence cap is still 2 (from `floor(14/7)`), applied within lunch sampling — the cap is never normalized by the meal's slot supply

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

### Requirement: Per-meal cadence is the planning-frequency preference

The system SHALL store the caller's cooking frequency as a per-meal **`cadence`** map — `{ breakfast, lunch, dinner }`, each an integer weekly count 0–7 — in the profile, replacing the single `default_cooking_nights` scalar as the stated preference. `update_preferences` SHALL treat `cadence` as a defined key with **per-key merge semantics** consistent with the documented RFC 7396 merge-patch contract: `{ cadence: { lunch: 2 } }` sets lunch only, `{ cadence: { dinner: null } }` clears one key, and `cadence: null` clears the map — never a wholesale replacement. For one deprecation window, `update_preferences` SHALL accept **`default_cooking_nights: N`** as an alias (validated int 0–7) merged as `cadence.dinner = N` — preserving breakfast/lunch and never writing the frozen `default_cooking_nights` column — appending `{ key: "default_cooking_nights", reason: "aliased", superseded_by: "cadence.dinner" }` to the result's `warnings`. Reads SHALL fall back gracefully: `read_user_profile` exports the stored map, or — when it is NULL — the read-time derivation `{ breakfast: 0, lunch: 0, dinner: default_cooking_nights ?? 5 }`, and exports `default_cooking_nights` as a derived mirror of `cadence.dinner` for the same window. The migration SHALL backfill `cadence = { breakfast: 0, lunch: 0, dinner: N }` for every profile row whose `default_cooking_nights` is non-NULL — the defined column wins over any `custom`-bag shadow (precedence, not merge) — and SHALL tolerate tenants with no profile row (no row created).

#### Scenario: Migration maps the scalar onto the map

- **WHEN** the migration runs over a profile with `default_cooking_nights = 5`, one with NULL, one whose `custom` bag shadows a different value, and a tenant with no profile row
- **THEN** the first gets `cadence = {"breakfast":0,"lunch":0,"dinner":5}`, the NULL profile's `cadence` stays NULL, the shadowed profile's map is derived from the column (the `custom` bag is untouched and byte-identical), and the row-less tenant is untouched

#### Scenario: Read falls back through the frozen scalar

- **WHEN** `read_user_profile` runs for a member whose `cadence` is NULL
- **THEN** the export carries the derivation `{ breakfast: 0, lunch: 0, dinner: default_cooking_nights ?? 5 }` and planning proceeds without error

#### Scenario: The cadence patch merges per key

- **WHEN** `update_preferences` applies `{ cadence: { lunch: 2 } }` to a stored `{"breakfast":0,"lunch":0,"dinner":5}`
- **THEN** the stored map becomes `{"breakfast":0,"lunch":2,"dinner":5}` — the other keys are preserved, not replaced

#### Scenario: The legacy key is aliased with a warning

- **WHEN** `update_preferences` receives `default_cooking_nights: 3` during the deprecation window
- **THEN** `cadence.dinner` becomes 3 (breakfast/lunch preserved), the frozen `default_cooking_nights` column is not written, and the result's `warnings` carries the aliased entry

### Requirement: The planning window bounds per-meal slot counts, not cooking frequency

The number of vibe slots `propose_meal_plan` shapes for a plan SHALL be, per meal, the caller's `cadence[meal]` count applied **within** the planning window (subject to any explicit per-meal override), so that changing the planning window alone SHALL NOT change how many slots per window the caller intends to cook for any meal. Counts are per-window, not week-scaled — parity with the prior `nights` behavior, generalized per meal. The planning window continues to bound **recurrence caps** (period-aware repeatability), not counts.

#### Scenario: A longer window with the same cadence plans the same number of slots

- **WHEN** a caller's `cadence.dinner` is 3 and their `planning_cadence_days` changes from 7 to 14
- **THEN** the resulting plan still shapes 3 dinner slots (subject to any explicit `meals` override), not 6

#### Scenario: Each meal's count is bounded independently

- **WHEN** a caller's cadence is `{ breakfast: 2, lunch: 0, dinner: 4 }` and no explicit `meals` override is supplied
- **THEN** the plan shapes 2 breakfast slots, 0 lunch slots, and 4 dinner slots within the window

