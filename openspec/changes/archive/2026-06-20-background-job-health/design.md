## Context

`warm-flyer-cache` introduced a `scheduled()` cron with **no in-band consumer of failure**. The rest of the system gets observability for free: a tool throws → Claude.ai renders a structured error → the user reacts. A cron has no user attached, and the platform won't fill the gap — Cloudflare Cron Triggers have **no retries and no native failure alerts**, only a short-retention dashboard table, and triggers have been reported silently not firing with nothing in logs. So the warm can break in ways nobody learns about until the flyer is mysteriously empty.

Today's `scheduled()` handler also **swallows** the error (try/catch, no rethrow), which means Cloudflare records every tick as *success* — hiding failures from the one native signal that exists.

The system already has the muscles this needs: KV for small operational state, a public fetch path separate from the cron, a structured-log convention, and `createIssue`/email precedents for outbound reporting. This change adds the **detect** and **notify** layers on top of the **emit** layer that already exists, as a reusable convention (the warm is the first of several background jobs).

## Goals / Non-Goals

**Goals:**
- Make a stopped or failing background job **detectable from outside** the Worker.
- A reusable health convention that the warm, the email handler, and future crons all ride — one endpoint, one monitor.
- Keep the Worker's role to *emitting truthful state*; let *what's alarming* and *who to notify* live in ops tooling.
- Free-tier and self-host friendly; every alerting hop is optional and degrades gracefully when unconfigured.

**Non-Goals:**
- Shipping Worker logs to a third-party store, or a metrics/dashboard pipeline (Analytics Engine).
- Monitoring the synchronous MCP tool surface — those already fail in-band to the user.
- A bespoke incident-management system. The endpoint + an external monitor + ntfy is the whole loop.

## Decisions

### 1. Monitor the outcome, on the fetch path — not a heartbeat from the cron

`/health` reads the state the jobs already persist (the warm's cursor `last_refresh_at`/`done`, each rollup's `as_of`, and each job's `health:job:<name>` record) and answers *"is each background job fresh and healthy right now?"* An external monitor polls it and alerts on `ok == false` or staleness.

- **vs. a dead-man's-switch heartbeat (the cron pings healthchecks.io):** a heartbeat monitors the *mechanism* ("did a tick ping") — it can stay green while the output is broken (a sweep "completes" but every unit errored). `/health` monitors the *outcome* ("is the data actually fresh"), catching every cause — dead cron, wedged sweep, KV-write failure, upstream down — through **one lens**. And because `fetch` is independent of `scheduled`, the endpoint stays answerable when the cron is dead, so staleness still surfaces.
- **vs. the Worker pushing alerts itself as the spine:** keeping the Worker to *emit state only* (decision rationale: alerting-agnostic) means *what counts as alarming* and *who to notify* live entirely in the external monitor — no alerting choices baked into the deployed code, and self-hosters opt in by pointing a monitor at the endpoint. (An optional Worker push is added in §5 as a *backstop*, not the spine.)

### 2. A reusable `health:job:<name>` record, not a warm-specific hack

Each background job writes one KV record per run: `{ ok: boolean, last_run_at: number, summary: object }` at `health:job:<name>` (e.g. `health:job:flyer-warm`, `health:job:email`). `/health` lists them. Adding a future job (per-tenant stockup warm) means writing one record — the endpoint and the monitor cover it automatically. The `summary` is small and **tenant-data-free** by construction (counts, durations, error classes — never tenant ids). The warm's record additionally carries the freshness signal the monitor asserts on (last sweep completion + oldest rollup `as_of`).

### 3. `/health` is token-gated and aggregate-only

The endpoint lives on the **default (non-MCP) handler** alongside `GET /`. It requires a `HEALTH_TOKEN` secret (query param or header); when the secret is **unset the endpoint is disabled (404)** — safe by default, opt-in. It returns **only aggregate** operational state — never per-tenant rows. `locationId`s (store ids, low-sensitivity) are reported as counts, not enumerated. This keeps the new inbound surface from leaking either tenant data or a publicly-readable map of internal cadence/health.

### 4. Rethrow in `scheduled()` so the native signal is honest

The handler logs the error **and rethrows** (cron has no retries, so nothing is lost by letting it propagate). Cloudflare then records the tick as a failure in its Cron "Past Events" table — a free, zero-config second signal alongside `/health`. This is a one-line honesty fix to behavior shipped in `warm-flyer-cache`.

### 5. Optional, secret-gated ntfy push — the independent backstop ("one topic, two producers")

ntfy is just an authenticated POST to a topic. When `NTFY_URL` (+ optional `NTFY_TOKEN`) is configured, a background job that *fails* posts a short tenant-clean message. This is the **second producer** into the user's ntfy topic — the first being the external monitor (`/health` → ntfy). It exists because the recommended monitor (a self-hosted Uptime Kuma) shares a failure domain with the operator's homelab; a Worker-side push fires from Cloudflare's edge even when that monitor is offline. **Optional by design:** unset → no push, same graceful degradation as absent `flyer_terms.toml`.

### 6. Operator wiring (documented, not coded): Kuma → `/health` → ntfy; Cloudflare MCP for debug

- **Detect/notify:** point an external poller (Uptime Kuma recommended — the operator likely already runs one; any URL monitor with a webhook works) at `/health`, assert `ok` + freshness, route to ntfy (Kuma has native ntfy).
- **Debug:** the rich signal — the warm's structured sweep/error lines — already lives in **Cloudflare Workers Logs**. The **Cloudflare Workers Observability MCP** queries exactly that (logs, errors, invocation stats) with built-in OAuth, so an agent can diagnose a failure against the real data without shipping logs anywhere. This is why the design does *not* centralize logs in a third-party store (a `non-goal`).

## Risks / Trade-offs

- **New inbound surface (`/health`)** → contained: token-gated (404 when the secret is unset), aggregate-only, tenant-data-free.
- **Self-hosted monitor shares a failure domain with the homelab** (homelab down → blind) → mitigated by the optional Worker→ntfy push (§5), which is failure-domain-independent.
- **Detection latency** is the monitor's poll interval (minutes) plus the freshness threshold (~a day for a daily flyer) → fine for this workload; the optional push gives instant "broke" alerts when configured.
- **A health record write is one extra KV write per job run** → negligible against the free 1000/day budget (a few per day).
- **`summary` could accidentally carry tenant data** if a future adopter is careless → the convention and a review note constrain it to counts/timestamps/error-classes; `/health` and ntfy inherit the same rule.

## Migration Plan

1. Land `src/health.ts`, the `/health` route, the rethrow, and the warm + email adopters together.
2. No data migration: `health:job:*` keys are written on first run; `/health` reports "never run" until then. All new secrets are optional — unset means `/health` is disabled and no ntfy push, i.e. behavior is unchanged until the operator opts in.
3. Operator sets `HEALTH_TOKEN` (to enable `/health`) and optionally `NTFY_URL`, then wires the monitor — documented in `SELF_HOSTING.md`. Deploy stays operator-run from the data repo.
4. **Rollback:** revert; the `health:*` keys become inert and `/health` 404s.

## Open Questions

None blocking. Tunables to settle in implementation: the staleness threshold the monitor asserts (suggest ~2× the refresh interval), and whether `/health` takes the token via query param vs header (suggest support both; query param is what URL-pollers handle most easily).
