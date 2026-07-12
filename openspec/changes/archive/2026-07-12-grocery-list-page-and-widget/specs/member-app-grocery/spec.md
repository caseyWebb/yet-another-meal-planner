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

### Requirement: The order UI renders dispositions and honest partial results

The order dialog SHALL lead with the stale-cart warning when the view's `in_cart` section is
non-empty (the cart API is write-only — the member clears the store cart manually). Preview
SHALL render each disposition surface: checkpoint items with their candidate lists (choice →
commit `overrides`), pantry partials (confirm → `include_partials`), assumed-quantity lines
(count → `quantities`), and per-line exclusion (→ `exclude`). After commit the UI SHALL report
the cart, list, send-snapshot, and SKU-cache writes independently and honestly: it SHALL never present the cart as populated when
`cart.written` is false; a `reauth_required` cart failure SHALL render the Kroger re-link
affordance over the existing login-url read; lines the cart took SHALL show as advanced to
in-cart. The in-cart group SHALL offer the user-asserted "order placed" advance through
`mark_grocery_send_placed`, supplying the exact rendered send membership and snapshot version.
The existing per-row `status: "ordered"` transition remains compatible for agent and satellite
callers, but the member whole-send UI SHALL use the atomic batch assertion so it cannot partially
advance a send.

#### Scenario: A checkpoint item is dispositioned, not dropped

- **WHEN** preview returns an ambiguous item with candidates
- **THEN** the dialog renders the candidates for choice and the commit carries the chosen SKU
  as an override; an undispositioned checkpoint item is simply not carted, and the UI says so

#### Scenario: A failed cart write is reported truthfully

- **WHEN** commit returns `cart.written: false` with `code: "reauth_required"`
- **THEN** the UI does not claim the cart is populated, reports the list/send/SKU-cache outcomes independently, shows the items as still to-buy only when the list never advanced or rollback succeeded, calls out a surviving In-cart state when rollback failed, and offers the Kroger re-link flow

#### Scenario: Mark order placed advances the exact send atomically

- **WHEN** the member asserts the order was placed on the in-cart group
- **THEN** the batch operation advances exactly that send's rendered `in_cart` membership to
  `ordered`, stamps `ordered_at`, and conflicts without a partial write when membership changed

## ADDED Requirements

### Requirement: The member adapter respects write classifications

The member Grocery adapter SHALL register check/uncheck (including atomic virtual materialize-and-check), pantry verification/Buy anyway, persistent substitution accept/undo, and send-line relist as idempotent class-(b) canonical-key mutations with optimistic cache state and serial offline replay. Mark placed SHALL be online-only; while unavailable it SHALL show an offline hint and SHALL never enqueue. Every settled mutation SHALL reconcile both raw and snapshot grocery queries.

#### Scenario: Offline check renders optimistically
- **WHEN** a member checks a line offline
- **THEN** the shared component shows it checked immediately and the registered mutation pauses for serial replay

#### Scenario: Mark placed cannot queue
- **WHEN** a member is offline with an in-cart send visible
- **THEN** Mark order placed is disabled with an offline hint and no mutation-cache record is created
