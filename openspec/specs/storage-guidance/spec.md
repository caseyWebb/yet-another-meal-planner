# storage-guidance Specification

## Purpose
TBD - created by archiving change add-storage-guidance. Update Purpose after archive.
## Requirements
### Requirement: Class-keyed curated storage-guidance content tree

The system SHALL maintain an `guidance/ingredient_storage/` content tree under the **data-repo-root `guidance/` umbrella** as shared corpus content read by all tenants. Each file SHALL be markdown prose keyed by a **storage behavior class** (e.g. `tender-herbs.md`, `hardy-herbs.md`, `leafy-greens.md`, `alliums.md`) rather than by individual ingredient, so one entry covers a whole family of items without duplication. A small number of **singleton** files (e.g. `basil.md`, `tomatoes.md`, `avocados.md`) MAY exist for items whose storage rule contradicts their class. Relational "do not store together" rules (e.g. ethylene cross-contamination) SHALL live in a dedicated `_ethylene.md` file, because they belong to no single item. The tree SHALL be hand-maintained curated config and SHALL NOT be written by the agent.

#### Scenario: Guidance is keyed by class, not ingredient

- **WHEN** the `guidance/ingredient_storage/` tree is inspected
- **THEN** files are named for storage behavior classes (and a few singletons), not one file per ingredient, and the same file serves every member of its class

#### Scenario: Relational rules live in their own file

- **WHEN** a "do not store together" rule is recorded (e.g. onions apart from potatoes, ethylene producers away from sensitive items)
- **THEN** it lives in the relational `_ethylene.md` file rather than being duplicated into each affected item's file

### Requirement: Read-only access tools, no write path

The system SHALL expose `guidance/ingredient_storage/` through the unified guidance read tools `list_guidance("ingredient_storage")` (returning class slugs each with an optional one-line description) and `read_guidance("ingredient_storage", slugs)` (returning the named entries' content) — defined by the `cooking-techniques` capability. The storage corpus SHALL remain effectively read-only: the `ingredient_storage` domain SHALL be **excluded from the `save_guidance` writable-domain allowlist**, so a write addressed to it is rejected and mutates nothing. The guarantee is that the agent can never alter ingredient-storage content; it is enforced by the allowlist rather than by the absence of any write tool.

#### Scenario: List then read on demand

- **WHEN** the agent calls `list_guidance("ingredient_storage")` and then `read_guidance("ingredient_storage", ["tender-herbs", "_ethylene"])`
- **THEN** the list returns class slugs and the read returns the content of exactly the named entries

#### Scenario: Storage domain cannot be written

- **WHEN** a `save_guidance("ingredient_storage", …)` write is attempted
- **THEN** it is rejected (the domain is not on the writable allowlist) and the storage corpus is unchanged

### Requirement: Item-to-class mapping by agent judgment, not a manifest

The agent SHALL map a just-purchased item to the relevant guidance class using its own world knowledge over the semantic file slugs returned by `list_storage_guidance()` (e.g. "cilantro" → `tender-herbs`). The system SHALL NOT maintain an ingredient→class manifest or alias table for this mapping; the mapping is intentionally non-deterministic, and over-fetching an extra class file is harmless.

#### Scenario: Bought item resolves to a class via world knowledge

- **WHEN** the member has just bought cilantro and the agent is selecting guidance
- **THEN** the agent reads `tender-herbs.md` based on its own knowledge that cilantro is a tender herb, with no lookup table consulted

### Requirement: Storage tips surfaced at put-away

The agent SHALL surface a small number (about 2–3) of relevant, non-obvious storage tips when new perishables enter the kitchen — on **both** the `received` restock flow (order placement) **and** the farmers-market `update_pantry` haul. It SHALL select tips by relevance to what was just acquired and SHALL NOT repeat the same tip on every trip (mild repetition is accepted over maintaining seen-tip state).

#### Scenario: Tips on order receipt

- **WHEN** the member confirms they picked up an order and the pantry is restocked from the grocery list
- **THEN** the agent offers a couple of relevant storage tips for the perishables just received

#### Scenario: Tips on a market haul

- **WHEN** the member adds fresh produce via `update_pantry` after a farmers-market trip
- **THEN** the agent offers relevant storage tips for those items, the same as on the order path

### Requirement: No improvised or folklore guidance

The agent SHALL NOT improvise storage advice: when no class file matches a just-bought item, it SHALL stay silent rather than invent a tip. Contested or folklore tips SHALL be pre-hedged in the file's prose so that, by relaying the file faithfully, the agent never asserts contested guidance as settled fact.

#### Scenario: Nothing vetted to say

- **WHEN** the member buys an item with no matching class file in `storage_guidance/`
- **THEN** the agent offers no storage tip for it rather than improvising one

#### Scenario: Contested tip relayed with its hedge

- **WHEN** the agent surfaces a tip the file marks as contested (e.g. the berry vinegar rinse)
- **THEN** it relays the hedge present in the prose rather than presenting the tip as settled fact

