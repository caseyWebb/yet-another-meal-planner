## MODIFIED Requirements

### Requirement: Durable cooking log, not an eating log

The system SHALL maintain the per-tenant cooking log as rows in the D1 `cooking_log` table (`tenant`, `date`, `type`, `recipe`, `name`, `protein`, `cuisine`, `meal`) — a durable, append-only record of **cooking events**, not everything eaten. Each row SHALL carry a `date` (ISO date, required) and a `type` (required; new rows are one of `recipe`, `ad_hoc`), and MAY carry a **`meal`** — a nullable closed-set value `breakfast | lunch | dinner | project`, where NULL means "unknown / not a meal" (stories/02 Q2: there is no fourth "other" enum value — `type` and `meal` are orthogonal axes; a baked loaf logs `{ type: 'ad_hoc', meal: null }`). Rows that predate the meal dimension keep `meal` NULL — the migration never fabricates a meal. **Historical rows stored with the retired `type = 'ready_to_eat'` keep their stored type** — no backfill or re-typing — and every read SHALL handle them without error, treating them exactly as before the type's retirement (excluded from cook counts; inline dimensions contribute to mixes). A row with `type = recipe` SHALL carry a `recipe` slug (a soft reference to `recipes.slug`, no foreign-key constraint — history survives a recipe's removal) and SHALL NOT duplicate the recipe's protein/cuisine inline (those are looked up from the `recipes` table at read time). A non-`recipe` row SHALL carry a `name` and MAY carry inline `protein` / `cuisine` dimensions so it still contributes to mix aggregates. The system SHALL NOT log eating out, and SHALL NOT re-log leftovers of an already-logged cook (one cook that feeds multiple meals is one entry). The log SHALL NOT contain planned-but-not-yet-cooked meals; planned intent lives in the D1 `meal_plan` table.

#### Scenario: Recipe cook appends a slug row with its meal

- **WHEN** the user asserts they cooked a corpus recipe for dinner
- **THEN** a `cooking_log` row with `date`, `type = recipe`, the `recipe` slug, and `meal = 'dinner'` is inserted for the caller, with no inline protein/cuisine

#### Scenario: Pre-existing rows stay meal-unknown (F4)

- **WHEN** the meal-dimension migration runs over the production log (four `type = 'recipe'` rows)
- **THEN** all four rows carry `meal` NULL — nothing is fabricated — and they still count in overall cadence while reporting under `meal_unknown`

#### Scenario: A non-meal event logs with a null meal

- **WHEN** the user logs baking a loaf of bread
- **THEN** a `type = ad_hoc` entry with `meal` NULL is appended — no fourth "other" meal value exists

#### Scenario: Eating out is not logged

- **WHEN** the user mentions eating at a restaurant
- **THEN** no `cooking_log` row is appended

#### Scenario: Historical ready_to_eat rows are preserved and never break a read

- **WHEN** a caller's log contains rows stored with the retired `type = 'ready_to_eat'` and any log read (retrospective, the member log page, insights) runs
- **THEN** the rows keep their stored type, the read completes without error, and each row is treated as it was before the retirement — excluded from cook counts, inline dimensions contributing to mixes

### Requirement: Cook-capture appends to D1 via log_cooked

