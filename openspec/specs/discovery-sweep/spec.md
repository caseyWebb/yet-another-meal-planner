# discovery-sweep Specification

## Purpose
TBD - created by archiving change background-discovery-sweep. Update Purpose after archive.
## Requirements
### Requirement: Discovery runs as a scheduled background sweep

The system SHALL discover and import recipes in a background **discovery sweep** — a job in the Worker's single `scheduled()` handler, running with no member attached, alongside the flyer warm, the recipe-index projection, and the recipe-derived reconcile. The sweep SHALL NOT depend on any member starting a conversation. It SHALL bound its work per tick on **both** subrequest budgets — the external cap (feed and recipe-page fetches) via a cursor-swept bounded batch like the flyer warm, and the internal `env.AI` cap (classification, description, embedding, match confirmation) via per-tick caps like the recipe-derived reconcile — and SHALL advance a persisted cursor only after an idempotent publish, so a retried tick repeats safely. It SHALL write a `health:job:<name>` record per run (tenant-data-free) and SHALL rethrow a hard failure so the platform's native cron status reflects it, exactly as the other scheduled jobs do.

#### Scenario: Discovery happens with no user attached

- **WHEN** the scheduled handler fires and discovery sources have new candidates
- **THEN** the sweep polls sources, classifies, matches, and imports without any member conversation, and writes its health record

#### Scenario: Work is bounded per tick on both budgets

- **WHEN** a sweep tick has more candidates than its per-tick caps allow
- **THEN** it processes a bounded batch (within the external fetch cap and the internal `env.AI` cap), advances the cursor, and defers the remainder to later ticks rather than exceeding a per-invocation budget

#### Scenario: A retried tick does not double-import

- **WHEN** a tick throws after a partial publish and re-runs
- **THEN** already-imported candidates are not imported again (idempotent on canonical source URL and the evaluated set)

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

### Requirement: Candidates are narrowed cheapest-first before classification

The sweep SHALL keep the expensive classification leg proportional to matches, not to discovery volume, by triaging cheaply first: it SHALL embed each candidate's `title + summary` (one embedding call, no classification) and score it against each member's taste vectors, and SHALL drop any candidate that is near **no** member before spending a recipe-page fetch or a classification call. Only triage survivors SHALL be fetched and classified.

#### Scenario: Obvious non-fits die before classification

- **WHEN** a candidate's title/summary embedding is below the taste threshold for every member
- **THEN** the sweep does not fetch the page or run classification for it, and records the cheap-triage verdict

#### Scenario: A near-match proceeds to classification

- **WHEN** a candidate's title/summary embedding clears the taste threshold for at least one member
- **THEN** the sweep proceeds to fetch/classify that candidate

### Requirement: Classification produces validated frontmatter via env.AI

The sweep SHALL classify a triage-surviving candidate into the full required recipe frontmatter via `env.AI` — the same controlled-vocabulary contract `create_recipe` enforces (`protein`/`cuisine`/`season`/`requires_equipment` vocab, `course`, `ingredients_key`, `perishable_ingredients`, `side_search_terms` for mains, and a craving-aligned `description`) — using the recipe's fetched page content or the inline email body. The classifier's output SHALL be validated by the same validator the write path uses (`validateFile`); an off-vocabulary or missing-required-field result SHALL NOT be written.

#### Scenario: Classified recipe passes the same contract as a manual import

- **WHEN** the sweep classifies a candidate and the result satisfies the recipe contract
- **THEN** it is written via the same `buildNewRecipe` + `validateFile` write path a manual `create_recipe` uses

#### Scenario: Invalid classification is not written

- **WHEN** the classifier returns an off-vocabulary value or omits a required field
- **THEN** the candidate is not written to the corpus and is routed to the retry/park path

### Requirement: Taste matching is cosine recall plus an LLM confirm

The sweep SHALL match a classified candidate against each member's taste using a hybrid: a cosine **recall** filter (the candidate's description embedding scored by `favoriteAffinity` against the member's favorited-recipe vectors **and** an `env.AI`-derived embedding of the member's `taste` text) that admits candidates clearing a taste threshold, followed by a small-LLM **confirm** over the surviving candidate and the matching members' taste text. The confirm SHALL respect negative taste constraints (e.g. a disliked ingredient named in the taste text) that cosine similarity cannot. Each member's hard dietary restrictions SHALL be applied as a gate before a candidate is attributed to that member — a dietary-violating candidate SHALL NOT match that member (though it MAY match another).

#### Scenario: A disliked ingredient is excluded despite cosine proximity

- **WHEN** a candidate is cosine-close to a member whose taste text says they dislike a key ingredient of that candidate
- **THEN** the LLM confirm rejects the match for that member and the candidate is not attributed to them on that basis

#### Scenario: Dietary restriction gates the match

- **WHEN** a candidate violates a member's hard dietary restriction
- **THEN** it is not attributed to that member regardless of cosine score, even if it matches and imports for a different member

