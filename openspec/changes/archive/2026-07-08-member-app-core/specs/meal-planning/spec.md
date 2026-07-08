## MODIFIED Requirements

### Requirement: Meal plan is stored in and served from D1

The meal plan SHALL be stored as rows in the per-tenant D1 `meal_plan` table (keyed by `(tenant, recipe)`), not as a `meal_plan.toml` file or a `state:<username>:meal_plan` JSON array in KV. `read_meal_plan` SHALL query rows; `update_meal_plan` SHALL upsert (with open-world `sides`) and delete rows. In addition to the union-only `add` and the `remove`, `update_meal_plan` SHALL provide a **`set`** op that edits an existing row's mutable fields with replace semantics, keyed by recipe slug: a supplied `sides` array SHALL replace the row's sides wholesale (an empty array removes them all — the only way to remove a side); a supplied `planned_for` SHALL be set, and an explicit `planned_for: null` SHALL clear the scheduled date; `from_vibe` SHALL be preserved unless supplied. A `set` addressing a recipe with no planned row SHALL be reported as a per-op conflict, not an error. When a recipe is cooked, `log_cooked` SHALL remove it from the meal plan in the **same D1 transaction** as the cooking-log insert. Writes are strongly consistent and row-level (no whole-array rewrite).

#### Scenario: Planning a recipe upserts one row

- **WHEN** `update_meal_plan` adds a recipe with sides
- **THEN** a single `meal_plan` row is upserted, preserving the rest of the plan

#### Scenario: Cooking clears the plan atomically

- **WHEN** `log_cooked` logs a recipe that is on the meal plan
- **THEN** the cooking-log insert and the meal-plan row delete commit together in one D1 transaction

#### Scenario: A side is removed via set

- **WHEN** `update_meal_plan` applies `{ op: "set", recipe, sides: ["white rice"] }` to a row currently carrying `["white rice", "roasted broccoli"]`
- **THEN** the row's sides are replaced wholesale with `["white rice"]`, and its `planned_for` and `from_vibe` are unchanged

#### Scenario: A night is unscheduled via set

- **WHEN** `update_meal_plan` applies `{ op: "set", recipe, planned_for: null }` to a scheduled row
- **THEN** the row's `planned_for` is cleared while the row (and its sides and `from_vibe`) remains planned
