## MODIFIED Requirements

### Requirement: guidance/ umbrella with domain-keyed corpora

The system SHALL host curated guidance corpora under a `guidance/` umbrella at the **data-repo root**, organized by **domain** subdirectory: `guidance/ingredient_storage/` (the storage corpus), `guidance/cooking_techniques/` (cooking-technique memories), and `guidance/purchasing/` (buy-side selection/quality guidance). A `domain` SHALL be a member of a small controlled vocabulary; an unknown or path-unsafe domain SHALL be rejected with a structured error rather than read from disk. Each corpus file SHALL be markdown prose keyed by a semantic slug, optionally carrying a one-line `description` frontmatter field.

#### Scenario: Known domains resolve to their subtree

- **WHEN** a guidance tool is called with `domain: "cooking_techniques"`
- **THEN** it operates over `guidance/cooking_techniques/` and only that subtree

#### Scenario: A newly added domain resolves to its subtree

- **WHEN** a guidance tool is called with `domain: "purchasing"`
- **THEN** it operates over `guidance/purchasing/` and only that subtree

#### Scenario: Unknown or unsafe domain is rejected

- **WHEN** a guidance tool is called with a domain outside the controlled vocabulary (or one containing path separators / traversal)
- **THEN** it returns a structured error and reads nothing from disk

### Requirement: Domain-gated guidance write tool with a writable allowlist

The system SHALL provide `save_guidance(domain, slug, content, source?)` that creates or **refines** a single guidance entry. A **writable-domain allowlist** SHALL govern which domains accept writes; `cooking_techniques` and `purchasing` SHALL be on the allowlist and `ingredient_storage` SHALL NOT. A write to a non-allowlisted domain SHALL be rejected with a structured `validation_failed` and SHALL mutate nothing. Saving to an **existing** slug SHALL overwrite/refine that single file (one memory per slug); saving to a **new** slug SHALL create it. The `slug` SHALL be validated as a safe slug (lowercase, hyphen-separated; no path traversal).

#### Scenario: Save a new technique memory

- **WHEN** `save_guidance("cooking_techniques", "browning-meat", <distilled prose>, source)` is called and no such entry exists
- **THEN** it creates `guidance/cooking_techniques/browning-meat.md` with the prose and recorded source

#### Scenario: Save to the purchasing domain is accepted

- **WHEN** `save_guidance("purchasing", "olive-oil", <distilled prose>, source)` is called
- **THEN** it creates or refines `guidance/purchasing/olive-oil.md` (the `purchasing` domain is on the writable allowlist)

#### Scenario: Refine an existing technique memory

- **WHEN** `save_guidance` is called for an existing slug
- **THEN** the single existing file is overwritten with the refined content (no second file is appended)

#### Scenario: Write to a read-only domain is rejected

- **WHEN** `save_guidance("ingredient_storage", …)` is called
- **THEN** it returns `validation_failed`, writes nothing, and the ingredient-storage corpus is unchanged
