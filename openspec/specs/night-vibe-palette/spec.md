# night-vibe-palette Specification

## Purpose
TBD - created by archiving change propose-meal-plan-tool. Update Purpose after archive.
## Requirements
### Requirement: Night vibes are saved specs with lifecycle metadata

The system SHALL store a per-tenant **night-vibe palette**: each night vibe is a persisted `search_recipes` spec (a `vibe` string and optional `facets`) plus lifecycle metadata — a `cadence_days` target period, `weather_affinity` tags drawn from the weather `meal_vibes` vocabulary, and an optional `season`. A night vibe SHALL be identified by a stable id and SHALL be the retrieval query for its slot. The palette SHALL be per-tenant private profile data (a D1 table, sibling to `staples`/`stockup`), never shared.

#### Scenario: A night vibe is a usable saved query

- **WHEN** a night vibe is created with a vibe phrase and `cadence_days`
- **THEN** it is stored as a per-tenant row usable as a `search_recipes` query

#### Scenario: A filled slot queries by its vibe's spec

- **WHEN** a slot is filled from a night vibe
- **THEN** the vibe's stored spec (`vibe` + `facets`) is the query and gate for that slot's retrieval

### Requirement: Night-vibe embedding is derived on the cron

Each night vibe's query embedding SHALL be derived Worker-side on the scheduled reconcile, **hash-gated** on the vibe text so it regenerates only when the text changes (steady state ≈ 0 work) and pruned when the vibe is deleted — mirroring the `taste_derived` reconcile. A vibe whose embedding has not yet reconciled SHALL be treated as "not yet indexed" for sampling-and-fill (handled gracefully, not an error), remaining editable meanwhile.

#### Scenario: Edited text re-embeds on a later tick

- **WHEN** a night vibe's text is edited
- **THEN** its embedding re-derives on a later cron tick via the hash gate, with no hand-authored vector

#### Scenario: An unembedded vibe is not an error

- **WHEN** a night vibe is newly created and its embedding has not yet reconciled
- **THEN** it is treated as not-yet-indexed for the fill step rather than raising an error

### Requirement: Cadence-as-debt scheduling

Slot scheduling SHALL use a **cadence-as-debt** model: for a night vibe with period `P`, `debt = days_since(last_satisfied) / P`. A vibe's sampling weight SHALL rise monotonically with debt (bounded), so a vibe cooked recently is dormant and an overdue vibe surfaces; the single `cadence_days` knob SHALL subsume the pinned/weighted/occasional spectrum (a short period behaves as a weekly "pin," a long period as "occasional"). When more vibes are **due** than there are slots, the system SHALL resolve by debt-rank (highest-debt first) and let the rest **roll over** (their debt keeps rising) rather than overfilling the week.

#### Scenario: A recently-satisfied weekly vibe stays dormant

- **WHEN** a weekly-period vibe was satisfied yesterday
- **THEN** its debt is near zero and it is not force-placed this week

#### Scenario: An overdue monthly vibe surfaces

- **WHEN** a monthly-period vibe has not been satisfied in over a month
- **THEN** its debt exceeds one and it surfaces into the week

#### Scenario: Over-subscription rolls over

- **WHEN** more vibes are due than there are slots
- **THEN** the highest-debt vibes take the slots and the remainder roll over to a later week

### Requirement: Weather-weighted seeded sampling

Level-1 slot selection SHALL weight the palette by joining each vibe's `weather_affinity` against the forecast's per-day `meal_vibes` (a soft reweighting — a warm day mid-week may still surface a grill vibe; a cold week boosts soup/comfort), combined with the cadence-debt weight, then draw N slots by **seeded** diverse sampling (force-placing due/pinned vibes first). Sampling SHALL be deterministic given the seed and SHALL avoid drawing near-duplicate vibes. Where the forecast is per-date, the system MAY assign a slot's vibe to its best-fitting night. When weather is unavailable, sampling SHALL fall back to cadence-debt weight alone without error.

#### Scenario: A cold week reweights the palette

- **WHEN** the forecast is a cold, rainy week
- **THEN** soup/comfort-affinity vibes gain weight and grill-affinity vibes lose weight (not removed) before sampling

#### Scenario: Seeded shape is reproducible

- **WHEN** the same seed is used
- **THEN** the same week-shape is sampled; a different seed yields a different valid shape

#### Scenario: Missing weather degrades gracefully

- **WHEN** the weather read fails
- **THEN** sampling proceeds on cadence-debt weight alone with no surfaced error

### Requirement: Satisfaction is revealed at cook time

A night vibe's `last_satisfied` SHALL be derived from cooks attributed to that vibe by a **cook-time cosine match** of the actual cooked recipe against the palette (the `cooking-history` capability's `satisfied_vibe` records) — `MAX(date)` over those records, never stored on the vibe. Attribution SHALL union two signals: (a) the planned row's `from_vibe`, when present, as a **guaranteed-reset prior** (an explicitly-aimed vibe always resets, even at a borderline cosine); and (b) every palette vibe the cooked recipe matches at or above a calibrated cosine threshold. An **off-plan** cook (no slot provenance) SHALL therefore reset any vibe its recipe genuinely matches — off-plan cooking is revealed behavior and SHALL advance the rhythm. Attribution is at **cook time on a concrete recipe** (revealed), not at plan time on a guess (speculative). `profile-reconciliation` remains a backstop for systematic drift, not the primary path.

#### Scenario: An on-plan cook advances its vibe and any it also matches

- **WHEN** a planned row carrying `from_vibe` is cooked and logged
- **THEN** that vibe resets (the guaranteed prior) and any other palette vibe the cooked recipe matches at/above the threshold also resets

#### Scenario: An off-plan cook resets the matched vibe

- **WHEN** an off-plan meal is cooked whose recipe cosine-matches a palette vibe at/above the threshold
- **THEN** that vibe's `last_satisfied` advances — off-plan cooks are no longer blind to cadence

#### Scenario: last_satisfied stays a derived query

- **WHEN** a vibe's `last_satisfied` is read
- **THEN** it is `MAX(date)` over the caller's cook-time satisfaction records for that vibe, with nothing written onto the vibe row

### Requirement: The palette is part of the profile

The night-vibe palette is per-tenant private profile data (a D1 table, sibling to `staples`/`stockup`), and SHALL be surfaced as part of the member's profile read: `read_user_profile()` SHALL include the palette and each vibe's cadence status, and an empty palette SHALL appear in the profile's `missing[]` onboarding areas (the `data-read-tools` capability). This makes the palette a first-class revealed-preference layer the agent reads at session start as the basis for shaping vibes on a bare request — a prior, not a cage.

#### Scenario: The profile read includes the palette and cadence

- **WHEN** `read_user_profile()` is called for a member with a non-empty palette
- **THEN** the result includes the palette vibes and each vibe's cadence status

#### Scenario: An empty palette surfaces as an onboarding gap

- **WHEN** a member has no night vibes
- **THEN** `read_user_profile()` lists the palette onboarding area in `missing[]`

