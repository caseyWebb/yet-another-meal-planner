## MODIFIED Requirements

### Requirement: Imported recipes are active and conformant

Every imported recipe SHALL be written without a `status` field (the per-tenant `status` lifecycle is retired), with `source: null`, and `discovered_at` / `discovery_source` null. An imported recipe is an available corpus recipe by default — there is no `draft` limbo and no per-tenant activation step. The output SHALL pass `scripts/build-indexes.mjs --check` (no hard-fail errors); judgment fields left empty before enrichment MAY produce soft warnings.

#### Scenario: Fresh import validates

- **WHEN** the importer has written all recipe files and `build-indexes.mjs --check` is run
- **THEN** the build exits zero, treating only missing recommended fields as warnings

#### Scenario: Available by default, no draft

- **WHEN** a recipe is imported from the export
- **THEN** it carries no `status` and is available to every member by default, rather than landing in a `draft` state to be activated
