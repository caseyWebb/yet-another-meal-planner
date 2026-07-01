## ADDED Requirements

### Requirement: Background-job run-history records

In addition to the last-state `job_health` row, each background process (a cron-`scheduled` job or the inbound `email` handler) SHALL **append** a per-run history record to a D1 `job_runs` table on every run, of the shape `{ id, job, ok: boolean, ran_at: number, duration_ms: number, summary: object }`. `id` is a stable per-run identifier (so a specific run can be linked to); `ran_at` is epoch ms; `duration_ms` is the run's wall-clock duration; `summary` carries the same tenant-data-free operational detail as the `job_health` record. Records SHALL be **tenant-data-free** — no usernames, tenant ids, or other per-tenant identifiers in any field — and SHALL be written **through `src/db.ts`** (a storage failure is a structured `storage_error`, never a raw throw). Appending a run record SHALL NOT block or fail the job: a history-write failure SHALL degrade to a no-op, exactly as the existing health write does on a storage error.

The `job_runs` table SHALL be **bounded** so the history cannot grow without limit — retention is capped per job (a fixed maximum number of recent runs per job, older rows pruned), consistent with the other bounded operational tables. The history write SHALL go to D1, not KV (the same standing-write-load rationale as `job_health`).

A reader SHALL return, for a given job, the most recent runs **newest-first** (each as `{ id, ok, ran_at, duration_ms, summary }`), and SHALL derive the **current-streak start** — the `ran_at` of the earliest run in the unbroken run of the job's current `ok` value (the "healthy since" / "unhealthy since" instant). When D1 is unreachable, the reader SHALL degrade to an empty history rather than throwing out of the read path.

#### Scenario: A job appends a run record on each run

- **WHEN** a background job completes a run (successfully or with failure)
- **THEN** it appends a `job_runs` record with a stable `id`, `ok`, `ran_at`, `duration_ms`, and a tenant-data-free `summary`, through `src/db.ts`, in addition to upserting its `job_health` row

#### Scenario: Run history is bounded per job

- **WHEN** a job has accumulated more than the per-job retention cap of run records
- **THEN** the oldest records beyond the cap are pruned, so the table size stays bounded

#### Scenario: Run records never carry tenant data

- **WHEN** a run fails because of a specific tenant's input
- **THEN** the run record's `summary` carries only the error class and counts, never the tenant id or other per-tenant identifiers

#### Scenario: The reader derives the current-streak start

- **WHEN** a job's recent runs are read and its latest runs share the same `ok` value back to some point
- **THEN** the reader reports that streak's earliest `ran_at` as the current-state-since instant (the "healthy since" / "unhealthy since" time)

#### Scenario: A history-write failure does not fail the job

- **WHEN** appending a `job_runs` record hits a storage error
- **THEN** the write degrades to a no-op and the job's run is unaffected (mirroring the `job_health` write)
