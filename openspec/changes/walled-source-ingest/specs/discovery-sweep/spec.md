## MODIFIED Requirements

### Requirement: Sweep intake polls feeds and reads the email inbox, deduped

The sweep SHALL gather candidates from three shared sources: the RSS/Atom `feeds` table (polled — discovery is no longer a live agent-time pull), the email `discovery_candidates` inbox (pushed by the `email()` handler), and the **pushed-candidate inbox** (`ingest_candidates`, written by `POST /admin/api/ingest` from home-network scrapers — see `recipe-ingestion`). A pushed candidate arrives with its **pre-parsed content already attached** (the scraper did the walled fetch), so it enters the same classify → describe → dedup → match → import pipeline as feed and email candidates but its `acquire` step is satisfied from the attached content rather than a fetch. It SHALL exclude from this **fresh** intake any candidate whose canonical URL is already a corpus recipe `source_url`, is in `discovery_rejections`, or is already recorded in the discovery log (any prior outcome) — **except** that a pushed candidate whose only prior outcome is a transient/walled acquisition park (`error` with an acquisition reason, e.g. `unreachable`/`no_jsonld`) SHALL be admitted and supersede that park, since the scraper has now supplied content the Worker's own fetch could not reach. A **walled source SHALL be scraper-owned, not a polled `feed`** — the Worker SHALL NOT poll a walled source (it would only park `unreachable` and suppress the later real push). Canonicalization SHALL strip tracker query strings/fragments/trailing slashes, and SHALL prefer a recipe's JSON-LD-declared `source` over the fetched URL when present.

In addition to fresh intake, the sweep SHALL maintain a **retry stream**: parked rows whose outcome is a transient failure (`error` with a transient acquisition reason, i.e. `unreachable`; or `failed`) and that are **due** for retry (their `next_retry_at` has passed and their attempt count is under the cap) SHALL be re-admitted as candidates, reconstructed from the logged URL/title/source. A URL in `discovery_rejections` SHALL NOT be re-admitted by the retry stream. A re-admitted candidate SHALL resolve its **existing** log row in place rather than create a duplicate row.

#### Scenario: Three sources feed one pipeline

- **WHEN** the sweep runs with configured feeds, inbox emails, and pushed candidates present
- **THEN** candidates from the feeds, the `discovery_candidates` inbox, and the `ingest_candidates` push inbox enter the same classify/match/import pipeline

#### Scenario: Already-handled candidates are skipped from fresh intake

- **WHEN** a candidate's canonical URL matches a corpus `source_url`, a `discovery_rejections` row, or any existing discovery-log row
- **THEN** that candidate is excluded from fresh intake before any classification work is spent on it

#### Scenario: A pushed candidate supersedes a prior walled park

- **WHEN** a pushed candidate's URL previously parked as `error`/`unreachable` and has no other prior outcome
- **THEN** it is admitted (not skipped as already-evaluated) and processed from its attached content, superseding the walled park

#### Scenario: A walled source is not polled as a feed

- **WHEN** a source is served by a scraper (walled)
- **THEN** it is not registered in the `feeds` table and the Worker never attempts to fetch it directly

#### Scenario: A due transient park is re-admitted via the retry stream

- **WHEN** a parked `unreachable` or `failed` row's `next_retry_at` has passed and its attempt count is under the cap
- **THEN** it is re-admitted as a candidate and its existing log row is resolved in place, not duplicated

#### Scenario: A rejected URL is never re-admitted

- **WHEN** a parked row's URL is in `discovery_rejections` (e.g. an operator deleted that discovery)
- **THEN** the retry stream does not re-admit it, regardless of its `next_retry_at`

#### Scenario: Evaluated non-matches are not re-classified each sweep

- **WHEN** a candidate was classified in a prior sweep and matched no member
- **THEN** it is recorded as a terminal `no_match` outcome and is not re-fetched or re-classified on subsequent sweeps

## ADDED Requirements

### Requirement: Pushed candidates skip the acquire fetch and are recorded with provenance

A pushed candidate SHALL be processed by the sweep with its `acquire` step **satisfied from its attached pre-parsed content** — the sweep SHALL NOT fetch its URL. Every downstream stage (triage, classify, describe/embed, dedup, taste-match, confirm, import, attribution) SHALL be identical to a feed candidate, so a pushed candidate is taste-matched and governed (rate cap, classify cap) with no special attribution. The sweep SHALL record on the candidate's `discovery_log` row that it was `pushed` and its `origin` (the batch source), so the operator surface can badge it and render its `acquire` stage as satisfied-by-push. Because a pushed candidate's content persists in `ingest_candidates`, a **transient** classify/infrastructure failure SHALL be retryable by re-running classification from the stored content (no re-fetch), while a **contract-invalid** classification SHALL park terminally as for any candidate.

#### Scenario: A pushed candidate is not fetched

- **WHEN** the sweep processes a candidate that arrived via `/admin/api/ingest`
- **THEN** it classifies/matches/imports from the attached content and issues no external fetch for that URL

#### Scenario: A pushed candidate is taste-matched like any other

- **WHEN** a pushed candidate clears classification
- **THEN** it is taste-matched, deduped, and rate-governed exactly as a feed candidate, with attribution decided by taste (not by the fact that it was pushed)

#### Scenario: Provenance is recorded for the operator surface

- **WHEN** a pushed candidate reaches a terminal outcome
- **THEN** its `discovery_log` row carries `pushed` and `origin`, so the Discovery view badges it and shows `acquire` as arrived-via-push

#### Scenario: A transient failure retries without re-fetching

- **WHEN** a pushed candidate's classification fails on a transient infrastructure error
- **THEN** it is retried by re-running classification from the persisted pushed content, not by re-fetching the source
