## MODIFIED Requirements

### Requirement: create_recipe persists a recipe with a solo commit

`create_recipe(frontmatter, body)` SHALL write a new `recipes/<slug>.md` from the agent-supplied frontmatter and body and commit it on its own via the atomic commit engine — not staged into the end-of-session commit. The slug SHALL be derived from the title (or supplied). The tool SHALL refuse to overwrite an existing recipe, returning `{ error: "slug_exists", slug }` when a file already exists at the target path. A recipe created through the discovery/import path SHALL land directly as a normal corpus recipe (no `draft` status); the importing agent SHALL populate `description` and, for mains, `side_search_terms`.

#### Scenario: Recipe is created and committed

- **WHEN** `create_recipe` is called with frontmatter and a body containing `## Ingredients` and `## Instructions`
- **THEN** a new `recipes/<slug>.md` is written and committed in a single commit, and the tool returns the slug

#### Scenario: Existing slug is not clobbered

- **WHEN** `create_recipe` targets a slug whose file already exists
- **THEN** it returns `{ error: "slug_exists", slug }` and leaves the existing file untouched

## REMOVED Requirements

### Requirement: Imported recipes land in draft state

**Reason**: Disposition collapses into the import decision (see `experimental-meal-planning`): an imported discovery becomes a first-class corpus recipe directly, a non-imported discovery stays a discovery, and an explicit rejection suppresses the discovery URL. The `draft` limbo state and the separate later promotion step are removed.

**Migration**: Existing `status: draft` recipes are reconciled to normal corpus recipes during the `d1-profile` overlay move; the per-tenant `status` overlay is retired in favor of the `favorite` boolean plus discovery-URL suppression. Pending drafts at cutover are either kept (treated as active corpus recipes) or removed if never wanted.
