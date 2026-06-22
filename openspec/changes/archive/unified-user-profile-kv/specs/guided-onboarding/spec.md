## MODIFIED Requirements

### Requirement: Guided first-run setup skill

The system SHALL provide a `configure-grocery-profile` skill that handles a member's grocery profile — **store location (ZIP)**, taste, cooking preferences, diet principles, **kitchen equipment**, a **starter recipe corpus**, starting pantry, an optional **bulk-buy watchlist**, an optional **staples list**, and **ready-to-eat (heat-and-eat) acceptance** — **idempotently**: on an empty profile it walks first-time setup conversationally; on an existing profile it reads back what it already knows and edits only what the member names. It SHALL persist each piece via write tools — `update_preferences`, `update_taste`, `update_diet_principles`, `update_kitchen`, `update_pantry`, `add_draft_ready_to_eat`, `update_stockup`, `update_feeds`, `update_staples`, and `commit_changes` (to bulk-promote the starter corpus into the caller's overlay via KV write-through). The skill itself SHALL NOT define an MCP tool. Like every workflow skill, it SHALL load `grocery-core` via its prerequisite line.

To read the current profile state, the skill SHALL call `read_user_profile()` rather than the individual read tools (`read_preferences`, `read_taste`, `read_diet_principles`, `read_kitchen`, `read_staples`). The returned bundle provides all profile sections needed to assess which areas are already filled in and which need setup.

#### Scenario: New member is guided through setup

- **WHEN** a member with no existing profile begins onboarding
- **THEN** the skill prompts for store ZIP, taste, diet principles, equipment, a starter corpus, pantry, an optional watchlist, an optional staples list, and ready-to-eat acceptance conversationally and writes each through the corresponding write tool

#### Scenario: Existing member can update individual areas

- **WHEN** a member with an existing profile runs `configure-grocery-profile`
- **THEN** the skill reads the current profile via `read_user_profile()` and only prompts to update the areas the member names or that are missing

#### Scenario: profile_status drives onboarding gate from KV

- **WHEN** `profile_status()` is called at the start of a session
- **THEN** it checks DATA_KV for the `profile:<username>` bundle's `preferences` field to determine `initialized`, and checks which profile/state fields are absent to populate `missing` — no GitHub directory listing is performed
