## MODIFIED Requirements

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
