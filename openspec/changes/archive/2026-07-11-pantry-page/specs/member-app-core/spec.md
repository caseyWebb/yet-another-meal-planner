# member-app-core

## MODIFIED Requirements

### Requirement: Pantry page over row-level ops

The pantry page SHALL read the tenant's pantry and mutate it through the existing row ops
(add/upsert keyed by canonical ingredient id, remove, mark-verified, and **dispose**), with no
new backend query, no new Worker route, and no D1/tool/schema change — every behavior consumes
the band-1 `pantry-disposition-foundations` contract (`GET /api/pantry` serving `location`;
`POST /api/pantry/ops` accepting `dispose`; the `WASTE_REASONS` enum; `PANTRY_LOCATIONS` /
`PANTRY_CATEGORIES`; the server-side `stampDepartment` funnel and the ingredient-category cron).
The three controlled vocabularies SHALL have a single source in `@yamp/contract`, imported by
both the Worker's `src/department.ts` and the member app.

The page SHALL keep the **needs-verification section**: perishable-category items (`produce`,
`dairy`, `seafood`, `meat`) whose `last_verified_at` exceeds the 7-day staleness threshold,
derived client-side from served fields, most-stale first, each with a `{N}d unchecked` badge, an
editable qty, a Verify control that drops the row on the next render, and a **bare trash** — the
one bare-trash affordance on the page, since here removal is verification cleanup, not a
disposition. An item SHALL appear in exactly one section.

The page SHALL offer a **multi-item add grid** (ITEM / QTY / CATEGORY / LOCATION) with
`<datalist>` suggestions drawn from the controlled vocab (category placeholder "auto", location
"—"): a fresh draft row SHALL append whenever the last row gains a name, each row SHALL carry a
per-row remove (disabled at a single row), and Clear + an "Add N items" commit (disabled at
zero) SHALL fire ONE batch of `add` ops. Added rows SHALL come back verified-now. Category and
location autofill SHALL be **non-authoritative UX only**: a blank category commits as "auto" and
the server's D17 ingredient-identity funnel / cron classifies it; any client-side recognition
MAY pre-fill category/location for a recognized name but SHALL NEVER clobber a value the member
typed.

The page SHALL offer a **group-by toggle** (transient per-mount state) with two dimensions:
**Category** (alphabetical) and **Location** (the fixed `PANTRY_LOCATIONS` order — Fridge,
Freezer, Pantry, Spice rack, Counter, Cabinet); locations store the slug and display Title Case.

**Item rows** SHALL render a relative verified stamp, a re-verify control hidden once the row is
verified today, and an editable qty written as the `add` upsert (preserving the row's location
and `added_at`). Every regular-row removal SHALL be a disposition — regular rows carry **no bare
trash**:

- A **Used split button** whose primary action fires `dispose{disposition:"used"}` (an
  idempotent delete; partial-use decrement and a consumption signal are out of scope), and whose
  menu opens the waste modal.
- A **waste modal** ("Toss '{item}'") SHALL present all 10 canonical `WASTE_REASONS` as a
  single-tap reason list; on tap it SHALL mint a client-side `event_id`, stamp `occurred_at`, fire
  `dispose{disposition:"waste", reason, event_id, occurred_at}`, and remove the row. The modal
  SHALL NEVER ask for a value or price (the event's value is derived later from spend history).
- `prepared_from` rows SHALL use the same disposition flow (their waste stamps the Leftovers
  pseudo-department server-side).

#### Scenario: Verifying clears the nudge

- **WHEN** a member verifies a flagged perishable
- **THEN** `mark_pantry_verified`'s op stamps today and the item leaves the needs-verification
  section on the next render

#### Scenario: Group-by Location renders the fixed vocabulary order

- **WHEN** a member with pantry rows in at least two locations switches the group-by control to
  Location
- **THEN** the rows regroup under Title-Case location headers in the fixed `PANTRY_LOCATIONS`
  order (e.g. Fridge before Pantry regardless of row order), and switching back to Category
  regroups them alphabetically by food-category label

#### Scenario: Multi-add autofills without authority and never clobbers a typed override

- **WHEN** a member types a recognized item name into an add row and, in another row, types an
  explicit category or location that differs from what recognition would fill
- **THEN** the recognized row's untouched category/location are pre-filled as a convenience while
  the typed override is preserved unchanged, and committing sends one batch of `add` ops — a row
  left blank in category commits with no category (the server funnel classifies it), and the
  added rows render verified-now

#### Scenario: Used is an idempotent delete with no modal

- **WHEN** a member taps the primary Used action on a regular row
- **THEN** a `dispose{disposition:"used"}` op is issued, the row is removed, and no waste modal
  or reason is shown

#### Scenario: Mark-as-waste records one canonical reason and never asks a value

- **WHEN** a member opens a row's menu, chooses Mark as waste, and taps a reason
- **THEN** the reason is one of the ten canonical `WASTE_REASONS`, the op carries
  `disposition:"waste"` with a client-minted `event_id` and a stamped `occurred_at`, the row is
  removed, and at no point is the member asked for the item's value or price
