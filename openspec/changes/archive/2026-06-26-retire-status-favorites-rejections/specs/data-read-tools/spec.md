## MODIFIED Requirements

### Requirement: list_recipes reads the index and filters in-worker

The system SHALL provide `list_recipes(filters)` that reads the shared D1 `recipes` index, **joins each entry with the caller's per-tenant overlay** (`favorite` / `reject`), **the caller's cooking-log-derived `last_cooked`**, **and the caller's owned-equipment list**, unions the caller's personal (unshared) recipes, and applies filters in the Worker, returning `{ recipes: [{ slug, title, frontmatter }] }` where `frontmatter` reflects the merged objective content plus the caller's subjective marks. By default — with no overlay row — a recipe is **neutral (available)**; the default result is the whole corpus **minus the caller's rejects**. There is no `status` field and no effective-`draft` default. If the index is missing or malformed, the tool SHALL return a structured `index_unavailable` error.

#### Scenario: The whole corpus minus rejects is returned by default

- **WHEN** `list_recipes({})` is invoked
- **THEN** every shared recipe the caller has not rejected is returned (no per-member activation required), each merged with the caller's `favorite`/`last_cooked`

#### Scenario: Rejected recipes are excluded

- **WHEN** the caller has rejected a recipe and invokes `list_recipes({})`
- **THEN** that recipe is absent from the result; another member who has not rejected it still sees it

#### Scenario: Personal recipes included

- **WHEN** the caller has personal (unshared) recipes and invokes `list_recipes({})`
- **THEN** the results include the caller's personal recipes alongside non-rejected shared corpus recipes

#### Scenario: Index missing or malformed

- **WHEN** the D1 `recipes` index cannot be read
- **THEN** the tool returns a structured `index_unavailable` error rather than an empty list or a throw

### Requirement: list_recipes surfaces the favorite boolean

`list_recipes` SHALL surface the caller's `favorite` boolean on each returned entry, merged from the caller's overlay. It SHALL NOT surface a `status` or `rating` field. (Rejected recipes are excluded from the result entirely rather than surfaced with a flag.)

#### Scenario: Favorite rides each entry; status and rating are gone

- **WHEN** `list_recipes` returns recipes the caller has and has not favorited
- **THEN** each entry's merged view carries `favorite: true`/`false` and carries no `status` and no `rating`
