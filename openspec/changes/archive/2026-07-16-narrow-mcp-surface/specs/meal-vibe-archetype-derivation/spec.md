# meal-vibe-archetype-derivation — delta

## ADDED Requirements

### Requirement: Scheduled derivation is the sole producer, bounded

The system SHALL run archetype derivation as a **scheduled generative reconcile pass** (the pluggable `edge` producer of `profile-reconciliation`), enqueuing new archetypes into `pending_proposals` under a **per-run cap** so a member is never flooded, and recording job health like the other background jobs. The cron SHALL be the sole derivation producer: there is no member-facing `suggest_meal_vibes` MCP tool (nor its `suggest_night_vibes` alias) and no member-tappable suggest trigger (the retired `/api/vibes/suggest` stub is owned by `remove-meal-dimension-shims`). Derivation output still reaches the member as proposals — confirmed from the member app's reconciliation queue — and the pass SHALL remain read-with-respect-to-the-palette (it enqueues proposals; it never writes the palette table). The derivation internals (clustering, naming, `(meal, phrase-space)` dedup, pending-near-duplicate convergence, cold-start starters) are unchanged.

#### Scenario: The scheduled pass is bounded per member

- **WHEN** the generative reconcile pass would derive many new archetypes for one member in a single run
- **THEN** it enqueues at most the per-run cap and records the run's health, deferring the rest to a later tick

#### Scenario: A new member's palette seeds from the cron, not a tool

- **WHEN** a new member accrues favorites/cook history (or taste notes, cold-start) and the scheduled pass runs
- **THEN** candidate archetypes land as pending proposals for the member to confirm, with no on-demand derivation tool involved

#### Scenario: Derivation never writes the palette

- **WHEN** the pass produces candidates
- **THEN** only `pending_proposals` rows are written; the palette table changes only when the member accepts a proposal

## REMOVED Requirements

### Requirement: On-demand and scheduled derivation, bounded

**Reason**: The on-demand `suggest_meal_vibes` tool (and its `suggest_night_vibes` alias) leaves the member surface in the cull; the scheduled generative reconcile pass — already one of the two producers, with identical dedup/convergence internals — becomes the only one. Onboarding no longer needs an in-conversation trigger: proposals accumulate on the cron and are confirmed from the member app's queue.
**Migration**: The ADDED "Scheduled derivation is the sole producer, bounded" requirement carries the cron path forward verbatim. Hard removal, no dispatch alias.
