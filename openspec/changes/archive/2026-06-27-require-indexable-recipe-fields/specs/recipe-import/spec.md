## MODIFIED Requirements

### Requirement: Imported recipes are active and conformant

Every imported recipe SHALL be written **fully conformant to the required-field
contract** (the `recipe-metadata-contract` capability): every system-consumed field
present, with explicit empty forms (`null`/`[]`) where a value is genuinely empty —
`source: null` and `discovered_at`/`discovery_source` null for a non-discovery import.
There is no `status` field (the per-tenant `status` lifecycle is retired) and no `draft`
limbo — an imported recipe is an available corpus recipe by default. The output SHALL
pass `scripts/build-indexes.mjs --check` with **no errors and no missing-required-field
slack**; a judgment field left unpopulated is a hard failure, not a soft warning, so the
importer SHALL classify or explicitly empty every required field before the write.

#### Scenario: Fresh import validates strictly

- **WHEN** the importer has written a recipe and `build-indexes.mjs --check` is run
- **THEN** the build exits zero only if every required field is present (value or explicit empty); a missing required field fails the check

#### Scenario: Available by default, no draft

- **WHEN** a recipe is imported
- **THEN** it carries no `status` and is available to every member by default, rather than landing in a `draft` state to be activated

### Requirement: Protein and cuisine classification draws from the controlled vocabulary

When a recipe is imported or created, the system SHALL classify `protein` and `cuisine`
to their **coarse controlled buckets** (the sets enforced at write and build time — e.g.
`fish` not `salmon`, `shellfish` not `shrimp`), in the same enrichment step that derives
the other required fields (`course`, `ingredients_key`, `perishable_ingredients`,
`requires_equipment`, `description`, and `side_search_terms` for mains). A specific
ingredient SHALL be mapped to its bucket rather than written verbatim (shrimp →
`shellfish`, salmon/cod/tuna → `fish`). When a dish has **no protein focus** — a
vegetable side, a plain noodle or grain dish, a condiment — the classifier SHALL write
`protein: null` (the explicit "no value" form), never an omitted field and never an
off-vocabulary value such as `none`. The controlled sets SHALL be surfaced to the
classifying agent (the `create_recipe`/`update_recipe` tool descriptions and
`AGENT_INSTRUCTIONS.md`), and an off-vocabulary value that reaches a write SHALL be
rejected by the write tool with a structured error, prompting reclassification.

#### Scenario: Specific protein is mapped to its bucket

- **WHEN** a shrimp curry is imported
- **THEN** the classifier writes `protein: shellfish` (the bucket), not `protein: shrimp`

#### Scenario: No-protein-focus dish writes explicit null

- **WHEN** a radish condiment or a plain cold-noodle dish is imported
- **THEN** the classifier writes `protein: null` (present and explicit), not an omitted field and not `protein: none`

#### Scenario: An off-vocabulary value is corrected, not persisted

- **WHEN** the classifier nonetheless emits an off-vocabulary `protein`/`cuisine`/`requires_equipment` value on a write
- **THEN** the write tool returns a structured `validation_failed` error and the recipe is not committed until the value is reclassified to a legal bucket (or, for `protein`/`cuisine`, set to `null`)

## ADDED Requirements

### Requirement: Import populates every required field

The import/enrichment step SHALL populate every required recipe field before the write,
deriving each from the source where possible: `ingredients_key` from the recipe's
ingredient list (the defining 5–7, normalized through the alias table),
`perishable_ingredients` by the "would the leftover rot" test (`[]` when none),
`course` from the dish type, `description` as the agent's craving-aligned summary, and
the may-be-empty arrays (`dietary`, `season`, `tags`, `pairs_with`, `requires_equipment`)
set to their explicit value or `[]`. A required field the importer cannot derive SHALL be
written in its explicit empty form (`null`/`[]`), never omitted.

#### Scenario: ingredients_key is derived, never omitted

- **WHEN** a recipe is imported
- **THEN** `ingredients_key` is populated with the defining ingredients (non-empty), normalized through the alias table, rather than left absent

#### Scenario: An underivable field is written empty, not omitted

- **WHEN** the importer cannot determine a recipe's `season`
- **THEN** it writes `season: []` (present, explicit) rather than omitting the field
