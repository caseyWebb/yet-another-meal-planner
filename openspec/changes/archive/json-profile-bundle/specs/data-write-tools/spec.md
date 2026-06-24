## MODIFIED Requirements

### Requirement: Repo-data write tools

The system SHALL provide repo-data write tools split by persistence layer.

**GitHub-backed** (write via the atomic commit engine): `update_recipe`, `create_recipe`, the note write tools, and the user-curated shared-corpus tools (`update_aliases`). `commit_changes` SHALL accept a batch of GitHub-backed repo updates and persist them in one commit. `commit_changes` SHALL NOT accept a `config_updates` field — preferences, taste, diet principles, and aliases are written through their standalone tools (`update_preferences`, `update_taste`, `update_diet_principles`, `update_aliases`), which are not redundantly batched here.

**KV-backed** (write to DATA_KV; no git commit): `update_pantry`, `mark_pantry_verified`, `add_draft_ready_to_eat`, `update_ready_to_eat`, `update_stockup`, `update_staples`, `update_preferences`, `update_taste`, `update_diet_principles`, `update_kitchen`, `update_grocery_list`, `add_to_grocery_list`, `remove_from_grocery_list`. The structured profile fields (`kitchen`, `staples`, `overlay`, `ready_to_eat`, `stockup`, `preferences`) are persisted as **native JSON values** inside the `profile:<username>` bundle — the write tools store objects/arrays directly and SHALL NOT serialize them to TOML or attach documentation-header comments. The markdown fields (`taste`, `diet_principles`) are stored as JSON strings.

#### Scenario: commit_changes rejects config_updates

- **WHEN** `commit_changes` is called with a `config_updates` field
- **THEN** the field is not part of the tool's input schema (the call is rejected as an unknown field), and the caller is expected to use `update_preferences` / `update_taste` / `update_diet_principles` / `update_aliases` instead

#### Scenario: Structured profile write stores JSON, not TOML

- **WHEN** `update_staples`, `update_stockup`, `update_kitchen`, `update_ready_to_eat`, or a recipe overlay rating/status edit is applied
- **THEN** the corresponding field of `profile:<username>` in DATA_KV is updated as a JSON object/array via read-modify-write, with no TOML serialization and no header comment

### Requirement: Preferences are edited by merge-patch over structured JSON

`update_preferences` SHALL accept a `patch` object (NOT a content string) and apply it to the caller's current `preferences` object using JSON Merge Patch semantics (RFC 7396): a key present in the patch sets or overwrites its value; a key whose patch value is `null` is deleted; nested objects are merged recursively to arbitrary depth; arrays and scalars replace wholesale. The application SHALL be atomic — a rejected patch leaves the stored preferences unchanged.

The `preferences` object SHALL have a defined top-level surface — `default_cooking_nights` (number), `lunch_strategy` (`leftovers` | `buy` | `mixed`), `ready_to_eat_default_action` (`opt-in` | `auto-add`), `stores` (object: `primary`, `preferred_location`, `location_zip`), `brands` (map of normalized term → ranked string array), `dietary` (object: `avoid`, `limit` string arrays) — plus a `custom` object holding arbitrary agent-added keys.

`update_preferences` SHALL reject a patch whose top-level keys include any key outside that defined set with a structured error directing the value under `custom`. After merging, it SHALL validate the merged result's types and reject a type-invalid result with a `malformed_data` error, storing nothing.

The `brands` tri-state (absent → ambiguous/ask; `[]` → don't-care/cheapest; `[…]` → ranked) is expressed through merge-patch directly: a list value sets the ranked or empty list; a `null` value deletes the key back to absent.

#### Scenario: Partial patch merges without clobbering siblings

- **WHEN** `update_preferences({ patch: { stores: { preferred_location: "Kroger - 76137" } } })` is called and `stores.primary` is already `"kroger"`
- **THEN** `stores.preferred_location` is updated, `stores.primary` is preserved, and no other field is touched

#### Scenario: Brands key deleted back to ambiguous

- **WHEN** `update_preferences({ patch: { brands: { olive_oil: null } } })` is called
- **THEN** `brands.olive_oil` is removed from the stored preferences, so the matcher treats olive oil as ambiguous (asks) rather than don't-care

#### Scenario: Brands key set to don't-care

- **WHEN** `update_preferences({ patch: { brands: { yellow_onion: [] } } })` is called
- **THEN** `brands.yellow_onion` is stored as an empty array, so the matcher picks cheapest-acceptable without asking

#### Scenario: Unknown top-level key is rejected toward custom

- **WHEN** `update_preferences({ patch: { spice_tolerance: "high" } })` is called and `spice_tolerance` is not a defined top-level key
- **THEN** a structured error is returned naming the key and directing it under `custom`, and nothing is stored

#### Scenario: Arbitrary preference nested under custom is accepted

- **WHEN** `update_preferences({ patch: { custom: { spice_tolerance: "high" } } })` is called
- **THEN** `custom.spice_tolerance` is stored, and a later `update_preferences({ patch: { custom: { spice_tolerance: null } } })` deletes just that key

#### Scenario: Type-invalid merged result is rejected

- **WHEN** `update_preferences({ patch: { lunch_strategy: "sometimes" } })` is called and `sometimes` is not in the enum
- **THEN** a `malformed_data` error is returned and the stored preferences are unchanged
