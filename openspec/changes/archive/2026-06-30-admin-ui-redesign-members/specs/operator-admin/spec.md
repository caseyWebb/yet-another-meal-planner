## MODIFIED Requirements

### Requirement: Tenant listing is operational-only

The admin surface SHALL list the current members from the tenant directory (the `tenant:*` allowlist), returning canonical ids and operational status only. Operational status MAY include, per member: an owner flag, an active/pending connection status, a Kroger-linked/unlinked status, activity timestamps (joined/invited, last-active), and activity counts (recipes cooked, favorites) — all derived from existing per-tenant operational state (the allowlist record, the Kroger refresh-token presence, and aggregate counts over the member's own per-tenant tables). The listing SHALL NOT return per-tenant domain data (pantry, preferences, recipes, notes, grocery list contents, meal plan contents).

#### Scenario: Listing returns ids without domain data

- **WHEN** the operator opens the admin panel
- **THEN** it shows the allowlisted member ids (and at most operational metadata), and no member's pantry/preference/recipe content

#### Scenario: Listing includes operational status per member

- **WHEN** the operator opens the Members roster
- **THEN** each member's row reflects its active/pending connection status and Kroger-linked status, both derived from existing operational state (no new per-tenant domain table)

## ADDED Requirements

### Requirement: Members roster shows summary tiles and a per-member action menu

The Members area SHALL render a summary stat-tile row (Members, Active, Pending, Kroger linked counts, derived from the tenant listing) above a roster of member rows, composed from the shared component kit's stat-card grid and `Item`/`ItemGroup` primitives. Each roster row SHALL show the member's avatar (initials), `@username`, an owner badge when applicable, an active/pending status badge, a Kroger-linked badge when linked, and an activity meta line (cooked/favorites counts and last-active age for an active member; invited age for a pending one). Each row SHALL carry a per-member actions menu (the kit `DropdownMenu`) offering **Rotate invite**, **Link Kroger** (or **Re-link Kroger** when already linked) for an active member, and **Revoke** (label varying by status: "Revoke invite" for pending, "Revoke access" for active) — invoking the existing onboard/rotate/kroger-login/revoke operations unchanged. Activating the actions menu SHALL NOT also navigate to the member's detail view.

#### Scenario: Stat tiles reflect the roster

- **WHEN** the operator opens the Members area
- **THEN** the stat tiles show the total member count, the active count, the pending count, and the Kroger-linked count, each matching the roster below

#### Scenario: A pending member's row reflects its state

- **WHEN** a member has been invited but has not yet connected
- **THEN** their row shows a pending badge, no Kroger badge, and an "invited <age>" meta line instead of activity counts

#### Scenario: Row actions menu invokes the existing operations

- **WHEN** the operator opens a roster row's actions menu and selects Rotate invite, Link Kroger, or Revoke
- **THEN** the corresponding existing admin operation runs (invite rotation, Kroger consent-link minting, or revocation) unchanged, and the menu interaction does not navigate to the member's detail view

### Requirement: Invite flow is a dialog with a shown-once banner

The Members area SHALL mint a new member's invite through a dialog (the kit `Dialog` + `Field`) prompting for a username, rather than an inline form. On a successful mint (initial onboard or a roster row's Rotate invite), the area SHALL show a dismissible, shown-once banner carrying the invite code and the connector URL, consistent with the existing no-log guarantee on the invite code. A Kroger consent-link mint (from a roster row's Link Kroger action) SHALL show the same banner pattern with its single-use consent URL in place of the invite code, distinguished from the invite-code variant.

#### Scenario: Operator invites a new member via the dialog

- **WHEN** the operator opens the invite dialog, enters a username, and confirms
- **THEN** the existing onboard operation runs, the dialog closes, and a shown-once banner displays the minted invite code and connector URL

#### Scenario: Kroger consent link renders as a distinct banner variant

- **WHEN** the operator triggers Link Kroger for a member
- **THEN** the shown-once banner displays the single-use consent URL, visually distinct from the invite-code banner

### Requirement: Member detail view with a sectioned sub-nav

The admin surface SHALL provide a member-detail view, reached by activating a roster row, server-rendered at its own URL (`/admin/members/<id>`, with each section as its own sub-route, e.g. `/admin/members/<id>/pantry`) so a deep link or refresh loads that member's selected section directly. The view SHALL render a header (the member's `@username`, owner/status/Kroger badges, and activity stats) and a pills sub-nav over six sections — Profile, Pantry, Meal plan, Grocery, Cooking log, Notes — each server-rendered from the existing `memberDetail` read (profile as key-value detail, pantry and cooking log as tabular data, meal plan and grocery list as their own row layouts, notes as note cards). A pending (not-yet-connected) member SHALL render an empty state explaining the member has not connected yet, instead of the sectioned sub-nav.

#### Scenario: Detail view deep-links to a section

- **WHEN** the operator opens `/admin/members/<id>/pantry` directly (or refreshes there)
- **THEN** the Worker server-renders that member's detail view with the Pantry section selected, with no client-side fetch for the section's data

#### Scenario: Header shows identity and activity

- **WHEN** the operator opens a connected member's detail view
- **THEN** the header shows the member's `@username`, applicable owner/status/Kroger badges, and their activity stats (cooked/favorites counts, joined age)

#### Scenario: Pending member shows an empty state

- **WHEN** the operator opens the detail view for a member who has not yet connected
- **THEN** the view shows an empty state explaining the member hasn't connected, and does not render the sectioned sub-nav or attempt to read per-tenant data that doesn't exist yet

#### Scenario: Each section renders from the existing member-detail read

- **WHEN** the operator selects a section (Profile, Pantry, Meal plan, Grocery, Cooking log, or Notes)
- **THEN** that section's content is server-rendered from the same `memberDetail` read the Data area's per-tenant explorer uses, with no separate or duplicated read path
