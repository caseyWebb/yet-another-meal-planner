## Context

The deploy pipeline already does the hard part for KV: id-less bindings in the code `wrangler.jsonc` are auto-provisioned by `wrangler deploy`, the provisioned ids are pinned back into the operator's data-repo config (`merge-wrangler-config.mjs` `pinKvIds` + the pin step in `data-deploy.yml`), and a deploy-time `run-migrations.mjs` applies idempotent, ledgered migrations. D1 needs the same shape plus one new thing: schema DDL, which Cloudflare provides natively via `wrangler d1 migrations`.

This slice stands up the rails and proves them end-to-end with zero domain tables. Every later slice then ships as "a D1 schema migration + a data backfill + tools swapped from KV/GitHub to `src/db.ts`."

## Goals / Non-Goals

**Goals:**
- A `DB` binding that auto-provisions and pins back per operator, exactly like the KV bindings — no manual operator step beyond an API token with D1 edit.
- A thin, structured-error data-access layer (`src/db.ts`) so tools never touch raw D1 and never throw.
- A two-track migration pipeline: native `wrangler d1 migrations` for **schema**, the existing `.mjs` runner (now with a `d1` client) for **data backfills**.
- End-to-end proof: deploy provisions D1, applies `0001_init.sql`, `/health` reports D1 reachable.

**Non-Goals:**
- Moving any domain data (recipe index, profile, cooking log, … are later slices).
- A query builder / ORM — `src/db.ts` is prepared-statement ergonomics, not an abstraction layer.
- A KV read-cache in front of D1 (YAGNI until a hot path is measured).

## Decisions

### Decision: binding named `DB`; tables live behind `src/db.ts`

The binding is `env.DB` (the Cloudflare idiom). Tools never reference `env.DB` directly — they go through `src/db.ts`, which owns prepared statements, the transaction/batch helper, and error mapping. This keeps the SQL surface in one reviewable place and lets the binding be renamed or sharded later without touching tools.

**Alternative considered:** `DATA_DB` for symmetry with `DATA_KV`. Minor; `DB` matches wrangler/D1 docs and the access layer hides it. Trivially reversible.

### Decision: two migration tracks, by nature of the change

```
  SCHEMA (DDL)            migrations/d1/*.sql      wrangler d1 migrations apply DB --remote
    declarative,         tracked in D1's          native, transactional, idempotent by
    table shape          `d1_migrations` table    Cloudflare's own ledger

  DATA (backfill)        migrations/*.mjs         node scripts/run-migrations.mjs --root .
    imperative, reads    tracked in DATA_KV       up({ kv, d1, dataRoot, log }); reads the
    GitHub/KV → INSERT   `migrations:applied`     data-repo checkout + KV, writes D1 rows
```

**Rationale:** Schema changes are declarative SQL and fit Cloudflare's native migration tool perfectly — leaning into the platform. Data backfills are imperative (they read the operator's GitHub checkout and existing KV, coerce, and INSERT) — they don't fit SQL-file migrations but already have a home in the idempotent, ledgered `.mjs` runner. Two ledgers, but each tracks a distinct kind of change; mixing them would force imperative JS into `.sql` files or reimplement schema-diffing in JS. The `migrations/d1/` directory keeps the SQL files from colliding with the `.mjs` runner's `migrations/` scan (which only globs `*.mjs`).

**Deploy ordering:** provision (during `deploy`) → `wrangler d1 migrations apply` (tables exist) → `run-migrations.mjs` (backfill into them). The schema step is a no-op when nothing's pending; the backfill runner already no-ops gracefully when access can't resolve (brand-new operator).

### Decision: `src/db.ts` surface

A minimal wrapper, returning structured results and mapping D1 errors to `ToolError` (`malformed_data` / a new `storage_error`), never throwing raw:

```
  db(env).first<T>(sql, ...binds): Promise<T | null>
  db(env).all<T>(sql, ...binds):   Promise<T[]>
  db(env).run(sql, ...binds):      Promise<{ changes: number }>
  db(env).batch(stmts):            Promise<void>   // D1 transaction (env.DB.batch)
```

Upserts (pantry, staples, brand prefs, overlay) are common enough that the layer documents the `INSERT … ON CONFLICT … DO UPDATE` idiom, but exposes no bespoke upsert helper until a slice needs one — keep the layer thin.

### Decision: provisioning mirrors KV, generalized

`merge-wrangler-config.mjs` gains `mergeD1Databases(codeD1, operatorD1)` (binding set from code; `database_id` from operator by binding, else omitted→auto-provision; code ids stripped — the same cross-tenant-safety rule as KV) and `pinD1Ids(deployed, operator)` mirroring `pinKvIds`. `kvIdsChanged` becomes `bindingIdsChanged` covering both `kv_namespaces` and `d1_databases`, so the pin step stays a true no-op (and skips the commit) when nothing changed. `D1_LEVEL`/code-level handling slots into the existing `mergeWranglerConfig`.

**Risk:** this assumes `wrangler deploy` auto-provisions an id-less `d1_databases` entry the same way it does KV (writing the provisioned `database_id` back into `_code/wrangler.jsonc` in place, which the pin step reads). If a wrangler version doesn't, the fallback is an explicit `wrangler d1 create` step in the deploy whose output id feeds the pin — the pin step's input is the only thing that changes (the same contingency already noted for KV in `data-deploy.yml`). Verify against the pinned `wrangler-action` version during implementation.

### Decision: prove it with `schema_meta`, not a domain table

`0001_init.sql` creates only `schema_meta(key TEXT PRIMARY KEY, value TEXT)` and `/health` runs `SELECT 1`. This exercises provisioning → schema apply → Worker binding without committing to any domain schema, so the foundation can land and be verified independently of slice 1.

## Risks / Open Questions

- **Wrangler D1 auto-provision parity with KV** — primary risk; mitigation above (explicit `d1 create` fallback). Confirm before merging.
- **API token scope** — operators' existing `CLOUDFLARE_API_TOKEN` is documented as "Workers + KV edit"; D1 edit must be added. `SELF_HOSTING.md` and the token-scope guidance update; an under-scoped token surfaces as a clear deploy failure on the `d1 migrations apply` step.
- **Local dev** — `wrangler dev` uses a local SQLite D1; `wrangler d1 migrations apply DB --local` seeds it. Document in `CONTRIBUTING.md`. Vitest unit tests for `src/db.ts` run against the local/in-memory D1 (or the existing miniflare setup if present); confirm the test harness can bind D1.
- **Backup/DR** (carried from the umbrella) — not solved here; once domain data lands in D1, define an export/time-travel cadence. Foundation only notes the dependency.
- **`migrations:applied` vs `d1_migrations`** — two ledgers is deliberate (above); document clearly in `CONTRIBUTING.md` so a contributor knows a schema change is a `.sql` file and a data move is a `.mjs` file.
