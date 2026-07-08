# member-app-differentiators delta — gate-meal-suggestions-to-mains

## MODIFIED Requirements

### Requirement: Group-wide trending row with a minimum-signal guard

The system SHALL provide `GET /api/cookbook/trending` (session-gated, ETagged): a group-wide
`cooking_log` aggregation over a trailing window (default 60 days) — deliberately cross-tenant,
exposing per-recipe counts only (`cooks`, distinct-cook count, last cooked date) and never
which member cooked what. A recipe SHALL qualify only with at least 2 cooks or at least 2
distinct cooking tenants in the window; below the guard the trending set SHALL be empty rather
than ranking single cooks. Results SHALL be joined to the projected recipe index (unprojected
slugs dropped), filtered by the caller's overlay rejects, restricted to **meal candidates** —
recipes whose effective `course` includes `main` or is empty (fail-open for a not-yet-classified
recipe; trending is a meal-suggestion surface, and a component/sub-recipe the group cooked twice
is real history but not a meal to suggest) — and deterministically ordered
(cooks, then distinct cooks, then recency, then slug). The browse page's first slot SHALL
render "New & trending": the existing new-for-me items first, then trending backfill,
deduplicated and capped — with no trending badge fabricated when the trending set is empty.

#### Scenario: Sparse production history yields an empty trending set

- **WHEN** the log holds only single-cook entries (e.g. two recipes, one cook each — the
  production state at design time)
- **THEN** the trending set is empty and the browse row renders new-for-me content alone

#### Scenario: A repeat-cooked recipe trends with counts only

- **WHEN** a recipe logs 3 cooks across 2 tenants within the window
- **THEN** it appears in the trending set with `cooks: 3` and a distinct-cook count of 2, with
  no member identities exposed

#### Scenario: A rejected recipe never trends for that member

- **WHEN** a recipe qualifies group-wide but the caller has marked it rejected
- **THEN** it is absent from that caller's trending response

#### Scenario: A repeat-cooked non-main never trends

- **WHEN** a recipe whose effective `course` does not contain `main` and is non-empty (e.g. a
  fresh pasta dough classified `["side"]` or `["component"]`) logs 2+ cooks within the window
- **THEN** it is absent from the trending set, while a recipe with an empty (not-yet-classified)
  `course` that clears the signal guard still qualifies

### Requirement: Picked-for-you is a deterministic favorites-centroid ranking with zero AI calls

The system SHALL provide `GET /api/cookbook/picked-for-you` (session-gated, ETagged): a thin
wrap of the existing `rankCandidates` ranking using the normalized centroid of the caller's
stored favorite embeddings as the query vector — stored cron-captured vectors only, no
Workers AI or frontier-model call at request time. Candidates SHALL exclude the caller's
favorites, rejects, recipes conflicting with the profile's dietary avoids (the same gate
the propose pool applies), and recipes that are not **meal candidates** — those whose effective
`course` is non-empty and does not include `main` (fail-open for an empty, not-yet-classified
`course`; picked-for-you suggests meals, never a component/sub-recipe). With no favorites the
result SHALL be empty — no backfill from the general index — and the browse row SHALL render
its empty state inviting favorites. The optional nudge parameters `rankCandidates` carries for
the propose flow SHALL be absent on this call path.

#### Scenario: No favorites means an honest empty row

- **WHEN** the caller has no favorite recipes
- **THEN** the endpoint returns an empty list and the row renders the favorite-a-few empty
  state rather than generic picks

#### Scenario: Ranking touches no model at request time

- **WHEN** picked-for-you is computed
- **THEN** no `env.AI` call occurs — the query vector is a centroid of stored favorite
  embeddings and ranking runs over stored recipe vectors

#### Scenario: Favorites and rejects never appear as picks

- **WHEN** the caller favorites one recipe and rejects another
- **THEN** neither appears in the picked-for-you response

#### Scenario: A non-main never appears as a pick

- **WHEN** the embedded index contains a recipe whose effective `course` is non-empty and does
  not contain `main` (e.g. a pasta dough near the caller's favorites in embedding space)
- **THEN** it is absent from the picked-for-you response, while a recipe whose `course` is
  empty (not yet classified) remains eligible
