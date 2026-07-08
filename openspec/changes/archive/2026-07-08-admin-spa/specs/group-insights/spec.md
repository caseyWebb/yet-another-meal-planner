## MODIFIED Requirements

### Requirement: Insights is a read-only top-level operator area

The admin panel SHALL provide an **Insights** area, rendered at `/admin/insights` and reached from the area nav after the Data area. The area SHALL be read-only — it displays group-popularity aggregates and performs no write. A deep link or refresh to `/admin/insights` SHALL render the Insights area directly.

#### Scenario: Insights renders at its own URL

- **WHEN** the operator opens `/admin/insights` directly (or refreshes there)
- **THEN** the Insights area renders as its own top-level surface, reached from the area nav alongside Status, Members, Data, Usage, Discovery, Logs, and Config

#### Scenario: Insights performs no write

- **WHEN** the operator interacts with any control in the Insights area
- **THEN** no D1 row, corpus object, or configuration value is created, updated, or deleted — every control only re-scopes or re-ranks the displayed aggregates

### Requirement: Insights toggles re-render from seeded data without refetch

The Insights area SHALL load **one** payload carrying every window's precomputed aggregates (the panel's typed insights read over the existing group-aggregation reader). Changing the window, the rank metric, or expanding a source SHALL update the view client-side from that already-loaded payload, without an additional network request or a navigation.

#### Scenario: Toggling the window makes no request

- **WHEN** the operator changes the window or rank metric after the area has loaded
- **THEN** the tiles, heatmap emphasis, and leaderboards update from the already-loaded payload with no additional server request
