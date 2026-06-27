# cloudflare-data-platform Specification

## Purpose

Defines the Cloudflare D1 storage tier and its access discipline: D1 (`env.DB`) is the system of record for all domain and operational data, tools reach it only through the `src/db.ts` data-access layer (structured errors, never throws), and the schema is evolved by a single schema-only migration track (`migrations/d1/*.sql` applied by `wrangler d1 migrations apply`). This is the storage boundary the `d1-*` slices migrated onto.
## Requirements
### Requirement: D1 is the system of record for domain data

The Worker SHALL bind a Cloudflare D1 database as `DB` (`env.DB`). D1 is the storage tier for domain and operational data — data that is queried, related, admin-editable, or requires read-after-write consistency. The three-tier boundary is:

- **R2** holds authored recipe + guidance markdown (`recipes/*.md`, `guidance/**/*.md`) — the source of truth for human-authored corpus content, hand-edited via Obsidian (S3-compatible sync) or other file tooling. The Worker SHALL bind the R2 bucket and read/list/write the corpus through it; there is no GitHub App or installation token on the data path. (Git history for the corpus is not retained; this is a deliberate trade.)
- **D1** holds all domain/operational data and derived projections (recipe index, profile, session state, cooking log, shared corpus, attributed notes, registries, config, caches).
- **KV** holds ephemeral infrastructure only (`KROGER_KV`: tokens, PKCE verifiers, TTL flyer cache, background-job health; `OAUTH_KV`: provider state; `TENANT_KV`: directory/invites). No domain data lives in KV; the Worker binds only `KROGER_KV`, `TENANT_KV`, and `OAUTH_KV`.

Authored markdown SHALL NOT be stored in D1 — D1 is the relational/derived tier, and a file-based editor (Obsidian) has no interface to a D1 row; the corpus is files, in R2.

#### Scenario: Worker binds D1 and R2

- **WHEN** the Worker starts with a provisioned D1 database and R2 corpus bucket
- **THEN** `env.DB` and the R2 binding are available, `/health` reports the database reachable (`SELECT 1` succeeds), and recipe/guidance reads resolve from R2

#### Scenario: Health surfaces a misprovisioned database

- **WHEN** D1 is unreachable or unprovisioned
- **THEN** `/health` reports the D1 probe as failing, rather than the failure first appearing at a tool call

#### Scenario: No domain data remains in KV

- **WHEN** the recipe index, profile, session state, cooking log, shared corpus, and attributed notes have all moved to D1
- **THEN** the Worker binds only `KROGER_KV`, `TENANT_KV`, and `OAUTH_KV` (ephemeral infrastructure), and no domain-data KV key remains

#### Scenario: Authored corpus is files in R2, not rows in D1

- **WHEN** a recipe or guidance document is created or edited
- **THEN** it is persisted as a markdown object in R2 (editable by a file-based tool), and only its derived projection (the index) is written to D1

### Requirement: Tools access D1 only through the data-access layer

Worker tools SHALL access D1 exclusively through `src/db.ts`, never the raw `env.DB` API. The layer SHALL expose prepared-statement helpers (`first`, `all`, `run`) and a transactional `batch` (plus `prepare` for building batched statements), and SHALL map D1 failures to structured `ToolError`s (`storage_error`) rather than throwing — consistent with the repo's "tools return structured errors, not throws" rule.

#### Scenario: A query failure becomes a structured error

- **WHEN** a D1 statement fails (e.g. constraint violation, malformed SQL)
- **THEN** the access layer returns/raises a structured `ToolError` (`storage_error`), and no raw D1 exception escapes to the tool surface

#### Scenario: Multi-row writes are transactional

- **WHEN** a tool applies a multi-row write (e.g. a meal-plan upsert plus a cooking-log insert)
- **THEN** the statements are committed together through the layer's `batch`, so a partial failure leaves no half-applied state

### Requirement: Schema-only migration track

D1 schema changes SHALL be applied by Cloudflare-native migrations: declarative SQL files under `migrations/d1/*.sql`, applied by `wrangler d1 migrations apply DB` (`--local` to seed the dev SQLite, `--remote` on deploy), and tracked in D1's own `d1_migrations` table (created automatically on first apply). This SHALL be the only standing migration track — a schema change is a `.sql` file under `migrations/d1/`; there is no other migration mechanism.

**No script writes D1 from CI.** The recipe-index projection is performed by the **Worker reconcile**, which projects the `recipes` table from the R2 corpus (see `r2-corpus-store`). The index is a deterministic rebuild of a derived table, distinct from the schema-migration track.

#### Scenario: Schema migration applies on deploy

- **WHEN** a deploy runs with a pending `migrations/d1/*.sql` file
- **THEN** `wrangler d1 migrations apply DB --remote` creates/updates the tables and records the migration in D1's `d1_migrations` table

#### Scenario: A schema change is a SQL file

- **WHEN** a new table or column is needed
- **THEN** the change is expressed as a `.sql` file under `migrations/d1/` and applied by `wrangler d1 migrations apply`, with no imperative `.mjs` migration runner involved

#### Scenario: The index is projected by the Worker, not CI

- **WHEN** the recipe corpus changes in R2
- **THEN** the Worker reconcile projects the updated index into D1, and no CI script writes to D1

