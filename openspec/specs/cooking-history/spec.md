# cooking-history Specification

## Purpose
TBD - created by archiving change cooking-log-and-retrospection. Update Purpose after archive.
## Requirements
### Requirement: Durable cooking log, not an eating log

The system SHALL maintain the per-tenant cooking log as rows in the D1 `cooking_log` table (`tenant`, `date`, `type`, `recipe`, `name`, `protein`, `cuisine`) — a durable, append-only record of **cooking events and at-home convenience meals**, not everything eaten — not as `users/<username>/cooking_log.toml` in GitHub. Each row SHALL carry a `date` (ISO date, required) and a `type` (required, one of `recipe`, `ready_to_eat`, `ad_hoc`). A row with `type = recipe` SHALL carry a `recipe` slug (a soft reference to `recipes.slug`, no foreign-key constraint — history survives a recipe's removal) and SHALL NOT duplicate the recipe's protein/cuisine inline (those are looked up from the `recipes` table at read time). A row with `type = ready_to_eat` or `ad_hoc` SHALL carry a `name` and MAY carry inline `protein` / `cuisine` dimensions so it still contributes to mix aggregates. The system SHALL NOT log eating out, and SHALL NOT re-log leftovers of an already-logged cook (one cook that feeds multiple meals is one entry). The log SHALL NOT contain planned-but-not-yet-cooked meals; planned intent lives in the D1 `meal_plan` table.

#### Scenario: Recipe cook appends a slug-only row

- **WHEN** the user asserts they cooked a corpus recipe
- **THEN** a `cooking_log` row with `date`, `type = recipe`, and the `recipe` slug is inserted for the caller, with no inline protein/cuisine

#### Scenario: Ad-hoc meal carries inline dimensions

- **WHEN** the user logs cooking something not in the corpus
- **THEN** a `type = ad_hoc` entry with a `name` and optional inline `protein`/`cuisine` is appended

#### Scenario: Eating out is not logged

- **WHEN** the user mentions eating at a restaurant
- **THEN** no `cooking_log` row is appended

#### Scenario: Ready-to-eat consumption decrements pantry and records a favorite

- **WHEN** the user says they ate a ready-to-eat item (e.g. "I had the frozen lasagna")
- **THEN** a `type = ready_to_eat` row is inserted and that item's on-hand stock in the D1 `pantry` table is decremented, and the row contributes to the item's favored-frequency signal

### Requirement: `last_cooked` is derived from the log

The system SHALL treat a recipe's `last_cooked` as a value **derived by query**, equal to `MAX(date)` over the caller's `cooking_log` rows where `type = recipe` and `recipe` equals that slug — never stored on the recipe (the `recipes` table holds no per-tenant `last_cooked`). It is realized automatically when a cooked row for that recipe is appended; there is no separate write. `last_cooked` SHALL NOT be affected at plan/menu-agreement time.

#### Scenario: last_cooked is a query, not a stored field

- **WHEN** `search_recipes` or `read_recipe` resolves a recipe's `last_cooked`
- **THEN** the value comes from `MAX(date)` over the caller's `cooking_log` recipe rows for that slug, with no `last_cooked` written to the recipe

#### Scenario: Cooking a recipe updates its derived last_cooked

- **WHEN** a `type = recipe` row is appended for `arroz-caldo` dated 2026-06-09
- **THEN** `arroz-caldo`'s derived `last_cooked` for the caller becomes 2026-06-09 by query, with nothing written to the recipe

#### Scenario: Planning does not move last_cooked

- **WHEN** a recipe is added to the plan but not yet cooked
- **THEN** its derived `last_cooked` is unchanged

### Requirement: Cook-capture appends to D1 via log_cooked

The system SHALL provide a cook-capture path via the `log_cooked` tool, which appends one cooking event to the caller's `cooking_log` table and returns without a `commit_sha`. It SHALL validate the entry at write time (an ISO `date` defaulting to today; a `type` in {`recipe`, `ready_to_eat`, `ad_hoc`}; a `recipe` entry's slug resolved against the D1 `recipes` table; a non-recipe entry requires `name`) — an unresolved slug is a structured `not_found` error written nowhere, and a missing required field is a `validation_failed` error. For a `recipe` entry it SHALL also remove that recipe from the caller's `meal_plan`, in the **same D1 transaction** as the cooking-log insert. Any pantry decrements the user confirms are applied via `update_pantry`. The build SHALL NOT validate the cooking log (it is no longer in GitHub). The agent SHALL NOT claim a meal was logged that the user did not assert.

#### Scenario: Recipe entry with a real slug is logged and clears the plan atomically

- **WHEN** `log_cooked({ type: "recipe", recipe: "miso-salmon" })` is called and `miso-salmon` exists in `recipes`
- **THEN** a `cooking_log` row is inserted for the caller dated today and the recipe is removed from the caller's `meal_plan` in the same D1 transaction, returning `{ logged }` with no `commit_sha`

#### Scenario: Recipe entry with an unknown slug is rejected

- **WHEN** `log_cooked({ type: "recipe", recipe: "not-a-recipe" })` is called and no such slug exists
- **THEN** a structured `not_found` error is returned and nothing is written

#### Scenario: Unplanned cook still logs

- **WHEN** the user asserts cooking something that was not on the meal plan
- **THEN** a `cooking_log` row is inserted without requiring a prior plan row

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

### Requirement: Ready-to-eat acquisition is cross-recorded at inventory capture

Ready-to-eat consumption decrements on-hand stock in the D1 `pantry` table (the caller's ready-to-eat catalog is options-only), so the on-hand view is only correct if acquisition records the same stock. Whenever the agent records physical inventory **outside onboarding** — notably the standalone `update_pantry` flow (e.g. a freezer haul of frozen dinners) — and the items named are heat-and-eat items, the agent SHALL record their on-hand stock via `update_pantry` AND SHALL **offer** to add them to the caller's ready-to-eat catalog via `add_draft_ready_to_eat` (`status: active`) when they are not already cataloged, using a consistent `name` so the favorites↔pantry-on-hand restock cross-reference matches. It SHALL offer rather than silently catalog (consistent with the persona's don't-auto-add stance) and SHALL require no new MCP tool. (The onboarding capture points are covered by the guided-onboarding capability.)

#### Scenario: Ad-hoc freezer haul of heat-and-eat items is offered for cataloging

- **WHEN** the member says they just stocked the freezer with several frozen dinners via the pantry-update flow
- **THEN** the agent records them as pantry on-hand stock via `update_pantry` and offers to add the ones not already in the catalog via `add_draft_ready_to_eat`, under the same name used in the pantry

#### Scenario: Already-cataloged item only updates stock

- **WHEN** a heat-and-eat item the member restocks is already an `active` entry in their ready-to-eat catalog
- **THEN** the agent records the on-hand stock via `update_pantry` and does not re-add a duplicate catalog entry

