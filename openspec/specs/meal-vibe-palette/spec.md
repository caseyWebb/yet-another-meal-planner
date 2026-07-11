# meal-vibe-palette Specification

## Purpose
TBD - created by archiving change meal-dimension-foundations. Update Purpose after archive.
## Requirements
### Requirement: Meal vibes are saved specs with lifecycle metadata

The system SHALL store a per-tenant **meal-vibe palette**: each meal vibe is a persisted `search_recipes` spec (a `vibe` string and optional `facets`) plus lifecycle metadata — a `cadence_days` target period, `weather_affinity` tags drawn from the weather `meal_vibes` vocabulary, and an optional `season` — plus a **`meal`** dimension: a closed-set value `breakfast | lunch | dinner` (projects are never vibe-driven), defaulting to `dinner` on creation, and an optional **`members`** list (see the member-assignment requirement). A meal vibe SHALL be identified by a stable id and SHALL be the retrieval query for its slot. The palette SHALL be per-tenant private profile data — stored in the D1 `night_vibes` table (the table is deliberately NOT renamed; only the tool family renames), never shared. The migration SHALL stamp every existing vibe `meal = 'dinner'` and `members = NULL`.

#### Scenario: A meal vibe is a usable saved query with a meal

- **WHEN** a meal vibe is created with a vibe phrase, `cadence_days`, and `meal: "lunch"`
- **THEN** it is stored as a per-tenant row usable as a `search_recipes` query, carrying `meal = 'lunch'`

#### Scenario: A filled slot queries by its vibe's spec

- **WHEN** a slot is filled from a meal vibe
- **THEN** the vibe's stored spec (`vibe` + `facets`) is the query and gate for that slot's retrieval

#### Scenario: Existing vibes migrate to dinner

- **WHEN** the meal-dimension migration runs over the production palette (seven dinner-shaped vibes)
- **THEN** every existing row carries `meal = 'dinner'` and `members = NULL`, a semantically correct fit for all live rows, and the `night_vibes` table keeps its name

### Requirement: Meal-vibe CRUD is served by the meal_vibe tool family

The system SHALL expose the palette through the canonical tool names `list_meal_vibes`, `add_meal_vibe`, `update_meal_vibe`, and `remove_meal_vibe` (and `suggest_meal_vibes`, the `meal-vibe-archetype-derivation` capability). `add_meal_vibe` SHALL accept `meal` (default `'dinner'`) and `members`; `list_meal_vibes` SHALL return them. `update_meal_vibe` SHALL support **explicit-null field clearing**: a supplied `null` clears `cadence_days`, `base_weight`, `weather_affinity`, `weather_antipathy`, `season`, `facets`, or `members`; an absent field preserves. `meal` SHALL be settable (moving the vibe between meal palettes — no re-embed, since the embedding hash covers the phrase) but NOT nullable; `vibe` SHALL NOT be nullable. Write classes are unchanged (D15): vibe create/delete are class (b) keyed by the vibe id; vibe edit is class (a).

#### Scenario: Explicit null clears a field

- **WHEN** `update_meal_vibe` is called with `{ cadence_days: null }`
- **THEN** the vibe's `cadence_days` is cleared while every absent field is preserved

#### Scenario: Moving a vibe between meals does not re-embed

- **WHEN** `update_meal_vibe` sets `meal: "lunch"` on a dinner vibe without changing its phrase
- **THEN** the vibe now samples into the lunch palette and its `night_vibe_derived` embedding row is unchanged (the hash gates on the vibe text)

### Requirement: Deprecated night-vibe tool names dispatch onto the meal-vibe ops

