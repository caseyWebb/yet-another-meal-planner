## MODIFIED Requirements

### Requirement: Derived facets are seeded synchronously at import

`create_recipe` SHALL seed a new recipe's derived facets synchronously at import (as it already seeds the `description`), so an agent-imported recipe is fully classified before the next classify tick and is not index-lagged. The scheduled classify pass SHALL remain the authority and SHALL refresh the seed on a later body change. A seed failure SHALL NOT fail the already-persisted import (best-effort, like the description seed) — the classify pass backfills.

#### Scenario: An agent import is not facet-lagged

- **WHEN** `create_recipe` writes a new recipe
- **THEN** it seeds the derived facets synchronously, so the next index projection materializes them without waiting a classify tick

#### Scenario: A direct corpus edit is faceted eventually

- **WHEN** a recipe body is authored directly in the R2 corpus (no `create_recipe` call)
- **THEN** the recipe is unfaceted until the next classify tick derives its facets, and this eventual-consistency lag is not an error

#### Scenario: A seed failure does not fail the import

- **WHEN** the synchronous classify seed errors during `create_recipe`
- **THEN** the recipe is still persisted and the scheduled classify pass backfills its facets on a later tick

### Requirement: Component sub-recipes classify as `component`, not a meal course

The classifier's open `course` vocabulary SHALL name **`component`** — a sub-recipe or building block (a fresh pasta dough, a stock, a spice blend, a base sauce made to be used inside other dishes) that is not plated as its own course — in the classify prompt's course guidance, anchored by a few-shot exemplar (a plain pasta dough → `course: ["component"]` with `side_search_terms: []`), so the model stops scattering sub-recipes across `main`/`side`/`baked_good`. A component is not a main, so its derived `side_search_terms` SHALL be empty (the existing effective-course rule). `course` SHALL remain open-vocabulary (shape-validated only — no contract-validator change). The change SHALL ship a D1 migration that clears the classify gate (`body_hash`) so the existing corpus **re-converges organically** through the bounded scheduled classify pass — stored facet values remain in place until each recipe's re-classification overwrites them (no empty-facet window), authored Tier-B overrides survive by construction (the projection-time merge), and no production row is hand-edited.

#### Scenario: A pasta dough classifies as a component

- **WHEN** the classify pass processes a sub-recipe body (e.g. a fresh pasta dough: flour, eggs; instructions to knead, rest, and roll)
- **THEN** the derived `course` is `["component"]` and the derived `side_search_terms` is `[]`

#### Scenario: The existing corpus converges through the pipeline

- **WHEN** the migration lands on the already-classified production corpus (including the observed defect rows: `fresh-pasta` classified `["side"]`, `homemade-pasta-dough` `["baked_good"]`, `spinach-fresh-pasta` `["main"]`)
- **THEN** the classify gate is cleared and the bounded pass re-derives every recipe over subsequent ticks with the component-aware prompt, each recipe keeping its previous derived facets until its re-classification lands — no manual backfill, no hand-edited rows, no empty-course window

#### Scenario: An authored course override still wins

- **WHEN** a recipe carries an authored `course` override and is re-classified after the gate-clear
- **THEN** the projected effective `course` is the authored override, exactly as before — the re-convergence cannot clobber a human correction
