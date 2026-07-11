## MODIFIED Requirements

### Requirement: Propose endpoints are thin adapters over the shared planner operation

The member app SHALL expose the propose surface as a session-gated `/api` route group calling shared operations extracted from the MCP tool closures — one operation running the full propose pipeline (context loads, per-meal week shaping, slot filling, assembly) called by both `propose_meal_plan` and `POST /api/propose`, and one resolving the tenant's preference-derived weather forecast called by both `get_weather_forecast` and `GET /api/propose/weather` — with the tools' observable behavior unchanged. The propose endpoint SHALL accept the tool's full input (the per-meal `meals` counts map with the window-scoped `nights` alias, `attendance`, seed, lock, exclude, boost ingredients, nudges, per-slot constraints, `ephemeral_vibes` with per-entry `meal`) and return the tool's result shape (meal-carrying slots, per-meal and attendance diagnostics), so the tool and the endpoint are **one contract** maintained in the same pass. The attendance **web control** is deferred (D29-final routes its design through the Claude Design project; band 2+) — the endpoint accepts the param now so the contract is fixed before any UI exists. Structured errors (including the weather `no_location` family) SHALL cross the HTTP boundary through the shared error middleware with their codes intact.

#### Scenario: The endpoint and the tool return the same proposal

- **WHEN** the same tenant submits the same propose input — including `meals` and `attendance` — through the MCP tool and through `POST /api/propose`
- **THEN** both return the same proposal, produced by the same shared operation

#### Scenario: A missing location is a structured state, not a failure page

- **WHEN** a member with no resolvable ZIP loads the propose page's weather strip
- **THEN** the weather endpoint returns the structured `no_location` code and the UI renders a quiet set-your-ZIP affordance while the rest of the flow works

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
