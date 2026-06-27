## MODIFIED Requirements

### Requirement: Retrospective over real cooking history

The system SHALL provide a `retrospective(period)` tool that aggregates the caller's `cooking_log` rows over the requested period, resolving each `type = recipe` row's protein/cuisine from the D1 `recipes` table (a `cooking_log LEFT JOIN recipes`) and each non-recipe row's dimensions from its inline columns. It SHALL return `recipes_cooked` (cooks in the window), `protein_mix` and `cuisine_mix` (counts by dimension over the window, including inline dimensions from non-recipe rows; rows lacking a dimension bucket under `unknown`), a **cadence** measure (cooks per week over the period, counting `recipe` + `ad_hoc` only — `ready_to_eat` is not cooking), a **cook-vs-convenience** breakdown (cooked = `recipe` + `ad_hoc` vs convenience = `ready_to_eat`), **`ready_to_eat_favorites`** (ready-to-eat names frequency-ranked over the period), and **`underused`** with its companion **`underused_count`** (defined below). An empty log SHALL return an empty result with no error.

The `period` argument SHALL scope only `recipes_cooked`, `protein_mix`, `cuisine_mix`, cadence, cook-vs-convenience, and `ready_to_eat_favorites`. `underused` SHALL be **independent of `period`** and SHALL surface **loved recipes that have gone quiet and are in season** — not "every recipe not cooked in the window." A recipe SHALL qualify as `underused` WHEN all of the following hold:

- **loved** — the caller has favorited it (declared preference), OR has cooked it (`type = recipe`) **at least 3 times within the trailing 12 months** ending at `now` (revealed preference);
- **stale** — its derived `last_cooked` is `null` (never cooked) or strictly older than a **fixed 30-day** window ending at `now`;
- **in season** — its `season` is empty (year-round) or includes the **current season**, derived from `now` (Northern-hemisphere meteorological months);
- **not rejected** — a recipe the caller has rejected SHALL NOT appear, even when it is otherwise loved and stale.

Each `underused` item SHALL carry `slug`, `title`, `last_cooked`, `why` (`"favorite"` when the caller favorited the recipe, otherwise `"revealed"`), and `cook_count` (the caller's **all-time** `type = recipe` count for that slug). `underused` SHALL be ordered stalest-first (never-cooked before any cooked, then ascending `last_cooked`, then `slug`) and SHALL be **capped at the 15 stalest items**. `underused_count` SHALL report the total number of qualifying recipes before the cap, so the caller can tell how many were elided.

#### Scenario: Protein mix reflects every cook, not just the latest

- **WHEN** a protein is cooked multiple times in the period
- **THEN** `protein_mix` counts each cook event, not one row per recipe

#### Scenario: retrospective joins the recipe index

- **WHEN** `retrospective` runs for a window
- **THEN** it queries the caller's `cooking_log` rows joined to `recipes`, using each recipe row's recipe-derived protein/cuisine and each non-recipe row's inline dimensions

#### Scenario: Empty log is valid

- **WHEN** the caller has no `cooking_log` rows
- **THEN** `retrospective` returns an empty result (including an empty `underused` and `underused_count: 0`) with no error

#### Scenario: Cadence counts cooking, not convenience

- **WHEN** the period contains both `recipe`/`ad_hoc` and `ready_to_eat` entries
- **THEN** cadence counts only the `recipe` and `ad_hoc` entries, while cook-vs-convenience reports both sides

#### Scenario: Ready-to-eat favorites are frequency-ranked

- **WHEN** the period contains repeated `ready_to_eat` entries for the same item
- **THEN** `ready_to_eat_favorites` ranks that item by how often it appears

#### Scenario: A stale favorite is underused

- **WHEN** the caller has favorited a recipe whose derived `last_cooked` is older than 30 days and whose season includes the current season
- **THEN** it appears in `underused` with `why: "favorite"`

#### Scenario: A favorited-but-never-cooked recipe is underused

- **WHEN** the caller has favorited an in-season recipe they have never cooked (`last_cooked` is `null`)
- **THEN** it appears in `underused` with `why: "favorite"` and sorts ahead of every cooked entry

#### Scenario: A revealed favorite that has gone quiet is underused

- **WHEN** the caller has never favorited an in-season recipe but has cooked it at least 3 times in the trailing 12 months and not within the last 30 days
- **THEN** it appears in `underused` with `why: "revealed"` and `cook_count` equal to its all-time cook count

#### Scenario: A one-off cook is not underused

- **WHEN** an in-season recipe the caller has not favorited was cooked only once in the trailing 12 months and is stale
- **THEN** it does NOT appear in `underused` (a single cook is not revealed preference)

#### Scenario: A rejected recipe is excluded even when loved and stale

- **WHEN** an in-season recipe the caller cooked many times was later rejected
- **THEN** it does NOT appear in `underused`

#### Scenario: An out-of-season loved recipe is excluded

- **WHEN** the caller has favorited a stale recipe whose `season` is `["winter"]` and the current season is `summer`
- **THEN** it does NOT appear in `underused`; a favorited stale recipe with `season: []` under the same conditions DOES appear

#### Scenario: Underused ignores the period and uses a fixed 30-day window

- **WHEN** `retrospective("year")` runs and the caller has favorited a recipe cooked 20 days ago
- **THEN** that recipe is NOT `underused` (cooked within the fixed 30-day staleness window), regardless of the year-long `period`

#### Scenario: Underused is capped with a total count

- **WHEN** more than 15 loved, stale, in-season recipes qualify
- **THEN** `underused` returns the 15 stalest items and `underused_count` reports the full qualifying total
