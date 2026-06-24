## MODIFIED Requirements

### Requirement: Unified profile read

`read_user_profile()` SHALL return the caller's full profile in one DATA_KV read, including `initialized`, `missing`, and the profile fields. The structured fields (`preferences`, `kitchen`, `staples`, `overlay`, `ready_to_eat`, `stockup`) are stored as **native JSON values** inside the `profile:<username>` bundle and SHALL be returned directly — the only decode on the read path is the outer `JSON.parse` of the bundle. The Worker SHALL NOT parse TOML on the profile read path. The markdown fields (`taste`, `diet_principles`) are returned as strings.

`read_preferences()` SHALL return the caller's `preferences` object directly from the bundle (no TOML parse), and SHALL return a `not_found` error when preferences are absent or empty.

#### Scenario: Profile read returns structured JSON without TOML parsing

- **WHEN** `read_user_profile()` is called for an initialized tenant
- **THEN** `preferences` and the other structured fields are returned as objects/arrays sourced directly from the JSON bundle, with no `parseToml` call on the read path

#### Scenario: Preferences consumed by matcher and weather as an object

- **WHEN** the matcher reads `[brands]` or the weather resolver reads `stores`/`location_zip`
- **THEN** it accesses `bundle.preferences` as a JSON object, not a parsed TOML string
