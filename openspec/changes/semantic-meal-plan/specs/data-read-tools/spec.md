## MODIFIED Requirements

### Requirement: Group signal is readable on shared recipes

The system SHALL expose the cross-tenant group signal for a shared recipe — how many other tenants have **favorited** it (a count) and non-private notes (attributed) — to inform surfacing of recipes the caller has not tried. This read SHALL aggregate across tenants at read time and SHALL exclude private notes authored by others. The favorite count replaces the prior averaged star rating; it is a single indexed aggregate (`COUNT` of favorites), not an average over a 1–5 scale.

#### Scenario: Aggregated group favorite count available

- **WHEN** several tenants have favorited a recipe and the caller requests group signal for it
- **THEN** the caller receives the count of other-tenant favorites and the attributed non-private notes from the group

#### Scenario: Others' private notes excluded

- **WHEN** another tenant has a private note on a recipe
- **THEN** that private note is not included in the group signal returned to the caller

## ADDED Requirements

### Requirement: list_recipes exposes the favorite facet

`list_recipes` SHALL accept a `favorite` filter returning only the caller's favorited recipes, and SHALL surface the caller's `favorite` boolean on returned entries. The prior `rating` filter/return SHALL be removed in the favorite model.

#### Scenario: Filter to favorites

- **WHEN** `list_recipes({ favorite: true })` is called
- **THEN** only recipes the caller has favorited are returned, each annotated with `favorite: true`
