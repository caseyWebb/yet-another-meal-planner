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

The sweep SHALL gather candidates from three shared sources: the RSS/Atom `feeds` table (polled — discovery is no longer a live agent-time pull), the email `discovery_candidates` inbox (pushed by the `email()` handler), and the **pushed-candidate inbox** (`ingest_candidates`, written by `POST /admin/api/ingest` from home-network satellites — see `recipe-ingestion`). A pushed candidate arrives with its **pre-parsed content already attached** (the satellite did the walled fetch), so it enters the same classify → describe → dedup → match → import pipeline as feed and email candidates but its `acquire` step is satisfied from the attached content rather than a fetch. It SHALL exclude from this **fresh** intake any candidate whose canonical URL is already a corpus recipe `source_url`, is in `discovery_rejections`, or is already recorded in the discovery log (any prior outcome) — **except** that a pushed candidate whose only prior outcome is a transient/walled acquisition park (`error` with an acquisition reason, e.g. `unreachable`/`no_jsonld`) SHALL be admitted and supersede that park, since the satellite has now supplied content the Worker's own fetch could not reach. A **walled source SHALL be satellite-owned, not a polled `feed`** — the Worker SHALL NOT poll a walled source (it would only park `unreachable` and suppress the later real push). Canonicalization SHALL strip tracker query strings/fragments/trailing slashes, and SHALL prefer a recipe's JSON-LD-declared `source` over the fetched URL when present.

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

- **WHEN** a source is served by a satellite (walled)
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

The sweep SHALL record an auditable outcome for **every candidate it processes**, not only the ones it imports, so an operator can see what the autonomous pipeline did. Each log entry SHALL carry at least: a timestamp, the candidate's canonical source URL and title, the discovery source (feed name or sender), the **outcome** (imported / skipped-duplicate / skipped-no-match / skipped-rejected-source / dietary-gated / parked-error), and outcome-specific detail (for an import: the resulting slug and the matched member attribution; for a duplicate: the corpus recipe it matched; for a no-match or dietary-gated outcome halted at the match stage: that no member cleared the threshold or was confirmed, **plus the per-member taste/match cosine scores computed at that stage**; for a parked error: the specific failure — a classification-validation message, or a specific acquisition-failure reason from the `unreachable` / `no_jsonld` / `not_a_recipe` / `incomplete` taxonomy rather than a catch-all `unreachable`). The log SHALL be the data source the operator admin Logs view reads (see the `operator-admin` capability). The existing `discovery_evaluated` (do-not-re-evaluate) set and `discovery_errors` (parked) records MAY be derived from or co-located with this log; the log SHALL be retained under a bounded retention window so it does not grow without limit.

#### Scenario: Every processed candidate produces a log entry

- **WHEN** the sweep processes a candidate to any terminal outcome (import, skip, or park)
- **THEN** a log entry is recorded with the timestamp, source, title, outcome, and outcome-specific detail

#### Scenario: An import entry carries slug and attribution

- **WHEN** the sweep imports a candidate matched to one or more members
- **THEN** its log entry records the resulting slug and which member(s) it was attributed to

#### Scenario: A skip entry records why

- **WHEN** the sweep skips a candidate as a duplicate or a no-match
- **THEN** its log entry records the reason (the matched corpus recipe for a duplicate; no-member-matched for a no-match)

#### Scenario: A match-stage skip or gate carries the computed member scores

- **WHEN** the sweep halts a candidate at the match stage — no member clears the taste threshold, every clearing member is declined by the negation-aware confirm, or every clearing member is gated by a hard dietary restriction
- **THEN** its log entry's `detail` includes the per-member cosine match score computed for that candidate, not only the pass/fail outcome

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

### Requirement: Feed polling is bounded per tick by a persisted rotation cursor

