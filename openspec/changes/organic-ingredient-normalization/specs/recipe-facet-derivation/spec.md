## MODIFIED Requirements

### Requirement: Derived ingredient facets are alias-normalized

The classify pass SHALL normalize the derived `ingredients_key` and `perishable_ingredients` to **full canonical ids** through the shared resolver (the same `normalizeIngredientList` the write path and the discovery path apply, resolving each surface form to its canonical node via the `representative` pointer), so a derived ingredient name lines up across recipes for cross-recipe overlap and pantry matching regardless of surface form — while distinct varieties stay distinct (no base-equality collapse). A term the resolver has not yet placed SHALL normalize to its cleaned form (unchanged behavior) and be enqueued for the capture job, so the overlap sharpens as the identity layer grows.

#### Scenario: Derived perishables of a synonym share one canonical node

- **WHEN** the classify pass derives `perishable_ingredients` for two recipes that each use fresh cilantro under different wording (e.g. "cilantro" and "fresh coriander leaves")
- **THEN** both record the same canonical entry (synonym-merged), so the two recipes' use of that perishable can be compared directly, whereas two distinct varieties (e.g. cheddar vs mozzarella) record distinct entries and do not falsely overlap

#### Scenario: An unplaced term still normalizes and is captured

- **WHEN** the classify pass derives an ingredient the resolver has not yet placed
- **THEN** it records the cleaned term (as today) and enqueues the surface form, so a later capture tick can merge it into its canonical node
