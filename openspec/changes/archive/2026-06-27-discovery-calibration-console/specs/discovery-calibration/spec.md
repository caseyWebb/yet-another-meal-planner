## ADDED Requirements

### Requirement: The sweep's thresholds are tunable global config, not constants

The discovery sweep's knobs — the taste threshold τ, the triage threshold, the dedup threshold δ, the per-tick classify cap, and the per-window import rate cap — SHALL be readable from a stored, operator-editable **global** config (a `discovery_config` D1 singleton), merged over the compiled `DEFAULT_CONFIG` so any unset knob falls back to its default. The sweep SHALL load this config at job start (per tick). The config SHALL be **global** to the group (one set of knobs), not per-member. An absent or empty config SHALL read as exactly the compiled defaults, so the feature is inert until an operator sets a value.

#### Scenario: An operator override changes the sweep's behavior without a redeploy

- **WHEN** an operator saves a `discovery_config` with a new τ and the sweep next runs
- **THEN** the sweep uses the saved τ (merged over the defaults for the unset knobs), with no code change or redeploy

#### Scenario: Empty config is exactly the defaults

- **WHEN** no `discovery_config` row exists (or it sets no knobs)
- **THEN** the sweep runs with the compiled `DEFAULT_CONFIG` values unchanged

### Requirement: Cheap threshold analysis over the live corpus and members

The system SHALL provide an **analyze** operation that, given a set of knob values, reports their projected effect on the *current* corpus and members **without any `env.AI` call or feed fetch** — computed by reusing the sweep's pure matchers over the embeddings already in `recipe_derived` and each member's favorite/taste vectors. It SHALL report, at minimum: for **δ**, how many corpus recipe pairs would collapse as near-duplicates (cosine ≥ δ), with enough of the top pairs/cosines to show the gap between genuine duplicates and genuine variety; and for **τ**, per member, how many corpus recipes would match (cosine ≥ τ over favorites+taste). It SHALL run against arbitrary candidate knob values (not only the saved ones), so an operator can preview a change before saving. If it bounds the pairwise work (e.g. samples a large corpus), it SHALL report that the result is bounded rather than presenting a partial count as complete.

#### Scenario: δ analysis reports would-be duplicate collapses

- **WHEN** analyze runs at a given δ
- **THEN** it returns the count of corpus pairs at/above δ and a sample of the highest-cosine pairs, computed with no AI call

#### Scenario: τ analysis reports per-member match counts

- **WHEN** analyze runs at a given τ
- **THEN** it returns, per member, how many corpus recipes that member would match (and flags a member with no favorites/taste as cold-start), with no AI call

### Requirement: A no-write dry-run previews the full pipeline and serves as the E2E

The system SHALL provide a **dry-run** operation that executes the entire sweep pipeline (intake → triage → classify → dedup → match → governor) at a given config but **writes nothing** — no corpus recipe, no attribution, no log row — and returns the per-candidate would-be outcomes (import / duplicate / no-match / dietary-gated / parked, with the matched member(s) for a would-be import). It SHALL reuse the unchanged sweep core via a no-write dependency implementation. Because it writes nothing, it is the safe full-pipeline verification on a deployed Worker; this operation discharges the discovery-sweep change's deferred end-to-end test (its task 10.3).

#### Scenario: Dry-run previews outcomes and writes nothing

- **WHEN** an operator triggers a dry-run
- **THEN** it returns the per-candidate would-be outcomes for the current feeds/inbox at the given knobs, and **no** recipe, attribution, or log row is written

#### Scenario: Dry-run reflects the real pipeline

- **WHEN** a candidate would be imported (or deduped, gated, parked) by a real tick at the given config
- **THEN** the dry-run reports that same outcome for it (it drives the same core, only the writes are stubbed)

### Requirement: Config writes are guarded against footgun values

A write to the discovery config SHALL enforce hard floors at the write boundary: a value that would make the sweep dangerously permissive (e.g. τ at or below a minimum, δ at or below a minimum, or a rate cap above a maximum) SHALL be rejected unless the write explicitly confirms the override. The guard SHALL be enforced server-side (not only in the UI), so a direct API call cannot bypass it. Knob values SHALL be validated for type/range (thresholds in [0, 1], caps positive integers).

#### Scenario: A floor-breaching value needs explicit confirmation

- **WHEN** a config write sets τ at or below the floor (or δ below its floor) without the explicit-confirm flag
- **THEN** the write is rejected with a structured error naming the floor, and the stored config is unchanged

#### Scenario: Out-of-range values are rejected

- **WHEN** a config write sets a threshold outside [0, 1] or a non-positive cap
- **THEN** the write is rejected and the stored config is unchanged
