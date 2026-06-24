## MODIFIED Requirements

### Requirement: Profile writes target D1

The per-tenant profile write tools — `update_taste`, `update_diet_principles`, `update_kitchen`, `update_staples`, `update_stockup`, `add_draft_ready_to_eat`, `update_ready_to_eat`, and `rate_recipe` — SHALL persist to the D1 profile tables (`profile`, `kitchen_equipment`, `staples`, `stockup`, `ready_to_eat`, `overlay`) as typed rows, not as TOML strings inside a KV bundle. They SHALL return without a `commit_sha` and SHALL NOT serialize TOML or attach documentation-header comments. Multi-row writes SHALL use a D1 transaction.

#### Scenario: Structured profile write updates D1 rows

- **WHEN** `update_staples`, `update_stockup`, `update_kitchen`, `update_ready_to_eat`, or `rate_recipe` is applied
- **THEN** the corresponding D1 table rows are upserted/deleted for the caller, with no TOML serialization and no KV bundle write

### Requirement: Preferences are edited by merge-patch over structured D1 storage

`update_preferences` SHALL accept a `patch` object and apply it to the caller's preferences with JSON Merge Patch semantics (RFC 7396): present keys set, `null` deletes, nested objects merge to arbitrary depth, arrays replace wholesale. The defined top-level surface is `default_cooking_nights`, `lunch_strategy`, `ready_to_eat_default_action`, `stores`, `brands`, `dietary`, and `custom`; a patch top-level key outside that set SHALL be rejected with a structured error directing it under `custom`. After merging, the result's types SHALL be validated (enums, `brands` map of term→string[], `stores`/`dietary` shapes, `custom` object) and a type-invalid result rejected with `malformed_data`, storing nothing. The application SHALL be atomic (one D1 transaction): scalar/JSON fields update the `profile` row; `brands` entries map to `brand_prefs` rows — a list value UPSERTs, `null` DELETEs (the tri-state: absent row = ambiguous, `[]` = don't-care, non-empty = ranked).

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
