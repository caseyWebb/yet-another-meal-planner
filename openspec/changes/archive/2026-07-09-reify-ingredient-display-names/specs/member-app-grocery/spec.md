## ADDED Requirements

### Requirement: The grocery view renders a reified display name

The member grocery surfaces SHALL render a human label from stored/curated data, never a raw canonical id. A stored-row read (`read_grocery_list`) and the derived to-buy view SHALL render each line's label as the row's `display_name ?? name`; a `plan`-derived line (no stored row) and a line materialized by canonical id SHALL render the identity node's curated `display_name`. The **enriched** to-buy read SHALL expose the curated `display_name` for surfaces that previously rendered a bare canonical id as human text — the sibling-suggestion label and relation target, and the aisle/department grouping label. The **default** (non-enriched) to-buy view SHALL be unchanged: `GET /api/grocery/to-buy` and the `read_to_buy` tool SHALL still return the same lines via the same shared operation, with the reified display confined to the stored-row read and the enriched view — no default line field is added or re-sourced. The `display_name` SHALL never enter the set algebra, which continues to join on the canonical ids.

#### Scenario: Accepting a sibling swap renders the clean label, not the id

- **WHEN** the member accepts an inline substitute (a graph-sibling swap) and the app materializes it via `add_to_grocery_list` with the sibling's canonical `id` (e.g. `cabbage::color-red`)
- **THEN** the new grocery-list row renders as "Red cabbage" (its curated `display_name`), not `cabbage::color-red`, while still deduping and ordering on the canonical id

#### Scenario: The enriched view labels previously-raw-id surfaces

- **WHEN** the enriched to-buy view is read and a line carries substitute siblings and an aisle/department grouping
- **THEN** the sibling label, the relation target, and the department heading render curated human labels (via the node `display_name`) rather than bare canonical ids

#### Scenario: The default read_to_buy is unchanged

- **WHEN** the same tenant reads `read_to_buy` and `GET /api/grocery/to-buy` (default, non-enriched) with unchanged underlying data
- **THEN** both return the same lines via the same shared operation, with no new field on the default line and each `to_buy[].name` sourced exactly as before
