# cooking-techniques Specification

## Purpose
TBD - created by archiving change add-cooking-techniques-guidance. Update Purpose after archive.
## Requirements
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

### Requirement: Unified guidance read tools

The system SHALL provide one generic read tool over `guidance/<domain>/`: `read_guidance(domain?, slugs?)`. With `slugs` present it SHALL return the content of exactly the named entries within that domain (a structured `not_found` naming an unknown slug). With `slugs` absent it SHALL return the **listing** — available slugs each with their optional one-line `description` — for the named domain, or for all domains grouped by domain when `domain` is also omitted. An absent corpus tree SHALL NOT be an error (it yields an empty listing); an unknown domain yields a structured `validation_failed`. This single tool SHALL replace the prior `list_guidance` / `read_guidance` pair; for one deprecation window `list_guidance(domain?)` SHALL remain registered as a dispatch alias onto the listing mode (identical responses, no `warnings` injection), after which it falls to the generic unknown-tool rejection.

#### Scenario: List one domain then read on demand

- **WHEN** the agent calls `read_guidance("cooking_techniques")` and then `read_guidance("cooking_techniques", ["browning-meat"])`
- **THEN** the first call returns technique slugs (+ descriptions) and the second returns the content of exactly the named entries

#### Scenario: List all domains in one call

- **WHEN** the agent calls `read_guidance()` with no domain and no slugs
- **THEN** it returns the slugs for every domain, grouped by domain

#### Scenario: Absent tree is empty, not an error

- **WHEN** `read_guidance("cooking_techniques")` is called and no `guidance/cooking_techniques/` tree exists yet
- **THEN** it returns an empty listing rather than an error

#### Scenario: Unknown slug on read is a structured not_found

- **WHEN** `read_guidance("cooking_techniques", ["no-such-technique"])` is called
- **THEN** it returns a structured `not_found` naming the slug

#### Scenario: A stale list call dispatches for one window

- **WHEN** a stale plugin calls `list_guidance("purchasing")` during the deprecation window
- **THEN** the alias returns the identical listing `read_guidance("purchasing")` returns

### Requirement: Technique memories surfaced at cook time

During the guided `cook` flow, the agent SHALL surface relevant cooking-technique memories inline at the matching step. It SHALL map the recipe's steps to technique slugs using its **own world-knowledge** over the slugs returned by `read_guidance("cooking_techniques")`'s listing mode (no manifest or lookup table), then read the few that fit. It SHALL surface only **non-obvious** tips, capped to about the most valuable two, woven in at the relevant Prep/Cook step — not recited as a list. When no technique memory matches a step, the agent SHALL stay silent rather than improvise.

#### Scenario: Browning tip surfaces at the browning step

- **WHEN** the cook flow reaches a step that browns ground beef and a `browning-meat` memory exists
- **THEN** the agent weaves the saved tip in at that step ("even layer, don't disturb, brown not gray")

#### Scenario: Nothing relevant, nothing said

- **WHEN** a cook step has no matching technique memory
- **THEN** the agent offers no technique tip for it rather than inventing one

### Requirement: Shared, operator-curated cooking-technique corpus

The system SHALL maintain `guidance/cooking_techniques/` as a **shared corpus** read by all tenants, holding general cooking-technique wisdom keyed by **technique slug** (e.g. `browning-meat.md`, `searing.md`, `resting-meat.md`) rather than by recipe or ingredient. The corpus SHALL be **operator-curated** via the admin guidance editor — like every guidance domain, it is not agent-writable. Each file SHALL carry distilled prose and MAY carry a `description` and a `source` (provenance) frontmatter field. Technique entries SHALL be flat — there is no relational/`_`-prefixed cross-entry file.

#### Scenario: Technique keyed by slug, shared across tenants

- **WHEN** the `guidance/cooking_techniques/` tree is inspected
- **THEN** files are named for techniques (not recipes or ingredients) and the same file is read by every tenant

#### Scenario: Provenance recorded

- **WHEN** the operator saves a technique memory distilled from a named source
- **THEN** the entry records the `source` so the advice is traceable and citable at the stove