#### Scenario: Cold-start member matches on taste text

- **WHEN** a member has no favorited recipes but has authored `taste` text
- **THEN** matching uses the embedded taste-text vector rather than returning no matches for that member

### Requirement: A candidate matching any member is auto-imported with attribution

The sweep SHALL import a candidate into the shared corpus when it matches **at least one** member, and SHALL record per-member **match attribution** (which member[s] it matched). Import SHALL stamp `discovered_at`, `discovery_source`, and the attribution, and SHALL use the shared opt-out model — the recipe is available to everyone; a member who does not want it uses `toggle_reject`. A candidate matching **no** member SHALL NOT be imported and SHALL be recorded in `discovery_evaluated`.

#### Scenario: One member's match imports for the group

- **WHEN** a candidate matches exactly one member's taste
- **THEN** the recipe is imported into the shared corpus, attributed to that member, and available (opt-out) to all members

#### Scenario: No match means no import

- **WHEN** a classified candidate matches no member
- **THEN** it is not imported and is recorded in `discovery_evaluated` so it is not re-evaluated

#### Scenario: Attribution drives per-member surfacing

- **WHEN** a recipe is imported attributed to member A but not member B
- **THEN** the recipe is in the shared corpus for both, but only member A's new-for-me read surfaces it as newly discovered

### Requirement: Imports are deduplicated semantically, not just by URL

