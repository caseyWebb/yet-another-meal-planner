# purchasing-guidance — delta

## ADDED Requirements

### Requirement: Shared, operator-curated purchasing corpus keyed by product/item

The system SHALL maintain `guidance/purchasing/` as a **shared corpus** read by all tenants, holding buy-side selection wisdom keyed by **product/item slug** (e.g. `canned-tomatoes.md`, `olive-oil.md`) — *what kind of X to get* and the non-obvious quality/ripeness judgments for that item. A small number of **class** files MAY exist where the knowledge genuinely generalizes across a family (e.g. `stone-fruit.md`), but the default unit is the item. The corpus SHALL be **operator-curated** via the admin guidance editor — like every guidance domain, it is not agent-writable (there is no `save_guidance` tool). Each file SHALL carry distilled prose and a one-line `description` frontmatter field, and MAY carry a `source` (provenance) field. Entries SHALL be flat — there is no relational `_`-prefixed cross-entry file (there is no "do not buy together" rule, unlike storage's `_ethylene`).

#### Scenario: Keyed by item, shared across tenants

- **WHEN** the `guidance/purchasing/` tree is inspected
- **THEN** files are named for products/items (not storage classes or techniques) and the same file is read by every tenant

#### Scenario: Provenance recorded from a buying guide

- **WHEN** the operator saves an entry distilled from a named buying guide or taste test
- **THEN** the entry records the `source` so the advice is traceable and citable at the shelf

#### Scenario: The agent cannot write the corpus

- **WHEN** the member MCP tool surface is enumerated
- **THEN** no guidance write tool appears; purchasing entries change only through operator curation

## MODIFIED Requirements

### Requirement: Item-to-entry mapping by agent world-knowledge, not a manifest

The agent SHALL map a grocery-list item to the relevant purchasing entry using its **own world-knowledge** over the semantic slugs returned by `read_guidance("purchasing")`'s listing mode (e.g. a "canned tomatoes" line → `canned-tomatoes`, a "peaches" line → `stone-fruit`). The system SHALL NOT maintain an item→entry manifest or alias table; the mapping is intentionally non-deterministic, and over-fetching an extra entry is harmless.

#### Scenario: List item resolves to an entry via world knowledge

- **WHEN** the list has canned tomatoes and the agent is selecting purchasing guidance
- **THEN** the agent reads `canned-tomatoes.md` based on its own knowledge of the mapping, with no lookup table consulted

## REMOVED Requirements

### Requirement: Capture flow distills member buying guides

**Reason**: The member-driven distill-and-save flow depended on `save_guidance`, which is removed with the member guidance-write surface; buying-guide curation is an operator concern via the admin guidance editor.
**Migration**: None on the agent surface. An operator files distilled what-to-buy knowledge through the admin editor (one entry per item; refine, don't duplicate).

### Requirement: Shared, agent-writable purchasing corpus keyed by product/item

**Reason**: The corpus stays shared and item-keyed, but its agent-writable posture dies with the member guidance-write surface — the operator curates it via the admin editor.
**Migration**: Superseded by this delta's ADDED "Shared, operator-curated purchasing corpus keyed by product/item" requirement; existing content and file conventions are unchanged.