For one deprecation window, the old tool names (`list_night_vibes`, `add_night_vibe`, `update_night_vibe`, `remove_night_vibe`, `suggest_night_vibes`) SHALL remain registered as **dispatch aliases onto the identical shared ops** — one op layer, no duplicated logic, identical requests and identical responses (no warnings injection; aliases are behavior-identical per D21's dispatch framing) — with each alias's description replaced by one line: "Deprecated alias of `<new name>` — identical behavior; use the new name." Aliases SHALL accept and return the new `meal`/`members` fields, so a lagging plugin loses nothing but the name. The aliases are recorded in docs/TOOLS.md's Deprecations section and are removed by the window-close cleanup change (`remove-meal-dimension-shims`) once a subsequent plugin publish has occurred AND ≥30 days have elapsed since this change's plugin publish.

#### Scenario: An aliased call is identical to the canonical call

- **WHEN** a lagging plugin calls `add_night_vibe` with a phrase and `meal: "lunch"`
- **THEN** the creation and the response are identical to the same call via `add_meal_vibe` — same op, same fields, no warning injected

### Requirement: Vibes are member-assignable and contribute by attendance

A meal vibe MAY carry a **`members`** list (D29-final): an array of non-empty opaque member handles, deduped, stored verbatim; `NULL`/absent means "everyone." An assigned vibe SHALL contribute slots and cadence-debt to a proposal only when `members ∩ effective-eating-set ≠ ∅`; a NULL-members vibe always contributes. **Stale-members fail-open**: a vibe whose members are all unresolvable against the household roster SHALL contribute as everyone (with a diagnostics note) — a stale reference never silently deletes a vibe from planning. Handles carry no band-5 schema dependency; in band 1 the roster is the singleton `[tenant]`, so all production vibes (`members` NULL) behave exactly as today.

#### Scenario: A NULL-members vibe always contributes

- **WHEN** a proposal is shaped for a household whose vibes all have `members = NULL`
- **THEN** every vibe contributes to sampling exactly as before member assignment existed

#### Scenario: A stale assignment fails open

- **WHEN** a vibe's `members` list contains only handles unresolvable against the roster
- **THEN** the vibe contributes as if assigned to everyone and the proposal's diagnostics note the stale assignment

### Requirement: Meal-vibe embedding is derived on the cron

Each meal vibe's query embedding SHALL be derived Worker-side on the scheduled reconcile, **hash-gated** on the vibe text so it regenerates only when the text changes (steady state ≈ 0 work) and pruned when the vibe is deleted — mirroring the `taste_derived` reconcile. Because the hash covers the vibe *text* only, adding or changing `meal`/`members` SHALL trigger zero re-embeds. A vibe whose embedding has not yet reconciled SHALL be treated as "not yet indexed" for sampling-and-fill (handled gracefully, not an error), remaining editable meanwhile.

#### Scenario: Edited text re-embeds on a later tick

- **WHEN** a meal vibe's text is edited
- **THEN** its embedding re-derives on a later cron tick via the hash gate, with no hand-authored vector

#### Scenario: The meal-dimension migration re-embeds nothing

- **WHEN** the migration adds `meal` and `members` to every existing vibe row
- **THEN** no `night_vibe_derived` row regenerates — every `updated_at` is unchanged, because no vibe text changed

#### Scenario: An unembedded vibe is not an error

- **WHEN** a meal vibe is newly created and its embedding has not yet reconciled
- **THEN** it is treated as not-yet-indexed for the fill step rather than raising an error

### Requirement: Cadence-as-debt scheduling

Slot scheduling SHALL use a **cadence-as-debt** model: for a meal vibe with period `P`, `debt = days_since(last_satisfied) / P`. A vibe's sampling weight SHALL rise monotonically with debt (bounded), so a vibe cooked recently is dormant and an overdue vibe surfaces; the single `cadence_days` knob SHALL subsume the pinned/weighted/occasional spectrum (a short period behaves as a weekly "pin," a long period as "occasional"). Debt SHALL remain **absolute-days and meal-orthogonal** (stories/02 Q3): per-meal slot counts shape slot *supply*, debt shapes *ranking within a meal's sampling*, and debt is never normalized by a meal's slot supply. When more vibes are **due** than there are slots in their meal, the system SHALL resolve by debt-rank (highest-debt first) and let the rest **roll over** (their debt keeps rising) rather than overfilling the week.

#### Scenario: A recently-satisfied weekly vibe stays dormant

- **WHEN** a weekly-period vibe was satisfied yesterday
- **THEN** its debt is near zero and it is not force-placed this week

#### Scenario: An overdue monthly vibe surfaces

- **WHEN** a monthly-period vibe has not been satisfied in over a month
- **THEN** its debt exceeds one and it surfaces into the week

#### Scenario: Debt is not normalized by per-meal supply

- **WHEN** a lunch vibe with `cadence_days: 7` exists in a household whose lunch cadence is 3 slots a week
- **THEN** its debt is still `days_since(last_satisfied) / 7` — "every 7 days" means the same real interval regardless of household configuration, and an unfittable vibe simply stays maximally overdue until a slot opens

#### Scenario: Over-subscription rolls over

- **WHEN** more vibes are due than there are slots
- **THEN** the highest-debt vibes take the slots and the remainder roll over to a later week

### Requirement: Weather-weighted seeded sampling

Level-1 slot selection for **dinner** slots SHALL weight the palette by joining each vibe's `weather_affinity` against the forecast's per-day `meal_vibes` (a soft reweighting — a warm day mid-week may still surface a grill vibe; a cold week boosts soup/comfort), combined with the cadence-debt weight, then draw the requested slots by **seeded** diverse sampling (force-placing due/pinned vibes first). Weather weighting is **dinner-scoped** (stories/02 Q4, the `weather-bucket-planning` capability): breakfast and lunch sampling SHALL use cadence-debt weight alone, and a `weather_affinity` stored on a non-dinner vibe SHALL be preserved but inert in allocation. Sampling SHALL be deterministic given the seed and SHALL avoid drawing near-duplicate vibes. Where the forecast is per-date, the system MAY assign a slot's vibe to its best-fitting night. When weather is unavailable, sampling SHALL fall back to cadence-debt weight alone without error.

#### Scenario: A cold week reweights the dinner palette

- **WHEN** the forecast is a cold, rainy week
- **THEN** soup/comfort-affinity dinner vibes gain weight and grill-affinity dinner vibes lose weight (not removed) before sampling

#### Scenario: A lunch vibe's weather affinity is inert

- **WHEN** a lunch vibe carries a stored `weather_affinity`
- **THEN** the value is preserved on the row but does not affect lunch sampling, which weights by cadence-debt alone

#### Scenario: Seeded shape is reproducible

- **WHEN** the same seed is used
- **THEN** the same week-shape is sampled; a different seed yields a different valid shape

#### Scenario: Missing weather degrades gracefully

- **WHEN** the weather read fails
- **THEN** sampling proceeds on cadence-debt weight alone with no surfaced error

### Requirement: Satisfaction is revealed at cook time

A meal vibe's `last_satisfied` SHALL be derived from cooks attributed to that vibe by a **cook-time cosine match** of the actual cooked recipe against the palette (the `cooking-history` capability's `satisfied_vibe` records) — `MAX(date)` over those records, never stored on the vibe. Attribution SHALL union two signals: (a) the cleared planned row's `from_vibe`, when present, as a **guaranteed-reset prior** (an explicitly-aimed vibe always resets, even at a borderline cosine) — read from the row the cook actually cleared; and (b) every palette vibe the cooked recipe matches at or above a calibrated cosine threshold. Cosine attribution SHALL be **meal-scoped**: when the logged entry carries a `meal`, candidate vibes restrict to those whose `meal` equals it; an entry with NULL `meal` matches against all vibes (fail-open, today's behavior). An **off-plan** cook (no slot provenance) SHALL therefore reset any vibe its recipe genuinely matches — off-plan cooking is revealed behavior and SHALL advance the rhythm. Attribution is at **cook time on a concrete recipe** (revealed), not at plan time on a guess (speculative). `profile-reconciliation` remains a backstop for systematic drift, not the primary path.

