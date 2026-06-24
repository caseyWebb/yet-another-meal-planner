## MODIFIED Requirements

### Requirement: Shared corpus lives in D1, not GitHub TOML

The shared corpus artifacts — ingredient aliases, the store registry, store notes, recipe notes, RSS feeds, the newsletter sender/member allowlist, the discovery inbox, the SKU resolution cache, and flyer terms — SHALL be stored in D1 tables, written and validated by the Worker write tools, and read by query. GitHub SHALL hold only `recipes/*.md`. Attributed notes (`store_notes`, `recipe_notes`) SHALL carry an `author` (the writing tenant) and a `private` flag; `read_recipe_notes` SHALL return the caller's own private notes plus everyone's shared notes via a single query, joined with the D1 overlay ratings.

#### Scenario: GitHub holds only recipes

- **WHEN** the migration completes
- **THEN** no shared-corpus TOML remains in the data repo, the Worker reads/writes these artifacts in D1, and the only data the Worker reads from GitHub is recipe markdown

#### Scenario: read_recipe_notes is fully D1

- **WHEN** `read_recipe_notes(slug)` is called
- **THEN** notes (own-private + group-shared) and group ratings both come from D1 queries, with no GitHub read

#### Scenario: Attribution and privacy preserved

- **WHEN** a member writes a private note
- **THEN** it is stored with their `author` and `private=1`, and other members do not see it in `read_recipe_notes`
