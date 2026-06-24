## ADDED Requirements

### Requirement: D1 is the system of record for domain data

The Worker SHALL bind a Cloudflare D1 database as `DB` (`env.DB`). D1 is the storage tier for domain and operational data — data that is queried, related, admin-editable, or requires read-after-write consistency. The three-tier boundary is:

- **GitHub** holds authored recipe markdown (`recipes/*.md`) only — the source of truth for recipe content, hand-edited via Obsidian/native apps.
- **D1** holds all domain/operational data and derived projections (recipe index, profile, session state, cooking log, notes, registries, config, caches) — migrated slice by slice.
- **KV** holds ephemeral infrastructure only (`KROGER_KV`: tokens, PKCE verifiers, TTL flyer cache, health; `OAUTH_KV`: provider state; `TENANT_KV`: directory/invites). No domain data lives in KV.

This change introduces the binding and the rails; it moves no domain data.

#### Scenario: Worker binds D1

- **WHEN** the Worker starts with a provisioned D1 database
- **THEN** `env.DB` is available and the `/health` endpoint reports the database reachable (`SELECT 1` succeeds)

#### Scenario: Health surfaces a misprovisioned database

- **WHEN** D1 is unreachable or unprovisioned
- **THEN** `/health` reports the D1 probe as failing, rather than the failure first appearing at a tool call

### Requirement: Tools access D1 only through the data-access layer

Worker tools SHALL access D1 exclusively through `src/db.ts`, never the raw `env.DB` API. The layer SHALL expose prepared-statement helpers (`first`, `all`, `run`) and a transactional `batch`, and SHALL map D1 failures to structured `ToolError`s rather than throwing — consistent with the repo's "tools return structured errors, not throws" rule.

#### Scenario: A query failure becomes a structured error

- **WHEN** a D1 statement fails (e.g. constraint violation, malformed SQL)
- **THEN** the access layer returns/raises a structured `ToolError`, and no raw D1 exception escapes to the tool surface

### Requirement: Two-track migration pipeline

The system SHALL apply D1 **schema** changes via Cloudflare-native migrations (`wrangler d1 migrations apply DB`, SQL files under `migrations/d1/`, tracked in D1's own `d1_migrations` table) and D1 **data backfills** via the existing idempotent `.mjs` runner (`scripts/run-migrations.mjs`, tracked in the `migrations:applied` KV ledger), which SHALL pass a D1 client to each migration's `up({ kv, d1, dataRoot, log })`. On deploy, schema migrations SHALL be applied before data backfills run.

#### Scenario: Schema migration applies on deploy

- **WHEN** a deploy runs with a pending `migrations/d1/*.sql` file
- **THEN** `wrangler d1 migrations apply` creates/updates the tables and records the migration in `d1_migrations`, before the data-backfill runner executes

#### Scenario: Data backfill receives a D1 client

- **WHEN** `scripts/run-migrations.mjs` runs a pending `.mjs` migration and D1 is provisioned
- **THEN** the migration's `up()` receives a working `d1` client alongside `kv`, and its id is recorded in `migrations:applied` after success

#### Scenario: Backfill runner no-ops before D1 exists

- **WHEN** the runner executes for a brand-new operator whose D1 is not yet provisioned
- **THEN** it skips gracefully (the `d1` client is null/unavailable) without failing the deploy
