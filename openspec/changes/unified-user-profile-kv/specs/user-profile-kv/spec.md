## ADDED Requirements

### Requirement: Profile bundle stored in DATA_KV as source of truth

The system SHALL store each tenant's profile as a JSON blob under the key `profile:<username>` in DATA_KV. The bundle SHALL contain all per-tenant operational state that has no long-term archival value: `preferences`, `taste` (markdown string), `diet_principles` (markdown string), `kitchen`, `staples`, `overlay`, `ready_to_eat`, and `stockup`. DATA_KV is already bound to the Worker and SHALL be used for both shared corpus artifacts (`index:recipes`) and per-tenant profile/state keys. No new KV namespace binding SHALL be introduced.

#### Scenario: Profile bundle key naming

- **WHEN** a tenant with username `alice` has a profile
- **THEN** their profile is stored at DATA_KV key `profile:alice` as a JSON-serialized object containing all profile fields

#### Scenario: Missing bundle treated as empty profile

- **WHEN** `DATA_KV.get("profile:<username>")` returns null (new member or pre-migration)
- **THEN** the system treats all profile fields as absent/empty rather than erroring

### Requirement: read_user_profile returns the full profile bundle in one KV read

The system SHALL expose a `read_user_profile()` tool that reads `profile:<username>` from DATA_KV and returns all profile sections in a single structured response: `{ preferences, taste, diet_principles, kitchen, staples, overlay, ready_to_eat, stockup }`. Fields absent from the bundle SHALL be returned as null or their field-appropriate empty value. This tool SHALL replace the individual read tools (`read_preferences`, `read_taste`, `read_diet_principles`, `read_kitchen`, `read_staples`) for the nominal session-start batch.

#### Scenario: Full profile returned in one call

- **WHEN** `read_user_profile()` is called for a tenant whose profile bundle exists in KV
- **THEN** the tool returns all profile fields in a single response with no GitHub API call

#### Scenario: Absent fields return empty values

- **WHEN** a tenant's profile bundle exists but does not contain a `kitchen` field (e.g. partially migrated)
- **THEN** `read_user_profile()` returns `kitchen: null` (or the field-appropriate empty value) rather than erroring

### Requirement: Lazy migration from GitHub on KV miss

The system SHALL implement lazy migration: when `read_user_profile()` (or any per-tenant KV read) encounters an empty KV key for a tenant whose GitHub subtree has existing profile files, it SHALL read those files from GitHub, populate the KV key, and return the result. Subsequent reads SHALL be served from KV without any GitHub API call. Lazy migration SHALL also apply on the write path: a profile update tool that finds an empty KV bundle SHALL seed from GitHub before applying the update, so the first write does not overwrite fields from other areas with empty values.

#### Scenario: First read after deploy migrates transparently

- **WHEN** a tenant calls a tool after deploy and their `profile:<username>` KV key does not exist yet
- **THEN** the Worker reads the corresponding GitHub file(s), writes the KV key, and returns the data — the caller receives their profile as if it were already in KV

#### Scenario: First profile write also migrates

- **WHEN** a tenant calls `update_taste(content)` and `profile:<username>` does not exist in KV
- **THEN** the Worker seeds the bundle from GitHub (reading all available profile files), applies the taste update, and writes the complete bundle to KV — no other profile field is lost

### Requirement: Session state stored as individual DATA_KV keys

The system SHALL store per-tenant session state — pantry, meal plan, and grocery list — as individual DATA_KV keys rather than bundled with the profile. The keys SHALL be `state:<username>:pantry`, `state:<username>:meal_plan`, and `state:<username>:grocery_list`. These files SHALL no longer exist in the GitHub data repo.

#### Scenario: Pantry read from KV

- **WHEN** `read_pantry()` is called
- **THEN** the Worker reads `state:<username>:pantry` from DATA_KV with no GitHub API call

#### Scenario: Grocery list written to KV

- **WHEN** `update_grocery_list(ops)` or `add_to_grocery_list(item)` is called
- **THEN** the change is written to `state:<username>:grocery_list` in DATA_KV and no git commit is made

### Requirement: profile_status checks KV key presence

The system SHALL derive `{ initialized, missing }` from DATA_KV rather than from a GitHub directory listing of `users/<username>/`. `initialized` SHALL be true when the `profile:<username>` key exists and contains a non-empty `preferences` field. `missing` SHALL list the area keys whose corresponding field is absent or empty in the bundle, using the same area-to-field mapping as today (`store` → `preferences`, `taste` → `taste`, `diet` → `diet_principles`, `equipment` → `kitchen`, `pantry` → `state:<username>:pantry`, `ready-to-eat` → `ready_to_eat`, `stockup` → `stockup`, `corpus` → `overlay`).

#### Scenario: Initialized member has preferences in KV

- **WHEN** a tenant's `profile:<username>` bundle contains a non-empty `preferences` field
- **THEN** `profile_status` returns `{ initialized: true, missing: [] }` (or missing listing any genuinely absent areas) with no GitHub API call

#### Scenario: Brand-new member has no KV key

- **WHEN** DATA_KV has no `profile:<username>` key for this tenant
- **THEN** `profile_status` returns `{ initialized: false, missing: [<all areas>] }` rather than erroring

### Requirement: Overlay reads for list_recipes and read_recipe served from KV

The system SHALL read the caller's overlay (recipe rating and status per slug) from the `overlay` field of `profile:<username>` in DATA_KV rather than from `users/<username>/overlay.toml` in GitHub. The overlay merge behavior (effective status defaults to `draft` for absent slug; `last_cooked` still derived from `cooking_log.toml` in GitHub) SHALL remain unchanged.

#### Scenario: list_recipes overlay from KV

- **WHEN** `list_recipes` is called
- **THEN** per-tenant rating/status is merged from the KV profile bundle's `overlay` field, not from a GitHub file read

### Requirement: Cross-tenant overlay enumeration via TENANT_KV

The system SHALL enumerate all tenant IDs from TENANT_KV (`tenant:*` keys) to serve cross-tenant overlay reads (e.g. group ratings in `read_recipe_notes`). For each tenant ID, it SHALL read the `overlay` field from that tenant's `profile:<username>` KV key. TENANT_KV is already the authoritative tenant directory.

#### Scenario: Group ratings aggregated from KV profiles

- **WHEN** `read_recipe_notes(slug)` is called
- **THEN** group ratings are collected by enumerating TENANT_KV for all tenant IDs, reading the `overlay` section from each `profile:<username>` key, and merging non-null ratings for the slug — no GitHub file reads for overlay
