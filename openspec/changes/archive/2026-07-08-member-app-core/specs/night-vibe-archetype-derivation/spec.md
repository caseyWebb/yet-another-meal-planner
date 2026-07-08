## MODIFIED Requirements

### Requirement: On-demand and scheduled derivation, bounded

The system SHALL expose an on-demand `suggest_night_vibes` tool that runs derivation for the caller and returns candidate archetypes (as proposals) so the onboarding / retrospective flow can seed or grow a palette immediately; it SHALL be read-with-respect-to-the-palette (it enqueues proposals; it never writes `night_vibes`). The system SHALL also run derivation as a **scheduled generative reconcile pass** (the pluggable `edge` producer of `profile-reconciliation`), enqueuing new archetypes into `pending_proposals` under a **per-run cap** so a member is never flooded, and recording job health like the other background jobs. A **member-tappable app trigger** (the member web app's suggest endpoint) SHALL additionally be gated by the archetype-derivation job's recorded health: when the job's last run was healthy and within the derivation interval (~20 hours, the same constant the scheduled pass throttles on), the trigger SHALL return a throttled response **without invoking any model**, so a button a member can tap repeatedly cannot spend `env.AI` unboundedly. The agent-mediated MCP tool path is not gated (agent judgment mediates its use).

#### Scenario: Onboarding seeds a palette on demand

- **WHEN** the onboarding flow calls `suggest_night_vibes` for a new member
- **THEN** it returns candidate archetypes as proposals without writing the palette

#### Scenario: The scheduled pass is bounded per member

- **WHEN** the generative reconcile pass would derive many new archetypes for one member in a single run
- **THEN** it enqueues at most the per-run cap and records the run's health, deferring the rest to a later tick

#### Scenario: The app trigger throttles against fresh job health

- **WHEN** the member app's suggest trigger fires while the archetype-derive job's last healthy run is within the derivation interval
- **THEN** it returns a throttled response without running derivation or touching `env.AI`, and a stale or unhealthy last run lets the trigger run the bounded on-demand derivation
