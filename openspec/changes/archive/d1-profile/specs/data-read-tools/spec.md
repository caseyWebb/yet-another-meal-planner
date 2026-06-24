## MODIFIED Requirements

### Requirement: Unified profile read assembles from D1

`read_user_profile()` SHALL return the caller's full profile assembled from the D1 profile tables — `initialized`, `missing`, and all profile fields — in one batched set of queries. The structured fields (`preferences`, `kitchen`, `staples`, `overlay`, `ready_to_eat`, `stockup`) are reconstructed from typed rows/columns (preferences from the `profile` row + `brand_prefs`); the markdown fields (`taste`, `diet_principles`) are returned as strings from the `profile` row. The Worker SHALL NOT parse TOML on the profile read path, and SHALL NOT read a `profile:<username>` KV bundle. The returned object shape is unchanged from the caller's perspective.

`read_preferences()` SHALL return the caller's `preferences` object assembled from D1, and `not_found` when no profile row / preferences exist.

#### Scenario: Profile read assembles structured JSON from D1

- **WHEN** `read_user_profile()` is called for an initialized tenant
- **THEN** the profile is assembled from the D1 tables and returned in the existing shape, with no TOML parse and no KV bundle read

#### Scenario: Matcher and weather read preferences from D1

- **WHEN** the matcher reads `brands` or the weather resolver reads `stores`/`location_zip`
- **THEN** the values come from the D1 `brand_prefs` and `profile` rows, not a parsed TOML string
