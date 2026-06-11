## MODIFIED Requirements

### Requirement: Guided first-run setup skill

The system SHALL provide a `configure-grocery-profile` skill that handles a member's grocery profile — taste, cooking preferences, diet principles, starting pantry, and **ready-to-eat (heat-and-eat) acceptance** — **idempotently**: on an empty profile it walks first-time setup conversationally (rather than requiring a wall of typed input); on an existing profile it reads back what it already knows and edits only what the member names. It SHALL persist each piece via the existing write tools (`update_taste`, `update_preferences`, `update_diet_principles`, `update_pantry`, and `add_draft_ready_to_eat` for ready-to-eat acceptance) and SHALL introduce no new MCP tools. Like every workflow skill, it SHALL load `grocery-core` via its prerequisite line.

The ready-to-eat setup area SHALL ask which kinds of heat-and-eat items the member accepts and for which meals, and SHALL persist named acceptances to the member's `users/<username>/ready_to_eat.toml` as `active` items (via `add_draft_ready_to_eat` with `status: active`). A member with no opinion on ready-to-eat SHALL be able to skip the area, leaving the catalog empty.

#### Scenario: New member is guided through setup

- **WHEN** a member with no existing profile begins onboarding
- **THEN** the skill prompts for taste, preferences, diet principles, pantry, and ready-to-eat acceptance conversationally and writes each through the corresponding existing write tool

#### Scenario: Ready-to-eat acceptances seed the per-tenant catalog

- **WHEN** the member names heat-and-eat items they accept during onboarding
- **THEN** the skill writes them as `active` items to that member's `users/<username>/ready_to_eat.toml`, tagged by meal, affecting no other member

#### Scenario: Onboarding uses only existing tools

- **WHEN** the onboarding skill persists captured setup
- **THEN** it does so through the existing write tools and defines no new MCP tool
