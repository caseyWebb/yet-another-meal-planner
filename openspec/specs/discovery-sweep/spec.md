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

The sweep SHALL gather candidates from both shared sources: the RSS/Atom `feeds` table (polled — discovery is no longer a live agent-time pull) and the email `discovery_candidates` inbox (pushed by the `email()` handler). It SHALL exclude any candidate whose canonical URL is already a corpus recipe `source_url`, is in `discovery_rejections`, or is in the `discovery_evaluated` set (candidates already evaluated and not imported). Canonicalization SHALL strip tracker query strings/fragments/trailing slashes, and SHALL prefer a recipe's JSON-LD-declared `source` over the fetched URL when present.

#### Scenario: Both sources feed one pipeline

- **WHEN** the sweep runs with configured feeds and inbox emails present
- **THEN** candidates from both the feeds and the `discovery_candidates` inbox enter the same classify/match/import pipeline

#### Scenario: Already-handled candidates are skipped

- **WHEN** a candidate's canonical URL matches a corpus `source_url`, a `discovery_rejections` row, or a `discovery_evaluated` row
- **THEN** that candidate is excluded before any classification work is spent on it

#### Scenario: Evaluated non-matches are not re-classified each sweep

- **WHEN** a candidate was classified in a prior sweep and matched no member
- **THEN** it is recorded in `discovery_evaluated` and is not re-fetched or re-classified on subsequent sweeps

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

#### Scenario: A persistently-unclassifiable candidate is parked, not lost

- **WHEN** a candidate fails classification validation after the retry budget
- **THEN** it is recorded in `discovery_errors`, surfaced by `read_discovery_errors`, and the sweep continues with other candidates

#### Scenario: Parked errors are agent-readable

- **WHEN** `read_discovery_errors` is called
- **THEN** it returns the parked candidates with their failure context

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

The sweep SHALL record an auditable outcome for **every candidate it processes**, not only the ones it imports, so an operator can see what the autonomous pipeline did. Each log entry SHALL carry at least: a timestamp, the candidate's canonical source URL and title, the discovery source (feed name or sender), the **outcome** (imported / skipped-duplicate / skipped-no-match / skipped-rejected-source / dietary-gated / parked-error), and outcome-specific detail (for an import: the resulting slug and the matched member attribution; for a duplicate: the corpus recipe it matched; for a no-match: that no member cleared the threshold; for a parked error: the validation failure). The log SHALL be the data source the operator admin Logs view reads (see the `operator-admin` capability). The existing `discovery_evaluated` (do-not-re-evaluate) set and `discovery_errors` (parked) records MAY be derived from or co-located with this log; the log SHALL be retained under a bounded retention window so it does not grow without limit.

#### Scenario: Every processed candidate produces a log entry

- **WHEN** the sweep processes a candidate to any terminal outcome (import, skip, or park)
- **THEN** a log entry is recorded with the timestamp, source, title, outcome, and outcome-specific detail

#### Scenario: An import entry carries slug and attribution

- **WHEN** the sweep imports a candidate matched to one or more members
- **THEN** its log entry records the resulting slug and which member(s) it was attributed to

#### Scenario: A skip entry records why

- **WHEN** the sweep skips a candidate as a duplicate or a no-match
- **THEN** its log entry records the reason (the matched corpus recipe for a duplicate; no-member-matched for a no-match)

