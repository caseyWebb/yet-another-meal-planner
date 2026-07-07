## MODIFIED Requirements

### Requirement: Descriptive facets are derived; the hard gates and identity stay authored

Recipe facets SHALL be placed by their authoring story. **Tier A** facets — `ingredients_key`, `ingredients_full`, `perishable_ingredients`, `side_search_terms`, and `meal_preppable` — SHALL be **derived only**: produced by the classify pass into D1 and absent from authored frontmatter, with no human-corrector path. **Tier B** facets — `protein`, `cuisine`, `course`, `season`, `tags` — SHALL be **derived by default with an optional authored override** (see the override requirement). **Tier C** — `dietary` and `requires_equipment` (the hard gates) plus the identity fields (`title`, `source`) — SHALL remain authored frontmatter, unchanged by this capability. The two hard gates are deliberately retained as authored because a misclassified `dietary` risks allergen exposure and a misclassified `requires_equipment` silently hides a makeable recipe.

#### Scenario: A Tier A facet is derived, never authored

- **WHEN** a recipe is classified
- **THEN** `ingredients_key`, `ingredients_full`, `perishable_ingredients`, `side_search_terms`, and `meal_preppable` are written to D1 by the classify pass and are not required, validated, or read from authored frontmatter

#### Scenario: The hard gates stay authored

- **WHEN** a recipe is written or reconciled
- **THEN** `dietary` and `requires_equipment` remain authored frontmatter fields owned by the author, and the classify pass does not overwrite them

## ADDED Requirements

### Requirement: The full ingredient list is a derived Tier A facet

The classify pass SHALL derive `ingredients_full` — the recipe's **complete** ingredient list as plain ingredient names (no amounts, no prep clauses, no optional-markers; a disjunctive line records its primary) — from the body's ingredient section, as an additional output field on the **same** classify call that derives `ingredients_key` (no additional model call per recipe). `ingredients_full` SHALL be normalized and captured exactly as the existing derived ingredient facets: alias-normalized to full canonical ids through the shared resolver at classify time, novel terms enqueued for the capture job, stored on `recipe_facets` as the classify-time snapshot, projected into `recipes`, and re-resolved through the current resolver at each index projection. The import-time seeding paths SHALL carry the field so a newly created or discovery-imported recipe is fully derived before the next cron tick. The migration adding the columns SHALL clear the classify gate so the existing corpus reclassifies organically over the bounded scheduled ticks — no manual backfill; consumers (the to-buy derivation) SHALL treat a not-yet-derived recipe as an explicit reported gap, never as an empty ingredient list.

#### Scenario: The full list is complete where the key list is selective

- **WHEN** a recipe whose body lists twelve ingredients is classified
- **THEN** `ingredients_full` carries all twelve as normalized names while `ingredients_key` still carries only the 5–7 defining ones, and both use the same canonical ids for the ingredients they share

#### Scenario: Names are canonical and amount-free

- **WHEN** the body lists "2 lbs boneless chicken thighs, cut into strips" and "¼ cup fresh cilantro, chopped (optional)"
- **THEN** `ingredients_full` records the canonical ids for chicken thighs and cilantro — no quantities, prep clauses, or optionality markers

#### Scenario: The existing corpus converges through the pipeline

- **WHEN** the migration lands on a corpus of already-classified recipes
- **THEN** the classify gate is cleared and the bounded classify pass re-derives the corpus over subsequent ticks, with each not-yet-reclassified recipe reported as underived by consumers in the interim — no hand-run backfill and no silent empties

#### Scenario: A body edit re-derives the list

- **WHEN** an authored recipe body's ingredient section changes
- **THEN** the facet gate hash changes and the next classify tick re-derives `ingredients_full` (with `ingredients_key` and the other derived facets), so downstream derivations follow the edit
