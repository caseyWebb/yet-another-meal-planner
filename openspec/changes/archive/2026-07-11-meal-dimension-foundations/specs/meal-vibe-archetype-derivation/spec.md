## ADDED Requirements

### Requirement: Archetypes are derived from revealed taste

The system SHALL derive candidate meal-vibe archetypes for a member from their **revealed** taste — their favorited recipes and recently-cooked recipes — by clustering those recipes' embeddings (`recipe_derived`) into archetype groups. Each cluster SHALL yield one candidate vibe whose query phrase names the cluster and whose `cadence_days` is inferred from that cluster's **observed cook interval** in the cooking log (a cluster cooked ~weekly → a ~weekly cadence). Clustering SHALL be **deterministic** (seeded) so a given member's taste-space yields a stable set of archetypes.

#### Scenario: A recurring cooking pattern becomes a candidate archetype

- **WHEN** a member's cooking log shows a tight group of similar dishes cooked at a regular interval
- **THEN** derivation produces a candidate meal vibe naming that group, with a `cadence_days` near the observed interval

#### Scenario: Derivation is deterministic

- **WHEN** derivation runs twice over the same favorites + cooking log with the same seed
- **THEN** it produces the same set of candidate archetypes

### Requirement: Naming classifies phrase, weather bucket, and meal in one small-model call

The system SHALL name each cluster into a craving-aligned vibe phrase using a **small model** (a quick-summary call over the cluster's nearest recipe descriptions), not the frontier model on any hot path — mirroring the discovery classifier / `generateDescription` precedent. The single naming call SHALL return **three** reply lines: the vibe phrase, the weather-bucket label, and the **meal label**. The meal label SHALL be parsed strictly against the closed set `breakfast | lunch | dinner` (`parseMealLabel`, mirroring `parseBucketLabel`) and SHALL **fail closed to `'dinner'`** on a missing, invalid, or unparseable label — a misclassification costs a mis-shelved suggestion the member retags, never a crash or a dropped suggestion. **For a non-dinner classification the weather-bucket label SHALL be discarded** (weather is dinner-only; never store dead data). Derived suggestions SHALL carry `meal` through the pending-proposal payload. A derived archetype SHALL be surfaced as a **proposal**, never silently written to the palette; the member confirms it (the `profile-reconciliation` capability's `confirm_proposal`). Naming MAY instead be produced by the operator's frontier model via the operator reconcile surface; both paths SHALL enqueue to the same `pending_proposals` queue. The delta adds no new AI spend — same generation call, one more reply line.

#### Scenario: A derived archetype is a proposal carrying its meal, not an auto-write

- **WHEN** derivation names a new lunch-shaped archetype for a member
- **THEN** it is enqueued as an `add_vibe` proposal whose payload carries `meal: "lunch"`, and nothing is written to the palette until the member accepts

#### Scenario: An unparseable meal label fails closed to dinner

- **WHEN** the naming call's meal line is missing or outside the closed set
- **THEN** the candidate is kept with `meal: 'dinner'` — the suggestion is neither dropped nor an error

#### Scenario: A non-dinner cluster discards its weather bucket

- **WHEN** the naming call classifies a cluster as `lunch` and also returns a weather-bucket label
- **THEN** the bucket label is discarded and the derived suggestion carries no weather bucket

#### Scenario: Naming does not run the frontier model on a hot path

