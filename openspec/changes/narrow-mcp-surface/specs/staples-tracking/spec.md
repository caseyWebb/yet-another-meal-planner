# staples-tracking — delta

## MODIFIED Requirements

### Requirement: Staples list is a per-tenant curated opt-in catalog

The system SHALL maintain a per-tenant staples list in the D1 `staples` table that stores the member's "don't run out of these" items. Each item SHALL have a required `name` field and an optional `perishable: true` flag. The list SHALL be curated through the member web app over the shared staples write operation (add deduped by normalized `name`; remove silently succeeding when absent) — there is no `update_staples` MCP tool — and is read via the `staples` array on `read_user_profile()`, a bare `StaplesItem[]` (not `{ items: [...] }`). An empty or absent staples list SHALL degrade gracefully — all staples-driven behaviors become no-ops, preserving existing behavior for members who have not set up a list.

#### Scenario: Staples list is present with items

- **WHEN** a member has `[{ name: "olive oil" }, { name: "eggs", perishable: true }]` in their D1 staples table
- **THEN** `read_user_profile().staples` returns both items with their fields, and staples-driven flows use this list

#### Scenario: Staples list is empty

- **WHEN** a member has no rows in their D1 staples table
- **THEN** `read_user_profile().staples` returns an empty array and all staples-driven prompting behaviors are suppressed (no error, no prompting)

#### Scenario: Curation is a member-app write

- **WHEN** a member adds or removes a staple
- **THEN** the member app writes through the shared operation (dedup by normalized name, silent absent-remove), and no staples write tool appears on the MCP surface

#### Scenario: Perishable flag is optional

- **WHEN** a staple item is added without `perishable`
- **THEN** the item is stored without the flag and is treated as non-perishable (no staleness prompting for it)
