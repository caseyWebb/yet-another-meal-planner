## ADDED Requirements

### Requirement: Season is a controlled vocabulary

The `season` field SHALL be a **controlled vocabulary** — `spring`, `summer`, `fall`, `winter` — defined once as a shared `SEASON_VOCAB` (a sibling to `PROTEIN_VOCAB` / `CUISINE_VOCAB` / `EQUIPMENT_VOCAB`) and enforced by the shared required-field contract at **both write time (the Worker) and build time**, exactly as `requires_equipment` is enforced against `EQUIPMENT_VOCAB`. A `season` array entry outside the vocabulary SHALL be a hard failure that names the offending value — at the Worker (`validation_failed`, no commit) and at build (non-zero exit). `[]` (year-round) remains a legal value and its presence/empty-array semantics (from *Per-field empty semantics for required recipe fields*) are unchanged.

Because `season` predates this vocabulary and has held free-form values, two transitional affordances SHALL apply: (1) a deterministic consumer that matches a recipe's `season` against a **derived current season** SHALL normalize before comparison — case-folding and mapping the synonym `autumn` to `fall` — so a recipe stored before migration still matches; and (2) a re-runnable migration over a data checkout SHALL canonicalize legacy `season` frontmatter (case-fold, `autumn` → `fall`, de-duplicate), flagging any value that does not map to the vocabulary for manual repair rather than guessing. Read-side normalization does not rewrite the stored value; the migration does.

#### Scenario: Canonical season tokens are accepted at write and build

- **WHEN** a recipe carries `season: ["summer", "fall"]` (or `season: []`)
- **THEN** the required-field contract accepts it at both the Worker write gate and the build gate

#### Scenario: An off-vocabulary season is rejected at write and build

- **WHEN** a recipe carries `season: ["monsoon"]` or the synonym `season: ["autumn"]`
- **THEN** the contract hard-fails naming `season` (Worker: `validation_failed`, no commit; build: non-zero exit), pointing to `fall` over `autumn`

#### Scenario: A legacy synonym still matches on read

- **WHEN** a consumer matches a recipe carrying `season: ["Autumn"]` against a current season of `fall`
- **THEN** the consumer normalizes `"Autumn"` to `fall` (case-fold + synonym) and the recipe matches, with no rewrite of the stored value

#### Scenario: The migration canonicalizes legacy season frontmatter

- **WHEN** the season migration runs over a recipe carrying `season: ["Summer", "autumn"]`
- **THEN** the file's `season` becomes `["summer", "fall"]` (case-folded, synonym mapped, de-duplicated), and a value with no vocabulary mapping is reported for manual repair instead

#### Scenario: Year-round recipes are unaffected

- **WHEN** a recipe carries `season: []`
- **THEN** it is treated as in season in every season, unchanged by this vocabulary