- **WHEN** archetype naming runs in the background derivation pass
- **THEN** it uses the small edge model (or, when the operator drives it, the operator's own frontier), never a synchronous frontier call on a member request

### Requirement: Derived archetypes are deduped against the existing palette

Before enqueueing, the system SHALL drop any candidate vibe whose **named phrase** is already covered within its meal — measured by cosine similarity of the candidate phrase's embedding, in the same embedding space as the palette's `night_vibe_derived` phrase vectors, at a shared threshold, **keyed on `(meal, phrase-space)`** (a lunch candidate dedupes against lunch vibes and lunch-mealed proposals; a pending proposal lacking `meal` is treated as `dinner`) — by any of: (a) an existing **palette** vibe of that meal (a palette vibe not yet reconciled into `night_vibe_derived` SHALL be embedded in the same pass, so a just-confirmed vibe still dedupes), (b) a **pending** `add_vibe` proposal of that meal, (c) a **rejected** `add_vibe` proposal of that meal (a dismissed archetype SHALL NOT return under a paraphrased name), or (d) a candidate of that meal already kept **in the same run**. This dedup SHALL apply to **every candidate source** — cluster-derived and cold-start alike. The clusters branch MAY additionally pre-filter clusters whose centroid is covered by a palette vector before spending naming calls, as an optimization; the `(meal, phrase-space)` check is the gate. Combined with the queue's stable-id idempotency, this SHALL prevent proposing a vibe the member already has, already sees pending, or already rejected. The per-run embedding work SHALL be bounded to one batched, cached embed call (no per-phrase model calls, never the frontier).

#### Scenario: An already-covered archetype is not re-proposed

- **WHEN** a derived dinner candidate's named phrase is within the threshold of a dinner vibe already in the member's palette (e.g. a candidate "A comforting Southern pot pie" against a palette "A comforting Southern meal")
- **THEN** it is dropped and no `add_vibe` proposal is enqueued for it

#### Scenario: The same phrase in a different meal is not a duplicate

- **WHEN** a derived lunch candidate's phrase is within the threshold of a dinner palette vibe but of no lunch vibe or lunch-mealed proposal
- **THEN** it survives dedupe — the convergence key is `(meal, phrase-space)`, not phrase-space alone

#### Scenario: A rejected archetype does not return

- **WHEN** a member has rejected a derived `add_vibe` proposal and a later pass derives the same archetype for the same meal — under the same name or a paraphrase within the threshold
- **THEN** the queue's stable id suppresses the identical name and the `(meal, phrase-space)` dedup drops the paraphrase; neither is enqueued

#### Scenario: Cold-start candidates are deduped identically

- **WHEN** the cold-start fallback generates starter vibes for a member with rejected or pending `add_vibe` proposals near one of the starters in the same meal
- **THEN** that starter is dropped by the same `(meal, phrase-space)` dedup before enqueue

### Requirement: Cold-start seeding from taste text

When a member has too little cooking history or too few favorites to cluster meaningfully **and their palette is empty**, the system SHALL fall back to deriving a small set of **starter** archetypes from the member's authored `taste` text (a small-model call), so a brand-new member can be offered a palette before they have a cook history. Starter vibes SHALL carry `meal: 'dinner'` — taste notes carry no per-meal signal, and the system never fabricates one. These SHALL also be surfaced as proposals, never auto-written, and SHALL be superseded by behavior-derived archetypes as history accumulates. Once the member's palette is non-empty, the cold-start fallback SHALL NOT run: a member with a palette but a taste-space too thin to cluster is derived nothing (`source: "none"`) and the pass spends no naming call — their palette grows again when their history supports clustering. Cold-start candidates SHALL pass through the same `(meal, phrase-space)` dedup as cluster-derived candidates.

#### Scenario: A new member is offered a starter palette

- **WHEN** a member with an authored taste profile, little/no cooking history, and an empty palette is derived for
- **THEN** starter archetypes are proposed from their taste text, each carrying `meal: 'dinner'`, so `propose_meal_plan` is usable after they confirm some

#### Scenario: A confirmed palette stops the starter generator

- **WHEN** a member has confirmed palette vibes but still too little history to cluster
- **THEN** the derivation pass proposes nothing from taste text, reports `source: "none"`, and makes no naming-model call

#### Scenario: Thin taste and no history yields nothing rather than noise

- **WHEN** a member has neither meaningful history nor taste text
- **THEN** derivation proposes nothing (no fabricated archetypes), and the surface reports the palette is empty

### Requirement: On-demand and scheduled derivation, bounded

The system SHALL expose an on-demand `suggest_meal_vibes` tool (with `suggest_night_vibes` as a deprecation-window dispatch alias) that runs derivation for the caller and returns candidate archetypes (as proposals) so the onboarding / retrospective flow can seed or grow a palette immediately; it SHALL be read-with-respect-to-the-palette (it enqueues proposals; it never writes the palette table). The system SHALL also run derivation as a **scheduled generative reconcile pass** (the pluggable `edge` producer of `profile-reconciliation`), enqueuing new archetypes into `pending_proposals` under a **per-run cap** so a member is never flooded, and recording job health like the other background jobs. These two — the cron and the agent-mediated tool — are the only derivation producers; the agent-mediated tool path is not throttle-gated (agent judgment mediates its use).

#### Scenario: Onboarding seeds a palette on demand

- **WHEN** the onboarding flow calls `suggest_meal_vibes` for a new member
- **THEN** it returns candidate archetypes as proposals without writing the palette

#### Scenario: The scheduled pass is bounded per member

- **WHEN** the generative reconcile pass would derive many new archetypes for one member in a single run
- **THEN** it enqueues at most the per-run cap and records the run's health, deferring the rest to a later tick

### Requirement: Derivation runs converge near-duplicate pending suggestions

Each derivation run (the tool and the scheduled pass — one shared core) SHALL first converge the member's existing **pending** `add_vibe` proposals, so redundancy that has already accumulated heals organically through the pipeline: iterating pending proposals in ascending `(created_at, id)` order, a proposal whose phrase is within the shared threshold — under the **`(meal, phrase-space)`** convergence key, with a proposal lacking `meal` treated as `dinner` — of (a) a palette vibe of that meal, (b) a rejected `add_vibe` proposal of that meal, or (c) an earlier surviving pending proposal of that meal SHALL be resolved as **superseded**; otherwise it survives as its group's **representative**. The representative of a near-duplicate pending group is therefore the **earliest-created** proposal (ties broken by lowest id), making convergence deterministic and idempotent — a rerun over converged state changes nothing. The sweep SHALL run even when the pass derives no new candidates, SHALL only ever resolve rows whose status is `pending` (member-resolved rows — accepted or rejected — are never modified), and SHALL report the number superseded in the run's result and the scheduled job's health summary.

#### Scenario: An accumulated pile of paraphrases collapses to one suggestion per archetype

- **WHEN** a member's queue holds several pending `add_vibe` proposals within the threshold of each other in the same meal
- **THEN** the next derivation run leaves the earliest-created one pending and marks the rest superseded, and the member's suggestion surfaces show one suggestion for that archetype

#### Scenario: Meal-less pending proposals converge as dinner

- **WHEN** the sweep encounters a pending `add_vibe` proposal enqueued before the meal dimension existed
- **THEN** it participates in convergence as a `dinner` proposal

#### Scenario: Member dismissals are never rewritten

- **WHEN** the sweep runs over a queue containing rejected proposals
- **THEN** every rejected row keeps its status and `resolved_at` untouched, and rejected proposals participate only as dedup evidence

#### Scenario: Convergence is idempotent

- **WHEN** the sweep runs twice over the same queue state
- **THEN** the second run supersedes nothing further and the same representatives remain pending
