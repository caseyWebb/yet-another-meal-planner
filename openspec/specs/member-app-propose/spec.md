# member-app-propose Specification

## Purpose
TBD - created by archiving change member-app-propose. Update Purpose after archive.
## Requirements
### Requirement: Propose endpoints are thin adapters over the shared planner operation

The member app SHALL expose the propose surface as a session-gated `/api` route group calling shared operations extracted from the MCP tool closures — one operation running the full propose pipeline (context loads, per-meal week shaping, slot filling, assembly) called by both `propose_meal_plan` and `POST /api/propose`, and one resolving the tenant's preference-derived weather forecast (`resolveTenantForecast`) consumed by the propose pipeline server-side — there is no `get_weather_forecast` MCP tool and no client-side weather read; the forecast reaches the model only as the engine's silent context. The propose endpoint SHALL accept the tool's full input (the per-meal `meals` counts map with the window-scoped `nights` alias, `attendance`, seed, lock, exclude, boost ingredients, nudges, per-slot constraints, `ephemeral_vibes` with per-entry `meal`) and return the tool's result shape (meal-carrying slots, per-meal and attendance diagnostics), so the tool and the endpoint are **one contract** maintained in the same pass. The attendance **web control** is deferred (D29-final routes its design through the Claude Design project; band 2+) — the endpoint accepts the param now so the contract is fixed before any UI exists. Structured errors (including the weather `no_location` family) SHALL cross the HTTP boundary through the shared error middleware with their codes intact.

#### Scenario: The endpoint and the tool return the same proposal

- **WHEN** the same tenant sends the same propose input (same seed and vectors) to `POST /api/propose` and `propose_meal_plan`
- **THEN** both run the one shared operation and return the same result shape with the same chosen week

#### Scenario: The forecast is engine context, not a model verb

- **WHEN** the propose pipeline runs for a window
- **THEN** it loads the tenant forecast through the shared weather operation itself — no forecast tool appears on the MCP surface and the member app has no client-side weather read

#### Scenario: Weather errors stay structured across surfaces

- **WHEN** the weather operation cannot resolve a ZIP for the tenant
- **THEN** the structured `no_location` error crosses the member API boundary with its code intact, and the propose pipeline degrades to season-based reasoning exactly as before

### Requirement: The propose session lives client-side only

All propose-session state — seed, locks, per-slot recipe pins and facet pins, vibe overrides, excludes, nudges, freeform text — SHALL live client-side, persisted by the app and replayed as the full request body against the stateless endpoint on every change. The Worker SHALL NOT persist any propose-session state: no session rows, no KV session blobs, no server-held proposal between calls (the query-embedding cache stores content-addressed vectors, not sessions). Session resume and reproducibility SHALL rest entirely on the endpoint's determinism — the same request body yields the same week.

#### Scenario: A session resumes by replay

- **WHEN** a member returns to the propose page with a stored client session
- **THEN** the app re-submits the same request body and renders the same week, with no server-side session read

#### Scenario: Proposing writes no server state

- **WHEN** a member iterates through many rerolls, pins, and overrides without committing
- **THEN** no tenant data row, KV entry (beyond content-addressed embedding cache entries), or other server-side state records the session

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

### Requirement: Commit threads provenance through the existing plan ops

Committing a proposed week SHALL map each **filled** slot onto an `update_meal_plan` **`add`** op carrying a **client-minted ULID row id**, the slot's **`meal`**, the slot's vibe id as `from_vibe`, the corpus side titles as the row's open-world sides, and a client-assigned open date within the planning window. The committer SHALL NEVER set `duplicate: true` — the op layer's slug-global coalesce therefore makes "commit updates an existing row rather than duplicating" **structural** (D26-final): an already-planned recipe converges onto its existing row (`coalesced: true`), and the client adopts the **surviving row's id** in place of the one it minted — the survivor-id rebind is a recorded obligation on the band-2/3 offline mutation registry, which must re-key the queued mutation on the returned id. When the member has explicitly duplicated a recipe, a commit touching that slug surfaces the op's `candidates` conflict — genuine member-created ambiguity, resolved by re-issuing with a row id. No new commit endpoint SHALL be introduced. After commit the client session SHALL be cleared, so cooking a committed row later stamps the vibe's satisfaction provenance exactly as an agent-committed plan would.

#### Scenario: A committed slot carries its meal and vibe provenance

- **WHEN** a member commits a week containing a lunch slot and later logs that recipe as cooked
- **THEN** the plan row carried the slot's `meal` and `from_vibe`, and the cook stamps that vibe's satisfaction provenance feeding cadence debt and the reconcile signals

#### Scenario: Committing an already-planned recipe converges on the surviving row

- **WHEN** a proposed main is already on the meal plan as exactly one row
- **THEN** the commit's add (client-minted id, no `duplicate`) coalesces onto the existing row, the response reports `coalesced: true` with the surviving row's id, the client rebinds to that id, and the member is told the night was already planned

#### Scenario: A member-made duplicate surfaces as a conflict, never a silent pick

- **WHEN** a commit's add touches a slug the member has explicitly duplicated (two plan rows exist)
- **THEN** the op returns a conflict with both `candidates`, and the commit surface resolves it by id rather than auto-picking a row

#### Scenario: A replayed commit cannot double-plan

- **WHEN** a committed slot's add op is delivered twice (an offline replay keyed by its client-minted row id)
- **THEN** the second delivery updates the same row in place — replay never creates a duplicate plan row

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

