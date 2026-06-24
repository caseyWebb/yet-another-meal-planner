# recipe-index Specification

## Purpose

Defines the recipe index: the shared, objective projection of `recipes/*.md`, stored in and served from the D1 `recipes` table. The Worker reads the index from D1 — not from KV or the GitHub data repo — for the read-heavy operations that require it, and the build projects the validated recipe set into the table on every recipe push.

## Requirements

### Requirement: Recipe index is stored in and served from D1

The system SHALL maintain the shared recipe index as a `recipes` table in **D1** (the `DB` binding), not as a KV blob. The Worker SHALL read the index from D1 — not from KV or the GitHub data repo — on every tool invocation that requires it (`list_recipes`, `retrospective`, the `read_recipe` slug path, and the discovery idempotency check). The table holds only **objective** recipe content (the shared projection); subjective per-tenant fields (`status`, `rating`, `last_cooked`) are NOT stored here and continue to be merged at read time from the overlay and cooking log.

A *provisioned but empty* `recipes` table SHALL be treated as an empty corpus (the tool returns no recipes), distinct from an *unreadable* table (D1 unreachable or unmigrated), which SHALL surface as `index_unavailable`.

#### Scenario: list_recipes reads from D1

- **WHEN** `list_recipes` is called
- **THEN** the Worker loads the index from the D1 `recipes` table and applies filters, making no KV or GitHub call for the index

#### Scenario: Empty corpus is not an error

- **WHEN** the `recipes` table exists but has no rows
- **THEN** `list_recipes` returns `{ recipes: [] }` rather than an `index_unavailable` error

#### Scenario: Unreadable index surfaces as index_unavailable

- **WHEN** the `recipes` table cannot be read (D1 unreachable or not yet migrated)
- **THEN** the tool returns a structured `index_unavailable` error, not an unhandled exception

#### Scenario: retrospective reads recipe metadata from D1

- **WHEN** `retrospective` is called
- **THEN** recipe protein/cuisine metadata is resolved by querying D1, not by loading a KV blob

#### Scenario: Discovery idempotency check is an indexed query

- **WHEN** `parse_recipe` or `create_recipe` checks whether a source URL is already indexed
- **THEN** the lookup runs against the D1 `recipes` table (the `source_url` column is indexed) rather than loading the entire index

### Requirement: The build projects the index into D1

`build-indexes` SHALL project the validated recipe set into the D1 `recipes` table by replacing its contents wholesale in one transaction (`DELETE` then batched `INSERT`), so a removed recipe loses its row and the table is a deterministic function of `recipes/*.md`. It SHALL NOT publish the index to KV. The build SHALL skip the projection gracefully (warn, not fail) when D1 access cannot be resolved (e.g. `--check` mode or before first provision).

#### Scenario: Recipe push rebuilds the D1 table

- **WHEN** `build-indexes` runs after a recipe change
- **THEN** the `recipes` table is replaced to match the current `recipes/*.md`, with no KV `index:recipes` write

#### Scenario: Deploy populates D1 immediately

- **WHEN** an operator runs the deploy workflow
- **THEN** the post-deploy `build-indexes` step populates the D1 `recipes` table, so `list_recipes` returns results without requiring a recipe push first
