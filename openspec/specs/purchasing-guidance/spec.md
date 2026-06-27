# purchasing-guidance Specification

## Purpose
TBD - created by archiving change add-purchasing-guidance. Update Purpose after archive.
## Requirements
### Requirement: Shared, agent-writable purchasing corpus keyed by product/item

The system SHALL maintain `guidance/purchasing/` as a **shared corpus** read by all tenants, holding buy-side selection wisdom keyed by **product/item slug** (e.g. `canned-tomatoes.md`, `olive-oil.md`) — *what kind of X to get* and the non-obvious quality/ripeness judgments for that item. A small number of **class** files MAY exist where the knowledge genuinely generalizes across a family (e.g. `stone-fruit.md`), but the default unit is the item. Like `cooking_techniques` and unlike the read-only `ingredient_storage` corpus, this corpus SHALL be **agent-writable** (it is on the `save_guidance` writable-domain allowlist). Each file SHALL carry distilled prose and a one-line `description` frontmatter field, and MAY carry a `source` (provenance) field. Entries SHALL be flat — there is no relational `_`-prefixed cross-entry file (there is no "do not buy together" rule, unlike storage's `_ethylene`).

#### Scenario: Keyed by item, shared across tenants

- **WHEN** the `guidance/purchasing/` tree is inspected
- **THEN** files are named for products/items (not storage classes or techniques) and the same file is read by every tenant

#### Scenario: Provenance recorded from a buying guide

- **WHEN** a purchasing entry is saved from a named buying guide or taste test
- **THEN** the entry records the `source` so the advice is traceable and citable at the shelf

### Requirement: Phone-out inclusion gate

The purchasing corpus SHALL hold only knowledge **non-obvious enough that a member would consult it standing in the aisle** — the buy-side analogue of the storage corpus's "skip the obvious." Obvious or already-well-understood buy knowledge SHALL NOT be entered; in particular, produce **seasonality** is out of scope. Ripeness/quality judgments SHALL be admitted only through this same gate — a non-obvious "how to choose a ripe pineapple" qualifies, an obvious "is this banana brown" does not.

#### Scenario: Non-obvious selection earns an entry

- **WHEN** the knowledge is a researched buy-side judgment (which canned tomatoes for sauce, which supermarket olive oil is actually good)
- **THEN** it is eligible for an entry in `guidance/purchasing/`

#### Scenario: Obvious or seasonality knowledge is excluded

- **WHEN** the knowledge is obvious at a glance or is produce seasonality (well understood)
- **THEN** no purchasing entry is created for it

### Requirement: No improvised or folklore buying guidance

The agent SHALL NOT improvise buying advice: when no purchasing entry matches an item, it SHALL stay silent rather than invent a tip. Contested or folklore tips — ripeness lore especially — SHALL be **pre-hedged in the file's prose** so that, by relaying the file faithfully, the agent never asserts contested guidance as settled fact. This mirrors the `ingredient_storage` anti-folklore posture, carried over to the writable purchasing corpus.

#### Scenario: Nothing vetted to say

- **WHEN** an item on the list has no matching entry in `guidance/purchasing/`
- **THEN** the agent offers no purchasing tip for it rather than improvising one

#### Scenario: Contested tip relayed with its hedge

- **WHEN** the agent surfaces a tip the file marks as contested (e.g. a debated ripeness cue)
- **THEN** it relays the hedge present in the prose rather than presenting the tip as settled fact

### Requirement: Item-to-entry mapping by agent world-knowledge, not a manifest

The agent SHALL map a grocery-list item to the relevant purchasing entry using its **own world-knowledge** over the semantic slugs returned by `list_guidance("purchasing")` (e.g. a "canned tomatoes" line → `canned-tomatoes`, a "peaches" line → `stone-fruit`). The system SHALL NOT maintain an item→entry manifest or alias table; the mapping is intentionally non-deterministic, and over-fetching an extra entry is harmless.

#### Scenario: List item resolves to an entry via world knowledge

- **WHEN** the list has canned tomatoes and the agent is selecting purchasing guidance
- **THEN** the agent reads `canned-tomatoes.md` based on its own knowledge of the mapping, with no lookup table consulted

### Requirement: Capture flow distills member buying guides

The agent SHALL provide a capture flow (a skill) that, when a member posts a buying guide, a taste test, a URL, or their own distillation of *what to buy*, compresses it to **imperative, non-obvious** "what to actually grab" guidance and persists it via `save_guidance("purchasing", …)`, recording the `source` when known. The flow SHALL save the distilled essence, not the verbatim article, and SHALL read any existing entry for the slug first and **merge** rather than blindly replace (one memory per item). Fetching a URL SHALL be best-effort (buying-guide sources are frequently bot-walled); the flow SHALL accept pasted text when a fetch is not possible. The skill's selection criteria SHALL **disambiguate** it from its siblings: a *technique* article belongs to the cooking-technique capture flow (`cooking_techniques`), and a *single-recipe* tweak belongs to the recipe-note flow — only *what-to-buy* knowledge is filed to `purchasing`.

#### Scenario: Member posts a buying guide to internalize

- **WHEN** the member posts a "best olive oil" taste test (or pastes its text) and asks the agent to remember it
- **THEN** the agent saves a distilled `olive-oil` purchasing entry via `save_guidance("purchasing", …)`, with the source recorded, and confirms what it saved

#### Scenario: A buying guide is filed to purchasing, not techniques

- **WHEN** the member posts guidance about *which product to buy* (not how to cook it)
- **THEN** the agent files it under `purchasing`, not `cooking_techniques`

#### Scenario: A second source refines the single entry

- **WHEN** the member posts further buying advice for an item that already has an entry
- **THEN** the agent reads the existing entry and saves a single refined entry rather than creating a duplicate

### Requirement: Purchasing tips surfaced at shop time

During the `shop-groceries` flow, the agent SHALL surface a small number (about 2–3) of relevant, non-obvious purchasing tips for what is on the list — at the **pick** end of the trip, mirroring how storage tips surface at the **received** end. On the **in-store walk** it SHALL weave the tip in as the relevant aisle/section is reached, selecting entries by relevance to the list items (by world-knowledge mapping). On the **online (Kroger) flush** it SHALL instead give a single consolidated "check the cart and swap manually" callout. Purchasing guidance SHALL be **narration only** in v1: it SHALL NOT influence `match_ingredient_to_kroger_sku` and SHALL NOT write `preferences.brands`. When no entry matches a list item, the agent SHALL stay silent rather than improvise, and SHALL NOT repeat the same tip on every trip.

#### Scenario: In-store tip surfaces at the relevant aisle

- **WHEN** the in-store walk reaches the canned-goods aisle and a `canned-tomatoes` entry exists for a tomato item on the list
- **THEN** the agent weaves the saved buying tip in at that aisle ("for sauce, grab a no-calcium-chloride San Marzano")

#### Scenario: Online flush gives a manual-swap callout

- **WHEN** the online (Kroger) flush builds the cart and a purchasing entry matches a list item
- **THEN** the agent gives a single consolidated "eyeball these in the cart and swap manually" callout and does not alter the SKU match automatically

#### Scenario: Nothing relevant, nothing said

- **WHEN** a list item has no matching purchasing entry
- **THEN** the agent offers no purchasing tip for it rather than inventing one

#### Scenario: Guidance does not alter SKU matching

- **WHEN** purchasing guidance exists for an item being ordered online
- **THEN** `match_ingredient_to_kroger_sku` runs unchanged and the guidance is surfaced only as narration (no automatic substitution, no `preferences.brands` write)

