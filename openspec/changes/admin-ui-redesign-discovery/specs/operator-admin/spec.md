## ADDED Requirements

### Requirement: Discovery area shows the candidate pipeline

The admin panel's **Discovery** area (`/admin/discovery`) SHALL render, server-rendered, the autonomous candidate pipeline (`discovery-sweep`): page-level stat tiles, a filter-pill row, and a paginated list of per-candidate cards — the area's sole content (replacing any placeholder body).

**Stat tiles** SHALL show: total **Candidates**, **Imported** count with its import rate (imported ÷ total, as a percentage), **Parked / failed** count (content `error` parks plus infrastructure `failed` rows), and the count **In retry queue** (rows with `next_retry_at` not null).

**Filter pills** SHALL be: All, Imported, Retrying, Parked, Failed, No match, Duplicate, Dietary, Deferred — each labelled with its current count; "Retrying" SHALL match every retryable row (`next_retry_at` not null) regardless of its `error`/`failed` split; the other pills SHALL match their corresponding `outcome` value (`imported`, `error` for Parked, `failed` for Failed, `no_match`, `duplicate`, `dietary_gated`, `deferred`). Selecting a pill SHALL filter the candidate list and reset to the first page. The filter and the page SHALL be expressed as route query parameters so each filter/page combination is independently navigable and deep-linkable.

Each **candidate card** SHALL show: the candidate's title, source (with an icon distinguishing a feed vs. an email source) and its relative discovery age, an outcome badge, a **7-stage progression track** (triage → acquire → classify → describe → dedup → match → import — the `discovery-sweep` pipeline's real stage order) rendered per the "Discovery candidate progression track" requirement, and a one-line plain-language summary of where/why the candidate stands (e.g. an import's member attribution, a duplicate's matched recipe, a park's specific reason, a dietary gate's restriction). A retryable candidate (outcome `error` or `failed` with `next_retry_at` not null) SHALL show its attempt count against the retry cap and a relative countdown to its next automatic retry; a terminal parked/failed candidate (attempt cap exhausted) SHALL show that it is terminal rather than a countdown. The list SHALL be paginated with a fixed page size.

Expanding a card SHALL reveal: a per-stage breakdown (each of the 7 stages marked passed / stopped here / not reached, with a short description of what that stage does) and the underlying `discovery_log` row rendered as key/value detail (via the shared `PrettyKV` kit primitive) — id, url, outcome, slug, attempts, the next-retry countdown, and the outcome's `detail` payload.

#### Scenario: Discovery area renders the pipeline view by default

- **WHEN** the operator opens `/admin/discovery`
- **THEN** the area renders the stat tiles, the filter-pill row, and the paginated candidate-card list — not a placeholder

#### Scenario: Stat tiles summarize the candidate pool

- **WHEN** the operator opens `/admin/discovery` with a mix of imported, parked, failed, and retryable candidates recorded
- **THEN** the stat tiles show the total candidate count, the imported count with its import-rate percentage, the combined parked/failed count, and the in-retry-queue count

#### Scenario: A filter pill narrows the candidate list

- **WHEN** the operator selects the "Duplicate" pill
- **THEN** only candidates with outcome `duplicate` render, the page resets to the first page, and the pill's count matches the rendered list's length

#### Scenario: The "Retrying" pill matches both parked and failed retryable rows

- **WHEN** the operator selects the "Retrying" pill with both `error`- and `failed`-outcome rows that have a pending `next_retry_at`
- **THEN** both rows render under that filter, regardless of their outcome split

#### Scenario: A candidate card shows its furthest stage and halt point

- **WHEN** a candidate's outcome is `no_match` with `detail.stage` of `"triage"`
- **THEN** its progression track shows no stage as passed and `triage` as the halt point, colored as a rejection

#### Scenario: An imported candidate shows all 7 stages passed

- **WHEN** a candidate's outcome is `imported`
- **THEN** its progression track shows all 7 stages as passed, with no halt-colored stop

#### Scenario: A retryable candidate shows its attempt count and retry countdown

- **WHEN** a candidate's outcome is `error` with `attempts` of 2 and a future `next_retry_at`
- **THEN** the card shows "attempt 2/5" (the configured retry cap) and a relative countdown to the next automatic retry

#### Scenario: A terminal parked candidate shows terminal, not a countdown

- **WHEN** a candidate's outcome is `error` with `attempts` at the retry cap and `next_retry_at` null
- **THEN** the card shows it is terminal (no further automatic retry), not a countdown

#### Scenario: Expanding a card shows the per-stage breakdown and the raw log row

- **WHEN** the operator expands a candidate card
- **THEN** the expanded detail shows each of the 7 stages marked passed / stopped here / not reached, and the underlying `discovery_log` row rendered as key/value detail

### Requirement: Discovery candidate progression track

The candidate-card progression track SHALL render the `discovery-sweep` pipeline's 7 stages, in order — **triage** (cheap taste pre-filter), **acquire** (fetch + parse), **classify** (env.AI classification), **describe** (description generation + embed), **dedup** (near-duplicate cosine), **match** (taste cosine + dietary gate + LLM confirm), **import** (assemble, validate, write) — as a connected horizontal sequence. Each stage prior to the candidate's halt point SHALL render as passed (a check mark). The halt-point stage SHALL render distinctly by outcome kind: an imported candidate's final stage (`import`) renders as passed, not halted; a rejection (`no_match`, `dietary_gated`, `rejected_source`, `duplicate`) renders its halt stage with a stop indicator; a park or infrastructure failure (`error`, `failed`) renders its halt stage with a failure indicator; a rate-cap deferral (`deferred`) renders its halt stage with a hold indicator. Every stage after the halt point SHALL render as not-yet-reached.

