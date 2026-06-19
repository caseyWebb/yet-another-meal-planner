## ADDED Requirements

### Requirement: read_staples returns the caller's staples list

The system SHALL provide `read_staples()` that reads the caller's `users/<username>/staples.toml` and returns `{ items: [{ name, perishable? }] }`. When `staples.toml` is absent or empty the tool SHALL return `{ items: [] }` rather than an error, matching the graceful-degradation contract for optional per-tenant files.

#### Scenario: Returns items with perishable flag

- **WHEN** the caller's `staples.toml` contains `[{ name: "olive oil" }, { name: "eggs", perishable: true }]`
- **THEN** `read_staples()` returns `{ items: [{ name: "olive oil" }, { name: "eggs", perishable: true }] }`

#### Scenario: Missing file returns empty list

- **WHEN** the caller has no `staples.toml`
- **THEN** `read_staples()` returns `{ items: [] }` and does not error
