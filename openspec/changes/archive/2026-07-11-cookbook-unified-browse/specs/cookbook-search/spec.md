## ADDED Requirements

### Requirement: Result rows carry the compact facet fields

The keyword ranker's compact result row SHALL carry the compact facet fields — the
shape shared by the anonymous `/cookbook/search` JSON endpoint and the member app's
cookbook index/search reads: `slug`, `title`, `description`, `protein`, `cuisine`, and `time_total`
(minutes, or `null` when the recipe has no authored total time — never fabricated), so
list surfaces can render facet and time chips and apply client-side facet filters
without a second read. This is additive: ranking, ordering, the no-JS fallback, and the
Content-Security-Policy posture are unchanged.

#### Scenario: A hit row carries its time facet

- **WHEN** a recipe with `time_total: 25` is returned by the search endpoint or the
  member cookbook index read
- **THEN** its row carries `time_total: 25` alongside `slug`/`title`/`description`/
  `protein`/`cuisine`

#### Scenario: Missing time is null, never invented

- **WHEN** a recipe has no `time_total` in the index
- **THEN** its row carries `time_total: null` and downstream time filters treat it as
  failing any time cap
