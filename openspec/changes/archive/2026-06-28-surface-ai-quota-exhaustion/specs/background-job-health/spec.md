## ADDED Requirements

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