The system SHALL provide a cook-capture path via the `log_cooked` tool, which appends one cooking event to the caller's `cooking_log` table and returns without a `commit_sha`. It SHALL accept an optional **`meal`** (`breakfast | lunch | dinner | project`; omitted stores NULL, valid on all `type`s — cooking a planned project logs `{ type: 'recipe', meal: 'project' }`) and an optional **`plan_row_id`** addressing the exact plan row to clear. It SHALL validate the entry at write time (an ISO `date` defaulting to today; a `type` in {`recipe`, `ad_hoc`}; a `recipe` entry's slug resolved against the D1 `recipes` table; an `ad_hoc` entry requires `name`) — an unresolved slug is a structured `not_found` error written nowhere, and a missing required field is a `validation_failed` error. For **one deprecation window**, a stale plugin's `type: "ready_to_eat"` SHALL be accepted and converted to `type: "ad_hoc"` — `name`, `date`, `meal`, and inline dimensions carried over, the stored row `ad_hoc`, the success return carrying `warnings: [{ key: "type", reason: "retired", superseded_by: "ad_hoc" }]`; the dedupe identity and plan-clear logic operate on the converted form. After the window, `type: "ready_to_eat"` SHALL be rejected as `validation_failed` like any unknown type. For a `recipe` entry it SHALL clear **at most one** matching `meal_plan` row per the deterministic clear order (the dedicated requirement below), in the **same D1 transaction** as the cooking-log insert, returning `cleared_plan_row?: { id, recipe, meal, planned_for }` additively. Route-level idempotent dedupe identity SHALL be **per-`(date, meal, type, recipe|name)`**, where a NULL `meal` matches NULL only — this is cooking_log **dedupe identity only, never plan-row identity**. Any pantry decrements the user confirms are applied via `update_pantry`. The build SHALL NOT validate the cooking log (it is no longer in GitHub). The agent SHALL NOT claim a meal was logged that the user did not assert.

#### Scenario: Recipe entry with a real slug is logged and clears one row atomically

- **WHEN** `log_cooked({ type: "recipe", recipe: "miso-salmon", meal: "dinner" })` is called and `miso-salmon` exists in `recipes` with one planned row
- **THEN** a `cooking_log` row is inserted for the caller dated today with `meal = 'dinner'`, exactly that plan row is deleted in the same D1 transaction, and the result carries `cleared_plan_row` with the row's id

#### Scenario: Recipe entry with an unknown slug is rejected

- **WHEN** `log_cooked({ type: "recipe", recipe: "not-a-recipe" })` is called and no such slug exists
- **THEN** a structured `not_found` error is returned and nothing is written

#### Scenario: A stale ready_to_eat write converts to ad_hoc during the window

- **WHEN** a stale plugin calls `log_cooked({ type: "ready_to_eat", name: "frozen lasagna", meal: "dinner" })` during the deprecation window
- **THEN** the stored row is `{ type: 'ad_hoc', name: 'frozen lasagna', meal: 'dinner' }`, the write succeeds, the return carries the `warnings` conversion entry, and a replay of the same call dedupes against the converted `(date, meal, 'ad_hoc', name)` identity

#### Scenario: Unplanned cook still logs

- **WHEN** the user asserts cooking something that was not on the meal plan
- **THEN** a `cooking_log` row is inserted without requiring a prior plan row, and no plan row is cleared

#### Scenario: The dedupe identity includes the meal

- **WHEN** the same recipe is logged twice on one date, once with `meal: "lunch"` and once with `meal: "dinner"`
- **THEN** both rows exist (different dedupe identities), while a replay of either exact `(date, meal, type, recipe)` tuple is deduplicated — and this identity is never used as plan-row identity

### Requirement: Retrospective over real cooking history

The system SHALL provide a `retrospective(period)` tool that aggregates the caller's `cooking_log` rows over the requested period, resolving each `type = recipe` row's protein/cuisine from the D1 `recipes` table (a `cooking_log LEFT JOIN recipes`) and each non-recipe row's dimensions from its inline columns. It SHALL return `recipes_cooked` (cooks in the window), `protein_mix` and `cuisine_mix` (counts by dimension over the window, including inline dimensions from non-recipe rows — historical `ready_to_eat` rows included; rows lacking a dimension bucket under `unknown`), a **meal-aware cadence** measure — the overall `cooks_per_week` (definition unchanged: cooks per week over the period, counting stored `recipe` + `ad_hoc` rows only — historical `ready_to_eat` rows remain excluded, exactly as before the type's retirement), plus **`by_meal: { breakfast, lunch, dinner, project }`** over rows whose `meal` is set and **`meal_unknown: N`** counting NULL-meal rows (pre-migration rows are counted in the overall figure, reported unknown, never fabricated) — and **`underused`** with its companion **`underused_count`** (defined below). The return SHALL NOT include a `cook_vs_convenience` breakdown or a `ready_to_eat_favorites` list — both are removed with the ready-to-eat concept, with no empty-shell placeholder keys. A log containing historical `ready_to_eat` rows SHALL aggregate without error. An empty log SHALL return an empty result with no error.

