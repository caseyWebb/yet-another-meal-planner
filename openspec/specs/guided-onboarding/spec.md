# guided-onboarding Specification

## Purpose
TBD - created by archiving change package-agent-as-plugin. Update Purpose after archive.
## Requirements
### Requirement: Guided first-run setup skill

The system SHALL provide a `configure-grocery-profile` skill that handles a member's grocery profile — taste, cooking preferences, diet principles, starting pantry, **ready-to-eat (heat-and-eat) acceptance**, and **kitchen equipment** — **idempotently**: on an empty profile it walks first-time setup conversationally (rather than requiring a wall of typed input); on an existing profile it reads back what it already knows and edits only what the member names. It SHALL persist each piece via the existing write tools (`update_taste`, `update_preferences`, `update_diet_principles`, `update_pantry`, `add_draft_ready_to_eat` for ready-to-eat acceptance, and `update_kitchen` for equipment) and SHALL define no new MCP tool of its own. Like every workflow skill, it SHALL load `grocery-core` via its prerequisite line.

The ready-to-eat setup area SHALL ask which kinds of heat-and-eat items the member accepts and for which meals, and SHALL persist named acceptances to the member's `users/<username>/ready_to_eat.toml` as `active` items (via `add_draft_ready_to_eat` with `status: active`). A member with no opinion on ready-to-eat SHALL be able to skip the area, leaving the catalog empty.

The kitchen-equipment setup area SHALL walk the `EQUIPMENT_VOCAB` as a short, finite checklist (e.g. "do you have any of these: pressure cooker, sous vide, blender, …?") and SHALL persist the member's owned equipment to `users/<username>/kitchen.toml` `owned` via `update_kitchen`. It SHALL seed only the gating `owned` list, not the free-text `[notes]` region (oven count and pan sizes surface naturally during the `cook` flow). A member SHALL be able to skip the area, leaving `owned` empty — which makes the makeability gate a no-op, degrading gracefully to unfiltered behavior.

#### Scenario: New member is guided through setup

- **WHEN** a member with no existing profile begins onboarding
- **THEN** the skill prompts for taste, preferences, diet principles, pantry, ready-to-eat acceptance, and kitchen equipment conversationally and writes each through the corresponding existing write tool

#### Scenario: Ready-to-eat acceptances seed the per-tenant catalog

- **WHEN** the member names heat-and-eat items they accept during onboarding
- **THEN** the skill writes them as `active` items to that member's `users/<username>/ready_to_eat.toml`, tagged by meal, affecting no other member

#### Scenario: Equipment checklist seeds the kitchen inventory

- **WHEN** the member confirms they own a pressure cooker and a blender during the equipment checklist
- **THEN** the skill writes `owned = ["pressure-cooker", "blender"]` to that member's `users/<username>/kitchen.toml` via `update_kitchen`

#### Scenario: Skipped equipment leaves the gate inert

- **WHEN** the member skips the kitchen-equipment area
- **THEN** `owned` is left empty and the makeability gate suppresses no recipes for that member

#### Scenario: Onboarding uses only existing tools

- **WHEN** the onboarding skill persists captured setup
- **THEN** it does so through the existing write tools and defines no new MCP tool

### Requirement: Onboarding triggers on an empty profile or explicit request

The onboarding skill SHALL be loadable both by explicit invocation and by a **deterministic initialization gate** in the `grocery-core` persona tier (which every workflow loads once per session). Before the first substantive action in a session, the agent SHALL call `profile_status`; when it reports `initialized: false`, the agent SHALL run `configure-grocery-profile` before fulfilling the original request, then resume that request. The gate SHALL pass `missing` through to onboarding so already-completed areas can be skipped. The onboarding flow SHALL NOT force the member to provide everything at once.

The gate SHALL be **fail-open**: if `profile_status` returns an error (an indeterminate result), the agent SHALL proceed with the request normally — a transient failure SHALL NOT be treated as "not initialized." The gate SHALL be **skipped** when the active flow is itself `configure-grocery-profile` (no self-loop) or `report-grocery-agent-bug` (a new member must be able to report a bug without first completing setup).

#### Scenario: Uninitialized member is routed through onboarding first

- **WHEN** a member whose `profile_status` reports `initialized: false` makes a substantive request (e.g. "make me a menu")
- **THEN** the agent runs `configure-grocery-profile` before fulfilling it, then resumes the original request

#### Scenario: Initialized member proceeds directly

- **WHEN** `profile_status` reports `initialized: true`
- **THEN** the gate passes and the agent fulfills the request without re-running onboarding

#### Scenario: Gate fails open on an indeterminate status

- **WHEN** `profile_status` returns an error rather than a clear initialized state
- **THEN** the agent proceeds with the request normally rather than forcing onboarding

#### Scenario: Bug reporting is not gated

- **WHEN** a brand-new (uninitialized) member invokes `report-grocery-agent-bug`
- **THEN** the gate is skipped and the bug report proceeds without forcing setup first

#### Scenario: Onboarding does not gate itself

- **WHEN** the active flow is `configure-grocery-profile`
- **THEN** the initialization gate is skipped so onboarding does not re-trigger itself

### Requirement: Incremental, resumable capture

The onboarding skill SHALL capture setup in small batches and persist each batch as it is gathered, so that an interrupted or abandoned setup leaves the already-provided information saved rather than lost.

#### Scenario: Interrupted setup keeps partial data

- **WHEN** a member provides some setup information and then stops partway through
- **THEN** the information already gathered has been written and is not lost

