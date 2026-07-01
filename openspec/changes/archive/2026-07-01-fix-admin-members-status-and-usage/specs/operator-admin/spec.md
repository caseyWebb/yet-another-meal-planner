## MODIFIED Requirements

### Requirement: Tenant listing is operational-only

The admin surface SHALL list the current members from the tenant directory (the `tenant:*` allowlist), returning canonical ids and operational status only. Operational status MAY include, per member: an owner flag, an active/pending **connection** status, a Kroger-linked/unlinked status, activity timestamps (joined/invited, last-active), and activity counts (recipes cooked, favorites) — all derived from existing per-tenant operational state (the allowlist record, the OAuth grant presence, the Kroger refresh-token presence, and aggregate counts over the member's own per-tenant tables). The listing SHALL NOT return per-tenant domain data (pantry, preferences, recipes, notes, grocery list contents, meal plan contents).

A member's active/pending status SHALL be derived from whether the member has completed the MCP OAuth authorization at least once — i.e. whether at least one OAuth grant exists for the member's tenant id in `OAUTH_KV` — NOT from the presence of a `tenant_activity` row. `tenant_activity` (written by recent MCP tool-call activity) SHALL continue to supply the `joined`/`lastActive` timestamps shown alongside status, but SHALL NOT itself determine active-vs-pending: a member who connected once and has since been idle SHALL still report `active`, and a member with no completed OAuth grant SHALL report `pending` even if a stray `tenant_activity` row exists for them.

#### Scenario: Listing returns ids without domain data

- **WHEN** the operator opens the admin panel
- **THEN** it shows the allowlisted member ids (and at most operational metadata), and no member's pantry/preference/recipe content

#### Scenario: Listing includes operational status per member

- **WHEN** the operator opens the Members roster
- **THEN** each member's row reflects its active/pending connection status and Kroger-linked status, both derived from existing operational state (no new per-tenant domain table)

#### Scenario: A connected-but-idle member reports active, not pending

- **WHEN** a member has completed the Claude.ai OAuth connection (an OAuth grant exists for their tenant id in `OAUTH_KV`) but has made no recent MCP tool calls (no `tenant_activity` row, or a stale one)
- **THEN** their roster row reports `active`, not `pending`

#### Scenario: A never-connected member reports pending regardless of stray activity state

- **WHEN** a member's tenant id has no OAuth grant in `OAUTH_KV`
- **THEN** their roster row reports `pending`, even if a `tenant_activity` row exists for that tenant id
