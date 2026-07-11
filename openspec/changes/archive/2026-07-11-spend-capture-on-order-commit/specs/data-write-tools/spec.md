# data-write-tools Specification (delta)

## MODIFIED Requirements

### Requirement: Preferences are edited by merge-patch over structured D1 storage

`update_preferences` SHALL accept a `patch` object and apply it to the caller's preferences with JSON Merge Patch semantics (RFC 7396): present keys set, `null` deletes, nested objects merge to arbitrary depth, arrays replace wholesale. The defined top-level surface is `default_cooking_nights`, `planning_cadence_days`, `lunch_strategy`, `ready_to_eat_default_action`, `weekly_budget`, `stores`, `brands`, `dietary`, `rotation`, and `custom`; a patch top-level key outside that set SHALL be rejected with a structured error directing it under `custom`. `weekly_budget` is the household's weekly grocery budget in dollars, validated as a finite number ≥ 0 (`malformed_data` otherwise); unset or `0` means "no budget" (readers hide the budget line), and it is stored as a `profile` column and assembled into the `read_user_profile` preferences object like the other defined scalars. After merging, the result's types SHALL be validated (enums, `brands` map of term→string[], `stores`/`dietary`/`rotation` shapes, `custom` object) and a type-invalid result rejected with `malformed_data`, storing nothing. The application SHALL be atomic (one D1 transaction): scalar/JSON fields update the `profile` row; `brands` entries map to `brand_prefs` rows — a list value UPSERTs, `null` DELETEs (the tri-state: absent row = ambiguous, `[]` = don't-care, non-empty = ranked). It returns without a `commit_sha`.

#### Scenario: Partial patch merges without clobbering siblings

- **WHEN** `update_preferences({ patch: { stores: { preferred_location: "Kroger - 76137" } } })` is called and `stores.primary` is already `"kroger"`
- **THEN** `stores.preferred_location` updates, `stores.primary` is preserved, and nothing else changes

#### Scenario: Brands tri-state via UPSERT/DELETE

- **WHEN** `update_preferences({ patch: { brands: { olive_oil: ["Cobram"], yellow_onion: [], canola_oil: null } } })` is called
- **THEN** `brand_prefs` gets `olive_oil` ranked `["Cobram"]`, `yellow_onion` as don't-care `[]`, and any `canola_oil` row deleted (back to ambiguous)

#### Scenario: Unknown top-level key rejected toward custom

- **WHEN** `update_preferences({ patch: { spice_tolerance: "high" } })` is called
- **THEN** a structured error names the key and directs it under `custom`, and nothing is stored

#### Scenario: Type-invalid merged result is rejected

- **WHEN** `update_preferences({ patch: { lunch_strategy: "sometimes" } })` is called and `sometimes` is not in the enum
- **THEN** a `malformed_data` error is returned and the stored preferences are unchanged

#### Scenario: Weekly budget round-trips as a defined scalar

- **WHEN** `update_preferences({ patch: { weekly_budget: 95 } })` is called and later `{ patch: { weekly_budget: null } }`
- **THEN** the first write stores `95` on the profile row (and `read_user_profile` returns it in `preferences`), the second deletes it back to unset, and a negative or non-numeric value is rejected with `malformed_data`, storing nothing
