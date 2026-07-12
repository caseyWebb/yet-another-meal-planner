## MODIFIED Requirements

### Requirement: The propose flow UI iterates live against the stateless endpoint

The propose page SHALL render the design bundle's flow cut to the D8/D20 shared control set: an
intro state and an empty-palette state (production palettes start empty) linking to the palette
page; a controls row of **per-meal steppers** (breakfast / lunch / dinner slot counts — the
request's `meals` map); a variety bar (nights, distinct cuisines/proteins, protein histogram) with
the commit action; and one card per slot — main with description and facet chips, `why` chips,
side chips, waste/meal-prep/no-side flags, and the per-slot controls: a swap menu offering the
returned nearest-similar and different-cuisine picks plus the bounded alternates list, facet pin
popovers (protein, cuisine, time — pinned chips clearable in place, including on an over-constrained
empty slot), a vibe panel (typed phrase or palette preset, with reset), and **sides editing**
(add/remove the slot's side titles). The D8/D20-cut controls SHALL NOT appear: the adventurousness
slider, protein-want chips, the freeform phrase input, global re-roll, and the per-slot lock and
exclude controls. A request-changing edit (a per-meal count, swap, facet pin, or vibe override)
SHALL re-query the stateless endpoint while keeping the previous week rendered until the new one
arrives. A **sides edit SHALL NOT re-query** — it is a local refinement of the already-proposed
week. **Attendance** is a round-trip-only request field (D29-final): the session carries and replays
`attendance` from an agent-authored request, but the shared surface offers NO attendance control
(the web control is deferred behind a Claude Design pass). The flow SHALL be reachable from the
meal-plan page and the palette page.

#### Scenario: A per-meal count updates the week without flashing

- **WHEN** a member bumps the dinner (or breakfast/lunch) stepper
- **THEN** the app re-queries with the updated `meals` map while the previous proposal stays visible until the new one renders

#### Scenario: A swap keeps the night's shape

- **WHEN** a member swaps a slot to the offered similar pick
- **THEN** the next request pins that recipe to the slot's vibe, the slot re-renders with the pick and its vibe identity intact, and the rest of the week re-diversifies around it

#### Scenario: An over-constrained night is relaxed in place

- **WHEN** a member's facet pins leave a slot with no candidate
- **THEN** the slot renders the empty reason with each pin shown and clearable in place, without resetting the wider session

#### Scenario: A sides edit refines without a re-query

- **WHEN** a member adds or removes a side on a slot
- **THEN** the slot's side chips update in place with NO call to the propose endpoint, and the edited sides are carried into the commit

#### Scenario: The cut controls are absent

- **WHEN** a member views a proposed week
- **THEN** there is no adventurousness slider, no protein-want chips, no freeform input, no re-roll control, and no per-slot lock or exclude control — only per-meal steppers, swap, facet pins, per-slot vibe, sides editing, and commit

### Requirement: The propose flow ships with model-free Playwright coverage

The propose flow SHALL ship with page objects and specs on the member-app Playwright harness,
blocking in CI with per-area screenshots — and the suite SHALL run with **zero model calls**: the
seed provides a deterministic palette with synthetic vibe and recipe vectors (production palettes
are empty, so seeding is the only path to a filled proposal). Coverage SHALL include the
empty-palette state, first-propose (intro → slots + variety), same-request stability across a
reload, a per-meal stepper re-query, facet pinning including the over-constrained empty slot, a swap
via the returned alternates, a sides edit that does NOT re-query and rides to the plan on commit, a
commit verified on the plan page, and an assertion that the D8/D20-cut controls are ABSENT from the
shared surface.

#### Scenario: The suite needs no Workers AI

- **WHEN** the propose specs run in CI
- **THEN** every proposal is computed from seeded vectors, with no Workers AI invocation

#### Scenario: A propose change cannot merge without its coverage

- **WHEN** a change touches the propose page, its routes, or the shared controller's surfaced shapes
- **THEN** the corresponding page objects/specs are updated in the same change and the blocking Playwright job passes with fresh screenshots