The sweep SHALL poll the shared `feeds` table in a per-tick **bounded batch** rather than fetching every feed each tick — making real the feed half of the existing "bound work per tick on the external cap via a cursor-swept bounded batch like the flyer warm" requirement (the recipe-page half is already enforced by `fetchMaxPerTick`; the feed fan-out was not). Each tick it SHALL select at most `feedFetchMaxPerTick` feeds, advance a **persisted rotation cursor** so subsequent ticks poll the next feeds, and wrap around — so the **add-only** feed set can grow without the per-tick feed-fetch count exceeding the external-subrequest budget shared with the flyer warm in the same `scheduled()` invocation. `feedFetchMaxPerTick` SHALL be a member of the sweep's `DiscoveryConfig` with a conservative default, sized so `flyer + recipe-page + feed` external fetches stay within one invocation's budget. (It is a budget guardrail modeled on the existing retry sub-budget — a `DEFAULT_CONFIG` constant, not part of the operator-tunable D1 override set.)

Feeds not polled on a given tick SHALL simply be polled on a later tick (their candidates are discovered later, not lost). The rotation cursor SHALL be **best-effort** ephemeral state: losing it (eviction, cold start) SHALL restart the rotation without incorrectness, because candidate dedup makes a re-poll of an already-evaluated feed a no-op. Feed selection SHALL be **deterministic** given the feed set and the cursor position (a stable ordering) so the selection logic is unit-testable independent of the live feed set and KV.

#### Scenario: More feeds than the per-tick cap are polled across ticks

- **WHEN** the feed set has more entries than `feedFetchMaxPerTick`
- **THEN** a single tick fetches at most `feedFetchMaxPerTick` feeds, advances the cursor, and the remaining feeds are fetched on subsequent ticks

#### Scenario: Rotation wraps to cover every feed

- **WHEN** successive ticks advance the cursor past the end of the feed set
- **THEN** the cursor wraps and every feed is polled within a bounded number of ticks (no feed is starved)

#### Scenario: An added feed is reached within a bounded number of ticks

- **WHEN** a new feed is added to the add-only feed set
- **THEN** the rotation reaches and polls it within a bounded number of ticks rather than only after an unbounded delay

#### Scenario: Losing the cursor does not cause double-imports

- **WHEN** the persisted cursor is lost and the rotation restarts, re-polling recently-polled feeds
- **THEN** candidate dedup (corpus `source_url` / `discovery_rejections` / the discovery log) makes the re-poll a no-op and nothing is imported twice

### Requirement: Pushed candidates skip the acquire fetch and are recorded with provenance

A pushed candidate SHALL be processed by the sweep with its `acquire` step **satisfied from its attached pre-parsed content** — the sweep SHALL NOT fetch its URL. Every downstream stage (triage, classify, describe/embed, dedup, taste-match, confirm, import, attribution) SHALL be identical to a feed candidate, so a pushed candidate is taste-matched and governed (rate cap, classify cap) with no special attribution. The sweep SHALL record on the candidate's `discovery_log` row that it was `pushed` and its `origin` (the batch source), so the operator surface can badge it and render its `acquire` stage as satisfied-by-push. Because a pushed candidate's content persists in `ingest_candidates`, a **transient** classify/infrastructure failure SHALL be retryable by re-running classification from the stored content (no re-fetch), while a **contract-invalid** classification SHALL park terminally as for any candidate. The `ingest_candidates` row is the retry state: the sweep SHALL delete it on a **terminal** outcome (imported / rejected / contract-park) and keep it on a **transient** failure. Deleting the row SHALL be best-effort — a failed delete SHALL NOT abort the tick after the recipe is already imported — and the sweep's fresh-intake gather SHALL clean up (and skip) any inbox row whose URL is already a corpus recipe **or already settled in the discovery log**, so a stale row that survived a failed delete is not re-imported on a later tick (the corpus projection lags a just-completed import; the settled-log check closes that window).

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

#### Scenario: A stale inbox row is not re-imported

- **WHEN** a pushed candidate was imported but its `ingest_candidates` row survived (a best-effort delete failed) and reaches the next sweep before the corpus projection catches up
- **THEN** the fresh-intake gather skips and cleans it up because its URL is already settled in the discovery log, so it is not imported a second time

### Requirement: Imported titles are cleaned before slug derivation

