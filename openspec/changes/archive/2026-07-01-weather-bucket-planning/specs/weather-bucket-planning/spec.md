## ADDED Requirements

### Requirement: Discrete per-day weather category derivation

The system SHALL derive exactly one discrete weather **category** for each forecast day from that day's `meal_vibes`/`condition` (`src/weather.ts`), drawn from a small, mutually-exclusive category set that includes a `mild` default for a day with no strong weather signal. The derivation SHALL NOT union or flatten signals across multiple days into a single value — each day's category SHALL be computed independently of every other day in the window.

#### Scenario: A day with a strong signal maps to its category

- **WHEN** a forecast day's derived `meal_vibes`/`condition` strongly indicate one weather character (e.g. hot and dry, or cold and wet)
- **THEN** that day is assigned the corresponding discrete category

#### Scenario: A day with no strong signal defaults to mild

- **WHEN** a forecast day's `meal_vibes`/`condition` do not strongly indicate any category
- **THEN** that day is assigned `mild`

#### Scenario: Each day is categorized independently

- **WHEN** a planning window contains multiple forecast days with different weather characters
- **THEN** each day receives its own category based only on that day's own signal, not on any other day's

### Requirement: Discrete bucket membership on night vibes, bucketless as universal filler

A night vibe SHALL carry discrete weather **bucket membership**: a subset (possibly empty) of the non-`mild` weather categories. A vibe with no bucket membership (the default) SHALL be treated as **bucketless** and SHALL be eligible filler for every category's quota as well as `mild`/flex slots. A vibe that IS a member of one or more buckets SHALL be structurally ineligible to fill a different category's quota — this exclusion SHALL be a hard eligibility rule, not a reduced weight or score.

#### Scenario: A bucketless vibe fills any category

- **WHEN** a night vibe has no declared bucket membership
- **THEN** it is eligible to fill a quota slot for any weather category, and for `mild`/flex slots

#### Scenario: A bucketed vibe cannot fill a conflicting category's quota

- **WHEN** a night vibe belongs only to bucket `grill` and the allocator is filling a `wet` category's quota
- **THEN** that vibe is excluded from the `wet` quota's eligible pool, regardless of its cadence-debt or any other ranking signal

#### Scenario: Default membership is bucketless

- **WHEN** a night vibe has never had bucket membership assigned (authored or derived)
- **THEN** it is treated as bucketless, not as excluded from every category

### Requirement: Quota-based slot allocation mirrors the forecast's weather mix

`sampleWeek` SHALL allocate the planning window's slots to weather categories by histogramming the window's per-day categories and converting that histogram to integer slot quotas (via deterministic largest-remainder rounding), rather than applying a continuous per-vibe multiplier to a flattened weather-tag set. Each non-`mild` category's quota SHALL be filled from that category's member vibes union the bucketless vibes, ranked by the existing cadence-debt sampler. A `mild` day's quota SHALL be treated as flex, filled from the whole palette by cadence-debt. A category whose quota has no eligible member SHALL degrade to a flex slot rather than remain unfilled — the plan SHALL NEVER produce an empty slot for lack of a weather-matching vibe.

#### Scenario: Slot allocation mirrors the forecast's proportion

- **WHEN** the planning window's forecast is mostly `mild` with one day categorized `grill`
- **THEN** the `grill` category's quota is a small proportional share of the window's slots, not the full weight applied to every slot

#### Scenario: A quota with no eligible member degrades to flex

- **WHEN** a category's quota is greater than zero but no palette vibe is a member of that category (and none are bucketless)
- **THEN** that quota's slots are filled from the flex pool instead of being left empty

#### Scenario: Mild days allocate to flex

- **WHEN** a forecast day is categorized `mild`
- **THEN** its slot is filled from the whole palette ranked by cadence-debt, not restricted to any weather category

### Requirement: Force-placement respects bucket quotas without producing mismatches

Pinned night vibes SHALL remain force-placed regardless of weather category, as today. An overdue night vibe (per the existing `forceDueAt` tier) SHALL still be eventually force-placed once sufficiently overdue, but an overdue vibe whose bucket's category has a zero quota for the current planning window SHALL roll over rather than being opportunistically force-placed into a slot outside its bucket, unless and until it crosses the existing overdue escape hatch.

#### Scenario: An overdue vibe with no matching category rolls over

- **WHEN** a night vibe belonging to bucket `grill` is overdue (past `forceDueAt` but not yet at the escape-hatch tier) and the current window's forecast has a zero `grill` quota
- **THEN** the vibe rolls over to the next planning window rather than being placed into a mismatched slot

#### Scenario: A sufficiently overdue vibe is still force-placed

- **WHEN** a bucketed night vibe's debt reaches the existing overdue escape-hatch tier
- **THEN** it is force-placed for this window regardless of whether its bucket's category appears in the forecast

### Requirement: Archetype derivation classifies a derived vibe's weather bucket

The archetype-derivation naming pass SHALL classify each newly derived night vibe into one of the discrete weather categories, or a neutral/bucketless label, in the same model call used to name the cluster. A derived vibe's bucket membership SHALL default to bucketless when the classification is neutral, absent, or fails.

#### Scenario: A derived vibe receives a bucket classification

- **WHEN** the archetype-derivation naming pass names a new cluster into a night-vibe phrase
- **THEN** it also assigns that vibe a discrete weather bucket (or bucketless) from the same generation

#### Scenario: A failed or neutral classification defaults to bucketless

- **WHEN** the naming pass's bucket classification is neutral, missing, or the generation call fails
- **THEN** the derived vibe is treated as bucketless rather than left in an invalid or unset state that blocks derivation

### Requirement: Weather window bounds at the lesser of the planning window and forecast reliability

The set of forecast days used for category histogramming SHALL be bounded to the lesser of the planning window's day count and a forecast-reliability cap. Days beyond that cap SHALL be treated as `mild`/neutral rather than categorized from a low-confidence forecast, and their corresponding slots SHALL be allocated as flex.

#### Scenario: A window longer than the reliability cap treats excess days as mild

- **WHEN** the planning window spans more days than the forecast-reliability cap
- **THEN** days beyond the cap are treated as `mild` for allocation purposes, and their slots are flex

#### Scenario: A window within the reliability cap uses the full forecast

- **WHEN** the planning window's day count is at or under the forecast-reliability cap
- **THEN** every day in the window is categorized from its own forecast data
