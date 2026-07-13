## MODIFIED Requirements

### Requirement: One household adapter projection drives every member store surface

The Worker SHALL expose one session-gated, household-scoped store-adapter projection from a named shared operation. The projection SHALL contain both adapter-card data and grocery-launcher entries, and Profile and Grocery SHALL consume those fields without independently deriving adapter eligibility. It SHALL expose only credential presence and SHALL perform no external request or return any credential.

The projection SHALL use stable adapter/mode discriminants and deterministic ordering. Its launcher SHALL include only configured paths: Kroger online order, the configured satellite store, the selected Offline store walk, and the Instacart Marketplace handoff when complete valid operator configuration is present. An unavailable Instacart adapter SHALL produce no launcher entry.

#### Scenario: Profile and Grocery receive identical adapter truth

- **WHEN** a household has multiple configured adapters
- **THEN** one projection contains the card summaries and launcher entries consumed by both pages

#### Scenario: Projection is secret-free and externally inert

- **WHEN** the projection is read
- **THEN** it performs no provider request and returns no credential

#### Scenario: Launcher ordering is deterministic

- **WHEN** configured adapters are read repeatedly
- **THEN** launcher order is Kroger, satellites, selected Offline walk, then configured Instacart handoff

### Requirement: Offline reuses the store registry and Instacart exposes availability only

The Offline adapter SHALL present grocery-domain rows from the existing shared `stores` registry and SHALL NOT create a parallel entity. Missing selected slugs SHALL remain visible as unavailable without silently choosing another store.

The Instacart adapter-card projection SHALL expose only whether complete valid operator configuration is available. It SHALL expose no account state, retailer source, connect control, credential, or configuration detail. When available it SHALL add one enabled `marketplace_handoff` launcher entry with no store identity; when unavailable it SHALL add no launcher entry.

#### Scenario: Offline rows are existing stores, not copies

- **WHEN** shared grocery stores exist
- **THEN** Offline lists those rows without creating copies

#### Scenario: Deleted preferred Offline store is not silently replaced

- **WHEN** the selected slug is absent
- **THEN** it remains unavailable and emits no enabled walk entry

#### Scenario: Instacart availability is secret-free

- **WHEN** complete valid operator configuration exists
- **THEN** availability is reported without exposing the key or implying member account linking, preferred retailer, price, availability, or ETA
