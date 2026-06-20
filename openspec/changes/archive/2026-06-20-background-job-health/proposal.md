## Why

The flyer warm (`warm-flyer-cache`) added the first **background process with no human in the loop**. Every other failure path surfaces to a person in-band — a tool throws and Claude.ai shows the user a structured error. A cron tick fails at 3am and nobody sees it. Cloudflare makes this worse: Cron Triggers have **no retries and no failure alerts**, and there are reports of triggers silently not firing at all (no logs, nothing). The keystone failure — *a process that has stopped emits nothing* — can only be caught from **outside** the Worker. We have rich `emit` (structured logs) but nothing on **detect** or **notify**, so a broken warm goes unnoticed until someone wonders why the flyer is empty.

## What Changes

- **NEW** A reusable **background-job health record** in KV (`health:job:<name>` → `{ ok, last_run_at, summary }`), written by each background job on every run. Tenant-data-free (counts, timestamps, error classes — never tenant identifiers).
- **NEW** A `/health` endpoint on the Worker's public (non-MCP) fetch path that aggregates all job records into one status payload (overall `ok`, each job's freshness/last-run/last-error). It is **token-gated** (a `HEALTH_TOKEN` secret) and serves **only aggregate** state. Because `fetch` is independent of `scheduled`, the endpoint stays answerable even when the cron is dead — so an external monitor catches a stopped cron via staleness.
- **CHANGE** The `scheduled()` handler **rethrows after logging** instead of swallowing the error, so Cloudflare's native Cron "Past Events" table reflects failures (today it always shows success).
- **Adopters:** the **flyer warm** and the inbound **email** handler each write their health record. The convention is built to absorb the next background job (e.g. per-tenant stockup warming) with no new endpoint or monitor wiring.
- **OPTIONAL (secret-gated)** When an `NTFY_URL` (+ optional `NTFY_TOKEN`) secret is set, a **failed** background job posts a short, tenant-clean alert to that ntfy topic — an independent "I broke" push that fires even if an external monitor is offline. Unset → no-op (graceful, like the rest of the system).
- **Operator wiring (docs, not code):** point an external monitor (Uptime Kuma, or any poller) at `/health` → assert `ok` + freshness → route to ntfy. Use the **Cloudflare Workers Observability MCP** as the debug-query layer (it queries the structured logs the warm already emits).

## Capabilities

### New Capabilities
- `background-job-health`: the `health:job:<name>` record convention, the token-gated aggregate `/health` endpoint, the requirement that scheduled handlers surface failures to the platform (rethrow), the registered adopters (flyer warm + email handler), and the optional secret-gated ntfy failure push.

### Modified Capabilities
<!-- None. The warm's and email handler's health-reporting behavior is a cross-cutting concern owned by the new background-job-health capability, so flyer-cache-warming and newsletter-discovery specs are left unchanged. -->

## Impact

- **Code**: new `src/health.ts` (record read/write + `/health` payload builder + the optional ntfy push); `src/index.ts` (add the token-gated `/health` route to the default handler; rethrow in `scheduled()`; write the email handler's health record in the `email()` wrapper); `src/flyer-warm.ts` (write the warm's health record on each tick — ok with a summary, or fail); `src/env.ts` (new optional secrets `HEALTH_TOKEN`, `NTFY_URL`, `NTFY_TOKEN`).
- **State**: new KV keys under `KROGER_KV` with a `health:` prefix (`health:job:flyer-warm`, `health:job:email`) — no new binding.
- **Config**: `wrangler.jsonc` comment documenting the new (optional) secrets; no new bindings or triggers.
- **Docs (same pass — no-drift rule)**: `docs/SELF_HOSTING.md` (wire a monitor → `/health` → ntfy; set `HEALTH_TOKEN`; optional `NTFY_URL`; the Cloudflare Observability MCP for debugging); `docs/ARCHITECTURE.md` (the background-job health convention, the alerting-agnostic-Worker stance, why `/health` lives on the fetch path); `docs/SCHEMAS.md` (the `health:job:<name>` record shape and the `/health` response shape).
- **Security/privacy**: `/health` exposes only aggregate operational state and is token-gated; health records and ntfy messages are tenant-data-free by construction.
- **Non-goals**: shipping Worker logs to a third-party store; a metrics/dashboard pipeline (Analytics Engine); per-failure instant paging beyond the optional ntfy push; monitoring the synchronous MCP tool surface (those already fail in-band to the user).
