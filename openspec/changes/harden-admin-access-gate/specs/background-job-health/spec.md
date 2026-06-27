## MODIFIED Requirements

### Requirement: Aggregate health endpoint

The Worker SHALL serve a `/health` endpoint on its public (non-MCP) fetch path that aggregates all `health:job:<name>` records into one response reporting an overall `ok` and, per job, its `ok`, `last_run_at`, and a freshness/last-error summary. Because the `fetch` path is independent of the `scheduled` path, `/health` SHALL remain answerable even when the cron is not firing, so a stopped job is detectable via stale `last_run_at` / freshness. The endpoint SHALL return **only aggregate** state — never per-tenant rows, and store identifiers SHALL be reported as counts rather than enumerated. A job that has never run SHALL be reported as such rather than omitted or treated as healthy.

The response SHALL additionally carry an `admin` posture section reporting the operator admin gate as booleans only: `access_configured` (both Access vars set), `email_allowlist` (an allowlist is configured), `dev_bypass_set` (the dev bypass flag is present), and `exposed`. The `admin` section SHALL NOT include the allowlisted email addresses themselves — only whether an allowlist is configured. `exposed` SHALL be `true` when a tokenless `/admin` request would be admitted in a deployed (non-loopback) context, and SHALL be computed by the **same** gate-disposition logic the `/admin` gate uses, so the report cannot drift from the gate. When `exposed` is `true`, the overall `ok` SHALL be `false` (so `/health` returns `503`), in addition to the existing job-failure and D1-probe conditions.

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

- **WHEN** the admin gate would admit a tokenless `/admin` request in a deployed (non-loopback) context (`exposed: true`)
- **THEN** overall `ok` is `false` and `/health` returns `503`

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
