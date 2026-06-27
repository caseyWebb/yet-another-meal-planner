# recipe-index Specification

## Purpose

Defines the recipe index: the shared, objective projection of `recipes/*.md`, stored in and served from the D1 `recipes` table. The Worker reads the index from D1 — not from KV or the GitHub data repo — for the read-heavy operations that require it, and the Worker's scheduled reconcile projects the validated recipe set into the table from the R2 corpus.

## Requirements

### Requirement: Recipe index is stored in and served from D1

The system SHALL maintain the shared recipe index as a `recipes` table in **D1** (the `DB` binding), not as a KV blob. The Worker SHALL read the index from D1 — not from KV or the GitHub data repo — on every tool invocation that requires it (`search_recipes`, `retrospective`, the `read_recipe` slug path, and the discovery idempotency check). The table holds only **objective** recipe content (the shared projection); per-tenant disposition fields (`favorite`, `reject`) and the derived `last_cooked` are NOT stored here — they are merged at read time from the overlay and cooking log.

A *provisioned but empty* `recipes` table SHALL be treated as an empty corpus (the tool returns no recipes), distinct from an *unreadable* table (D1 unreachable or unmigrated), which SHALL surface as `index_unavailable`.

#### Scenario: search_recipes reads from D1

- **WHEN** `search_recipes` is called
- **THEN** the Worker loads the index from the D1 `recipes` table and applies the spec facets, making no KV or GitHub call for the index

#### Scenario: Empty corpus is not an error

- **WHEN** the `recipes` table exists but has no rows
- **THEN** a vibe-less `search_recipes` spec returns an empty result group rather than an `index_unavailable` error

#### Scenario: Unreadable index surfaces as index_unavailable

- **WHEN** the `recipes` table cannot be read (D1 unreachable or not yet migrated)
- **THEN** the tool returns a structured `index_unavailable` error, not an unhandled exception

#### Scenario: retrospective reads recipe metadata from D1

- **WHEN** `retrospective` is called
- **THEN** recipe protein/cuisine metadata is resolved by querying D1, not by loading a KV blob

#### Scenario: Discovery idempotency check is an indexed query

- **WHEN** `parse_recipe` or `create_recipe` checks whether a source URL is already indexed
- **THEN** the lookup runs against the D1 `recipes` table (the `source_url` column is indexed) rather than loading the entire index

### Requirement: The Worker reconcile projects the index into D1

The Worker's scheduled reconcile (`src/recipe-projection.ts`) SHALL project the validated recipe set into the D1 `recipes` table by replacing its contents wholesale in one transaction (`DELETE` then batched `INSERT`), so a removed recipe loses its row and the table is a deterministic function of the R2 `recipes/*.md` corpus. It SHALL NOT publish the index to KV. Projection is eventual (cron-driven): a fresh database is populated by the first reconcile pass over the R2 corpus, not by a CI build (see `r2-corpus-store` for the reconcile contract).

#### Scenario: A reconcile rebuilds the D1 table

- **WHEN** the reconcile runs after a recipe change
- **THEN** the `recipes` table is replaced to match the current R2 `recipes/*.md`, with no KV `index:recipes` write

#### Scenario: First reconcile populates a fresh database

- **WHEN** an operator deploys and the first scheduled reconcile runs
- **THEN** it populates the D1 `recipes` table from the R2 corpus, so `search_recipes` returns results
