## MODIFIED Requirements

### Requirement: The build validates recipes and projects the recipe index only

`scripts/build-indexes.mjs` SHALL validate recipe markdown and project the recipe index into D1, and SHALL NOT validate or parse any other corpus artifact. The store-registry, discovery-inbox, discovery-source, and whole-repo TOML parse-checks SHALL be removed from the build; those validations SHALL run at Worker write time in the corresponding tools. With no non-recipe data left in GitHub, the build has nothing else to check, and `smol-toml` is no longer used.

#### Scenario: Build only touches recipes

- **WHEN** the build runs
- **THEN** it validates `recipes/*.md` and writes the D1 recipe index, performing no store/discovery/TOML validation

#### Scenario: Shared-corpus validation is write-time

- **WHEN** a store, discovery source, or inbox candidate is written
- **THEN** it is validated by the Worker write tool at write time (a structured error on failure), not by a later build