#### Scenario: An on-plan cook advances its vibe and any it also matches

- **WHEN** a planned row carrying `from_vibe` is cooked and logged
- **THEN** that vibe resets (the guaranteed prior) and any other palette vibe the cooked recipe matches at/above the threshold also resets

#### Scenario: Attribution respects the entry's meal

- **WHEN** a cook is logged with `meal: "lunch"` and the cooked recipe cosine-matches both a lunch vibe and a dinner vibe at/above the threshold
- **THEN** only the lunch vibe receives a cosine-attributed satisfaction record (the `from_vibe` prior, if present, still always resets)

#### Scenario: A meal-less entry matches all vibes

- **WHEN** a cook is logged with no `meal`
- **THEN** cosine attribution considers every palette vibe regardless of meal, exactly as before the meal dimension

#### Scenario: last_satisfied stays a derived query

- **WHEN** a vibe's `last_satisfied` is read
- **THEN** it is `MAX(date)` over the caller's cook-time satisfaction records for that vibe, with nothing written onto the vibe row

### Requirement: The palette is part of the profile

The meal-vibe palette is per-tenant private profile data (a D1 table, sibling to `staples`/`stockup`), and SHALL be surfaced as part of the member's profile read: `read_user_profile()` SHALL include the palette under **meal-vibe** naming — each vibe with its cadence status, its `meal`, and its `members` when set — and an empty palette SHALL appear in the profile's `missing[]` onboarding areas with the label `"vibes"` unchanged (the `data-read-tools` capability). This makes the palette a first-class revealed-preference layer the agent reads at session start as the basis for shaping vibes on a bare request — a prior, not a cage.

#### Scenario: The profile read includes the palette, meals, and cadence

- **WHEN** `read_user_profile()` is called for a member with a non-empty palette
- **THEN** the result includes the palette vibes under meal-vibe naming, each with its `meal`, its cadence status, and its `members` when set

#### Scenario: An empty palette surfaces as an onboarding gap

- **WHEN** a member has no meal vibes
- **THEN** `read_user_profile()` lists the palette onboarding area in `missing[]` under the unchanged `"vibes"` label

