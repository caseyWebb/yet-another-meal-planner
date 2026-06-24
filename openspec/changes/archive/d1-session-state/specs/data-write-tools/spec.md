## MODIFIED Requirements

### Requirement: Pantry is stored in and served from D1

The pantry SHALL be stored as rows in the D1 `pantry` table (per tenant, keyed by normalized name), not as a `state:<username>:pantry` JSON array in KV. `read_pantry` SHALL query rows (category/prepared filters as `WHERE` clauses). `update_pantry` SHALL treat `add` as an `INSERT … ON CONFLICT DO UPDATE` upsert preserving `added_at`, refreshing `last_verified_at`, and overlaying other fields (result includes `merged:true` on conflict); `remove`/`verify` are row statements. Writes are strongly consistent and row-level (no whole-array rewrite).

#### Scenario: Pantry add upserts one row

- **WHEN** `update_pantry` adds an item whose normalized name already exists
- **THEN** the existing row is updated in place (added_at preserved, last_verified_at refreshed, `merged:true`), with no duplicate and no rewrite of other rows

#### Scenario: No domain data remains in DATA_KV

- **WHEN** session state, the profile, and the recipe index have all moved to D1
- **THEN** `DATA_KV` holds no domain data and the binding is removable (a follow-up cleanup)
