## MODIFIED Requirements

### Requirement: create_recipe persists a recipe with a solo commit

`create_recipe(frontmatter, body)` SHALL write a new `recipes/<slug>.md` from the agent-supplied frontmatter and body as its own atomic corpus write — not staged into any batched write — and SHALL record the caller household's visibility grant in the same operation: a `recipe_imports` row with `via = 'agent'`, the resolved member id, and the creation date, so an agent import is attributed at creation. The slug SHALL be derived from the title (or supplied). The tool SHALL refuse to overwrite an existing recipe, returning `{ error: "slug_exists", slug }` when a recipe already exists at the target slug with a different source. A recipe whose `source` URL is already in the corpus SHALL be **dedup-to-grant**: the tool creates no second copy, mints the caller household's `recipe_imports` grant on the existing recipe (`via 'agent'`, resolved member — idempotent when the household already holds one), and returns the `already_exists` error code with the existing slug to reuse, worded as bringing the existing recipe into the caller's cookbook. It SHALL NOT stamp a `status` (the per-tenant `status` lifecycle is retired); a created recipe is immediately visible through its creating household's lens (and more widely per the deployment profile and friend lenses). The importing agent SHALL populate `description` and, for mains, `side_search_terms` so the recipe is semantically retrievable once its embedding reconciles.

#### Scenario: Recipe is created, granted, and available

- **WHEN** `create_recipe` is called with frontmatter and a body containing `## Ingredients` and `## Instructions`
- **THEN** a new `recipes/<slug>.md` is written with no `status` stamped, the caller household's `recipe_imports` row (`via 'agent'`, the resolved member) is recorded in the same operation, and the recipe is visible through that household's lens

#### Scenario: Duplicate source becomes a grant, not a copy

- **WHEN** `create_recipe` is called by household B's member with a `source` URL household A already brought into the corpus
- **THEN** no file is written, B's household gains its `recipe_imports` grant on the existing recipe, and the tool returns `already_exists` with the existing slug — the recipe is now in B's cookbook

#### Scenario: Dedup-to-grant is idempotent

- **WHEN** the same household re-imports a source it already holds a grant on
- **THEN** the grant row is unchanged (first provenance wins) and the tool returns `already_exists` with the slug

#### Scenario: Existing slug is not clobbered

- **WHEN** `create_recipe` targets a slug that already exists with a different source
- **THEN** it returns `{ error: "slug_exists", slug }` and leaves the existing recipe and its grants untouched

#### Scenario: Imported recipe carries the semantic fields

- **WHEN** a main-course recipe is imported via the discovery/import path
- **THEN** the created frontmatter carries an agent-written `description` and `side_search_terms`
