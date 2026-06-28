## MODIFIED Requirements

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
