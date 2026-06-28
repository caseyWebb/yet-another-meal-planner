# background-job-health Specification

## Purpose
TBD - created by archiving change background-job-health. Update Purpose after archive.
## Requirements
### Requirement: Background-job health records

Each background process (a cron-`scheduled` job or the inbound `email` handler) SHALL persist a health record in KV at `health:job:<name>` on every run, of the shape `{ ok: boolean, last_run_at: number, summary: object }`. `ok` reflects whether the run succeeded; `last_run_at` is epoch ms; `summary` carries small operational detail (counts, durations, error classes). Records SHALL be **tenant-data-free** — no usernames, tenant ids, or other per-tenant identifiers may appear in any field. The record SHALL live under the existing `KROGER_KV` namespace with a `health:` prefix (no new binding).

#### Scenario: A job writes its health record on each run

- **WHEN** a background job completes a run (successfully or with failure)
- **THEN** it writes `health:job:<name>` with `ok`, a fresh `last_run_at`, and a tenant-data-free `summary`

#### Scenario: Records never carry tenant data

- **WHEN** a job records a failure caused by a specific tenant's input
- **THEN** the `summary` records only the error class and counts, never the tenant id or other per-tenant identifiers

### Requirement: Aggregate health endpoint

The Worker SHALL serve a `/health` endpoint on its public (non-MCP) fetch path that aggregates all `health:job:<name>` records into one response reporting an overall `ok` and, per job, its `ok`, `last_run_at`, and a freshness/last-error summary. Because the `fetch` path is independent of the `scheduled` path, `/health` SHALL remain answerable even when the cron is not firing, so a stopped job is detectable via stale `last_run_at` / freshness. The endpoint SHALL return **only aggregate** state — never per-tenant rows, and store identifiers SHALL be reported as counts rather than enumerated. A job that has never run SHALL be reported as such rather than omitted or treated as healthy.

The response SHALL additionally carry an `admin` posture section reporting the operator admin gate as booleans only: `access_configured` (both Access vars set), `email_allowlist` (an allowlist is configured), `dev_bypass_set` (the dev bypass flag is present), and `exposed`. The `admin` section SHALL NOT include the allowlisted email addresses themselves — only whether an allowlist is configured. `exposed` SHALL be `true` when the dev bypass is enabled on a surface that Access does not protect (`ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` unset and `ADMIN_DEV_BYPASS` set) — the surface's only safeguard is then the loopback dev-guard, an alarm-worthy deployment misconfiguration — and SHALL be computed by the **same** gate-disposition helper the `/admin` gate uses, so the report cannot drift from the gate. When `exposed` is `true`, the overall `ok` SHALL be `false` (so `/health` returns `503`), in addition to the existing job-failure and D1-probe conditions.

#### Scenario: Endpoint aggregates job health

- **WHEN** an authorized request hits `/health`
- **THEN** the response reports an overall status plus each registered job's `ok`, `last_run_at`, and freshness, with no per-tenant data

#### Scenario: Stopped cron is visible via staleness

- **WHEN** the cron has not fired for longer than its expected interval (so no fresh records are written)
- **THEN** `/health` still responds (served by the independent fetch path) and reports the job's stale `last_run_at`, letting an external monitor detect the outage

#### Scenario: A job that has never run is reported as such

- **WHEN** `/health` is queried before a job's first run (cold cache)
- **THEN** that job is reported as not-yet-run rather than omitted or reported healthy

#### Scenario: Endpoint reports admin gate posture

- **WHEN** a request hits `/health`
- **THEN** the response includes an `admin` section with the booleans `access_configured`, `email_allowlist`, `dev_bypass_set`, and `exposed`, and no allowlisted email addresses

#### Scenario: An exposed admin gate degrades overall health

- **WHEN** the dev bypass is enabled on a surface Access does not protect, so its only safeguard is the loopback dev-guard (`exposed: true`)
- **THEN** overall `ok` is `false` and `/health` returns `503`

### Requirement: Scheduled handlers surface failures to the platform

A `scheduled` handler SHALL log a failed run AND rethrow it, so that the run is recorded as a failure by the platform's native cron status (rather than being swallowed and reported as success). Because cron runs are not retried, rethrowing loses no work.

#### Scenario: A failed tick is recorded as a failure

- **WHEN** a scheduled tick throws
- **THEN** the handler logs the error and rethrows it, so the platform's cron run status reflects the failure rather than success

