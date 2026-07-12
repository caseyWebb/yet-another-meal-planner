## MODIFIED Requirements

### Requirement: The grocery page renders the derived view

The grocery route SHALL be a page header/launcher shell around the shared Grocery component and SHALL render the authoritative grocery snapshot: active and checked explicit/virtual lines, recipe attribution linking to detail, first-class household lines, pantry coverage and verification/Buy anyway, substitution decisions, underived slugs, grouped in-cart sends, and the bottom add row. It SHALL offer exactly **Department | Recipe** grouping; the previous Category/Aisle toggle SHALL be removed.

Department groups SHALL use store-placement presentation (`placement.section`, additively aliased from the prior placement-department field), order groups by minimum numeric aisle then label, put household/non-grocery rows in Household, and put missing placement last in Not mapped. Recipe attribution SHALL be ordered by planned date, meal-plan row id, then slug; a multi-recipe line SHALL appear once in its first recipe group with `+N`, and unattributed lines SHALL appear in No recipe. The default SHALL be Department; a remembered toggle is member-local pure view state.

Rows SHALL show check/strike-through, quantity, stable recipe attribution, note, Staple marker where present, remove for explicit rows, and anchored pantry-look-alike decisions. Header stats SHALL report To buy, Checked, and In carts; pre-send flyer hints and persisted send estimates SHALL remain distinctly labeled. The in-cart groups SHALL render between the active list and pantry coverage as specified by `grocery-list-widget`.

#### Scenario: The page shows plan-derived and explicit items as one list
- **WHEN** a member with a meal plan, an ad-hoc list row, a checked row, and pantry coverage opens the grocery page
- **THEN** they see shopping lines together with durable checked styling, the unchecked union-minus-pantry count, and covered items under the pantry section

#### Scenario: Department order is deterministic
- **WHEN** lines have aisle 8/Produce, aisle 2/Dairy, household kind, and no placement
- **THEN** the groups render Dairy, Produce, Household, and Not mapped in deterministic route/fallback order

#### Scenario: Recipe mode does not duplicate a line
- **WHEN** one line contributes to two recipes
- **THEN** it appears only in its first stable recipe group with the second represented as `+1`

#### Scenario: A stale perishable invites a real verification write
- **WHEN** a pantry-covered line is classified worth-a-look
- **THEN** Still good invokes pantry verification and Buy anyway invokes the coverage-override materialization operation rather than dismissing locally

#### Scenario: Household line stays out of pantry semantics
- **WHEN** a `kind:"household"` row renders
- **THEN** it appears under Household with list controls and no recipe or pantry-restock action

## ADDED Requirements

### Requirement: The member adapter respects write classifications

The member Grocery adapter SHALL register check/uncheck (including atomic virtual materialize-and-check), pantry verification/Buy anyway, persistent substitution accept/undo, and send-line relist as idempotent class-(b) canonical-key mutations with optimistic cache state and serial offline replay. Mark placed SHALL be online-only; while unavailable it SHALL show an offline hint and SHALL never enqueue. Every settled mutation SHALL reconcile both raw and snapshot grocery queries.

#### Scenario: Offline check renders optimistically
- **WHEN** a member checks a line offline
- **THEN** the shared component shows it checked immediately and the registered mutation pauses for serial replay

#### Scenario: Mark placed cannot queue
- **WHEN** a member is offline with an in-cart send visible
- **THEN** Mark order placed is disabled with an offline hint and no mutation-cache record is created
