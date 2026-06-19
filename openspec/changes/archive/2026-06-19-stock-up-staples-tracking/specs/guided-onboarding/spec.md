## MODIFIED Requirements

### Requirement: Guided first-run setup skill

The system SHALL provide a `configure-grocery-profile` skill that handles a member's grocery profile — **store location (ZIP)**, taste, cooking preferences, diet principles, **kitchen equipment**, a **starter recipe corpus**, starting pantry, an optional **bulk-buy watchlist**, an optional **staples list**, and **ready-to-eat (heat-and-eat) acceptance** — **idempotently**: on an empty profile it walks first-time setup conversationally (rather than requiring a wall of typed input); on an existing profile it reads back what it already knows and edits only what the member names. It SHALL persist each piece via write tools — `update_preferences`, `update_taste`, `update_diet_principles`, `update_kitchen`, `update_pantry`, `add_draft_ready_to_eat`, `update_stockup` (bulk-buy watchlist), `update_feeds` (discovery feeds), `update_staples` (staples list), and `commit_changes` (to bulk-promote the starter corpus into the caller's overlay). The skill itself SHALL NOT define an MCP tool — it composes existing and newly-added tools owned by other capabilities. Like every workflow skill, it SHALL load `grocery-core` via its prerequisite line.

The ready-to-eat setup area SHALL ask which kinds of heat-and-eat items the member accepts and for which meals, and SHALL persist named acceptances to the member's `users/<username>/ready_to_eat.toml` as `active` items (via `add_draft_ready_to_eat` with `status: active`). A member with no opinion on ready-to-eat SHALL be able to skip the area, leaving the catalog empty.

The kitchen-equipment setup area SHALL walk the `EQUIPMENT_VOCAB` as a short, finite checklist (e.g. "do you have any of these: pressure cooker, sous vide, blender, …?") and SHALL persist the member's owned equipment to `users/<username>/kitchen.toml` `owned` via `update_kitchen`. It SHALL seed only the gating `owned` list, not the free-text `[notes]` region (oven count and pan sizes surface naturally during the `cook` flow). A member SHALL be able to skip the area, leaving `owned` empty — which makes the makeability gate a no-op, degrading gracefully to unfiltered behavior. The equipment area SHALL run before the starter-corpus area so the makeability gate is seeded for corpus curation.

The staples setup area SHALL ask the member which items they never want to run out of, noting that the list is curated — only things they want the agent to remind them about. For each named item, it SHALL ask if it is perishable (short shelf life once opened / stored). It SHALL persist the list via `update_staples`. The area is skippable; an absent staples list degrades to no-prompting behavior.

#### Scenario: New member is guided through setup

- **WHEN** a member with no existing profile begins onboarding
- **THEN** the skill prompts for store ZIP, taste, diet principles, equipment, a starter corpus, pantry, an optional watchlist, an optional staples list, and ready-to-eat acceptance conversationally and writes each through the corresponding write tool

#### Scenario: Staples seeded at onboarding

- **WHEN** the member names "olive oil, salt, eggs (perishable)" during the staples setup area
- **THEN** the skill writes `[{ name: "olive oil" }, { name: "salt" }, { name: "eggs", perishable: true }]` to the member's `users/<username>/staples.toml` via `update_staples`

#### Scenario: Skipped staples area leaves file absent

- **WHEN** the member skips the staples setup area
- **THEN** no `staples.toml` is written and all staples-driven prompting behaviors remain suppressed

#### Scenario: Ready-to-eat acceptances seed the per-tenant catalog

- **WHEN** the member names heat-and-eat items they accept during onboarding
- **THEN** the skill writes them as `active` items to that member's `users/<username>/ready_to_eat.toml`, tagged by meal, affecting no other member

#### Scenario: Equipment checklist seeds the kitchen inventory

- **WHEN** the member confirms they own a pressure cooker and a blender during the equipment checklist
- **THEN** the skill writes `owned = ["pressure-cooker", "blender"]` to that member's `users/<username>/kitchen.toml` via `update_kitchen`

#### Scenario: Skipped equipment leaves the gate inert

- **WHEN** the member skips the kitchen-equipment area
- **THEN** `owned` is left empty and the makeability gate suppresses no recipes for that member

#### Scenario: Onboarding composes tools rather than defining its own

- **WHEN** the onboarding skill persists captured setup
- **THEN** it does so through write tools owned by other capabilities (the existing `update_*` / `add_draft_ready_to_eat` / `commit_changes` plus `update_stockup`, `update_feeds`, and `update_staples`) and defines no MCP tool of its own
