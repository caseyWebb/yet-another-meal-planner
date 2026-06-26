# cooking-techniques Specification

## Purpose
TBD - created by archiving change add-cooking-techniques-guidance. Update Purpose after archive.
## Requirements
### Requirement: guidance/ umbrella with domain-keyed corpora

The system SHALL host curated guidance corpora under a `guidance/` umbrella at the **data-repo root**, organized by **domain** subdirectory: `guidance/ingredient_storage/` (the storage corpus) and `guidance/cooking_techniques/` (cooking-technique memories). A `domain` SHALL be a member of a small controlled vocabulary; an unknown or path-unsafe domain SHALL be rejected with a structured error rather than read from disk. Each corpus file SHALL be markdown prose keyed by a semantic slug, optionally carrying a one-line `description` frontmatter field.

#### Scenario: Known domains resolve to their subtree

- **WHEN** a guidance tool is called with `domain: "cooking_techniques"`
- **THEN** it operates over `guidance/cooking_techniques/` and only that subtree

#### Scenario: Unknown or unsafe domain is rejected

- **WHEN** a guidance tool is called with a domain outside the controlled vocabulary (or one containing path separators / traversal)
- **THEN** it returns a structured error and reads nothing from disk

### Requirement: Shared, agent-writable cooking-technique corpus

The system SHALL maintain `guidance/cooking_techniques/` as a **shared corpus** read by all tenants, holding general cooking-technique wisdom keyed by **technique slug** (e.g. `browning-meat.md`, `searing.md`, `resting-meat.md`) rather than by recipe or ingredient. Unlike the read-only storage corpus, this corpus SHALL be **agent-writable** with no extra gate (the shared-and-agent-writable posture of `stores`/`feeds`). Each file SHALL carry distilled prose and MAY carry a `description` and a `source` (provenance) frontmatter field. Technique entries SHALL be flat — there is no relational/`_`-prefixed cross-entry file.

#### Scenario: Technique keyed by slug, shared across tenants

- **WHEN** the `guidance/cooking_techniques/` tree is inspected
- **THEN** files are named for techniques (not recipes or ingredients) and the same file is read by every tenant

#### Scenario: Provenance recorded

- **WHEN** a technique memory is saved from a named source
- **THEN** the entry records the `source` so the advice is traceable and citable at the stove

### Requirement: Unified guidance read tools

The system SHALL provide one generic read pair over `guidance/<domain>/`: `list_guidance(domain?)` and `read_guidance(domain, slugs)`. `list_guidance` SHALL return available slugs each with their optional one-line `description` — for a single domain when `domain` is supplied, or for all domains grouped by domain when `domain` is omitted. `read_guidance(domain, slugs)` SHALL return the content of exactly the named entries within that domain. An absent corpus tree SHALL NOT be an error (it yields an empty listing). These tools SHALL replace the prior `list_storage_guidance` / `read_storage_guidance`.

#### Scenario: List one domain then read on demand

- **WHEN** the agent calls `list_guidance("cooking_techniques")` and then `read_guidance("cooking_techniques", ["browning-meat"])`
- **THEN** the list returns technique slugs (+ descriptions) and the read returns the content of exactly the named entries

#### Scenario: List all domains in one call

- **WHEN** the agent calls `list_guidance()` with no domain
- **THEN** it returns the slugs for every domain, grouped by domain

#### Scenario: Absent tree is empty, not an error

- **WHEN** `list_guidance("cooking_techniques")` is called and no `guidance/cooking_techniques/` tree exists yet
- **THEN** it returns an empty listing rather than an error

#### Scenario: Unknown slug on read is a structured not_found

- **WHEN** `read_guidance("cooking_techniques", ["no-such-technique"])` is called
- **THEN** it returns a structured `not_found` naming the slug

### Requirement: Domain-gated guidance write tool with a writable allowlist

The system SHALL provide `save_guidance(domain, slug, content, source?)` that creates or **refines** a single guidance entry. A **writable-domain allowlist** SHALL govern which domains accept writes; `cooking_techniques` SHALL be on the allowlist and `ingredient_storage` SHALL NOT. A write to a non-allowlisted domain SHALL be rejected with a structured `validation_failed` and SHALL mutate nothing. Saving to an **existing** slug SHALL overwrite/refine that single file (one memory per technique); saving to a **new** slug SHALL create it. The `slug` SHALL be validated as a safe slug (lowercase, hyphen-separated; no path traversal).

#### Scenario: Save a new technique memory

- **WHEN** `save_guidance("cooking_techniques", "browning-meat", <distilled prose>, source)` is called and no such entry exists
- **THEN** it creates `guidance/cooking_techniques/browning-meat.md` with the prose and recorded source

#### Scenario: Refine an existing technique memory

- **WHEN** `save_guidance` is called for an existing slug
- **THEN** the single existing file is overwritten with the refined content (no second file is appended)

#### Scenario: Write to a read-only domain is rejected

- **WHEN** `save_guidance("ingredient_storage", …)` is called
- **THEN** it returns `validation_failed`, writes nothing, and the ingredient-storage corpus is unchanged

### Requirement: Capture flow distills member-supplied sources

The agent SHALL provide a capture flow (a skill) that, when a member posts an article, a URL, or their own distillation of a cooking technique, compresses it to **imperative, non-obvious** guidance and persists it via `save_guidance("cooking_techniques", …)`, recording the `source` when known. The flow SHALL save the distilled essence, not the verbatim article, and SHALL read any existing entry for the slug first and **merge** rather than blindly replace. Fetching a URL SHALL be best-effort (these sources are frequently bot-walled); the flow SHALL accept pasted text when a fetch is not possible.

#### Scenario: Member posts an article to internalize

- **WHEN** the member posts a browning-meat article (or pastes its text) and asks the agent to remember it
- **THEN** the agent saves a distilled `browning-meat` technique memory via `save_guidance`, with the source recorded, and confirms what it saved

#### Scenario: Posting a second source for an existing technique

- **WHEN** the member posts further advice for a technique that already has a memory
- **THEN** the agent reads the existing entry and saves a single refined memory rather than creating a duplicate

### Requirement: Technique memories surfaced at cook time

During the guided `cook` flow, the agent SHALL surface relevant cooking-technique memories inline at the matching step. It SHALL map the recipe's steps to technique slugs using its **own world-knowledge** over the slugs returned by `list_guidance("cooking_techniques")` (no manifest or lookup table), then `read_guidance` the few that fit. It SHALL surface only **non-obvious** tips, capped to about the most valuable two, woven in at the relevant Prep/Cook step — not recited as a list. When no technique memory matches a step, the agent SHALL stay silent rather than improvise.

#### Scenario: Browning tip surfaces at the browning step

- **WHEN** the cook flow reaches a step that browns ground beef and a `browning-meat` memory exists
- **THEN** the agent weaves the saved tip in at that step ("even layer, don't disturb, brown not gray")

#### Scenario: Nothing relevant, nothing said

- **WHEN** a cook step has no matching technique memory
- **THEN** the agent offers no technique tip for it rather than inventing one

