## MODIFIED Requirements

### Requirement: Sweep intake polls feeds and reads the email inbox, deduped

The sweep SHALL gather candidates from both shared sources: the RSS/Atom `feeds` table (polled — discovery is no longer a live agent-time pull) and the email `discovery_candidates` inbox (pushed by the `email()` handler). It SHALL exclude from this **fresh** intake any candidate whose canonical URL is already a corpus recipe `source_url`, is in `discovery_rejections`, or is already recorded in the discovery log (any prior outcome). Canonicalization SHALL strip tracker query strings/fragments/trailing slashes, and SHALL prefer a recipe's JSON-LD-declared `source` over the fetched URL when present.

In addition to fresh intake, the sweep SHALL maintain a **retry stream**: parked rows whose outcome is a transient failure (`error` with a transient acquisition reason, i.e. `unreachable`; or `failed`) and that are **due** for retry (their `next_retry_at` has passed and their attempt count is under the cap) SHALL be re-admitted as candidates, reconstructed from the logged URL/title/source. A URL in `discovery_rejections` SHALL NOT be re-admitted by the retry stream. A re-admitted candidate SHALL resolve its **existing** log row in place rather than create a duplicate row.

#### Scenario: Both sources feed one pipeline

- **WHEN** the sweep runs with configured feeds and inbox emails present
- **THEN** candidates from both the feeds and the `discovery_candidates` inbox enter the same classify/match/import pipeline

#### Scenario: Already-handled candidates are skipped from fresh intake

- **WHEN** a candidate's canonical URL matches a corpus `source_url`, a `discovery_rejections` row, or any existing discovery-log row
- **THEN** that candidate is excluded from fresh intake before any classification work is spent on it

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

### Requirement: Transient acquisition and infrastructure parks are retried across ticks with backoff

The sweep SHALL treat two park outcomes as **transient and retryable** rather than terminal: a candidate parked `error` with the acquisition reason `unreachable` (a fetch that threw or returned a non-2xx), and a candidate dropped `failed` by an infrastructure error (a transient `env.AI`/D1 failure). Each such row SHALL carry an **attempt count** and a **`next_retry_at`** timestamp. The sweep SHALL re-run the **full pipeline** (acquire → classify → match → import) against a due retryable row and SHALL resolve that row in place: on success to its real outcome (`imported` with slug+attribution, or `duplicate`, or `no_match`), and on a repeated failure by incrementing the attempt count and scheduling the next attempt under a **bounded exponential backoff**. Structural acquisition parks (`no_jsonld` / `not_a_recipe` / `incomplete`) and deterministic outcomes (`no_match` / `duplicate` / `dietary_gated` / `imported`) SHALL NOT be retried.

A retryable row SHALL become **terminal** once it reaches the attempt cap: its `next_retry_at` SHALL be cleared so it is no longer re-admitted. An exhausted `unreachable` row SHALL remain a terminal `error` park. An exhausted `failed` row SHALL resolve to a terminal `error` park so that the discovery-sweep health record (which degrades while `failed` rows stand) clears once infrastructure retries are spent rather than remaining degraded on a single permanently-unprocessable URL. The backoff schedule and the attempt cap SHALL be configuration, tunable without a contract change.

Retries SHALL be bounded per tick under a retry sub-budget so they cannot starve fresh intake of the per-tick fetch/classification budget; due rows beyond the sub-budget SHALL wait for a later tick. Because a successful retry re-runs the import path, a recovered-but-unimported park (an `error` row annotated as acquirable yet kept out of the corpus) SHALL NOT occur.

#### Scenario: A transient unreachable park recovers and imports on retry

- **WHEN** a candidate parked `unreachable` later fetches and parses, and matches a member
- **THEN** on a due retry the sweep imports it, resolving the existing row to `imported` with its slug and attribution (it does not stay a parked `error`)

#### Scenario: A still-failing transient park backs off and eventually terminalizes

- **WHEN** a retryable row fails again on a due retry
- **THEN** its attempt count increments and `next_retry_at` advances by the backoff schedule, and once it reaches the attempt cap `next_retry_at` is cleared and it becomes a terminal `error` park

#### Scenario: An exhausted infrastructure failure stops degrading health

- **WHEN** a `failed` row exhausts its retry attempts
- **THEN** it resolves to a terminal `error` park and is no longer counted as a standing infrastructure failure, so the discovery-sweep health record clears

#### Scenario: Structural and deterministic outcomes are not retried

- **WHEN** a candidate is parked `no_jsonld` / `not_a_recipe` / `incomplete`, or recorded `no_match` / `duplicate` / `dietary_gated` / `imported`
- **THEN** it carries no retry schedule and is not re-admitted by the retry stream

#### Scenario: Retries do not starve fresh intake

- **WHEN** more retryable rows are due than the retry sub-budget allows in one tick
- **THEN** the sweep processes fresh intake within its budget and retries up to the retry sub-budget, deferring the remaining due rows to a later tick
