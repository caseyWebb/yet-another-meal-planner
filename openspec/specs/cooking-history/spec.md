# cooking-history Specification

## Purpose
TBD - created by archiving change cooking-log-and-retrospection. Update Purpose after archive.
## Requirements
### Requirement: Durable cooking log, not an eating log

The system SHALL maintain `cooking_log.toml` at the repo root as a durable, append-only record of **cooking events and at-home convenience meals** — not everything eaten. Each entry SHALL carry a `date` (ISO date, required) and a `type` (required, one of `recipe`, `ready_to_eat`, `ad_hoc`). An entry with `type = recipe` SHALL carry a `recipe` slug and SHALL NOT duplicate the recipe's protein/cuisine inline (those are looked up from the recipe index at read time). An entry with `type = ready_to_eat` or `ad_hoc` SHALL carry a `name` and MAY carry inline `protein` / `cuisine` dimensions so it still contributes to mix aggregates. The system SHALL NOT log eating out, and SHALL NOT re-log leftovers of an already-logged cook (one cook that feeds multiple meals is one entry). The log SHALL NOT contain planned-but-not-yet-cooked meals; planned intent lives in `meal_plan.toml`.

#### Scenario: Recipe cook appends a slug-only entry

- **WHEN** the user asserts they cooked a corpus recipe
- **THEN** an entry with `date`, `type = recipe`, and the `recipe` slug is appended to `cooking_log.toml`, with no inline protein/cuisine

#### Scenario: Ad-hoc meal carries inline dimensions

- **WHEN** the user logs cooking something not in the corpus
- **THEN** a `type = ad_hoc` entry with a `name` and optional inline `protein`/`cuisine` is appended

#### Scenario: Eating out is not logged

- **WHEN** the user mentions eating at a restaurant
- **THEN** no `cooking_log.toml` entry is appended

#### Scenario: Ready-to-eat consumption decrements pantry and records a favorite

- **WHEN** the user says they ate a ready-to-eat item (e.g. "I had the frozen lasagna")
- **THEN** a `type = ready_to_eat` entry is appended and that item's on-hand stock in `pantry.toml` is decremented, and the entry contributes to the item's favored-frequency signal

### Requirement: `last_cooked` is derived from the log

The system SHALL treat recipe frontmatter `last_cooked` as a derived projection equal to the maximum `date` across `cooking_log.toml` entries where `type = recipe` and `recipe` equals that slug. `last_cooked` SHALL be updated **only** when a cooked entry for that recipe is appended, and SHALL be written in the **same** atomic commit as the log append. `last_cooked` SHALL NOT be modified at plan/menu-agreement time.

#### Scenario: Cooking a recipe bumps last_cooked in the same commit

- **WHEN** a `type = recipe` cooked entry is appended for `arroz-caldo` dated 2026-06-09
- **THEN** the same commit sets `arroz-caldo`'s `last_cooked` to 2026-06-09

#### Scenario: Planning does not move last_cooked

- **WHEN** a recipe is added to the plan but not yet cooked
- **THEN** its `last_cooked` is unchanged

### Requirement: Cook-capture transition

The system SHALL provide a cook-capture path (folded into `commit_changes` via a `cooking_log_entries` section, not a new per-file tool) that, in one atomic commit, appends the cooked entry, updates the derived `last_cooked`, applies any pantry decrements the user confirms, and removes the corresponding `planned` row from `meal_plan.toml` when the cook resolves a planned item. The agent SHALL NOT claim a meal was logged that the user did not assert.

#### Scenario: Confirmed cook persists log, last_cooked, pantry, and clears the plan

- **WHEN** the user confirms they made a planned recipe and used the last of an ingredient
- **THEN** one commit appends the cooked entry, sets `last_cooked`, removes the ingredient from the pantry, and removes the recipe's `planned` row from `meal_plan.toml`

#### Scenario: Unplanned cook still logs

- **WHEN** the user asserts cooking something that was not in `meal_plan.toml`
- **THEN** a cooked entry is appended (and `last_cooked` bumped for a recipe type) without requiring a prior plan row

### Requirement: Retrospective over real cooking history

The system SHALL provide a `retrospective(period)` tool that aggregates `cooking_log.toml` over the requested period, joining `type = recipe` entries to the recipe index for protein/cuisine. It SHALL return `recipes_cooked` (cooks in the window), `protein_mix` and `cuisine_mix` (counts by dimension over the window, including inline dimensions from non-recipe entries; entries lacking a dimension bucket under `unknown`), `underused` (recipes not cooked for a long interval, by derived `last_cooked`), a **cadence** measure (cooks per week over the period, counting `recipe` + `ad_hoc` only — `ready_to_eat` is not cooking), a **cook-vs-convenience** breakdown (cooked = `recipe` + `ad_hoc` vs convenience = `ready_to_eat`), and **`ready_to_eat_favorites`** (ready-to-eat names frequency-ranked over the period).

#### Scenario: Protein mix reflects every cook, not just the latest

- **WHEN** a protein is cooked multiple times in the period
- **THEN** `protein_mix` counts each cook event, not one entry per recipe

#### Scenario: Cadence counts cooking, not convenience

- **WHEN** the period contains both `recipe`/`ad_hoc` and `ready_to_eat` entries
- **THEN** cadence counts only the `recipe` and `ad_hoc` entries, while cook-vs-convenience reports both sides

#### Scenario: Ready-to-eat favorites are frequency-ranked

- **WHEN** the period contains repeated `ready_to_eat` entries for the same item
- **THEN** `ready_to_eat_favorites` ranks that item by how often it appears

#### Scenario: Underused still answerable

- **WHEN** a recipe has not been cooked for a long interval
- **THEN** it appears in `underused` based on its derived `last_cooked`

### Requirement: Ready-to-eat acquisition is cross-recorded at inventory capture

Ready-to-eat consumption decrements on-hand stock in `pantry.toml` (the catalog `ready_to_eat.toml` is options-only), so the on-hand view is only correct if acquisition records the same stock. Whenever the agent records physical inventory **outside onboarding** — notably the standalone `update_pantry` flow (e.g. a freezer haul of frozen dinners) — and the items named are heat-and-eat items, the agent SHALL record their on-hand stock via `update_pantry` AND SHALL **offer** to add them to the caller's ready-to-eat catalog via `add_draft_ready_to_eat` (`status: active`) when they are not already cataloged, using a consistent `name` so the favorites↔pantry-on-hand restock cross-reference matches. It SHALL offer rather than silently catalog (consistent with the persona's don't-auto-add stance) and SHALL require no new MCP tool. (The onboarding capture points are covered by the guided-onboarding capability.)

#### Scenario: Ad-hoc freezer haul of heat-and-eat items is offered for cataloging

- **WHEN** the member says they just stocked the freezer with several frozen dinners via the pantry-update flow
- **THEN** the agent records them as pantry on-hand stock via `update_pantry` and offers to add the ones not already in the catalog to `ready_to_eat.toml` via `add_draft_ready_to_eat`, under the same name used in the pantry

#### Scenario: Already-cataloged item only updates stock

- **WHEN** a heat-and-eat item the member restocks is already an `active` entry in their ready-to-eat catalog
- **THEN** the agent records the on-hand stock via `update_pantry` and does not re-add a duplicate catalog entry
