## 1. Binding + env

- [ ] 1.1 Add an id-less `d1_databases` entry to `wrangler.jsonc`: `{ "binding": "DB", "database_name": "grocery-mcp", "migrations_dir": "migrations/d1" }` (no `database_id` — auto-provisioned). Update the KV/binding comment block to mention D1's role (domain data).
- [ ] 1.2 Add `DB: D1Database` to `Env` in `src/env.ts` with a doc comment: holds domain/operational data per `cloudflare-storage-architecture`; KV is now ephemeral infra only.

## 2. Data-access layer

- [ ] 2.1 Add `src/db.ts`: `db(env)` returning `{ first<T>, all<T>, run, batch }` over `env.DB` prepared statements. Map D1 exceptions to a structured `ToolError` (add a `storage_error` code to `src/errors.ts` if none fits); never throw raw.
- [ ] 2.2 Document the `INSERT … ON CONFLICT … DO UPDATE` upsert idiom in a comment; add no bespoke upsert helper yet (keep thin).
- [ ] 2.3 Unit-test `src/db.ts` against a local/in-memory D1 (confirm the vitest/miniflare harness can bind D1; if not, add the binding to `vitest.config.ts` / test setup).

## 3. Schema migration pipeline (native)

- [ ] 3.1 Create `migrations/d1/0001_init.sql`: `CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT);`. No domain tables.
- [ ] 3.2 Verify `wrangler d1 migrations apply DB --local` seeds the local DB and `--remote` is the deploy form; note the `d1_migrations` tracking table is created automatically.

## 4. Data-backfill pipeline (runner)

- [ ] 4.1 Add `scripts/d1-rest.mjs`: `resolveD1Access(root)` (reads `d1_databases[].database_id` from the operator `wrangler.jsonc`, resolves account like `kv-rest.mjs`) and `makeD1Client(access)` with `query(sql, params)` / `exec(sql)` over the D1 REST endpoint (`/accounts/{acct}/d1/database/{dbid}/query`). Graceful `{ ok:false, reason }` when not provisioned.
- [ ] 4.2 Update `scripts/run-migrations.mjs`: resolve a D1 client (when available) and pass it as `d1` into `up({ kv, d1, dataRoot, log })`. A `null` `d1` (D1 not provisioned yet) is fine — slice-0 ships no `.mjs` migration that uses it. Keep the KV `migrations:applied` ledger unchanged.

## 5. Provisioning (merge + pin)

- [ ] 5.1 `scripts/merge-wrangler-config.mjs`: add `mergeD1Databases(codeD1, operatorD1)` (binding set from code; `database_id` from operator by binding else omitted; code ids stripped) and wire it into `mergeWranglerConfig` (`out.d1_databases = …`). Preserve `database_name`/`migrations_dir` from code.
- [ ] 5.2 Add `pinD1Ids(deployed, operator)` mirroring `pinKvIds`; generalize `kvIdsChanged` → `bindingIdsChanged(before, after)` covering both `kv_namespaces` and `d1_databases`. Update the `pin` CLI path to pin both.
- [ ] 5.3 Extend `tests/merge-wrangler-config.test.mjs`: D1 binding propagates from code; operator `database_id` is kept; code id is stripped; pin adds/updates D1 id; no-op when unchanged.

## 6. Deploy workflow

- [ ] 6.1 `.github/workflows/data-deploy.yml`: after the KV-id pin step, add **Apply D1 schema migrations** — `wrangler d1 migrations apply DB --remote` (via `cloudflare/wrangler-action`, `workingDirectory: _code`), running BEFORE the existing `run-migrations.mjs` step.
- [ ] 6.2 Update the pin step to also pin auto-provisioned D1 ids (it already runs `merge-wrangler-config.mjs pin`; once 5.2 lands, the same invocation covers D1).
- [ ] 6.3 Confirm `wrangler deploy` auto-provisions the id-less `DB` binding and writes `database_id` into `_code/wrangler.jsonc` for the pin step. If the pinned `wrangler-action` version does NOT, add a `wrangler d1 create grocery-mcp` step whose id feeds the pin (fallback noted in design).

## 7. Health

- [ ] 7.1 `src/health.ts`: add a D1 probe (`db(env).first("SELECT 1 AS ok")`); include its status in the `/health` payload so a misprovisioned/under-scoped D1 surfaces at `/health`, not at first tool call.

## 8. Docs

- [ ] 8.1 `docs/ARCHITECTURE.md`: add the three-tier boundary (GitHub = recipe markdown; D1 = domain data; KV = ephemeral infra) and D1's role; note the two-track migration pipeline.
- [ ] 8.2 `docs/SELF_HOSTING.md`: the `CLOUDFLARE_API_TOKEN` scope now includes **D1 edit**; a D1 database is auto-provisioned on first deploy and pinned back; no manual step.
- [ ] 8.3 `CONTRIBUTING.md`: local D1 (`wrangler d1 migrations apply DB --local`), and the rule of thumb — **schema change → `migrations/d1/*.sql`; data move → `migrations/*.mjs`**.
- [ ] 8.4 Note in the data-template repo's `wrangler.jsonc` (operator template) that it gains the id-less `DB` binding on next sync.

## 9. Verify

- [ ] 9.1 `npm run typecheck` + `npm test` green (new D1 binding types, merge tests, db.ts tests).
- [ ] 9.2 End-to-end on a scratch operator/Cloudflare account: deploy auto-provisions D1, `0001_init.sql` applies, the id pins back into the operator config, a redeploy reuses it, and `/health` reports D1 reachable.
