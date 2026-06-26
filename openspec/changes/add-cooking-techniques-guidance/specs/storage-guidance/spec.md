## MODIFIED Requirements

### Requirement: Class-keyed curated storage-guidance content tree

The system SHALL maintain an `guidance/ingredient_storage/` content tree under the **data-repo-root `guidance/` umbrella** as shared corpus content read by all tenants. Each file SHALL be markdown prose keyed by a **storage behavior class** (e.g. `tender-herbs.md`, `hardy-herbs.md`, `leafy-greens.md`, `alliums.md`) rather than by individual ingredient, so one entry covers a whole family of items without duplication. A small number of **singleton** files (e.g. `basil.md`, `tomatoes.md`, `avocados.md`) MAY exist for items whose storage rule contradicts their class. Relational "do not store together" rules (e.g. ethylene cross-contamination) SHALL live in a dedicated `_ethylene.md` file, because they belong to no single item. The tree SHALL be hand-maintained curated config and SHALL NOT be written by the agent.

#### Scenario: Guidance is keyed by class, not ingredient

- **WHEN** the `guidance/ingredient_storage/` tree is inspected
- **THEN** files are named for storage behavior classes (and a few singletons), not one file per ingredient, and the same file serves every member of its class

#### Scenario: Relational rules live in their own file

- **WHEN** a "do not store together" rule is recorded (e.g. onions apart from potatoes, ethylene producers away from sensitive items)
- **THEN** it lives in the relational `_ethylene.md` file rather than being duplicated into each affected item's file

### Requirement: Read access via unified guidance tools; read-only enforced by write allowlist

The system SHALL expose `guidance/ingredient_storage/` through the unified guidance read tools `list_guidance("ingredient_storage")` (returning class slugs each with an optional one-line description) and `read_guidance("ingredient_storage", slugs)` (returning the named entries' content) — defined by the `cooking-techniques` capability. The storage corpus SHALL remain effectively read-only: the `ingredient_storage` domain SHALL be **excluded from the `save_guidance` writable-domain allowlist**, so a write addressed to it is rejected and mutates nothing. The guarantee is that the agent can never alter ingredient-storage content; it is enforced by the allowlist rather than by the absence of any write tool.

#### Scenario: List then read on demand

- **WHEN** the agent calls `list_guidance("ingredient_storage")` and then `read_guidance("ingredient_storage", ["tender-herbs", "_ethylene"])`
- **THEN** the list returns class slugs and the read returns the content of exactly the named entries

#### Scenario: Storage domain cannot be written

- **WHEN** a `save_guidance("ingredient_storage", …)` write is attempted
- **THEN** it is rejected (the domain is not on the writable allowlist) and the storage corpus is unchanged
