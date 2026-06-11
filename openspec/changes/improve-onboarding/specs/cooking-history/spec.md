## ADDED Requirements

### Requirement: Ready-to-eat acquisition is cross-recorded at inventory capture

Ready-to-eat consumption decrements on-hand stock in `pantry.toml` (the catalog `ready_to_eat.toml` is options-only), so the on-hand view is only correct if acquisition records the same stock. Whenever the agent records physical inventory **outside onboarding** — notably the standalone `update_pantry` flow (e.g. a freezer haul of frozen dinners) — and the items named are heat-and-eat items, the agent SHALL record their on-hand stock via `update_pantry` AND SHALL **offer** to add them to the caller's ready-to-eat catalog via `add_draft_ready_to_eat` (`status: active`) when they are not already cataloged, using a consistent `name` so the favorites↔pantry-on-hand restock cross-reference matches. It SHALL offer rather than silently catalog (consistent with the persona's don't-auto-add stance) and SHALL require no new MCP tool. (The onboarding capture points are covered by the guided-onboarding capability.)

#### Scenario: Ad-hoc freezer haul of heat-and-eat items is offered for cataloging

- **WHEN** the member says they just stocked the freezer with several frozen dinners via the pantry-update flow
- **THEN** the agent records them as pantry on-hand stock via `update_pantry` and offers to add the ones not already in the catalog to `ready_to_eat.toml` via `add_draft_ready_to_eat`, under the same name used in the pantry

#### Scenario: Already-cataloged item only updates stock

- **WHEN** a heat-and-eat item the member restocks is already an `active` entry in their ready-to-eat catalog
- **THEN** the agent records the on-hand stock via `update_pantry` and does not re-add a duplicate catalog entry
