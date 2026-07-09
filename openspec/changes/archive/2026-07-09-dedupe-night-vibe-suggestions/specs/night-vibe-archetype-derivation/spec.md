# night-vibe-archetype-derivation — deltas

## MODIFIED Requirements

### Requirement: Derived archetypes are deduped against the existing palette

Before enqueueing, the system SHALL drop any candidate vibe whose **named phrase** is already covered — measured by cosine similarity of the candidate phrase's embedding, in the same embedding space as the palette's `night_vibe_derived` phrase vectors, at a shared threshold — by any of: (a) an existing **palette** vibe (a palette vibe not yet reconciled into `night_vibe_derived` SHALL be embedded in the same pass, so a just-confirmed vibe still dedupes), (b) a **pending** `add_vibe` proposal, (c) a **rejected** `add_vibe` proposal (a dismissed archetype SHALL NOT return under a paraphrased name), or (d) a candidate already kept **in the same run**. This phrase-space dedup SHALL apply to **every candidate source** — cluster-derived and cold-start alike. The clusters branch MAY additionally pre-filter clusters whose centroid is covered by a palette vector before spending naming calls, as an optimization; the phrase-space check is the gate. Combined with the queue's stable-id idempotency, this SHALL prevent proposing a vibe the member already has, already sees pending, or already rejected. The per-run embedding work SHALL be bounded to one batched, cached embed call (no per-phrase model calls, never the frontier).

#### Scenario: An already-covered archetype is not re-proposed

- **WHEN** a derived candidate's named phrase is within the threshold of a vibe already in the
  member's palette (e.g. a candidate "A comforting Southern pot pie" against a palette
  "A comforting Southern meal")
- **THEN** it is dropped and no `add_vibe` proposal is enqueued for it

#### Scenario: A paraphrase of a pending suggestion is not enqueued

- **WHEN** a run derives a candidate whose phrase is within the threshold of an `add_vibe`
  proposal already pending (e.g. "A mild Asian stir-fry" against a pending "A quick chicken
  stir-fry")
- **THEN** the candidate is dropped rather than enqueued as a second near-identical suggestion

#### Scenario: A rejected archetype does not return

- **WHEN** a member has rejected a derived `add_vibe` proposal and a later pass derives the
  same archetype — under the same name or a paraphrase within the threshold (e.g. "A fiery
  seafood skillet" after rejecting "A spicy seafood skillet")
- **THEN** the queue's stable id suppresses the identical name and the phrase-space dedup
  drops the paraphrase; neither is enqueued

#### Scenario: Two clusters naming to near-identical phrases yield one proposal

- **WHEN** two candidates in a single run name to phrases within the threshold of each other
- **THEN** only the first-kept candidate is enqueued

#### Scenario: Cold-start candidates are deduped identically

- **WHEN** the cold-start fallback generates starter vibes for a member with rejected or
  pending `add_vibe` proposals near one of the starters
- **THEN** that starter is dropped by the same phrase-space dedup before enqueue

### Requirement: Cold-start seeding from taste text

When a member has too little cooking history or too few favorites to cluster meaningfully **and their palette is empty**, the system SHALL fall back to deriving a small set of **starter** archetypes from the member's authored `taste` text (a small-model call), so a brand-new member can be offered a palette before they have a cook history. These SHALL also be surfaced as proposals, never auto-written, and SHALL be superseded by behavior-derived archetypes as history accumulates. Once the member's palette is non-empty, the cold-start fallback SHALL NOT run: a member with a palette but a taste-space too thin to cluster is derived nothing (`source: "none"`) and the pass spends no naming call — their palette grows again when their history supports clustering. Cold-start candidates SHALL pass through the same phrase-space dedup as cluster-derived candidates.

#### Scenario: A new member is offered a starter palette

- **WHEN** a member with an authored taste profile, little/no cooking history, and an empty
  palette is derived for
- **THEN** starter archetypes are proposed from their taste text, so `propose_meal_plan` is
  usable after they confirm some

#### Scenario: A confirmed palette stops the starter generator

- **WHEN** a member has confirmed palette vibes but still too little history to cluster
- **THEN** the derivation pass proposes nothing from taste text, reports `source: "none"`,
  and makes no naming-model call

#### Scenario: Thin taste and no history yields nothing rather than noise

- **WHEN** a member has neither meaningful history nor taste text
- **THEN** derivation proposes nothing (no fabricated archetypes), and the surface reports the
  palette is empty

## ADDED Requirements

### Requirement: Derivation runs converge near-duplicate pending suggestions

Each derivation run (the tool, the member-app trigger, and the scheduled pass — one shared core) SHALL first converge the member's existing **pending** `add_vibe` proposals, so redundancy that has already accumulated heals organically through the pipeline: iterating pending proposals in ascending `(created_at, id)` order, a proposal whose phrase is within the shared threshold of (a) a palette vibe, (b) a rejected `add_vibe` proposal, or (c) an earlier surviving pending proposal SHALL be resolved as **superseded**; otherwise it survives as its group's **representative**. The representative of a near-duplicate pending group is therefore the **earliest-created** proposal (ties broken by lowest id), making convergence deterministic and idempotent — a rerun over converged state changes nothing. The sweep SHALL run even when the pass derives no new candidates, SHALL only ever resolve rows whose status is `pending` (member-resolved rows — accepted or rejected — are never modified), and SHALL report the number superseded in the run's result and the scheduled job's health summary.

#### Scenario: An accumulated pile of paraphrases collapses to one suggestion per archetype

- **WHEN** a member's queue holds several pending `add_vibe` proposals within the threshold of
  each other (e.g. six chicken stir-fry paraphrases enqueued across successive daily runs)
- **THEN** the next derivation run leaves the earliest-created one pending and marks the rest
  superseded, and the member's suggestion surfaces show one stir-fry suggestion

#### Scenario: A pending suggestion covered by the palette or a dismissal is resolved

- **WHEN** a pending `add_vibe` proposal is within the threshold of a vibe the member has since
  confirmed into their palette, or of a proposal they rejected
- **THEN** the sweep marks it superseded — the member is not asked about a vibe they already
  have or already declined

#### Scenario: Member dismissals are never rewritten

- **WHEN** the sweep runs over a queue containing rejected proposals
- **THEN** every rejected row keeps its status and `resolved_at` untouched, and rejected
  proposals participate only as dedup evidence

#### Scenario: Convergence is idempotent

- **WHEN** the sweep runs twice over the same queue state
- **THEN** the second run supersedes nothing further and the same representatives remain
  pending
