## REMOVED Requirements

### Requirement: Satisfaction is slot provenance

**Reason:** Replaced by "Satisfaction is revealed at cook time". Attribution moves from plan-time slot provenance to a cook-time cosine match of the actual cooked recipe against the palette, so off-plan cooks and Claude-authored ephemeral weeks reset cadence correctly. The prior requirement's ban on "fuzzy embedding attribution at plan time" and its deferral of the off-plan case to `profile-reconciliation` no longer hold; attribution is now at cook time on a concrete recipe (revealed), not at plan time on a guess.

## ADDED Requirements

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
