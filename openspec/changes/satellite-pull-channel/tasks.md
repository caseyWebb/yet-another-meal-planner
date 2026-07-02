## 1. Shared contract: task/result wire types (extension-open)

- [x] 1.1 In `packages/contract/src/` add the pull-channel wire types: a `TaskEnvelope` (`{ id, kind, scope: "operator"|"tenant", payload }`) as a discriminated union keyed by `kind` with **no concrete arm** (the seam for changes 3/4); a `ClaimRequest` (`{ capabilities: string[], max?: number }`) and `ClaimResponse` (`{ tasks: TaskEnvelope[] }`); a `ResultRequest` (`{ task_id, status: "done"|"failed", reason?, observations?: ObservationItem[] }`) reusing the change-1 observation union. Keep the channel's view of `payload` opaque.
- [x] 1.2 Export the new symbols from `packages/contract/src/index.ts` alongside the existing ingest/observation types; keep the result/error taxonomy (`accepted|deduped|rejected`, `bad_payload|bad_key`, add `not_found` for an unknown `task_id`) consistent.
- [x] 1.3 Add contract tests: a task envelope round-trips; a result request with observations validates; an unknown `kind` and an unknown `task_id` path are handled; adding a hypothetical new `kind` does not break a consumer of the current set.

## 2. D1: queue table + key tenant column

- [x] 2.1 Add migration `packages/worker/migrations/d1/00NN_satellite_pull_channel.sql` (next free number after the current highest, e.g. `0037`): `CREATE TABLE satellite_tasks (id, kind, scope, tenant, dedup_key, payload, status DEFAULT 'pending', claimed_by, claimed_at, lease_expires_at, attempts DEFAULT 0, max_attempts DEFAULT 3, last_error, created_at, updated_at)`; index `(status, scope, tenant, kind, created_at)` for the claim scan; **partial unique** index on `dedup_key WHERE status IN ('pending','claimed')` for idempotent enqueue.
- [x] 2.2 In the same migration, `ALTER TABLE ingest_keys ADD COLUMN tenant TEXT` (nullable; existing rows read as operator-global — no backfill, confirmed by the zero-row production spike).
- [x] 2.3 Add `src/db.ts` prepared-statement helpers for the queue (never a direct `env.DB` touch, structured errors only): `enqueueTask` (idempotent per `dedup_key`), the atomic `claimTasks` (conditional `UPDATE … RETURNING` selecting pending-or-lease-expired rows filtered by scope × declared kinds, bumping `attempts` and stamping owner/lease), `completeTask`/`failTask` (idempotent terminal transition + attempt-cap parking), and `getTask`.
- [x] 2.4 Extend the ingest-key helpers to read/write the `tenant` binding (mint with optional tenant; roster read surfaces it); resolve a mint-time binding against the allowlist and reject a non-allowlisted target.

## 3. Worker: pull-channel endpoints

- [x] 3.1 Add `POST /satellite/tasks/claim` in `src/` (routed as a top-level `/satellite/*` path, outside `/admin*` so the Access gate never applies): authenticate the ingest key by SHA-256 hash lookup (reuse the ingest-key auth + rate limit), derive the key's scope from its tenant binding, atomically claim via `claimTasks`, return `{ tasks }`. An unknown/revoked key → `401`, nothing claimed.
- [x] 3.2 Add `POST /satellite/results`: authenticate the key, load the task by `task_id` (unknown → structured `not_found`), on `status: "done"` run the observations through the **shared** raw-observation intake used by `/admin/api/ingest` (extract that persistence/dedup/per-item-validation into a shared helper, not a re-implementation) then `completeTask`; on `status: "failed"` `failTask` with the reason (attempt-cap parking). Make both transitions idempotent (safe under double-run + late report).
- [x] 3.3 Confirm `POST /admin/api/ingest` is unchanged and still dispatched before the `/admin` Access gate as the exact-path key-authed exemption; add only a route comment noting the sibling `/satellite/*` pull channel.
- [x] 3.4 Enforce the scope rule in the claim path: operator-global key → operator-scope tasks only; tenant-bound key → operator-scope + own-tenant tasks; never another tenant's. Filter by the claim's declared `capabilities`.

