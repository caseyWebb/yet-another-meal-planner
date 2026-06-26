## MODIFIED Requirements

### Requirement: create_recipe persists a recipe with a solo commit

`create_recipe(frontmatter, body)` SHALL write a new `recipes/<slug>.md` from the agent-supplied frontmatter and body and commit it on its own via the atomic commit engine — not staged into the end-of-session commit. The slug SHALL be derived from the title (or supplied). The tool SHALL refuse to overwrite an existing recipe, returning `{ error: "slug_exists", slug }` when a file already exists at the target path, and SHALL refuse to duplicate a recipe whose `source` URL is already in the corpus (`already_exists`, with the existing slug to reuse). It SHALL NOT stamp a `status` (the per-tenant `status` lifecycle is retired); a created recipe is an available corpus recipe by default. The importing agent SHALL populate `description` and, for mains, `side_search_terms` so the recipe is semantically retrievable once its embedding reconciles.

#### Scenario: Recipe is created, committed, and available

- **WHEN** `create_recipe` is called with frontmatter and a body containing `## Ingredients` and `## Instructions`
- **THEN** a new `recipes/<slug>.md` is written and committed in a single commit with no `status` stamped, and the recipe is available to every member by default

#### Scenario: Existing slug is not clobbered

- **WHEN** `create_recipe` targets a slug whose file already exists
- **THEN** it returns `{ error: "slug_exists", slug }` and leaves the existing file untouched

#### Scenario: Imported recipe carries the semantic fields

- **WHEN** a main-course recipe is imported via the discovery/import path
- **THEN** the created frontmatter carries an agent-written `description` and `side_search_terms`

## REMOVED Requirements

### Requirement: Imported recipes land in draft state

**Reason**: The `draft` state is retired along with the rest of the `status` lifecycle. With opt-out visibility, an imported recipe is simply an available corpus recipe; there is no draft limbo and no separate later activation step. Disposition collapses to a decision: import it (it is in the corpus), leave it (it stays a discovery), or `reject_discovery` the URL group-wide.

**Migration**: `create_recipe` stops stamping `status: draft`. Existing `draft` overlay rows are deleted by the overlay migration (neutral is the new default). `discovered_at` / `discovery_source` continue to be set on discovery imports.