Beyond the canonical-URL exclusion, the sweep SHALL skip a candidate whose description embedding is at or above a near-duplicate cosine threshold against any existing corpus recipe (`recipe_derived`), and SHALL deduplicate within a single sweep (against other candidates and that tick's imports, which the corpus check cannot yet see). The near-duplicate threshold SHALL be tighter than the taste-match threshold. A candidate skipped as a duplicate SHALL be logged (not silently dropped). A candidate that is cosine-close to a recipe a member has rejected SHALL NOT be attributed to that member.

#### Scenario: Same dish from a different URL is not re-imported

- **WHEN** a candidate's description embedding is at or above the near-duplicate threshold against an existing corpus recipe
- **THEN** the candidate is skipped as a duplicate and the skip is logged

#### Scenario: Two feeds surfacing one dish import once

- **WHEN** two candidates in the same sweep tick are near-duplicates of each other and neither is in the corpus yet
- **THEN** only one is imported, and the other is skipped as an intra-sweep duplicate

#### Scenario: A near-duplicate of a rejected recipe is not attributed to that member

- **WHEN** a candidate is cosine-close to a recipe member M previously rejected
- **THEN** the candidate is not attributed to M on the basis of that similarity

### Requirement: Auto-import volume is governed

The sweep SHALL bound auto-import volume with a per-window rate cap in addition to the taste threshold. When the cap is reached for a window, excess matched candidates SHALL be **deferred** to a later tick (not silently dropped) and the deferral SHALL be logged or visible in the sweep's health summary. The taste threshold and the rate cap SHALL be configuration, tunable without a contract change.

#### Scenario: A feed flood cannot balloon the corpus in one sweep

- **WHEN** more candidates match than the per-window rate cap allows
- **THEN** the sweep imports up to the cap, defers the rest to a later window, and records the deferral count

#### Scenario: Thresholds are configurable

- **WHEN** the taste threshold or rate cap is changed in configuration
- **THEN** the sweep honors the new value with no change to the tool/spec contract

### Requirement: A per-member taste vector is derived and refreshed

The system SHALL derive a per-member taste embedding from the member's `profile.taste` text via `env.AI`, stored in a reconcile-/sweep-owned location keyed by tenant, and regenerated when the taste text changes (a content-hash gate, mirroring the recipe-derived description). A member whose taste text is absent or empty SHALL have no taste vector and SHALL be matched on favorites alone (or, with neither, by the cold-start fallback).

#### Scenario: Taste vector regenerates on a taste edit

- **WHEN** a member edits their `profile.taste` text
- **THEN** the taste vector is regenerated on a subsequent sweep/reconcile (its content hash changed), and stale vectors are not used

#### Scenario: Empty taste text yields no taste vector

- **WHEN** a member has no `taste` text
- **THEN** no taste vector is stored for them and matching falls back to favorites or the cold-start rule

### Requirement: Failed candidates are retried then parked in an error surface

Because the sweep has no conversation to surface a failure into, a candidate whose classification fails validation SHALL be retried a bounded number of times (with a corrective reprompt) and, on continued failure, recorded in a `discovery_errors` table with enough context to diagnose it. The system SHALL expose a `read_discovery_errors` tool returning these parked candidates, and SHALL push an optional ntfy alert on a new parked candidate — the same out-of-band feedback model as `reconcile_errors`. A parked candidate SHALL NOT block the rest of the sweep.

A candidate the sweep cannot acquire as parseable recipe content SHALL be parked with a **specific** acquisition-failure reason — `unreachable` (the fetch threw or returned a non-2xx), `no_jsonld` (the page was fetched but exposes no JSON-LD), `not_a_recipe` (JSON-LD is present but contains no schema.org `Recipe`), or `incomplete` (a `Recipe` was found but yields no ingredients or no instructions) — drawn from the same taxonomy the manual `parse_recipe` path uses, rather than a catch-all `unreachable` for every content failure. Where the failure is a non-2xx fetch, the parked detail SHALL also carry the HTTP status. The reason SHALL be recorded in the parked entry's `detail` so an operator can distinguish a walled/dead source from a feed entry that is simply not a parseable recipe.

#### Scenario: A persistently-unclassifiable candidate is parked, not lost

- **WHEN** a candidate fails classification validation after the retry budget
- **THEN** it is recorded in `discovery_errors`, surfaced by `read_discovery_errors`, and the sweep continues with other candidates

#### Scenario: Parked errors are agent-readable

- **WHEN** `read_discovery_errors` is called
- **THEN** it returns the parked candidates with their failure context

#### Scenario: An unacquirable candidate is parked with a specific reason

- **WHEN** the sweep fetches a candidate page that returns 200 but contains no schema.org `Recipe` (a roundup or category page)
- **THEN** it is parked with `detail.reason` of `not_a_recipe` (not the catch-all `unreachable`), so the operator can tell it apart from a genuinely unreachable page

#### Scenario: A non-2xx fetch records its status

- **WHEN** the sweep's fetch of a candidate page returns a non-2xx (a bot wall or dead link)
- **THEN** it is parked with `detail.reason` of `unreachable` and the HTTP status recorded in the detail

### Requirement: New-for-me read surfaces recently-imported, taste-matched recipes

The system SHALL provide a read (e.g. `list_new_for_me`) returning the caller's newly-discovered recipes: those imported (`discovered_at`) after the caller's `last_planned_at` watermark, attributed to the caller by the matcher, for which the caller has no overlay row (not yet favorited or rejected) and which the caller has not cooked. A fixed-window floor SHALL bound the cold-start case (a member with no/old watermark does not receive the entire backlog). The returned recipes SHALL already be classified and embedded (the sweep captured them), so they are immediately retrievable — there is no "imported this session but not yet retrievable" gap. An empty result SHALL NOT be an error.

#### Scenario: Only the caller's matches, only what they haven't acted on

- **WHEN** member A calls the new-for-me read
- **THEN** it returns recipes imported after A's watermark, attributed to A, with no overlay row for A and not in A's cooking log — excluding recipes attributed only to other members

#### Scenario: Cold-start is bounded by the window floor

- **WHEN** a member has never planned (no `last_planned_at`)
- **THEN** the read returns at most the fixed-window-floor recent matches, not the entire backlog

#### Scenario: Empty new-for-me is not an error

- **WHEN** there are no new matched recipes for the caller
- **THEN** the read returns an empty list and does not raise an error

### Requirement: Sweep outcomes are recorded as an operator-auditable log

The sweep SHALL record an auditable outcome for **every candidate it processes**, not only the ones it imports, so an operator can see what the autonomous pipeline did. Each log entry SHALL carry at least: a timestamp, the candidate's canonical source URL and title, the discovery source (feed name or sender), the **outcome** (imported / skipped-duplicate / skipped-no-match / skipped-rejected-source / dietary-gated / parked-error), and outcome-specific detail (for an import: the resulting slug and the matched member attribution; for a duplicate: the corpus recipe it matched; for a no-match: that no member cleared the threshold; for a parked error: the specific failure — a classification-validation message, or a specific acquisition-failure reason from the `unreachable` / `no_jsonld` / `not_a_recipe` / `incomplete` taxonomy rather than a catch-all `unreachable`). The log SHALL be the data source the operator admin Logs view reads (see the `operator-admin` capability). The existing `discovery_evaluated` (do-not-re-evaluate) set and `discovery_errors` (parked) records MAY be derived from or co-located with this log; the log SHALL be retained under a bounded retention window so it does not grow without limit.

#### Scenario: Every processed candidate produces a log entry

- **WHEN** the sweep processes a candidate to any terminal outcome (import, skip, or park)
- **THEN** a log entry is recorded with the timestamp, source, title, outcome, and outcome-specific detail

#### Scenario: An import entry carries slug and attribution

- **WHEN** the sweep imports a candidate matched to one or more members
- **THEN** its log entry records the resulting slug and which member(s) it was attributed to

#### Scenario: A skip entry records why

- **WHEN** the sweep skips a candidate as a duplicate or a no-match
- **THEN** its log entry records the reason (the matched corpus recipe for a duplicate; no-member-matched for a no-match)

#### Scenario: A parked-error entry records the specific acquisition reason

- **WHEN** the sweep parks a candidate it could not acquire as a recipe
- **THEN** its log entry's `detail.reason` is the specific failure (`unreachable` / `no_jsonld` / `not_a_recipe` / `incomplete`), not a catch-all `unreachable` applied to every content failure

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

