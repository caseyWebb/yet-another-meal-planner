## 1. Binding + env

- [x] 1.1 Add an id-less `d1_databases` entry to `wrangler.jsonc`: `{ "binding": "DB", "database_name": "grocery-mcp", "migrations_dir": "migrations/d1" }` (no `database_id` — auto-provisioned). Update the KV/binding comment block to mention D1's role (domain data).
- [x] 1.2 Add `DB: D1Database` to `Env` in `src/env.ts` with a doc comment: holds domain/operational data per `cloudflare-storage-architecture`; KV is now ephemeral infra only.

## 2. Data-access layer

- [x] 2.1 Add `src/db.ts`: `db(env)` returning `{ first<T>, all<T>, run, batch }` over `env.DB` prepared statements. Map D1 exceptions to a structured `ToolError` (add a `storage_error` code to `src/errors.ts` if none fits); never throw raw. (Also exposes `prepare` so `batch` callers build statements.)
- [x] 2.2 Document the `INSERT … ON CONFLICT … DO UPDATE` upsert idiom in a comment; add no bespoke upsert helper yet (keep thin).
- [x] 2.3 Unit-test `src/db.ts` — NOTE: the vitest harness runs in the default node env (no `@cloudflare/vitest-pool-workers`/miniflare pool — `vitest.config.ts` has no workers pool, and adding one is out of scope for slice 0), so there is no real D1 binding to bind. `test/db.test.ts` exercises the full wrapper contract (bind threading, result shaping, structured-error mapping) against a fake `D1Database` mirroring the workers-types surface. A live D1 round-trip is covered by the deploy-time `/health` probe (task 7.1), not unit-testable here.

## 3. Schema migration pipeline (native)

- [x] 3.1 Create `migrations/d1/0001_init.sql`: `CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT);`. No domain tables.
- [x] 3.2 Documented `wrangler d1 migrations apply DB --local` (local seed) and `--remote` (deploy form) in CONTRIBUTING.md, and that the `d1_migrations` tracking table is created automatically. NOTE: not run live — this sandbox has no Cloudflare account / wrangler login, so the actual apply (local or remote) is unverified.

## 4. Data-backfill pipeline (runner)

- [x] 4.1 Add `scripts/d1-rest.mjs`: `resolveD1Access(root)` (reads `d1_databases[].database_id` from the operator `wrangler.jsonc`, resolves account like `kv-rest.mjs`) and `makeD1Client(access)` with `query(sql, params)` / `exec(sql)` over the D1 REST endpoint (`/accounts/{acct}/d1/database/{dbid}/query`). Graceful `{ ok:false, reason }` when not provisioned.
- [x] 4.2 Update `scripts/run-migrations.mjs`: resolve a D1 client (when available) and pass it as `d1` into `up({ kv, d1, dataRoot, log })`. A `null` `d1` (D1 not provisioned yet) is fine — slice-0 ships no `.mjs` migration that uses it. Keep the KV `migrations:applied` ledger unchanged.

## 5. Provisioning (merge + pin)

- [x] 5.1 `scripts/merge-wrangler-config.mjs`: add `mergeD1Databases(codeD1, operatorD1)` (binding set from code; `database_id` from operator by binding else omitted; code ids stripped) and wire it into `mergeWranglerConfig` (`out.d1_databases = …`). Preserve `database_name`/`migrations_dir` from code.
- [x] 5.2 Add `pinD1Ids(deployed, operator)` mirroring `pinKvIds`; generalize `kvIdsChanged` → `bindingIdsChanged(before, after)` covering both `kv_namespaces` and `d1_databases` (added `pinBindingIds` to pin both in one pass). Update the `pin` CLI path to pin both.
- [x] 5.3 Extend `tests/merge-wrangler-config.test.mjs`: D1 binding propagates from code; operator `database_id` is kept; code id is stripped; pin adds/updates D1 id; no-op when unchanged.

## 6. Deploy workflow

- [x] 6.1 `.github/workflows/data-deploy.yml`: after the KV-id pin step, add **Apply D1 schema migrations** — `wrangler d1 migrations apply DB --remote` (via `cloudflare/wrangler-action`, `workingDirectory: _code`), running BEFORE the existing `run-migrations.mjs` step.
- [x] 6.2 Update the pin step to also pin auto-provisioned D1 ids (it already runs `merge-wrangler-config.mjs pin`; the same invocation now covers D1 via `pinBindingIds`/`bindingIdsChanged`). Step renamed + commit message updated.
- [ ] 6.3 NOT VERIFIED LIVE — this sandbox has no Cloudflare account / wrangler login, so I cannot confirm `wrangler deploy` (pinned `wrangler-action` v4.0.0) auto-provisions the id-less `DB` binding and writes `database_id` into `_code/wrangler.jsonc` for the pin step. The workflow assumes KV-parity (documented as a primary risk in design.md). If a future operator deploy shows D1 is NOT auto-provisioned in place, the fallback is an explicit `wrangler d1 create grocery-mcp` step feeding the pin (noted in design). Left unchecked pending a live deploy.

## 7. Health

- [x] 7.1 `src/health.ts`: add a D1 probe (`db(env).first("SELECT 1 AS ok")`); include its status in the `/health` payload so a misprovisioned/under-scoped D1 surfaces at `/health`, not at first tool call. (`probeD1(env)` → `{ ok, error? }`; folded into `buildHealthPayload`, which now takes `env`; a failed probe flips overall `ok` → 503.)

## 8. Docs

- [x] 8.1 `docs/ARCHITECTURE.md`: add the three-tier boundary (GitHub = recipe markdown; D1 = domain data; KV = ephemeral infra) and D1's role; note the two-track migration pipeline.
- [x] 8.2 `docs/SELF_HOSTING.md`: the `CLOUDFLARE_API_TOKEN` scope now includes **D1 edit**; a D1 database is auto-provisioned on first deploy and pinned back; no manual step.
- [x] 8.3 `CONTRIBUTING.md`: local D1 (`wrangler d1 migrations apply DB --local`), and the rule of thumb — **schema change → `migrations/d1/*.sql`; data move → `migrations/*.mjs`**.
- [x] 8.4 Documented in CONTRIBUTING.md (template-sync note): the `DB` binding propagates to operators via the merge regardless of template version; the separate data-template repo's own `wrangler.jsonc` should gain the id-less `DB` entry on its next sync. NOTE: the actual template edit lands in the external `groceries-agent-data-template` repo (a git submodule, not checked out / not owned here), so it is out of this change's commit scope.

## 9. Verify

- [x] 9.1 `npm run typecheck` + `npm test` green (new D1 binding types, merge tests, db.ts tests). Also `npm run test:tooling` green (107 pass). See report.
- [ ] 9.2 NOT VERIFIED LIVE — this sandbox has no Cloudflare account / wrangler login, so I cannot run the end-to-end deploy (auto-provision → `0001_init.sql` apply → id pin-back → redeploy reuse → `/health` D1 reachable). The code, workflow, and provisioning logic are implemented and unit-tested; the live deploy must be run on a scratch operator/Cloudflare account by an operator. Left unchecked.
