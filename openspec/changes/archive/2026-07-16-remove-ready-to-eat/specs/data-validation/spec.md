## MODIFIED Requirements

### Requirement: Cooking-log and meal-plan structural validation

The cooking log and meal plan SHALL be validated at write time by the Worker's `log_cooked` and `update_meal_plan` tools (D1 storage — not `.toml` files). The Worker SHALL enforce: a `cooking_log` entry requires `date` and `type` (∈ `recipe`/`ad_hoc`); a `type = recipe` entry requires `recipe` resolved against the D1 `recipes` table; an `ad_hoc` entry requires `name`; a `meal_plan` row requires `recipe` resolved against `recipes`; a `sides` value when present MUST be an array of strings (free-text, not slug-resolved); and all `date`/`planned_for` values MUST be valid ISO dates. For one deprecation window, an incoming `type: "ready_to_eat"` is accepted and converted to `type: "ad_hoc"` (the `data-write-tools` shim); after the window it is rejected like any unknown type. Historical `cooking_log` rows already stored with `type = 'ready_to_eat'` are valid stored data and SHALL NOT be re-validated, rewritten, or rejected by any read. The reconcile SHALL NOT validate these data sources (they are D1, written and validated by their own tools).

#### Scenario: Unknown cooking-log type is rejected at write

- **WHEN** `log_cooked` is called with `type: "snack"`
- **THEN** the Worker returns a structured `validation_failed` error and nothing is written

#### Scenario: The retired ready_to_eat type converts during the window only

- **WHEN** `log_cooked` is called with `type: "ready_to_eat"` and a `name`
- **THEN** during the deprecation window the entry is stored as `type = 'ad_hoc'` with a `warnings` entry, and after the window the call is rejected with `validation_failed` like any unknown type

#### Scenario: Recipe entry with unresolved slug is rejected at write

- **WHEN** `log_cooked` is called with `type: "recipe"` and a slug not in the D1 `recipes` table
- **THEN** the Worker returns a structured `not_found` error and nothing is written

#### Scenario: Free-text sides on a planned row are not slug-resolved

- **WHEN** `update_meal_plan` adds a row with `sides: ["roasted broccoli"]` and "roasted broccoli" resolves to no recipe slug
- **THEN** the write succeeds — `sides` is free-text, validated as an array of strings only

## REMOVED Requirements

### Requirement: Ready-to-eat catalog structural validation

**Reason**: The ready-to-eat write surface is removed wholesale; with no tool writing the catalog, there is no write boundary at which to validate its shape. The D1 `ready_to_eat` table and its historical rows are retained untouched pending a future rethink.
**Migration**: None — nothing writes the catalog, so no validation is needed. If a future change reintroduces a ready-to-eat concept, it defines its own validation from scratch.
