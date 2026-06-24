## MODIFIED Requirements

### Requirement: Group ratings aggregate from the D1 overlay table

`read_recipe_notes` SHALL compute the group's ratings/status signal for a recipe with a single query against the D1 `overlay` table (`SELECT tenant, rating, status FROM overlay WHERE recipe = ?`), scoped to the caller's group via the tenant directory — not by enumerating the tenant directory and reading each member's profile bundle. The caller's own private notes plus everyone's shared notes continue to be returned for the notes half (which still reads GitHub until the shared-corpus slice); only the ratings aggregation moves to D1 here.

#### Scenario: "rated 4+ by others" is one query

- **WHEN** `read_recipe_notes(slug)` is called
- **THEN** the ratings/status across the group come from a single indexed `overlay` query for that recipe, with no per-tenant bundle reads

#### Scenario: A member with no overlay row contributes no rating

- **WHEN** a group member has never rated the recipe
- **THEN** they have no `overlay` row for it and contribute nothing to the aggregate (no error)
