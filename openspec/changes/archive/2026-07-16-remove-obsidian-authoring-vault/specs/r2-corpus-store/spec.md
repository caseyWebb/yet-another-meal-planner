## MODIFIED Requirements

### Requirement: Human-direct edits get eventual, surfaced feedback

A corpus edit made outside the Worker (e.g. an S3-compatible client such as `rclone` writing to R2) SHALL be validated by the reconcile, not by CI. When such an edit is invalid, the system SHALL surface the failure through an agent-readable record and operator-visible health/notification, rather than silently dropping it. The system SHALL NOT require a GitHub CI run to validate corpus content.

#### Scenario: A bad direct edit is surfaced, not silent

- **WHEN** an author writes a malformed recipe to R2 with an S3-compatible client
- **THEN** the reconcile skips indexing it and the failure becomes visible (agent-surfaced message + `/health` + optional ntfy), with no reliance on GitHub CI

#### Scenario: A valid direct edit indexes without CI

- **WHEN** an author writes a well-formed recipe edit to R2
- **THEN** the next reconcile projects it into the index, with no GitHub push or CI run involved
