## MODIFIED Requirements

### Requirement: Aisle-ordered shopping list with graceful degradation

The `shopping-list` skill SHALL read the grocery list and present it grouped, **display-first
and read-only** until the user commits to walking. Grouping SHALL degrade gracefully: with no
known store or layout, a **department**-grouped list from general knowledge; with a named or
known store that has `layout` notes, an **aisle**-ordered walk inferred from those notes —
item-to-aisle placement is agent judgment over the store's own section vocabulary
(open-vocabulary, no manifest — the storage-guidance posture), with `location` notes
pinpointing tricky items and a `location` note taking precedence over inferred placement.
When the resolved store is the caller's **Kroger primary**, the skill SHALL prefer captured
per-SKU aisle placements (the to-buy read's aisle enrichment, sourced from the SKU cache at
that location) for the lines that have them — real store data over inference — with store-note
`location` pins still taking precedence, and lines without a captured placement degrading
per-line to the judgment path above. The list SHALL be filtered to the resolved store's
`domain`: a named different-category store (e.g. "Lowe's" → `home-improvement`) SHALL show
**only** that domain's items, department-grouped, with no voice offer. When no store is named
and `primary` is not a store slug, the skill SHALL **ask** whether the user is shopping a
specific store (then resolve it and read its `layout` notes) rather than probe every
registered store's notes to guess; with no specific store it defaults to a department list.
**Cold items — frozen, then refrigerated (dairy, meat) — SHALL be sequenced to be picked up
last** so they stay cold (a final "grab on your way out" group when frozen falls mid-store);
cold-vs-shelf-stable is agent judgment over the items. The **whole** list SHALL be displayed
before any walk, with recipe attribution and buy amount on each line. The skill SHALL offer to
enter voice step-by-step mode **only** when layout is known.

#### Scenario: Empty layout still yields a usable list

- **WHEN** the chosen store has no layout notes
- **THEN** the agent returns a sensibly department-grouped list rather than refusing, and does
  not offer voice mode

#### Scenario: Mapped store yields an aisle list from notes

- **WHEN** the chosen store has `layout` notes
- **THEN** the agent orders the list aisle-by-aisle from those notes and offers voice
  step-by-step mode

#### Scenario: Kroger primary walks captured placements

- **WHEN** the resolved store is the caller's Kroger primary and some to-buy lines carry
  captured aisle placements
- **THEN** those lines are ordered by their captured aisles (store-note `location` pins still
  winning), uncaptured lines fall back to judgment-grouped placement, and voice mode may be
  offered

#### Scenario: Different-domain store filters the list

- **WHEN** the user names a store whose category is `home-improvement` (e.g. Lowe's)
- **THEN** only `home-improvement`-domain list items are shown, department-grouped, with no
  voice offer

#### Scenario: No store named — ask rather than probe

- **WHEN** no store is named and `primary` is not a store slug
- **THEN** the agent asks whether the user is shopping a specific store (resolving and reading
  its notes if named) rather than reading every registered store's notes to guess, and
  defaults to a department list if none

#### Scenario: Cold items are sequenced last

- **WHEN** the list includes frozen or refrigerated items
- **THEN** they are ordered to be picked up last — a final "grab on your way out" group when
  frozen falls mid-store — so they stay cold
