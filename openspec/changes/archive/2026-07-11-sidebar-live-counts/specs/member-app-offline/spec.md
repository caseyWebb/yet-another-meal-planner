## ADDED Requirements

### Requirement: Sidebar badges render offline from persisted reads

The sidebar badge derivation SHALL read only allowlisted persisted queries — the meal plan
and the derived to-buy view — so the badges render from the persisted cache while offline,
consistent with the pages those reads back. The derivation SHALL introduce no new query or
network request of its own.

#### Scenario: Badges render from the persisted cache offline

- **WHEN** the app relaunches offline for a member whose plan and to-buy reads are in the
  persisted cache
- **THEN** the sidebar meal-plan and grocery badges render from that persisted data with no
  network request
