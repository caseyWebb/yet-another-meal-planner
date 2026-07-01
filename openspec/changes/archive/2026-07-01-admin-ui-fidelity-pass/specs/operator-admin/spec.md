## MODIFIED Requirements

### Requirement: Status area shows corpus stat tiles

The Status area SHALL render a row of page-level **corpus stat tiles** above the service-health detail, each a labelled count read from a small operational corpus-counts reader: **Recipes** (indexed recipe count), **Members** (allowlisted member count), **RSS feeds** (discovery feed count), and **Cached SKUs** (sku-cache row count). The tiles SHALL carry no per-tenant data — only aggregate counts. The **Recipes** and **Members** tiles SHALL link to their respective areas (`/admin/data` and `/admin/members`); the **RSS feeds** tile SHALL link to the Config area's Discovery-feeds editor (`/admin/config`, the default Discovery group); the **Cached SKUs** tile SHALL link to the Data area's Stores explorer (`/admin/data/stores`).

#### Scenario: Stat tiles render aggregate counts

- **WHEN** the operator opens the Status area
- **THEN** a row of stat tiles shows the recipe, member, RSS-feed, and cached-SKU counts, with no per-tenant data

#### Scenario: Recipe and member tiles navigate

- **WHEN** the operator activates the Recipes or Members stat tile
- **THEN** the browser navigates to the Data area or the Members area respectively

#### Scenario: RSS feeds tile navigates to the Config feeds editor

- **WHEN** the operator activates the RSS feeds stat tile
- **THEN** the browser navigates to the Config area's Discovery group, where the discovery-feeds editor is shown

#### Scenario: Cached SKUs tile navigates to the Stores explorer

- **WHEN** the operator activates the Cached SKUs stat tile
- **THEN** the browser navigates to the Data area's Stores explorer

### Requirement: Logs area with a left submenu and a detail dialog

The admin panel SHALL provide a top-level **Logs** area, server-rendered, whose sole content is the **all-cron-jobs run log**: a filterable, paginated list of individual `job_runs` records across every registered background job (see "Logs area shows the all-jobs run log" below). The Logs area SHALL render this view directly, with **no left submenu or sidebar** — it is a single-destination area, not a sectioned one. The Logs area SHALL NOT host a candidate-level Discovery destination — the per-candidate discovery pipeline is reached at the top-level **Discovery** area (`/admin/discovery`; see "Discovery area shows the candidate pipeline"), not under Logs. The legacy route `/admin/logs/discovery` SHALL respond with a **302 redirect** to `/admin/discovery` (preserving the link for any existing bookmark) rather than serving its own content.

When an individual run-log entry expands to more than a row's worth of detail, it SHALL render inline (the summary key/value detail), not in a separate dialog.

#### Scenario: Logs area shows the all-jobs run log by default

- **WHEN** the operator opens `/admin/logs`
- **THEN** the area renders the all-jobs run log (entries across every registered background job, newest-first), not the Discovery candidate log

#### Scenario: Logs area renders without a sidebar

- **WHEN** the operator opens `/admin/logs`
- **THEN** the page shows the all-jobs run log as the area's full-width content, with no left submenu or sidebar navigation

#### Scenario: The legacy Discovery log route redirects to the Discovery area

- **WHEN** the operator opens `/admin/logs/discovery` directly (or refreshes there)
- **THEN** the Worker responds with a 302 redirect to `/admin/discovery`, which renders the candidate-pipeline view

#### Scenario: Entry detail expands inline for a run

- **WHEN** the operator expands a run-log entry on `/admin/logs`
- **THEN** its `job_health`-shaped summary (and, on failure, its error) renders inline beneath the entry, without a dialog

#### Scenario: A new log source is added as a submenu destination

- **WHEN** a future log source is introduced
- **THEN** it appears as an additional Logs destination without restructuring the all-jobs run-log view or the Discovery area

### Requirement: Discovery area shows the candidate pipeline

The admin panel's **Discovery** area (`/admin/discovery`) SHALL render, server-rendered, the autonomous candidate pipeline (`discovery-sweep`): page-level stat tiles, a filter-pill row, and a paginated list of per-candidate cards — the area's sole content (replacing any placeholder body).

**Stat tiles** SHALL show: total **Candidates**, **Imported** count with its import rate (imported ÷ total, as a percentage), **Parked / failed** count (content `error` parks plus infrastructure `failed` rows), and the count **In retry queue** (rows with `next_retry_at` not null).

**Filter pills** SHALL be: All, Imported, Retrying, Parked, Failed, No match, Duplicate, Dietary, Deferred — each labelled with its current count; "Retrying" SHALL match every retryable row (`next_retry_at` not null) regardless of its `error`/`failed` split; the other pills SHALL match their corresponding `outcome` value (`imported`, `error` for Parked, `failed` for Failed, `no_match`, `duplicate`, `dietary_gated`, `deferred`). Selecting a pill SHALL filter the candidate list and reset to the first page. The filter and the page SHALL be expressed as route query parameters so each filter/page combination is independently navigable and deep-linkable.

Each **candidate card** SHALL show: the candidate's title, source (with an icon distinguishing a feed vs. an email source) and its relative discovery age, an outcome badge, a **7-stage progression track** (triage → acquire → classify → describe → dedup → match → import — the `discovery-sweep` pipeline's real stage order) rendered per the "Discovery candidate progression track" requirement, and a one-line plain-language summary of where/why the candidate stands (e.g. an import's member attribution, a duplicate's matched recipe, a park's specific reason, a dietary gate's restriction). A candidate halted at the `match` stage (outcome `no_match` with `detail.stage` of `"match"` or `"confirm"`, or `dietary_gated`) SHALL additionally show the per-member match scores carried in its log entry's `detail` (see the `discovery-sweep` capability's "Sweep outcomes are recorded as an operator-auditable log" requirement), so the operator can see how close each member came to a match rather than only the pass/fail outcome. A retryable candidate (outcome `error` or `failed` with `next_retry_at` not null) SHALL show its attempt count against the retry cap and a relative countdown to its next automatic retry; a terminal parked/failed candidate (attempt cap exhausted) SHALL show that it is terminal rather than a countdown. The list SHALL be paginated with a fixed page size.

Expanding a card SHALL reveal: a per-stage breakdown (each of the 7 stages marked passed / stopped here / not reached, with a short description of what that stage does) and the underlying `discovery_log` row rendered as key/value detail (via the shared `PrettyKV` kit primitive) — id, url, outcome, slug, attempts, the next-retry countdown, and the outcome's `detail` payload (including the per-member match scores when present).

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

#### Scenario: A match-halted candidate shows its per-member scores

- **WHEN** a candidate's outcome is `no_match` with `detail.stage` of `"match"`, or `dietary_gated`
- **THEN** the card shows the per-member match scores from the log entry's `detail`, alongside the existing plain-language summary

#### Scenario: A retryable candidate shows its attempt count and retry countdown

- **WHEN** a candidate's outcome is `error` with `attempts` of 2 and a future `next_retry_at`
- **THEN** the card shows "attempt 2/5" (the configured retry cap) and a relative countdown to the next automatic retry

#### Scenario: A terminal parked candidate shows terminal, not a countdown

- **WHEN** a candidate's outcome is `error` with `attempts` at the retry cap and `next_retry_at` null
- **THEN** the card shows it is terminal (no further automatic retry), not a countdown

#### Scenario: Expanding a card shows the per-stage breakdown and the raw log row

- **WHEN** the operator expands a candidate card
- **THEN** the expanded detail shows each of the 7 stages marked passed / stopped here / not reached, and the underlying `discovery_log` row rendered as key/value detail
