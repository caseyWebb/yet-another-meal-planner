## MODIFIED Requirements

### Requirement: Transient meal plan of committed cook intent

The system SHALL maintain the meal plan as a JSON value stored at DATA_KV key `state:<username>:meal_plan` — a transient, recipe-grain record of committed cook intent. The meal plan is no longer stored as `meal_plan.toml` in the GitHub data repo. Each planned entry SHALL carry a `recipe` slug and MAY carry an optional `planned_for` ISO date. A planned entry MAY additionally carry an optional **`sides`** array of free-text **open-world side** names (e.g. `["roasted broccoli", "white rice"]`) — sides that accompany the main on the plate but are not themselves corpus recipes. The `sides` array SHALL be advisory free text only: it SHALL NOT be slug-resolved. A **corpus side** (a `course: side` recipe with a slug) SHALL earn its own planned entry. The meal plan SHALL be distinct from the grocery list: a planned recipe whose ingredients are all in the pantry SHALL still appear in the meal plan. Entries SHALL be cleared as they resolve — removed when the recipe is cooked, or dropped when abandoned. All reads and writes SHALL go through DATA_KV with no GitHub API call.

#### Scenario: Planned recipe recorded even when nothing must be bought

- **WHEN** the user agrees to cook a recipe whose ingredients are all in the pantry
- **THEN** a planned entry for that recipe is written to `state:<username>:meal_plan` in DATA_KV even though nothing is added to the grocery list

#### Scenario: Cooking clears the planned entry

- **WHEN** a planned recipe is cooked and logged
- **THEN** its entry is removed from `state:<username>:meal_plan` in DATA_KV in the same operation as the cooking log write

#### Scenario: Open-world side rides on its main's entry

- **WHEN** the user agrees to a main rounded out with an open-world side ("roasted broccoli") that is not a corpus recipe
- **THEN** the main's planned entry carries `sides = ["roasted broccoli"]`, no separate slug entry is created for the side

#### Scenario: Corpus side earns its own entry

- **WHEN** the user agrees to a main paired with a `course: side` corpus recipe
- **THEN** the corpus side gets its own planned entry (not a `sides` item on the main's entry)

#### Scenario: Meal plan reads from KV with no GitHub call

- **WHEN** `read_meal_plan()` is called
- **THEN** the Worker reads `state:<username>:meal_plan` from DATA_KV and returns the planned entries without making any GitHub API call