## 4. Admin panel: tenant-binding selector on Mint

- [ ] 4.1 Route the Ingest Keys editor Mint-dialog change through the companion Claude Design project (per repo rules); take its exported bundle as the basis for the Basecoat markup. *(Not performed — the companion Claude Design project is not reachable from this implementation environment. The mint dialog's tenant-binding control was added directly in the existing Basecoat idiom — a labelled `<select class="input">` matching email-sources.tsx — and should be routed through the design project on the next design-touching pass. Flagged for review.)*
- [x] 4.2 Update the Ingest Keys editor island + its mint route: add the optional bind-to-tenant control (default operator-global, options = allowlisted members), surface each key's binding in the roster table; keep the shown-once secret flow. Validate the binding server-side against the allowlist.
- [x] 4.3 Extend the Playwright coverage under `admin/visual/` (page object + spec + seed a bound + an unbound key) and run `aubr test:admin` (web sessions: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`); surface the per-area screenshots for review.

## 5. Tests (Worker)

- [x] 5.1 Queue lifecycle tests: enqueue→claim→done; enqueue→claim→fail→re-claim→attempt-cap park; idempotent enqueue (no second in-flight row per `dedup_key`; terminal key re-enqueuable).
- [x] 5.2 Claim atomicity + graceful degradation: two concurrent claims don't double-acquire; an expired lease is re-claimable; a dropped satellite leaves work pending with no Worker-initiated recovery.
- [x] 5.3 Scope tests: operator-global key claims only operator-scope; tenant-bound key claims own-tenant + operator-scope, never another tenant's; claim filtered by declared capabilities.
- [x] 5.4 Results idempotency: a double-run + late report dedups via the shared raw-observation intake and the terminal transition is a safe no-op; unknown `task_id` → `not_found`.
- [x] 5.5 Auth: `/satellite/*` rejects unknown/revoked keys `401`; is served without an Access assertion (outside `/admin*`); is rate-limited like the ingest route.

## 6. Docs in lockstep

- [x] 6.1 `docs/SCHEMAS.md`: document the `satellite_tasks` table (columns, indexes, the partial-unique enqueue index, the lifecycle states), the additive `ingest_keys.tenant` column, and the claim/result wire shapes (task envelope discriminated union, `ClaimRequest`/`ClaimResponse`, `ResultRequest`).
- [x] 6.2 `docs/ARCHITECTURE.md`: add the pull channel beside the push ingest arm and the flyer warm — the satellite-initiated claim, the claim/lease lifecycle, the two key-derived scopes, why correctness rests on result-side dedup not the lease, and how outbound-only is preserved (no Worker push, no websocket/DO).
- [x] 6.3 `docs/SELF_HOSTING.md`: note minting a **tenant-bound** ingest key for a per-tenant satellite vs an operator-global key, and that `/satellite/*` is key-authed and outbound-only (no inbound port).
- [x] 6.4 `docs/TOOLS.md`: confirm unchanged (no MCP tool touched); adjust only incidental prose if needed.

## 7. Verification

- [x] 7.1 `aubr typecheck` + `aubr test` + `aubr test:tooling` green; the contract and worker suites cover the new channel.
- [ ] 7.2 If `--remote` D1 is applied, verify the migration applies cleanly against production (zero-row `ingest_keys`/`satellite_tasks`) and existing keys read as operator-global. *(Deferred to the deploy — no `--remote` apply from this environment; the migration was applied `--local` and against a full node:sqlite migration replay to sanity-check the SQL.)*
- [x] 7.3 `openspec validate "satellite-pull-channel" --strict` passes; run `/code-review` on the diff before opening a PR. *(Validate passes; `/code-review` is the orchestrator's step before the PR.)*