The sweep SHALL name every recipe it imports to the same cleaning contract the corpus was named
under (`recipe-import`, "Clean titles and globally-unique slugs"): SEO suffixes (e.g. a trailing
or embedded "Recipe"), marketing qualifiers (e.g. "the best", "easy", "homemade", "classic",
"super soft and tender"), and editorial framing (e.g. "A Better …", "Our Go-To …", "Summer Dinner
Recipe: …") SHALL be removed from the imported `title`; foreign dish names SHALL be preserved
over their English gloss. Identity-bearing words (dietary or method qualifiers that change what
the dish *is*, e.g. "Vegan", "Slow Cooker") and informative parenthetical glosses SHALL NOT be
treated as flowery. The cleaning judgment SHALL ride the sweep's existing per-import
classification call (one additional output field — no additional `env.AI` call), and its output
SHALL be accepted only through a deterministic word-subset guard: a cleaned title may only remove
words from the raw title (compared case- and punctuation-insensitively) and SHALL be rejected if
it introduces any word not present in the raw title. On a rejected, missing, or empty cleaned
title the sweep SHALL fall back to the raw title and proceed — title cleaning SHALL NOT introduce
a new park/failure class. The classifier's cleaned title SHALL NOT be consumed by the
facet-derivation paths (it is not a derived facet and never overrides an authored title).

#### Scenario: A flowery feed title is imported clean

- **WHEN** the sweep imports a candidate whose page title is "A Better Beer Can Chicken"
- **THEN** the recipe is written with `title: Beer Can Chicken` and slug `beer-can-chicken`

#### Scenario: An identity qualifier survives cleaning

- **WHEN** the sweep imports a candidate titled "Vegan Meatballs"
- **THEN** the recipe's `title` remains "Vegan Meatballs" — the dietary qualifier is identity, not marketing

#### Scenario: A cleaned title that invents words is rejected by the guard

- **WHEN** the classifier returns a cleaned title containing a word not present in the raw title
- **THEN** the sweep discards the cleaned title, imports with the raw title, and the import succeeds (no park)

#### Scenario: A missing cleaned title falls back to the raw title

- **WHEN** the classifier omits the cleaned-title field or returns an empty string
- **THEN** the import proceeds with the raw title exactly as before this requirement existed

### Requirement: Import slugs derive from the cleaned dish name

The slug of a newly imported recipe SHALL be derived from the **cleaned** title, with any
parenthetical gloss excluded from the slug basis (the gloss MAY remain in the `title`). The
mechanical slug derivation itself (lowercase, accents stripped, non-alphanumerics to hyphens)
SHALL be unchanged. When the cleaned title consists only of a parenthetical, the full title SHALL
be the fallback slug basis. This naming funnel SHALL be shared with the manual `create_recipe`
path, whose explicit `slug` parameter continues to override derivation.

#### Scenario: A glossed foreign title gets a dish-name slug

- **WHEN** a recipe titled "Jatjuk (Pine Nut Porridge)" is imported
- **THEN** its slug is `jatjuk` and its `title` keeps the informative gloss

#### Scenario: Existing slugs are untouched

- **WHEN** the sweep runs after this requirement ships
- **THEN** no existing recipe's slug or R2 object path is renamed — the derivation applies to new imports only

### Requirement: A cleaned-title slug collision is disambiguated, not parked

Because cleaning maps many raw titles onto fewer slugs, the sweep SHALL treat a `slug_exists`
collision at import time — which, after the sweep's URL and semantic dedup, indicates a
same-name-different-dish — by retrying with a bounded, deterministic numeric suffix (`-2`, `-3`,
…) rather than parking the candidate. When the bounded suffix range is exhausted, the candidate
SHALL park as an error (the existing behavior). The manual `create_recipe` path SHALL keep its
structured `slug_exists` error — auto-suffixing is the unattended path's behavior only.

#### Scenario: Same clean name, different dish, both imported

- **WHEN** the sweep imports a candidate whose cleaned title slugifies to an existing recipe's slug and the candidate survived semantic dedup (it is a different dish)
- **THEN** the recipe is imported under the first free suffixed slug (e.g. `strawberry-icebox-cake-2`) and the import is logged with that slug

#### Scenario: create_recipe still surfaces the collision

- **WHEN** `create_recipe` is called with a title whose derived slug already exists
- **THEN** it returns the structured `slug_exists` error for the agent to resolve conversationally

