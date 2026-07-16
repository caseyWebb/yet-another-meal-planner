## MODIFIED Requirements

### Requirement: Guided first-run setup skill

The system SHALL provide a `configure-yamp-profile` skill that handles a member's grocery profile — **store location (ZIP)**, taste, cooking preferences, diet principles, **kitchen equipment**, a **starter recipe corpus**, starting pantry, an optional **bulk-buy watchlist**, and an optional **staples list** — **idempotently**: on an empty profile it walks first-time setup conversationally (rather than requiring a wall of typed input); on an existing profile it reads back what it already knows (via `read_user_profile()`) and edits only what the member names. It SHALL persist each piece via write tools — `update_preferences`, `update_taste`, `update_diet_principles`, `update_kitchen`, `update_pantry`, `update_stockup` (bulk-buy watchlist), `update_feeds` (discovery feeds), and `update_staples` (staples list). There SHALL be no ready-to-eat (heat-and-eat) acceptance area — ready-to-eat is not an onboarding concept; heat-and-eat items a member has on hand are captured as ordinary pantry stock during the inventory walk. The skill itself SHALL NOT define an MCP tool — it composes existing and newly-added tools owned by other capabilities. Like every workflow skill, it SHALL load `yamp-core` via its prerequisite line.

The kitchen-equipment setup area SHALL walk the `EQUIPMENT_VOCAB` as a short, finite checklist (e.g. "do you have any of these: pressure cooker, sous vide, blender, …?") and SHALL persist the member's owned equipment to the D1 `kitchen_equipment` table via `update_kitchen`. It SHALL seed only the gating `owned` list, not the free-text `notes` region (oven count and pan sizes surface naturally during the `cook` flow). A member SHALL be able to skip the area, leaving `owned` empty — which makes the makeability gate a no-op, degrading gracefully to unfiltered behavior. The equipment area SHALL run before the starter-corpus area so the makeability gate is seeded for corpus curation.

The staples setup area SHALL ask the member which items they never want to run out of, noting that the list is curated — only things they want the agent to remind them about. For each named item, it SHALL ask if it is perishable (short shelf life once opened / stored). It SHALL persist the list to the D1 `staples` table via `update_staples`. The area is skippable; an absent staples list degrades to no-prompting behavior.

#### Scenario: New member is guided through setup

- **WHEN** a member with no existing profile begins onboarding
- **THEN** the skill prompts for store ZIP, taste, diet principles, equipment, a starter corpus, pantry, an optional watchlist, and an optional staples list conversationally and writes each through the corresponding write tool — with no ready-to-eat acceptance step

#### Scenario: Heat-and-eat items on hand are plain pantry stock

- **WHEN** during the inventory walk the member names frozen dinners they have in the freezer
- **THEN** the skill records them as pantry stock via `update_pantry` like any other item, with no catalog offer and no ready-to-eat write

#### Scenario: Equipment checklist seeds the kitchen inventory

- **WHEN** the member confirms they own a pressure cooker and a blender during the equipment checklist
- **THEN** the skill writes `owned = ["pressure-cooker", "blender"]` to that member's D1 kitchen inventory via `update_kitchen`

#### Scenario: Skipped equipment leaves the gate inert

- **WHEN** the member skips the kitchen-equipment area
- **THEN** `owned` is left empty in D1 and the makeability gate suppresses no recipes for that member

#### Scenario: Staples seeded at onboarding

- **WHEN** the member names "olive oil, salt, eggs (perishable)" during the staples setup area
- **THEN** the skill writes `[{ name: "olive oil" }, { name: "salt" }, { name: "eggs", perishable: true }]` to the member's D1 staples table via `update_staples`

#### Scenario: Skipped staples area leaves staples empty

- **WHEN** the member skips the staples setup area
- **THEN** no staples rows are written to D1 and all staples-driven prompting behaviors remain suppressed

#### Scenario: Onboarding composes tools rather than defining its own

- **WHEN** the onboarding skill persists captured setup
- **THEN** it does so through write tools owned by other capabilities (the existing `update_*` plus `update_stockup`, `update_feeds`, and `update_staples`) and defines no MCP tool of its own

## REMOVED Requirements

### Requirement: Inventory and heat-and-eat acceptance cross-record ready-to-eat items

**Reason**: The ready-to-eat catalog and its write tools are removed wholesale, and onboarding loses the heat-and-eat acceptance area — there are no longer two views to keep in sync. Heat-and-eat items are ordinary pantry stock.
**Migration**: The inventory walk keeps recording on-hand stock via `update_pantry`; the catalog-offer half of the behavior ceases. Existing per-tenant `ready_to_eat` rows stay inert in the retained D1 table.