### Requirement: Registered background jobs report health

The flyer warm and the inbound email handler SHALL each write their `health:job:<name>` record, so both current background processes are covered by `/health`. The flyer warm's record SHALL additionally carry the freshness signal a monitor asserts on (the last sweep's completion time — when the rollups were last refreshed).

#### Scenario: The flyer warm reports health

- **WHEN** a warm tick runs
- **THEN** it writes `health:job:flyer-warm` with `ok`, `last_run_at`, and a summary including sweep freshness (last completion time) and the run's error count

#### Scenario: The email handler reports health

- **WHEN** the inbound `email` handler processes a message
- **THEN** it writes `health:job:email` with `ok`, `last_run_at`, and a tenant-data-free summary

### Requirement: Optional secret-gated failure notification

When an `NTFY_URL` secret (and optional `NTFY_TOKEN`) is configured, a background job that **fails** SHALL post a short, tenant-data-free alert to that ntfy topic — an independent failure push that does not depend on any external monitor. When `NTFY_URL` is **unset**, no notification SHALL be attempted and the job SHALL proceed unaffected (graceful degradation). A notification attempt that itself fails SHALL NOT change the job's own outcome.

#### Scenario: Failure posts an ntfy alert when configured

- **WHEN** a background job fails and `NTFY_URL` is configured
- **THEN** a short tenant-data-free alert is posted to the ntfy topic (authenticated with `NTFY_TOKEN` when set)

#### Scenario: No notification configured degrades gracefully

- **WHEN** a background job fails and `NTFY_URL` is unset
- **THEN** no notification is attempted and the job proceeds exactly as before

#### Scenario: A failing notification does not affect the job

- **WHEN** posting the ntfy alert itself errors
- **THEN** the failure is swallowed and the job's own success/failure outcome is unchanged

### Requirement: Health endpoint is unauthenticated and safe to expose

`/health` SHALL be served without any Worker-enforced authentication, and its response SHALL be safe to expose publicly: tenant-data-free (no usernames, tenant ids, or other per-tenant identifiers) and free of raw internal error strings. In particular, the D1 reachability probe SHALL report a boolean reachability status, not the raw `storage_error` message. The `admin` posture section SHALL be safe under the same rules: it carries only booleans (gate configuration plus the `exposed` flag), never the allowlisted email addresses or any per-tenant identifier; `exposed` participates in the existing `200`-when-ok / `503`-when-failing split. Restricting who may read `/health` SHALL be an **edge** concern (e.g. Cloudflare Access or a WAF rule) requiring no Worker code; the Worker SHALL NOT carry a `HEALTH_TOKEN` or equivalent application secret for `/health`. The endpoint SHALL keep its aggregate shape, its independence from the `scheduled` path, and its `200`-when-ok / `503`-when-failing status split.

#### Scenario: Endpoint is reachable without a token

- **WHEN** a request hits `/health` with no credentials
- **THEN** the Worker returns the aggregate health payload (`200` when ok, `503` when a job is failing or the admin gate is exposed), with no token required

#### Scenario: Response carries no raw internal error strings

- **WHEN** the D1 reachability probe fails
- **THEN** `/health` reports D1 as not-ok via a boolean status and does not include the raw `storage_error` message or any per-tenant identifier

#### Scenario: Posture section carries no email addresses

- **WHEN** `ACCESS_ALLOWED_EMAILS` is configured and `/health` is requested
- **THEN** the `admin` section reports `email_allowlist: true` and does not include any of the allowlisted addresses

#### Scenario: Restricting reads is an edge choice, not Worker code

- **WHEN** an operator wants `/health` reachable only by themselves or a monitor
- **THEN** they place a Cloudflare Access app or WAF rule in front of `/health` at the edge, and the Worker requires no change and carries no health secret

### Requirement: Health badge SVG variant

The Worker SHALL serve a `/health.svg` variant on the same public fetch path as `/health`, rendering the **same aggregate health payload** into an SVG **card** image. Like `/health` it SHALL be **open** — served without any Worker-enforced authentication and carrying no `HEALTH_TOKEN` or other application secret — so the badge is anonymously fetchable, as a public README badge must be (image proxies fetch it with no credential, and there is no secret to leak into a README).

