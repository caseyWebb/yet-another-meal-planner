## ADDED Requirements

### Requirement: System-consumed recipe fields are required and present

Every recipe SHALL carry **all** system-consumed frontmatter fields — the fields any
deterministic consumer reads (`filterRecipes`, the semantic candidate row, the
retrospective JOIN, the recipe embedding, side retrieval, and discovery dedup). The
required set SHALL be: `title`, `description`, `ingredients_key`, `course`, `protein`,
`cuisine`, `time_total`, `source`, `dietary`, `season`, `tags`, `pairs_with`,
`perishable_ingredients`, `requires_equipment`, and (conditionally) `side_search_terms`.
Presence is **blunt-uniform**: a required field SHALL be present on every recipe even
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

### Requirement: Per-field empty semantics for required recipe fields

The required fields SHALL fall into three empty-form shapes, enforced identically at
write time and build time:

- **Non-empty** (no valid empty form; empty is a hard failure): `title` and `description`
  SHALL be non-empty strings; `ingredients_key` and `course` SHALL be non-empty arrays of
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

#### Scenario: Empty non-empty-field is rejected

- **WHEN** a recipe carries `description: ""` or `ingredients_key: []`
- **THEN** the validator hard-fails — an empty value is not a legal form for these fields

#### Scenario: A no-protein dish carries explicit null

- **WHEN** a plain grain bowl with no protein focus is written
- **THEN** it carries `protein: null` (present, explicit), not an omitted `protein` and not `protein: "none"`

#### Scenario: Empty arrays are accepted for may-be-empty fields

- **WHEN** a year-round recipe with no dietary tags carries `season: []` and `dietary: []`
- **THEN** the validator accepts both as present-and-empty

### Requirement: side_search_terms is required for mains

`side_search_terms` SHALL be present on every recipe as an array of strings. When a
recipe's `course` includes `main`, `side_search_terms` SHALL be **non-empty** (the
memoized semantic side-retrieval query for that main). When `course` does not include
`main`, `side_search_terms` MAY be `[]` but SHALL still be present.

#### Scenario: A main without side terms is rejected

- **WHEN** a recipe with `course: [main]` carries `side_search_terms: []`
- **THEN** the validator hard-fails, requiring complementary side terms for the main

#### Scenario: A side carries an empty side_search_terms

- **WHEN** a recipe with `course: [side]` carries `side_search_terms: []`
- **THEN** the validator accepts it (present, legitimately empty)

### Requirement: Free-form frontmatter is preserved as open passthrough

Frontmatter fields outside the required set SHALL remain optional and free-form (e.g.
`meal_preppable`, `veg_forward`, `difficulty`, `style`, `servings`, `time_active`,
`discovered_at`, `discovery_source`). The validators SHALL NOT require, warn on, or
reject these fields; they SHALL pass through untouched into the recipe's `extra`
projection. This is the "defined required surface + open passthrough" posture, parallel
to `preferences`' defined surface plus `custom` bag.

#### Scenario: An unknown field passes through untouched

- **WHEN** a recipe carries `meal_preppable: true` and a novel `plating_notes` field
- **THEN** validation neither requires nor rejects them, and both ride into the recipe's `extra` data unchanged

#### Scenario: A free-form field is never warned about

- **WHEN** a recipe omits `meal_preppable`
- **THEN** the build emits no warning — free-form fields carry no presence expectation

### Requirement: The required-field contract has a single shared source of truth

The required-field contract SHALL be defined exactly once in a shared module (a sibling
to `src/vocab.js`) — the field list, each field's empty-form shape, and the conditional
`side_search_terms` rule — and imported by both the Worker write-time validator
(`src/validate.ts`) and the Node index-build validator (`scripts/build-indexes.mjs`).
Neither validator SHALL define its own copy of the contract. This guarantees the
write-time gate and the build-time gate can never disagree about what a compliant recipe
is. If a platform constraint makes a shared import infeasible and a copy is unavoidable,
an automated test SHALL assert the copies are equal, failing CI on any drift.

#### Scenario: One definition feeds both validators

- **WHEN** a field is added to or removed from the required set
- **THEN** the change is made once in the shared module and both validators observe it without a second edit

#### Scenario: Both validators agree on a non-compliant recipe

- **WHEN** the Worker and build validators are exercised against the same recipe missing a required field
- **THEN** both reject it identically — they resolve the same shared contract (or the parity test fails CI before they can disagree)
