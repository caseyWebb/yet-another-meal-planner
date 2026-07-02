## ADDED Requirements

### Requirement: Alias target convergence

The sku-cache re-key pass SHALL, in the same scheduled tick and with plain code and no model calls, re-point every `ingredient_alias` row whose stored `id` no longer survives the representative chain: the target is the id reached by chasing `representative` pointers over the identity rows only — the alias front-door SHALL NOT be consulted for the target — and a row is rewritten only when the chased survivor differs from the stored `id`. The step SHALL retarget only rows the alias re-audit no longer owns — `audited_at` set, or `source='human'` (human rows are never audit-selected) — leaving un-audited auto rows untouched: those are re-pointed by the re-audit's own re-decision, and racing it could overwrite a same-tick re-decision with a stale chase that, with both rows then stamped, would never be revisited. The re-point SHALL write only the `id` column, preserving `source`, `confidence`, `decided_at`, and `audited_at` (key maintenance, not a re-decision), and SHALL NOT append per-row normalization-log entries; the pass's job summary SHALL carry an additive `alias_retargeted` count as the audit trail. The step SHALL be idempotent (a pass over converged rows writes nothing), bounded per tick with the deferred remainder flagged `truncated` and converged on later ticks, and an alias `id` absent from the identity registry SHALL be left unchanged.

#### Scenario: A loser-targeted alias converges through the chain

- **WHEN** an audited (or human-sourced) alias row's stored `id` is a merged-away node (including a retired multi-segment id re-rooted by segment repair) whose representative chain ends at a survivor
- **THEN** the next tick rewrites the row's `id` to the surviving id, leaving `source`, `confidence`, `decided_at`, and `audited_at` unchanged and writing no normalization-log entry

#### Scenario: A self-alias of a merged node becomes a real mapping

- **WHEN** an audited row whose `variant` equals its stored `id` points at a node that was merged into a survivor
- **THEN** the row is re-pointed to the survivor, becoming a `variant → survivor` mapping whose variant no longer equals its target

#### Scenario: Un-audited auto rows stay with the re-audit

- **WHEN** an alias row with `source='auto'` and a NULL `audited_at` points at a merged-away node
- **THEN** the retarget step does not touch it, and the row converges through the alias re-audit's own re-decision (which stamps it, making any later drift this step's to maintain)

#### Scenario: Converged rows are untouched

- **WHEN** the pass runs over rows whose stored `id` already resolves to itself, or whose `id` has no identity row at all
- **THEN** it plans no alias writes and the tick's `alias_retargeted` count is zero

#### Scenario: The retarget count is visible as work

- **WHEN** a tick re-points at least one alias row
- **THEN** the run's job summary reports the count under `alias_retargeted` and the tick is presented as work performed, not a settled no-op
