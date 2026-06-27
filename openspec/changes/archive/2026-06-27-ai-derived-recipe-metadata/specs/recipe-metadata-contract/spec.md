## MODIFIED Requirements

### Requirement: System-consumed recipe fields are required and present

Every recipe SHALL carry **all** system-consumed frontmatter fields — the fields any
deterministic consumer reads (`filterRecipes`, the semantic candidate row, the
retrospective JOIN, side retrieval, and discovery dedup). The
required set SHALL be: `title`, `ingredients_key`, `course`, `protein`,
`cuisine`, `time_total`, `source`, `dietary`, `season`, `tags`, `pairs_with`,
`perishable_ingredients`, `requires_equipment`, and (conditionally) `side_search_terms`.
`description` is **not** in this set — it is a Worker-derived, D1-resident field (see the
`derived-recipe-metadata` capability), not authored frontmatter. Presence is
**blunt-uniform**: a required field SHALL be present on every recipe even
when its value is empty, expressed through the field's explicit empty form (`null` or
`[]`) rather than by omission. A recipe missing any required field SHALL be a hard
failure — at Worker write time (`validation_failed`, no commit) and at build time
(non-zero exit) — naming the missing field and recipe.

#### Scenario: A missing required field is rejected

- **WHEN** a recipe write or a built recipe omits `ingredients_key` (or any other required field)
- **THEN** the validator hard-fails naming the missing field and recipe, and the recipe is neither committed nor indexed

#### Scenario: An explicit empty value satisfies presence

- **WHEN** a recipe carries `dietary: []`, `pairs_with: []`, and `protein: null`
- **THEN** the validator accepts those fields as present (the empty form is a value, not an omission)

#### Scenario: A missing or absent description is not a contract violation

- **WHEN** a recipe write or a built recipe carries no `description` in its frontmatter
- **THEN** the metadata-contract validator does not require, warn on, or reject it — `description` is a derived field owned by `derived-recipe-metadata`, not the frontmatter contract

### Requirement: Per-field empty semantics for required recipe fields

The required fields SHALL fall into three empty-form shapes, enforced identically at
write time and build time:

- **Non-empty** (no valid empty form; empty is a hard failure): `title`
  SHALL be a non-empty string; `ingredients_key` and `course` SHALL be non-empty arrays of
  strings. An empty value for any of these SHALL be rejected.
- **Explicit-`null` scalar** (a real value or the literal `null`, never omitted): `protein`
  SHALL be a `PROTEIN_VOCAB` value or `null`; `cuisine` a `CUISINE_VOCAB` value or `null`;
  `time_total` a number or `null`; `source` a string or `null`. `null` is the canonical
  "no value" form — the write path SHALL NOT translate a no-protein-focus dish into an
  *absent* field, and SHALL NOT accept the literal string `"none"`.
- **May-be-empty array** (always present; `[]` is a legal value): `dietary`, `season`,
  `tags`, `pairs_with`, `perishable_ingredients`, and `requires_equipment` SHALL each be an
  array of strings, possibly empty. `requires_equipment` entries SHALL be `EQUIPMENT_VOCAB`
  slugs; a non-empty array of off-vocabulary slugs SHALL be rejected.

`description` is **not** governed by this requirement — it is derived (see
`derived-recipe-metadata`), not an authored frontmatter field.

#### Scenario: Empty non-empty-field is rejected

- **WHEN** a recipe carries `title: ""` or `ingredients_key: []`
- **THEN** the validator hard-fails — an empty value is not a legal form for these fields

#### Scenario: A no-protein dish carries explicit null

- **WHEN** a plain grain bowl with no protein focus is written
- **THEN** it carries `protein: null` (present, explicit), not an omitted `protein` and not `protein: "none"`

#### Scenario: Empty arrays are accepted for may-be-empty fields

- **WHEN** a year-round recipe with no dietary tags carries `season: []` and `dietary: []`
- **THEN** the validator accepts both as present-and-empty
