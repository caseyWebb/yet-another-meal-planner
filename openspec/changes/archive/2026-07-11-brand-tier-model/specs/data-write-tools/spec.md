## MODIFIED Requirements

### Requirement: Preferences are edited by merge-patch over structured D1 storage

`update_preferences` SHALL accept a `patch` object and apply it to the caller's preferences with JSON Merge Patch semantics (RFC 7396): present keys set, `null` deletes, nested objects merge to arbitrary depth, arrays replace wholesale. The defined top-level surface is `default_cooking_nights`, `lunch_strategy`, `ready_to_eat_default_action`, `stores`, `brands`, `dietary`, and `custom`; a patch top-level key outside that set SHALL be rejected with a structured error directing it under `custom`. Each `brands` entry SHALL be a map of family term → **tier object** `{ tiers?: string[][], any_brand?: boolean }`: `tiers` is an ordered list of tiers, each tier a non-empty list of brand names where brands in the same tier are equally acceptable (cheapest wins) and earlier tiers are tried first; `any_brand: true` means that after the tiers (if any) are exhausted the cheapest acceptable candidate is taken instead of asking. Because the family value is an object, a partial family patch (e.g. `{ any_brand: true }`) SHALL merge into the stored family value under the same RFC 7396 rules, and `null` SHALL delete the family (back to ambiguous). After merging, the result's types SHALL be validated (enums, `stores`/`dietary` shapes, `custom` object; for each `brands` family: tiers an array of non-empty arrays of non-empty strings, a brand appearing in at most one tier of the family compared case-insensitively, `any_brand` boolean, and the all-empty value `{ tiers: [], any_brand: false }` rejected with a message directing the caller to use `null` to clear) and a type-invalid result rejected with `malformed_data`, storing nothing. The application SHALL be atomic (one D1 transaction): scalar/JSON fields update the `profile` row; `brands` entries map to `brand_prefs` rows — a family present in the patch UPSERTs the **merged** family value (`tiers` + `any_brand` columns), `null` in the patch DELETEs the row (the confidence tri-state: absent row = ambiguous/ask, `{ tiers: [], any_brand: true }` = don't-care/cheapest, non-empty `tiers` = the preference ladder). For **one deprecation window** a legacy `string[]` family value SHALL be accepted and converted rather than rejected — `[]` → `{ tiers: [], any_brand: true }`, a non-empty list → one singleton tier per rank in order with `any_brand: false` — with the tool's return carrying a `warnings` entry `{ key: "brands.<term>", reason: "deprecated_shape", superseded_by: "{ tiers, any_brand }" }` for each converted family; after the window an array value SHALL be rejected as `malformed_data`. It returns without a `commit_sha`.

#### Scenario: Partial patch merges without clobbering siblings

- **WHEN** `update_preferences({ patch: { stores: { preferred_location: "Kroger - 76137" } } })` is called and `stores.primary` is already `"kroger"`
- **THEN** `stores.preferred_location` updates, `stores.primary` is preserved, and nothing else changes

#### Scenario: Brand tiers via UPSERT/DELETE

- **WHEN** `update_preferences({ patch: { brands: { olive_oil: { tiers: [["Cobram", "California Olive Ranch"], ["Cento"]] }, yellow_onion: { any_brand: true }, canola_oil: null } } })` is called with no existing rows for those families
- **THEN** `brand_prefs` gets `olive_oil` with two tiers (Cobram and California Olive Ranch equally acceptable first, Cento the fallback) and `any_brand` false, `yellow_onion` as don't-care (`tiers` empty, `any_brand` true), and any `canola_oil` row deleted (back to ambiguous)

#### Scenario: Partial family patch preserves the sibling field

- **WHEN** `butter` is stored as `{ tiers: [["Challenge"], ["Kerrygold"]], any_brand: false }` and `update_preferences({ patch: { brands: { butter: { any_brand: true } } } })` is called
- **THEN** the stored `butter` row becomes `{ tiers: [["Challenge"], ["Kerrygold"]], any_brand: true }` — the tiers are preserved by the merge, not clobbered

#### Scenario: Legacy array value is converted for one deprecation window

- **WHEN** a stale agent calls `update_preferences({ patch: { brands: { butter: ["Challenge", "Kerrygold"] } } })` during the deprecation window
- **THEN** the write succeeds, storing `{ tiers: [["Challenge"], ["Kerrygold"]], any_brand: false }`, and the return carries `warnings` including `{ key: "brands.butter", reason: "deprecated_shape", superseded_by: "{ tiers, any_brand }" }` — never `validation_failed`

#### Scenario: The all-empty family value is rejected

- **WHEN** `update_preferences({ patch: { brands: { butter: { tiers: [], any_brand: false } } } })` is called
- **THEN** a `malformed_data` error directs the caller to use `null` to clear the family, and nothing is stored

#### Scenario: A brand in two tiers is rejected

- **WHEN** `update_preferences({ patch: { brands: { butter: { tiers: [["Kerrygold"], ["kerrygold", "Plugra"]] } } } })` is called
- **THEN** a `malformed_data` error names the duplicated brand, and nothing is stored

#### Scenario: Unknown top-level key rejected toward custom

- **WHEN** `update_preferences({ patch: { spice_tolerance: "high" } })` is called
- **THEN** a structured error names the key and directs it under `custom`, and nothing is stored

#### Scenario: Type-invalid merged result is rejected

- **WHEN** `update_preferences({ patch: { lunch_strategy: "sometimes" } })` is called and `sometimes` is not in the enum
- **THEN** a `malformed_data` error is returned and the stored preferences are unchanged
