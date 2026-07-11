## ADDED Requirements

### Requirement: Retrospective page shell with tabs

The "Cooking log" nav destination SHALL become the **Retrospective** page at `/retrospective`
("Look back at what you cooked — and what it cost."), a tabbed shell with three tabs — **Cooking
log** (default), **Spend analyzer**, and **Waste analyzer** — whose selected tab is held in a
`?tab` URL search param. The Spend and Waste tabs SHALL render a placeholder until their
analyzers ship (band 4); the Cooking log tab is the default surface. The legacy `/log` route
SHALL redirect to `/retrospective`.

#### Scenario: The retrospective shell defaults to the cooking log

- **WHEN** a member opens `/retrospective` with no `?tab`
- **THEN** the Cooking log tab is selected and its composer and log list render

#### Scenario: Switching tabs is reflected in the URL

- **WHEN** a member selects the Spend analyzer or Waste analyzer tab
- **THEN** the `?tab` search param updates and the selected tab's panel renders (a placeholder
  until the band-4 analyzers land)

#### Scenario: The legacy log route redirects

- **WHEN** a member navigates to `/log`
- **THEN** they land on `/retrospective`

## MODIFIED Requirements

### Requirement: Cooking log page with member corrections

The cooking log page SHALL list the caller's log most-recent-first via a bounded read (recipe
rows enriched with title and facets from the recipe index), SHALL log a cook through the same
shared operation the `log_cooked` tool uses — preserving slug validation, the `satisfied_vibe`
stamp, and the atomic meal-plan clear — with route-level idempotent dedupe so a replayed
mutation cannot double-log, and SHALL support deleting one of the caller's own entries by id.

The composer SHALL carry a **meal** control (`breakfast | lunch | dinner`, defaulting by time of
day — before 11:00 breakfast, before 16:00 lunch, else dinner) and a **source** control mapping
**From cookbook → `recipe`** (a recipe select) and **Something else → `ad_hoc`** (a free-text
dish name); the mock's "Leftovers" source is deliberately not offered (the log is a cooking log,
not an eating log — `log_cooked`'s closed `type` set has no leftovers value; leftovers-as-waste
is captured at pantry disposition). The composer SHALL carry a date picker defaulting to today
and **allowing backdating**, and on submit SHALL preserve the chosen meal and date for rapid
multi-logging. The chosen `meal` SHALL be sent to the shared log operation.

The list SHALL group entries by day (Today / Yesterday / an absolute date label) with a per-day
logged count, ordering rows within a day by meal (breakfast < lunch < dinner; a row whose meal
is unset sorts last), and each row SHALL show its meal tag, the recipe link with facet chips (or
a non-recipe badge for an `ad_hoc` entry), and a delete control.

#### Scenario: Logging from the app behaves like the tool

- **WHEN** a member logs a planned, vibe-proposed recipe from the app
- **THEN** the log row carries the vibe's `satisfied_vibe` provenance and the plan row is
  cleared in the same D1 transaction, exactly as via `log_cooked`

#### Scenario: A replayed log write cannot double-log

- **WHEN** the same log mutation is delivered twice
- **THEN** the second delivery is answered as deduplicated and exactly one log row exists

#### Scenario: The composer logs the chosen meal and a non-recipe entry

- **WHEN** a member picks a meal, selects "Something else", types a dish name, and logs it
- **THEN** an `ad_hoc` entry carrying that meal and name is logged, and the meal and date persist
  in the composer for the next entry

#### Scenario: The list groups by day and tags the meal

- **WHEN** the log holds entries across several days and meals
- **THEN** they render grouped by day with a logged count, ordered breakfast before lunch before
  dinner within a day, each row tagged with its meal
