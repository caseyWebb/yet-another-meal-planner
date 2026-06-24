## MODIFIED Requirements

### Requirement: Meal plan is stored in and served from D1

The meal plan SHALL be stored as rows in the D1 `meal_plan` table (per tenant, keyed by recipe), not as a `state:<username>:meal_plan` JSON array in KV. `read_meal_plan` SHALL query rows; `update_meal_plan` SHALL upsert (with open-world `sides`) and delete rows. When a recipe is cooked, `log_cooked` SHALL remove it from the meal plan in the **same D1 transaction** as the cooking-log insert.

#### Scenario: Planning a recipe upserts one row

- **WHEN** `update_meal_plan` adds a recipe with sides
- **THEN** a single `meal_plan` row is upserted, preserving the rest of the plan

#### Scenario: Cooking clears the plan atomically

- **WHEN** `log_cooked` logs a recipe that is on the meal plan
- **THEN** the cooking-log insert and the meal-plan row delete commit together in one D1 transaction