The `period` argument SHALL scope only `recipes_cooked`, `protein_mix`, `cuisine_mix`, and cadence (including `by_meal` and `meal_unknown`). `underused` SHALL be **independent of `period`** and SHALL surface **loved recipes that have gone quiet and are in season** — not "every recipe not cooked in the window." A recipe SHALL qualify as `underused` WHEN all of the following hold:

- **loved** — the caller has favorited it (declared preference), OR has cooked it (`type = recipe`) **at least 3 times within the trailing 12 months** ending at `now` (revealed preference);
- **stale** — its derived `last_cooked` is `null` (never cooked) or strictly older than a **fixed 30-day** window ending at `now`;
- **in season** — its `season` is empty (year-round) or includes the **current season**, derived from `now` (Northern-hemisphere meteorological months);
- **not rejected** — a recipe the caller has rejected SHALL NOT appear, even when it is otherwise loved and stale.

Each `underused` item SHALL carry `slug`, `title`, `last_cooked`, `why` (`"favorite"` when the caller favorited the recipe, otherwise `"revealed"`), and `cook_count` (the caller's **all-time** `type = recipe` count for that slug). `underused` SHALL be ordered stalest-first (never-cooked before any cooked, then ascending `last_cooked`, then `slug`) and SHALL be **capped at the 15 stalest items**. `underused_count` SHALL report the total number of qualifying recipes before the cap, so the caller can tell how many were elided.

#### Scenario: Protein mix reflects every cook, not just the latest

- **WHEN** a protein is cooked multiple times in the period
- **THEN** `protein_mix` counts each cook event, not one row per recipe

#### Scenario: Cadence reports per-meal counts and the unknown bucket (F4)

- **WHEN** `retrospective` runs over a log holding two dinner-mealed rows, one lunch-mealed row, and four pre-migration NULL-meal rows
- **THEN** the cadence section reports the overall `cooks_per_week` over all seven, `by_meal` with `dinner: 2` and `lunch: 1`, and `meal_unknown: 4` — no meal is fabricated for the NULL rows

#### Scenario: retrospective joins the recipe index

- **WHEN** `retrospective` runs for a window
- **THEN** it queries the caller's `cooking_log` rows joined to `recipes`, using each recipe row's recipe-derived protein/cuisine and each non-recipe row's inline dimensions

#### Scenario: Empty log is valid

- **WHEN** the caller has no `cooking_log` rows
- **THEN** `retrospective` returns an empty result (including an empty `underused` and `underused_count: 0`) with no error

#### Scenario: Historical ready_to_eat rows aggregate as before, without RTE fields

- **WHEN** the period contains `recipe` and `ad_hoc` entries alongside historical rows stored with `type = 'ready_to_eat'`
- **THEN** cadence counts only the `recipe` and `ad_hoc` entries (the historical rows stay excluded, as before the retirement), the historical rows' inline dimensions still contribute to `protein_mix`/`cuisine_mix`, the result contains no `cook_vs_convenience` or `ready_to_eat_favorites` key, and no error occurs

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

## REMOVED Requirements

### Requirement: Ready-to-eat acquisition is cross-recorded at inventory capture

**Reason**: The ready-to-eat catalog and its write tools (`add_draft_ready_to_eat`) are removed wholesale, so there is no catalog to keep in sync with pantry stock. Heat-and-eat items a member keeps on hand are just pantry items now.
**Migration**: None — the agent continues recording physical inventory via `update_pantry`; the catalog-offer half of the behavior simply ceases. Historical catalog rows stay inert in the retained D1 `ready_to_eat` table.
