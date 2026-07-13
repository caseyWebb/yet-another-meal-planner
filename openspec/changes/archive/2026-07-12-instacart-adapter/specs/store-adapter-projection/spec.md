## MODIFIED Requirements

### Requirement: One household adapter projection drives every member store surface

The Worker SHALL expose one session-gated, household-scoped store-adapter projection from a named shared operation. The projection SHALL contain both adapter-card data and grocery-launcher entries, and the Profile and Grocery pages SHALL consume those fields without independently deriving adapter eligibility from raw preferences, token state, store rows, or satellite records. The operation SHALL read preferences and store identity through existing data layers, inspect only Kroger refresh-token presence, and SHALL NOT touch `env.DB` directly, perform an external request, or return any credential.

The projection SHALL use stable adapter/mode discriminants and deterministic ordering. Its launcher SHALL include only configured paths: Kroger online order when Kroger is selected/linked or has a standing location, the configured satellite store when `primary=<slug>` and `fulfillment="satellite"`, the selected Offline store walk when `primary=<slug>` without the satellite marker, and the Instacart Marketplace handoff when complete valid operator configuration is present. The manual-shop fallback SHALL remain a grocery action rather than a store adapter, and an unavailable Instacart adapter SHALL produce no launcher entry.

#### Scenario: Profile and Grocery receive identical adapter truth

- **WHEN** a household has a linked Kroger account, a selected Kroger location, shared Offline stores, and a satellite-marked standing store
- **THEN** one adapter projection contains the card summaries and corresponding launcher entries, and both member pages render that response rather than recomputing eligibility

#### Scenario: Projection is secret-free and externally inert

- **WHEN** the adapter projection is read
- **THEN** it performs no Kroger or satellite network request and returns neither OAuth tokens nor a satellite helper URL/session token

#### Scenario: Launcher ordering is deterministic

- **WHEN** the same configured adapters are read repeatedly regardless of underlying D1 row order
- **THEN** the launcher order is Kroger first, then satellite stores sorted by display name and slug, then the selected Offline walk entry, then the configured Instacart handoff

### Requirement: Offline reuses the store registry and Instacart exposes availability only

The Offline adapter SHALL present grocery-domain rows from the existing shared `stores` registry, including identity and whether each row is the standing `stores.primary`; it SHALL NOT create an adapter entity or table. This change SHALL allow standing Offline selection through the class (a) preferences patch but SHALL NOT add shared-store CRUD, map-status derivation, an aisle-map editor, or store-walk state. If the selected slug no longer exists, the stored preference SHALL remain unchanged, the card SHALL mark it unavailable, and no enabled Offline launcher entry SHALL be emitted.

The Instacart adapter-card projection SHALL expose only whether complete valid operator configuration is available. It SHALL expose no account state, retailer source, connect control, credential, or configuration detail. When available it SHALL add one enabled `marketplace_handoff` launcher entry with no store identity; when unavailable it SHALL add no launcher entry.

#### Scenario: Offline rows are existing stores, not copies

- **WHEN** the shared registry contains two grocery stores and one non-grocery store
- **THEN** the Offline tab lists the two grocery rows from that registry and creates no parallel row or adapter record

#### Scenario: Deleted preferred Offline store is not silently replaced

- **WHEN** `stores.primary` names a slug absent from the shared registry
- **THEN** the projection reports the standing selection unavailable and emits no enabled walk entry instead of choosing another store

#### Scenario: Instacart availability is secret-free

- **WHEN** a member opens the Instacart tab with complete valid operator configuration
- **THEN** it reports availability without exposing the key or implying member account linking, preferred retailer, price, availability, or ETA
