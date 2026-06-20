## 1. Health record convention

- [ ] 1.1 Create `src/health.ts`: define the `JobHealth` record type (`{ ok, last_run_at, summary }`) and `writeJobHealth(kv, name, health)` / `readJobHealth(kv, name)` helpers over `health:job:<name>` in `KROGER_KV` (reuse the `KvStore` interface). Keep `summary` typed loosely but documented as tenant-data-free.
- [ ] 1.2 Add `buildHealthPayload(kv, jobNames[])` that reads all registered job records and returns the aggregate `{ ok, jobs: [...] }` shape, marking a missing record as "never run", and computing overall `ok` from the jobs.

## 2. `/health` endpoint

- [ ] 2.1 Add `HEALTH_TOKEN` (optional secret) to `src/env.ts`.
- [ ] 2.2 Add the `/health` route to the default handler in `src/index.ts`: 404 when `HEALTH_TOKEN` is unset; 401 on missing/wrong token (accept query param `?token=` or header); else return `buildHealthPayload(...)` as JSON. Aggregate-only, no per-tenant data.

## 3. Honest cron status

- [ ] 3.1 In `src/index.ts` `scheduled()`, log the error AND **rethrow** so the platform records the tick as a failure (remove the swallow).

## 4. Adopters write health records

- [ ] 4.1 Flyer warm: in `src/flyer-warm.ts`, write `health:job:flyer-warm` on each tick — `ok` true on a clean tick / false on a thrown tick, `summary` carrying the freshness signal (last sweep completion + oldest rollup `as_of`) and the run's error count. (Surface enough that a monitor can assert freshness.)
- [ ] 4.2 Email handler: in the `email()` wrapper in `src/index.ts`, write `health:job:email` after `handleInboundEmail` — `ok` reflecting success/failure, tenant-data-free `summary`.

## 5. Optional ntfy failure push

- [ ] 5.1 Add optional secrets `NTFY_URL` + `NTFY_TOKEN` to `src/env.ts`.
- [ ] 5.2 Add `notifyFailure(env, name, message)` to `src/health.ts`: when `NTFY_URL` is set, POST a short tenant-clean message (Bearer `NTFY_TOKEN` when set); when unset, no-op; swallow any error from the POST so it never changes the job's outcome.
- [ ] 5.3 Wire `notifyFailure` into the warm's failure path (in `scheduled()` around the rethrow, or where the tick failure is caught) and the email handler's failure path.

## 6. Tests

- [ ] 6.1 `src/health.ts`: round-trip `writeJobHealth`/`readJobHealth`; `buildHealthPayload` aggregates, marks never-run, and computes overall `ok` (with a fake KV).
- [ ] 6.2 `/health` route: 404 when `HEALTH_TOKEN` unset, 401 on wrong token, 200 + aggregate JSON with the right token; assert no per-tenant fields present.
- [ ] 6.3 `scheduled()` rethrow: a throwing tick causes the handler promise to reject (not resolve), while still logging.
- [ ] 6.4 `notifyFailure`: posts when `NTFY_URL` set (assert URL + auth header via a fake fetch), no-ops when unset, and a fetch error does not propagate.
- [ ] 6.5 Warm adopter: a tick writes `health:job:flyer-warm` with the freshness summary (extend the existing `flyer-warm` test harness).

## 7. Docs (same pass — no drift)

- [ ] 7.1 `docs/SCHEMAS.md`: document the `health:job:<name>` KV record shape and the `/health` response shape (next to the existing "Warmed flyer cache (KV)" section).
- [ ] 7.2 `docs/ARCHITECTURE.md`: add the background-job health convention — `/health` on the fetch path (independent of `scheduled`, so it survives cron-death), the alerting-agnostic-Worker stance, and the optional ntfy backstop.
- [ ] 7.3 `docs/SELF_HOSTING.md`: operator wiring — set `HEALTH_TOKEN`; point a monitor (Uptime Kuma recommended) at `/health`, assert `ok` + freshness, route to ntfy; optional `NTFY_URL`/`NTFY_TOKEN` for the Worker-side backstop; the Cloudflare Workers Observability MCP as the debug-query layer.
- [ ] 7.4 `wrangler.jsonc`: comment the new optional secrets (`HEALTH_TOKEN`, `NTFY_URL`, `NTFY_TOKEN`).

## 8. Ship

- [ ] 8.1 `npm run typecheck` + full `npm test` + `npm run test:tooling` green; `wrangler deploy --dry-run` bundles.
- [ ] 8.2 After merge, operator sets `HEALTH_TOKEN` (+ optional `NTFY_URL`), wires the monitor → ntfy, and confirms `/health` reports the warm + email jobs.
