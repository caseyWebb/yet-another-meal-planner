## MODIFIED Requirements

### Requirement: Recipe write tools enforce controlled vocabularies

The recipe write tools — `create_recipe` and `update_recipe` — SHALL reject a write whose
recipe frontmatter carries a `protein`, `cuisine`, or `requires_equipment` value outside
its controlled vocabulary, returning a structured `validation_failed` error (naming the
offending field and value) and making **no commit**. Enforcement SHALL occur at the commit
engine's `validateFile` step so every recipe write path is covered uniformly. `protein`
and `cuisine` SHALL each be present as an in-vocabulary value **or the explicit literal
`null`** — the write path SHALL NOT normalize a no-focus dish to an absent field and SHALL
NOT accept the literal string `none` (a `none`/`""` value is rejected as non-compliant,
prompting `null`). The `create_recipe` and `update_recipe` tool descriptions SHALL
enumerate the `protein` and `cuisine` controlled sets and SHALL state that a dish with no
protein focus is written as `protein: null` — never omitted, never `none`.

#### Scenario: Off-vocabulary protein is rejected before commit

- **WHEN** `create_recipe` is called with frontmatter `protein: shrimp` (the bucket is `shellfish`)
- **THEN** the tool returns a structured `validation_failed` error naming `protein` and `shrimp`, and no recipe file is committed

#### Scenario: No-protein dish requires explicit null

- **WHEN** `create_recipe` is called for a vegetable side with `protein: none` (or an empty string)
- **THEN** the tool returns a structured `validation_failed` error directing `protein: null`, and the recipe is committed only once `protein` is the explicit `null`

#### Scenario: Off-vocabulary equipment is rejected before commit

- **WHEN** `update_recipe` is called with `requires_equipment: ["air-fryer"]` and `air-fryer` is not in the equipment vocabulary
- **THEN** the tool returns a structured `validation_failed` error naming the offending slug, and no change is committed

#### Scenario: In-vocabulary recipe write succeeds

- **WHEN** `create_recipe` is called with `protein: shellfish`, `cuisine: thai`, and `requires_equipment: []`, all legal
- **THEN** the recipe is committed normally and the tool returns the slug and commit sha

#### Scenario: Tool descriptions surface the controlled sets

- **WHEN** the `create_recipe` / `update_recipe` tool schemas are presented to the agent
- **THEN** their descriptions list the allowed `protein` and `cuisine` values and the "write `protein: null` when there is no protein focus — never omit, never `none`" rule

## ADDED Requirements

### Requirement: Recipe write tools enforce the required-field contract

`create_recipe` and `update_recipe` SHALL enforce the full required-field contract (the
`recipe-metadata-contract` capability), rejecting with a structured `validation_failed`
error (no commit) any write whose resulting recipe is missing a required field or carries
an off-contract empty (an empty `title`/`description`/`ingredients_key`/`course`, an
omitted explicit-`null` scalar, or a main lacking `side_search_terms`). For
`update_recipe`, the contract SHALL be checked against the **merged result** (existing
frontmatter overlaid with the patch), not the patch alone — so a single-field edit on an
already-compliant recipe succeeds, while an edit that would strip or empty a required
field is rejected. `create_recipe`'s tool description SHALL enumerate the complete
required-field set, including `ingredients_key` and the explicit-empty forms.

#### Scenario: create_recipe rejects a missing required field

- **WHEN** `create_recipe` is called with frontmatter that omits `ingredients_key`
- **THEN** the tool returns a structured `validation_failed` error naming the missing field and makes no commit

#### Scenario: update_recipe validates the merged result, not the patch

- **WHEN** `update_recipe` patches only `time_total` on a recipe that already carries every other required field
- **THEN** the merged recipe is contract-compliant and the edit commits — the patch need not resend the full field set

#### Scenario: update_recipe rejects an edit that empties a required field

- **WHEN** `update_recipe` patches `description: ""` (or `ingredients_key: []`) onto an existing recipe
- **THEN** the merged result violates the non-empty rule and the tool returns `validation_failed`, making no commit

#### Scenario: create_recipe description enumerates the required set

- **WHEN** the `create_recipe` tool schema is presented to the agent
- **THEN** its description lists every required field (including `ingredients_key`) and the explicit empty form for each
