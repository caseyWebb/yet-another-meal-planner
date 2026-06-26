## MODIFIED Requirements

### Requirement: Parse-check scope for data TOMLs

The system SHALL parse-check every tracked `.toml` file for validity, but SHALL NOT enforce deep schema validation on non-index data files (`pantry.toml`, `preferences.toml`, `substitutions.toml`, `aliases.toml`, `stockup.toml`, `feeds.toml`, `skus/kroger.toml`) beyond their being parseable. The `guidance/**/*.md` files (both `guidance/ingredient_storage/` and `guidance/cooking_techniques/`) are prose and are not parse-checked as data (they are validated only for existence, like other curated markdown).

#### Scenario: Valid-but-sparse data TOML passes

- **WHEN** `pantry.toml` parses as valid TOML but omits fields the Worker would later expect
- **THEN** the build validation passes it (deep schema validation is not enforced on non-index data files)

#### Scenario: Guidance prose is existence-checked, not parsed as data

- **WHEN** a `guidance/cooking_techniques/*.md` or `guidance/ingredient_storage/*.md` file is present
- **THEN** validation treats it as curated prose (existence only) and does not parse-check its body as structured data
