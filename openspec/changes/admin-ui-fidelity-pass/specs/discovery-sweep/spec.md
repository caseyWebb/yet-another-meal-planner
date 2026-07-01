## MODIFIED Requirements

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
