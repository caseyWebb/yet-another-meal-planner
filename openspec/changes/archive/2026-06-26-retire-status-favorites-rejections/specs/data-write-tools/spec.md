## MODIFIED Requirements

### Requirement: toggle_favorite writes the caller's favorite boolean to the D1 overlay

The system SHALL provide a `toggle_favorite(slug, favorite)` tool that sets or clears the caller's `favorite` boolean for a recipe as a row in the D1 `overlay` table (keyed by `(tenant, recipe)`), returning without a `commit_sha`. It SHALL validate `slug` against the D1 `recipes` table (`not_found` when absent) and SHALL NOT write shared recipe content. `favorite: false` SHALL clear the flag, deleting the overlay row when nothing else is set on it. `favorite` and `reject` are **mutually exclusive**: setting `favorite: true` SHALL clear any `reject` on the same row.

#### Scenario: Favoriting a recipe writes only the overlay

- **WHEN** `toggle_favorite("miso-salmon", true)` is called for an existing recipe
- **THEN** the caller's `overlay` row for `miso-salmon` is upserted with `favorite = 1`, no shared recipe content changes, and the tool returns `{ slug, overlay }` with no `commit_sha`

#### Scenario: Favoriting clears a prior reject

- **WHEN** the caller had rejected a recipe and then calls `toggle_favorite(slug, true)`
- **THEN** the row now carries `favorite` and no `reject` (the two never coexist)

#### Scenario: Favoriting an unknown recipe is rejected

- **WHEN** `toggle_favorite` is called with a slug not in `recipes`
- **THEN** a structured `not_found` error is returned and nothing is written

## REMOVED Requirements

### Requirement: set_recipe_status writes the caller's status to the D1 overlay

**Reason**: The per-tenant `status` lifecycle (`active`/`draft`/`rejected`/`archived`) is retired. The opt-in `active`/`draft` distinction was a dump-and-reason crutch made obsolete by semantic retrieval; the only disposition that remains per-tenant is "hide this from me," which becomes the `reject` mark. The overlay collapses to `favorite` + `reject`.

**Migration**: `set_recipe_status` is replaced by `toggle_reject(slug, reject)`. A D1 migration collapses `overlay.status` → a `reject` flag (`rejected` rows → `reject = 1`; `active`/`draft` rows are deleted, since neutral is now the default) and drops the inert `overlay.rating` column.

## ADDED Requirements

### Requirement: toggle_reject hides a recipe for the caller via the D1 overlay

The system SHALL provide a `toggle_reject(slug, reject)` tool that sets or clears the caller's `reject` flag for a recipe as a row in the D1 `overlay` table, returning without a `commit_sha`. It SHALL validate `slug` against the D1 `recipes` table (`not_found` when absent) and SHALL NOT write shared recipe content. `reject: false` SHALL clear the flag, deleting the overlay row when nothing else is set on it. `reject` and `favorite` are mutually exclusive: setting `reject: true` SHALL clear any `favorite`. A rejected recipe SHALL be excluded from the caller's `list_recipes` and `recipe_semantic_search` results (a hard gate). This is **per-tenant** and distinct from the group-wide `reject_discovery` (which suppresses a discovery URL before import); `toggle_reject` acts on an existing corpus slug for one member only.

#### Scenario: Rejecting a recipe hides it for the caller only

- **WHEN** `toggle_reject("miso-salmon", true)` is called
- **THEN** the caller's `overlay` row is upserted with `reject`, the recipe no longer appears in that caller's `list_recipes`/`recipe_semantic_search`, and no other member's view changes

#### Scenario: Un-rejecting restores default visibility

- **WHEN** `toggle_reject(slug, false)` is called on a row whose only field was `reject`
- **THEN** the overlay row is deleted and the recipe returns to neutral (available) for the caller

### Requirement: Ready-to-eat disposition is favorite and reject

The ready-to-eat catalog SHALL use the same disposition model as recipes: `add_draft_ready_to_eat` adds an item that is available by default (no `draft`/`active` state), and `update_ready_to_eat` sets a per-item `favorite` or `reject` (mutually exclusive), with no `status` lifecycle and no `rating`. A rejected ready-to-eat item SHALL not be suggested to the caller.

#### Scenario: Rejecting a ready-to-eat item stops suggesting it

- **WHEN** `update_ready_to_eat(slug, { reject: true })` is called
- **THEN** the item is no longer suggested to the caller, and no `status` or `rating` is involved

#### Scenario: Added ready-to-eat items are available, not drafts

- **WHEN** `add_draft_ready_to_eat` adds an item
- **THEN** it is part of the caller's catalog and suggestible immediately, with no activation step
