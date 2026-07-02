## ADDED Requirements

### Requirement: Normalize alias listing shows mappings only

The Normalize area's alias listing SHALL list only real mappings — alias rows whose stored `variant` differs from their stored `id` — and SHALL NOT render canonical self-entries (`variant === id`, the resolver front-door row every mint writes for its own node) as table rows. The self-entry population SHALL be presented as a single count chip (e.g. "513 canonical entries") alongside the listing's filters. The mappings-only restriction SHALL be applied in the page reader, so the rendered page model contains no self-entry rows, and the listing's search, source filters, pagination, and row counts SHALL operate over the mappings set only.

#### Scenario: Self-entries collapse to a count chip

- **WHEN** the operator opens the Normalize alias listing over an alias table holding canonical self-entries and real mappings
- **THEN** only the real mappings render as rows, and the self-entries appear solely as a count chip

#### Scenario: Listing controls count mappings, not front-door rows

- **WHEN** the operator searches, filters by source, or pages through the alias listing
- **THEN** the result set, page count, and displayed totals are computed over the mappings only

#### Scenario: A converged former self-entry is listed

- **WHEN** the alias-target convergence re-points a self-entry of a merged-away node so its variant no longer equals its stored target
- **THEN** the row appears in the listing as a real mapping on the next page load
