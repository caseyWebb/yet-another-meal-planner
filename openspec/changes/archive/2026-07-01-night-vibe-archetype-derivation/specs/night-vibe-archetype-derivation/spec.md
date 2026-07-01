## ADDED Requirements

### Requirement: Archetypes are derived from revealed taste

The system SHALL derive candidate night-vibe archetypes for a member from their **revealed** taste — their favorited recipes and recently-cooked recipes — by clustering those recipes' embeddings (`recipe_derived`) into archetype groups. Each cluster SHALL yield one candidate vibe whose query phrase names the cluster and whose `cadence_days` is inferred from that cluster's **observed cook interval** in the cooking log (a cluster cooked ~weekly → a ~weekly cadence). Clustering SHALL be **deterministic** (seeded) so a given member's taste-space yields a stable set of archetypes.

#### Scenario: A recurring cooking pattern becomes a candidate archetype

- **WHEN** a member's cooking log shows a tight group of similar dishes cooked at a regular interval
- **THEN** derivation produces a candidate night vibe naming that group, with a `cadence_days` near the observed interval

#### Scenario: Derivation is deterministic

- **WHEN** derivation runs twice over the same favorites + cooking log with the same seed
- **THEN** it produces the same set of candidate archetypes

### Requirement: Naming uses a small model, gated by confirmation

The system SHALL name each cluster into a craving-aligned vibe phrase using a **small model** (a quick-summary call over the cluster's nearest recipe descriptions), not the frontier model on any hot path — mirroring the discovery classifier / `generateDescription` precedent. A derived archetype SHALL be surfaced as a **proposal**, never silently written to the palette; the member confirms it (the `profile-reconciliation` capability's `confirm_proposal`). Naming MAY instead be produced by the operator's frontier model via the operator reconcile surface; both paths SHALL enqueue to the same `pending_proposals` queue.

#### Scenario: A derived archetype is a proposal, not an auto-write

- **WHEN** derivation names a new archetype for a member
- **THEN** it is enqueued as an `add_vibe` proposal for the member to confirm, and nothing is written to `night_vibes` until they accept

#### Scenario: Naming does not run the frontier model on a hot path

- **WHEN** archetype naming runs in the background derivation pass
- **THEN** it uses the small edge model (or, when the operator drives it, the operator's own frontier), never a synchronous frontier call on a member request

### Requirement: Derived archetypes are deduped against the existing palette

Before proposing an archetype, the system SHALL drop any candidate whose centroid is already covered by an existing palette vibe — measured by cosine similarity of the candidate against the member's `night_vibe_derived` vectors, above a threshold. This SHALL prevent proposing a vibe the member already has, and combined with the queue's stable-id idempotency, SHALL prevent re-proposing a candidate the member already rejected.

#### Scenario: An already-covered archetype is not re-proposed

- **WHEN** a derived archetype is semantically close to a vibe already in the member's palette
- **THEN** it is dropped and no `add_vibe` proposal is enqueued for it

#### Scenario: A rejected archetype does not return

- **WHEN** a member has rejected a derived `add_vibe` proposal and the next derivation pass re-derives the same archetype
- **THEN** the queue's stable id suppresses re-proposing it

### Requirement: Cold-start seeding from taste text

When a member has too little cooking history or too few favorites to cluster meaningfully, the system SHALL fall back to deriving a small set of **starter** archetypes from the member's authored `taste` text (a small-model call), so a brand-new member can be offered a palette before they have a cook history. These SHALL also be surfaced as proposals, never auto-written, and SHALL be superseded by behavior-derived archetypes as history accumulates.

#### Scenario: A new member is offered a starter palette

- **WHEN** a member with an authored taste profile but little/no cooking history is derived for
- **THEN** starter archetypes are proposed from their taste text, so `propose_meal_plan` is usable after they confirm some

#### Scenario: Thin taste and no history yields nothing rather than noise

- **WHEN** a member has neither meaningful history nor taste text
- **THEN** derivation proposes nothing (no fabricated archetypes), and the surface reports the palette is empty

### Requirement: On-demand and scheduled derivation, bounded

The system SHALL expose an on-demand `suggest_night_vibes` tool that runs derivation for the caller and returns candidate archetypes (as proposals) so the onboarding / retrospective flow can seed or grow a palette immediately; it SHALL be read-with-respect-to-the-palette (it enqueues proposals; it never writes `night_vibes`). The system SHALL also run derivation as a **scheduled generative reconcile pass** (the pluggable `edge` producer of `profile-reconciliation`), enqueuing new archetypes into `pending_proposals` under a **per-run cap** so a member is never flooded, and recording job health like the other background jobs.

#### Scenario: Onboarding seeds a palette on demand

- **WHEN** the onboarding flow calls `suggest_night_vibes` for a new member
- **THEN** it returns candidate archetypes as proposals without writing the palette

#### Scenario: The scheduled pass is bounded per member

- **WHEN** the generative reconcile pass would derive many new archetypes for one member in a single run
- **THEN** it enqueues at most the per-run cap and records the run's health, deferring the rest to a later tick
