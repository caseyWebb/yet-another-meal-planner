## ADDED Requirements

### Requirement: The promoted panel repackages the differentiator signals as reason badges

The browse page SHALL render one visually distinct promoted panel captioned
"Recommended for you", each row an ordinary recipe row plus an uppercase **reason
badge** naming why it is promoted. The badge vocabulary SHALL be exactly: **"Just
Added"** (the new-for-me watermark read — discovery-attribution-based, unchanged),
**"Trending"** (the group-wide trending read with its minimum-signal guard verbatim),
and **"Picked for You"** (the favorites-centroid read). **"Popular with Friends" SHALL
NOT be rendered** — that reason requires the friend visibility lens and ships with the
change that lands it, not before.

Panel composition SHALL be a pure per-render derivation over those three session reads —
no new endpoint, no persistence, no pinning, and no dismissal state: at most **one row
per signal** — each signal's **top-ranked** row — in the fixed precedence Just Added →
Trending → Picked for You. A top row already promoted by a higher-precedence signal
contributes nothing (deduplicated, not re-badged), and a top row failing the active
global filters is dropped, never replaced by a deeper-ranked candidate — the panel
never misrepresents a signal's actual top recommendation. An empty signal likewise
contributes nothing — partial panels
are fine and no reason is ever backfilled from another signal or the general index.
Displayed promoted slugs SHALL be deduplicated out of the organic list below. The panel
SHALL hide entirely in search mode, in the favorites view mode, and when zero promoted
rows survive the filters.

Honest trend chips SHALL be preserved: a listed row (promoted or organic) that appears
in the guarded trending read carries the existing counts chip with its existing copy;
no trending badge or chip is fabricated when the trending set is empty.

#### Scenario: Reason badges ride real signals only

- **WHEN** the trending read returns a qualifying recipe and the caller has favorites
  (a non-empty picked-for-you) but nothing is new-for-me
- **THEN** the panel renders a "Trending" row and a "Picked for You" row, no "Just
  Added" row, and no "Popular with Friends" badge anywhere

#### Scenario: Promoted rows dedupe out of the organic list

- **WHEN** a recipe is displayed in the promoted panel
- **THEN** it does not appear again in the organic list below, and a slug qualifying for
  two signals appears once, badged with the higher-precedence reason

#### Scenario: The panel respects filters and hides when empty

- **WHEN** the active filters exclude every promoted candidate, or the page is in search
  mode or the favorites view
- **THEN** the promoted panel is absent entirely — no empty panel shell

#### Scenario: Sparse history yields no trending promotion

- **WHEN** the group cooking history is below the minimum-signal guard
- **THEN** no "Trending" row and no counts chip render anywhere on the page, and the
  panel shows only the other signals' rows (or hides if none survive)

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
(cooks, then distinct cooks, then recency, then slug). The browse page SHALL consume this
read through the promoted "Recommended for you" panel (the "Trending" reason and the
per-row honest counts chip) — with no trending badge or chip fabricated when the trending
set is empty.

#### Scenario: Sparse production history yields an empty trending set

- **WHEN** the log holds only single-cook entries (e.g. two recipes, one cook each — the
  production state at design time)
- **THEN** the trending set is empty and the browse page renders no "Trending" promotion
  and no counts chip

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
result SHALL be empty — no backfill from the general index — and the promoted panel SHALL
simply omit the "Picked for You" reason rather than inventing generic picks. The optional
nudge parameters `rankCandidates` carries for the propose flow SHALL be absent on this
call path.

#### Scenario: No favorites means no picked promotion

- **WHEN** the caller has no favorite recipes
- **THEN** the endpoint returns an empty list and the promoted panel renders without a
  "Picked for You" row — never generic picks

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

## REMOVED Requirements

### Requirement: Browse slots are filled without layout change

**Reason**: superseded by the unified cookbook browse — the sectioned "New & trending" /
"Picked for you" / "All recipes" layout is replaced by the promoted "Recommended for
you" panel over one flat organic list (see the ADDED promoted-panel requirement and
`member-app-core`'s rewritten browse requirement).
