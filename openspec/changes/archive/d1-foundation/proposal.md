## Why

`cloudflare-storage-architecture` decided that domain/operational data moves to **D1** (queryable, relational, admin-editable, strongly consistent), leaving GitHub for authored recipe markdown and KV for ephemeral infra. Every slice of that roadmap (recipe index, cooking log, profile, session state, shared corpus) needs the same rails first: a D1 binding that auto-provisions per operator, a schema-migration pipeline, a way for data backfills to write D1, and a thin Worker data-access layer. This change builds those rails and **moves no domain data** — it is roadmap slice 0.

The repo already auto-provisions id-less KV bindings on deploy and pins the ids back into the operator's config (`merge-wrangler-config.mjs`, `data-deploy.yml`). D1 follows the identical pattern, so the foundation is mostly *mirroring proven machinery* for a new binding type, plus adopting Cloudflare-native D1 schema migrations.

## What Changes

- **NEW** D1 binding `DB` in `wrangler.jsonc` (id-less — auto-provisioned by `wrangler deploy`, like the KV bindings), with `migrations_dir: "migrations/d1"` so D1's SQL schema migrations don't collide with the existing `migrations/*.mjs` KV/data runner.
- **NEW** `src/db.ts` — a thin typed data-access layer over `env.DB`: prepared-statement helpers (`first`/`all`/`run`), a `batch` transaction helper, and structured-error mapping (`src/errors.ts`), so tools never touch the raw D1 API and never throw.
- **NEW** `scripts/d1-rest.mjs` — a Cloudflare D1 REST client for build/deploy scripts (`resolveD1Access`, `makeD1Client` with `query`/`exec`), mirroring `kv-rest.mjs`. Lets the migration runner write D1 from CI.
- `scripts/merge-wrangler-config.mjs`: handle `d1_databases` in the merge (binding set from code, `database_id` from the operator or omitted→auto-provision, code ids stripped) and in the pin-back (`pinD1Ids`, mirroring `pinKvIds`); `kvIdsChanged` generalizes to cover D1.
- `scripts/run-migrations.mjs`: pass a `d1` client into each migration's `up({ kv, d1, dataRoot, log })`, so future slices' **data backfills** (read the data-repo checkout / KV → INSERT into D1) run through the existing idempotent, ledgered runner. Schema DDL does **not** go here — it uses the native pipeline below.
- `.github/workflows/data-deploy.yml`: after deploy + KV-id pin-back, add **`wrangler d1 migrations apply DB --remote`** (creates/updates tables) *before* the `run-migrations.mjs` step (which backfills into the now-existing tables). Pin auto-provisioned D1 ids back alongside the KV ids.
- **NEW** `migrations/d1/0001_init.sql` — a minimal bootstrap: a `schema_meta(key TEXT PRIMARY KEY, value TEXT)` table. No domain tables; it exists to prove the schema pipeline end-to-end.
- `src/health.ts`: extend the health check to ping D1 (`SELECT 1`) so a misprovisioned database surfaces in `/health` rather than at first tool use.
- `src/env.ts`: add `DB: D1Database` to `Env` with documentation of its role (domain data, per the architecture doc).
- Docs: `docs/SELF_HOSTING.md` (operator's Cloudflare API token now needs D1 edit; a D1 database is auto-provisioned); `docs/ARCHITECTURE.md` (the three-tier boundary + D1's role); `CONTRIBUTING.md` (local dev uses `wrangler dev` with local D1; how to add a D1 migration).

## Capabilities

### New Capabilities

- `cloudflare-data-platform`: the D1 binding, the `src/db.ts` access-layer contract, the two-track migration pipeline (native `wrangler d1 migrations` for schema; the `.mjs` runner for data backfills), and the architectural tier boundary statement.

### Modified Capabilities

- `operator-provisioning`: D1 is auto-provisioned and pinned back alongside the KV namespaces; the deploy applies D1 schema migrations; the operator's API token scope now includes D1.

## Impact

- `wrangler.jsonc`, `src/env.ts`, `src/health.ts`, new `src/db.ts`.
- `scripts/merge-wrangler-config.mjs` (+ `tests/merge-wrangler-config.test.mjs`), new `scripts/d1-rest.mjs`, `scripts/run-migrations.mjs`.
- `.github/workflows/data-deploy.yml`.
- `migrations/d1/0001_init.sql` (new).
- `docs/SELF_HOSTING.md`, `docs/ARCHITECTURE.md`, `CONTRIBUTING.md`.
- The data-template repo's `wrangler.jsonc` gains the id-less `DB` binding on its next sync (operator-provisioning template).
