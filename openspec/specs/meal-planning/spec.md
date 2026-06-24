# meal-planning Specification

## Purpose
TBD - created by archiving change cooking-log-and-retrospection. Update Purpose after archive.
## Requirements
### Requirement: Meal plan is stored in and served from D1

The meal plan SHALL be stored as rows in the per-tenant D1 `meal_plan` table (keyed by `(tenant, recipe)`), not as a `meal_plan.toml` file or a `state:<username>:meal_plan` JSON array in KV. `read_meal_plan` SHALL query rows; `update_meal_plan` SHALL upsert (with open-world `sides`) and delete rows. When a recipe is cooked, `log_cooked` SHALL remove it from the meal plan in the **same D1 transaction** as the cooking-log insert. Writes are strongly consistent and row-level (no whole-array rewrite).

#### Scenario: Planning a recipe upserts one row

- **WHEN** `update_meal_plan` adds a recipe with sides
- **THEN** a single `meal_plan` row is upserted, preserving the rest of the plan

#### Scenario: Cooking clears the plan atomically

- **WHEN** `log_cooked` logs a recipe that is on the meal plan
- **THEN** the cooking-log insert and the meal-plan row delete commit together in one D1 transaction

### Requirement: Transient meal plan of committed cook intent

The meal plan SHALL be a transient, recipe-grain record of committed cook intent (the D1 `meal_plan` table). Each row SHALL carry a `recipe` slug and MAY carry an optional `planned_for` ISO date. A row MAY additionally carry an optional **`sides`** array of free-text **open-world side** names (e.g. `["roasted broccoli", "white rice"]`) — sides that accompany the main on the plate but are not themselves corpus recipes and therefore have no slug. The `sides` array SHALL be advisory free text only: it SHALL NOT be slug-resolved, and the `recipe` slug invariant (and the reconcile/cook flows that key off it) SHALL be unaffected by its presence. A **corpus side** (a `course: side` recipe with a slug) SHALL instead earn its own row, not an entry in another row's `sides`. The meal plan SHALL be distinct from the grocery list: the grocery list is ingredient-grain and holds only items to buy, so a planned recipe whose ingredients are all already in the pantry SHALL still appear in the meal plan. Rows SHALL be cleared as they resolve — removed when the recipe is cooked, or dropped when abandoned.

#### Scenario: Planned recipe recorded even when nothing must be bought

- **WHEN** the user agrees to cook a recipe whose ingredients are all in the pantry
- **THEN** a `meal_plan` row for that recipe is upserted even though nothing is added to the grocery list

#### Scenario: Cooking clears the planned row

- **WHEN** a planned recipe is cooked and logged
- **THEN** its `meal_plan` row is removed in the same D1 transaction as the cooking-log insert

#### Scenario: Open-world side rides on its main's row

- **WHEN** the user agrees to a main rounded out with an open-world side ("roasted broccoli") that is not a corpus recipe
- **THEN** the main's `meal_plan` row carries `sides = ["roasted broccoli"]`, no separate slug row is created for the side, and the row's `recipe` slug (and the reconcile) is unchanged

#### Scenario: Corpus side earns its own row

- **WHEN** the user agrees to a main paired with a `course: side` corpus recipe
- **THEN** the corpus side gets its own `meal_plan` slug row (not a `sides` entry on the main's row)

### Requirement: Read the meal plan

The system SHALL provide a `read_meal_plan` tool returning the current `meal_plan` rows so the agent can resume cook intent across sessions.

#### Scenario: Plan readable in a fresh session

- **WHEN** a new conversation begins and the `meal_plan` table has rows for the caller
- **THEN** `read_meal_plan` returns those rows with their `recipe` slugs and any `planned_for` dates

### Requirement: Plan and cook modes

`AGENT_INSTRUCTIONS.md` SHALL define two operating modes. **Plan mode** SHALL cover the existing inventory, recipe, menu, and order behavior, and SHALL write `planned` rows on menu agreement. **Cook mode** SHALL be triggered by the user asserting they are making or have made a dish ("I'm making X", "I made X"), and SHALL walk the user through confirming the cook and updating inventory, including asking whether the last of consumed ingredients was used. The full hands-free, voice-guided step-by-step walkthrough is out of scope for this change and SHALL be deferred to a later Guided cook mode change; cook mode here SHALL be the minimal confirm-and-capture flow.

#### Scenario: Cook-intent utterance enters cook mode

- **WHEN** the user says "I'm making the arroz caldo"
- **THEN** the agent enters the minimal cook-capture flow: confirm the dish, prompt pantry decrements, ask about using the last of ingredients, and log the cook on completion

#### Scenario: Guided walkthrough is not attempted

- **WHEN** the user is in cook mode in this change
- **THEN** the agent performs confirm-and-capture and does NOT attempt timed step-by-step guidance (deferred)

### Requirement: Stale-planned reconcile at session start

When a session begins with **due** planned rows in the `meal_plan` table, the agent SHALL surface them and ask whether any were cooked — structurally parallel to the order flow's stale-cart check. A row is **due** when its `planned_for` is on or before today, or when `planned_for` is unset; future-dated rows SHALL NOT trigger the reconcile. Recipes the user confirms cooked SHALL be logged and cleared; recipes the user abandons SHALL be dropped from the plan. The agent SHALL NOT silently assume planned recipes were cooked.

#### Scenario: Due plan prompts a reconcile

- **WHEN** a new session starts and the `meal_plan` table has rows with `planned_for` on or before today (or unset)
- **THEN** the agent asks which were cooked, logs and clears the confirmed ones, and drops the abandoned ones

#### Scenario: Future-dated plan does not nag

- **WHEN** the only planned rows have a `planned_for` after today
- **THEN** the agent does not prompt a reconcile for them

#### Scenario: No silent promotion

- **WHEN** the user does not confirm cooking a due planned recipe
- **THEN** the agent leaves it unlogged (its `last_cooked` unchanged) rather than recording a cook