The halt stage for a candidate SHALL be derived from its stored `outcome` and `detail` (no schema change): `imported` halts at `import` (passed); `no_match` halts at `triage` when `detail.stage` is `"triage"`, otherwise at `match`; `dietary_gated` halts at `match`; `rejected_source` halts at `triage`; `duplicate` halts at `dedup`; `deferred` halts at `import` (held, not failed); `error` halts at `acquire` when `detail.reason` is one of the acquisition-park taxonomy (`unreachable`, `no_jsonld`, `not_a_recipe`, `incomplete`), at `classify` when `detail.reason` describes a classification failure, or at `import` when `detail.reason` describes an import-time failure; `failed` (an infrastructure failure) renders at `acquire` as a labeled approximation, since the pipeline's catch-all failure handler does not record which stage was active.

#### Scenario: A triage rejection shows no stages passed

- **WHEN** a candidate's outcome is `no_match` with `detail.stage` `"triage"`
- **THEN** the track shows `triage` as the halt point with zero prior stages passed

#### Scenario: A match-stage rejection shows triage and acquire through describe as passed

- **WHEN** a candidate's outcome is `dietary_gated`
- **THEN** the track shows `triage`, `acquire`, `classify`, `describe`, and `dedup` as passed, and `match` as the halt point

#### Scenario: An acquire-park shows only triage as passed

- **WHEN** a candidate's outcome is `error` with `detail.reason` `"unreachable"`
- **THEN** the track shows `triage` as passed and `acquire` as the halt point with a failure indicator

#### Scenario: A deferred candidate shows a hold, not a failure, at import

- **WHEN** a candidate's outcome is `deferred`
- **THEN** the track shows every stage through `match` as passed and `import` as a held (not failed) halt point

### Requirement: Operator retries a discovery candidate from the Discovery area

The Discovery area's candidate-card list SHALL provide, for each retryable candidate (outcome `error` or `failed` with a pending `next_retry_at`), a **Retry now** action invoking the existing single-row retry endpoint (`POST /admin/api/discovery/:id/retry`) and a **Delete** action invoking the existing delete endpoint (`DELETE /admin/api/discovery/:id`) — both per the "Operator retries or deletes a parked discovery row" requirement's unchanged contract. On a successful Retry or Delete the area SHALL reflect the resolved (or removed) candidate immediately. Each action SHALL be one-at-a-time per candidate (a card's actions are disabled while its request is in flight), modeled per the panel's data-modeling standard as one custom type distinct from the page's load state.

#### Scenario: Operator retries a parked candidate from its card

- **WHEN** the operator activates **Retry now** on a retryable candidate's card
- **THEN** the app POSTs `/admin/api/discovery/:id/retry`, and on success the card reflects the row's resolved outcome (e.g. its progression track now shows `imported`, or a fresh park with an advanced retry countdown)

#### Scenario: Operator deletes a candidate from its card

- **WHEN** the operator activates **Delete** on a candidate's card
- **THEN** the app sends `DELETE /admin/api/discovery/:id`, and on success that candidate no longer appears in the list

#### Scenario: A card's retry action is one-at-a-time

- **WHEN** a candidate's Retry request is already in flight
- **THEN** that candidate's Retry and Delete actions are disabled until the request resolves

## MODIFIED Requirements

### Requirement: Logs area with a left submenu and a detail dialog

The admin panel SHALL provide a top-level **Logs** area, server-rendered, whose default content (the bare `/admin/logs` route) is the all-cron-jobs run log: a filterable, paginated list of individual `job_runs` records across every registered background job. The Logs area SHALL NOT host a candidate-level Discovery destination — the per-candidate discovery pipeline is reached at the top-level **Discovery** area (`/admin/discovery`; see "Discovery area shows the candidate pipeline"), not under Logs. The legacy route `/admin/logs/discovery` SHALL redirect to `/admin/discovery` (preserving the link for any existing bookmark) rather than serving its own content. A `discovery-sweep` run entry's expanded detail SHALL link to `/admin/discovery` (not `/admin/logs/discovery`) for per-candidate detail, since the run's summary carries only sweep-tick counts, not individual candidates.

When an individual run-log entry expands to more than a row's worth of detail, it SHALL render inline (the summary key/value detail), not in a separate dialog.

#### Scenario: Logs area shows the all-jobs run log by default

- **WHEN** the operator opens `/admin/logs`
- **THEN** the area renders the all-jobs run log (entries across every registered background job, newest-first)

#### Scenario: The legacy Discovery log route redirects to the Discovery area

- **WHEN** the operator opens `/admin/logs/discovery` directly (or refreshes there)
- **THEN** the Worker redirects to `/admin/discovery`, which renders the candidate-pipeline view

#### Scenario: Entry detail expands inline for a run

- **WHEN** the operator expands a run-log entry on `/admin/logs`
- **THEN** its `job_health`-shaped summary (and, on failure, its error) renders inline beneath the entry, without a dialog

#### Scenario: A discovery-sweep run links to the Discovery area, not the legacy route

- **WHEN** the operator expands a `discovery-sweep` run entry
- **THEN** the expanded detail includes a link to `/admin/discovery` for per-candidate detail, not `/admin/logs/discovery`

#### Scenario: A new log source is added as a submenu destination

- **WHEN** a future log source is introduced
- **THEN** it appears as an additional Logs destination without restructuring the all-jobs run-log view