Unlike `/health` (which returns `200` healthy / `503` degraded), `/health.svg` SHALL return HTTP **`200` in all health states** and encode healthy-vs-degraded **visually by color**, because image proxies may not render a non-`200` response as an image. It SHALL set `content-type: image/svg+xml` and a short cache lifetime so an embedding README refreshes the badge on a TTL rather than live.

The rendered SVG SHALL be **tenant-data-free**, derived only from the aggregate payload — each registered job's `ok`/never-run state and `last_run_at`, the D1 probe, and the `admin` posture booleans — and SHALL NOT contain any per-tenant identifier or any allowlisted email address. The card SHALL render every registered job row, the D1 row, and an **`admin`** row that reflects the gate posture: a healthy style when Access is configured (`gated`), a distinct disabled style when the surface is unconfigured (safe `404`), a dev style for a loopback bypass, and a **failing** style when the gate is `exposed`. When the gate is `exposed`, the card's headline SHALL render degraded, consistent with `/health` overall `ok`. The card SHALL make a **never-run** job visually distinct from both healthy and failing, so a fresh deploy with pending jobs does not read as broken.

#### Scenario: Open — reachable without a token

- **WHEN** a request hits `/health.svg` with no credentials
- **THEN** the variant responds `200` with the SVG card, requiring no token — the same open posture as `/health`

#### Scenario: Healthy state renders a 200 SVG

- **WHEN** all jobs are `ok`, the D1 probe succeeds, and the admin gate is not exposed
- **THEN** the response is `200` with `content-type: image/svg+xml` and a card showing each job, D1, and the `admin` row in a healthy style

#### Scenario: Degraded state still renders 200

- **WHEN** a registered job is failing, the D1 probe fails, or the admin gate is `exposed`
- **THEN** `/health.svg` still returns `200` (not `503`) and shows the degraded state by color

#### Scenario: The admin row reflects the gate posture

- **WHEN** the card renders
- **THEN** it includes an `admin` row showing the gate state (gated / disabled / dev / exposed), and an `exposed` state renders the row and headline in the failing style

#### Scenario: A never-run job is visually distinct

- **WHEN** a job has never run (no record yet) at the time `/health.svg` is requested
- **THEN** that job's row renders in a distinct pending style, neither healthy nor failing

#### Scenario: The card carries no tenant data

- **WHEN** the SVG card renders
- **THEN** it contains only aggregate state (job names, statuses, timestamps, D1 status, admin posture) and no usernames, tenant ids, or allowlisted email addresses

### Requirement: Workers AI quota exhaustion is an explicit health signal

When an AI-using background job reports Workers AI's daily-free-allocation exhaustion (error 4006 — "you have used up your daily free allocation of N neurons"), `/health` SHALL surface it as an **explicit, named** signal rather than only a generic job failure. The `/health` payload SHALL carry a tenant-clean boolean `ai_quota_exhausted`, computed by aggregating the registered jobs' own tenant-clean summaries — a job's explicit `quota_exhausted` flag, or a 4006-shaped `error` string. An exhausted state SHALL degrade overall `ok` (so `/health` returns 503). `/health.svg` SHALL render an explicit row naming the quota exhaustion (red), and the admin Status view SHALL render an explicit banner naming the cause and the remedy. The signal SHALL remain tenant-data-free (it is derived from already-tenant-clean job summaries; it carries no neuron count or identifier).

#### Scenario: A 4006 job error raises the explicit signal and degrades health

- **WHEN** an AI job's stored health summary carries a 4006 / "neurons" error string (e.g. the describe/embed reconcile failing on quota)
- **THEN** `/health` reports `ai_quota_exhausted: true`, returns 503, and `/health.svg` renders an explicit "quota exhausted" AI row

#### Scenario: A job's explicit quota flag raises the signal

- **WHEN** a job reports `quota_exhausted: true` in its summary (e.g. the classify pass, which catches the per-recipe quota error rather than crashing)
- **THEN** `/health` reports `ai_quota_exhausted: true`

#### Scenario: Healthy AI jobs do not raise the signal

- **WHEN** no registered job's summary indicates quota exhaustion
- **THEN** `/health` reports `ai_quota_exhausted: false` and the AI signal does not degrade `ok`

#### Scenario: The admin Status view names the cause

- **WHEN** the operator opens the admin Status view while `ai_quota_exhausted` is true
- **THEN** it renders an explicit "Workers AI quota exhausted" banner (not a generic degraded headline alone), naming the daily-reset / Workers-Paid remedy

