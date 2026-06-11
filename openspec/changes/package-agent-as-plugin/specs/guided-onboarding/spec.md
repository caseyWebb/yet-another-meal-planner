## ADDED Requirements

### Requirement: Guided first-run setup skill

The system SHALL provide a `grocery-onboarding` skill that walks a new member through initial setup conversationally rather than requiring a wall of typed input. The skill SHALL gather the member's profile, preferences, pantry, and diet principles, and SHALL persist each via the existing write tools (`update_preferences`, `update_pantry`, `update_taste`, `update_diet_principles`). It SHALL introduce no new MCP tools. Like every workflow skill, its opening directive SHALL reference the `grocery-persona` skill.

#### Scenario: New member is guided through setup

- **WHEN** a member with no existing profile begins onboarding
- **THEN** the skill prompts for profile, preferences, pantry, and diet principles conversationally and writes each through the corresponding existing write tool

#### Scenario: Onboarding uses only existing tools

- **WHEN** the onboarding skill persists captured setup
- **THEN** it does so through the existing write tools and defines no new MCP tool

### Requirement: Onboarding triggers on an empty profile or explicit request

The onboarding skill SHALL be loadable both by explicit invocation and by relevance when the agent observes that the member has no profile yet (existing read tools return empty). It SHALL NOT force the member to provide everything at once.

#### Scenario: Empty profile offers onboarding

- **WHEN** the agent observes that read tools return no profile for the member
- **THEN** the onboarding skill is available to guide setup

### Requirement: Incremental, resumable capture

The onboarding skill SHALL capture setup in small batches and persist each batch as it is gathered, so that an interrupted or abandoned setup leaves the already-provided information saved rather than lost.

#### Scenario: Interrupted setup keeps partial data

- **WHEN** a member provides some setup information and then stops partway through
- **THEN** the information already gathered has been written and is not lost
