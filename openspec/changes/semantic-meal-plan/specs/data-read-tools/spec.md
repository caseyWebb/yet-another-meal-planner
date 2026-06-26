## MODIFIED Requirements

### Requirement: Group signal is readable on shared recipes

The system SHALL expose the cross-tenant group signal for a shared recipe — how many other tenants have **favorited** it (a count) and non-private notes (attributed) — to inform surfacing of recipes the caller has not tried. This read SHALL aggregate across tenants at read time and SHALL exclude private notes authored by others. The favorite count replaces the prior averaged star rating; it is a single indexed aggregate (`COUNT` of favorites), not an average over a 1–5 scale.

#### Scenario: Aggregated group favorite count available

- **WHEN** several tenants have favorited a recipe and the caller requests group signal for it
- **THEN** the caller receives the count of other-tenant favorites and the attributed non-private notes from the group

#### Scenario: Others' private notes excluded

- **WHEN** another tenant has a private note on a recipe
- **THEN** that private note is not included in the group signal returned to the caller

### Requirement: list_recipes surfaces the favorite boolean

`list_recipes` SHALL surface the caller's `favorite` boolean on each returned entry, merged from the caller's overlay at read time. The prior `rating` value SHALL no longer be merged or returned. (This change adds no dedicated `favorite` query filter to `list_recipes`; semantic retrieval and the favorite re-rank consume the boolean, and a member browses favorites through that path.)

#### Scenario: Favorite rides each entry, rating is gone

- **WHEN** `list_recipes` returns recipes the caller has favorited and not favorited
- **THEN** each entry's merged view carries `favorite: true`/`false` and carries no `rating` field

## ADDED Requirements

### Requirement: list_recipes surfaces the recipe description

`list_recipes` SHALL surface each recipe's `description` on the returned entry (projected as a `recipes` column), so the compact craving-aligned brief is available to the caller without a separate `read_recipe` call.

#### Scenario: Description rides the index entry

- **WHEN** `list_recipes` returns a recipe that has a `description`
- **THEN** the entry's frontmatter carries that `description`
