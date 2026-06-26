## MODIFIED Requirements

### Requirement: create_recipe persists a recipe with a solo commit

`create_recipe(frontmatter, body)` SHALL write a new `recipes/<slug>.md` from the agent-supplied frontmatter and body and commit it on its own via the atomic commit engine — not staged into the end-of-session commit. The slug SHALL be derived from the title (or supplied). The tool SHALL refuse to overwrite an existing recipe, returning `{ error: "slug_exists", slug }` when a file already exists at the target path, and SHALL refuse to duplicate a recipe whose `source` URL is already in the corpus (`already_exists`, with the existing slug to reuse). `status` SHALL default to `draft` when omitted (stripped from the shared index; effective per-tenant). The importing agent SHALL populate `description` and, for mains, `side_search_terms` so the recipe is semantically retrievable once its embedding reconciles.

#### Scenario: Recipe is created and committed

- **WHEN** `create_recipe` is called with frontmatter and a body containing `## Ingredients` and `## Instructions`
- **THEN** a new `recipes/<slug>.md` is written and committed in a single commit, and the tool returns the slug

#### Scenario: Existing slug is not clobbered

- **WHEN** `create_recipe` targets a slug whose file already exists
- **THEN** it returns `{ error: "slug_exists", slug }` and leaves the existing file untouched

#### Scenario: Imported recipe carries the semantic fields

- **WHEN** a main-course recipe is imported via the discovery/import path
- **THEN** the created frontmatter carries an agent-written `description` and `side_search_terms`

## ADDED Requirements

### Requirement: A discovery URL can be rejected group-wide

The system SHALL provide a `reject_discovery(url, reason?)` tool that records a **shared, group-wide** suppression of a discovery URL in a `discovery_rejections` table keyed by the canonical URL. Both discovery read paths SHALL consult it: `fetch_rss_discoveries` SHALL exclude rejected URLs from its candidate pool (folded into its corpus-dedup set), and `read_discovery_inbox` SHALL drop candidates whose URL is rejected (canonical match). Rejection SHALL be idempotent on the canonical URL and SHALL NOT modify recipe content or any tenant's overlay. Because the suppression is shared, it is reserved for "not corpus-worthy for the group" (junk, broken, non-recipe, duplicate, off-base); a personal not-for-me-this-time is a no-action skip, not a reject.

#### Scenario: A rejected URL stops resurfacing for everyone

- **WHEN** a member calls `reject_discovery` on a discovery URL and any member later reads the discovery pools
- **THEN** that URL (and its tracker-wrapped variants) is absent from both `fetch_rss_discoveries` and `read_discovery_inbox` for the whole group

#### Scenario: Rejection writes no recipe or overlay

- **WHEN** `reject_discovery` is called
- **THEN** only the shared `discovery_rejections` table is written; no recipe content and no tenant overlay changes
