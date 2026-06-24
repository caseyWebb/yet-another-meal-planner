## MODIFIED Requirements

### Requirement: Cooking log is stored in and served from D1

The per-tenant cooking log SHALL be stored as rows in the D1 `cooking_log` table (`tenant`, `date`, `type`, `recipe`, `name`, `protein`, `cuisine`), not as `users/<username>/cooking_log.toml` in GitHub. It is append-only in normal use; each row is one cooking event. A recipe-type entry's `recipe` is a soft reference to `recipes.slug` (no foreign-key constraint — history survives a recipe's removal).

`last_cooked` for a recipe SHALL be derived by query (`MAX(date)` over the caller's `type='recipe'` rows, grouped by `recipe`), never stored on the recipe. `retrospective` SHALL aggregate over the caller's rows within the requested window, resolving each event's protein/cuisine from the `recipes` table for recipe entries (a `LEFT JOIN`) and from the row's inline dimensions for non-recipe entries.

#### Scenario: last_cooked is a query, not a stored field

- **WHEN** `list_recipes` or `read_recipe` resolves a recipe's `last_cooked`
- **THEN** the value comes from `MAX(date)` over the caller's `cooking_log` recipe rows for that slug, with no `last_cooked` written to the recipe

#### Scenario: retrospective joins the recipe index

- **WHEN** `retrospective` runs for a window
- **THEN** it queries the caller's `cooking_log` rows joined to `recipes`, using each recipe entry's recipe-derived protein/cuisine and each non-recipe entry's inline dimensions

#### Scenario: Empty log is valid

- **WHEN** the caller has no `cooking_log` rows
- **THEN** `retrospective` returns an empty result and `last_cooked` is absent for all recipes, with no error

### Requirement: Cooking events are validated at write time with slug resolution

A new cooking event SHALL be appended via the `log_cooked` tool, which validates the entry at write time: an ISO `date` (defaulting to today), a `type` in {`recipe`, `ready_to_eat`, `ad_hoc`}, and — for a `recipe` entry — a `recipe` slug that **resolves against the D1 `recipes` table**. An unresolved slug SHALL be a structured `not_found` error, written nowhere. The build SHALL NOT validate the cooking log (it is no longer in GitHub).

#### Scenario: Recipe entry with a real slug is logged

- **WHEN** `log_cooked({ type: "recipe", recipe: "miso-salmon" })` is called and `miso-salmon` exists in `recipes`
- **THEN** a row is inserted for the caller dated today, and the recipe is cleared from the caller's meal plan

#### Scenario: Recipe entry with an unknown slug is rejected

- **WHEN** `log_cooked({ type: "recipe", recipe: "not-a-recipe" })` is called and no such slug exists
- **THEN** a structured `not_found` error is returned and nothing is written

#### Scenario: Non-recipe entry requires a name

- **WHEN** `log_cooked({ type: "ad_hoc" })` is called with no `name`
- **THEN** a structured validation error is returned
