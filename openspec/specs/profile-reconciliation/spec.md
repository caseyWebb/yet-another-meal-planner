# profile-reconciliation Specification

## Purpose
TBD - created by archiving change propose-meal-plan-tool. Update Purpose after archive.
## Requirements
### Requirement: Retrospective reconciles stated against revealed preference

The `retrospective` capability SHALL grow from reporting eating patterns to **proposing profile edits** that reconcile **stated** preference (the profile: taste, palette, cadences) against **revealed** behavior (the cooking log, overlay favorites/rejects, and in-app slot edits). Proposals SHALL cover palette/cadence **add, prune, and adjust** (e.g. "you cook a simple pasta ~weekly — formalize a weekly pasta vibe?", "you keep removing the salad night — drop it?", "your monthly project vibe fires but you cook it off-plan — stretch the cadence?"). Reconciliation SHALL **propose, never silently write** — every change is gated on member confirmation.

#### Scenario: A recurring archetype becomes a cadence proposal

- **WHEN** the cooking log shows a recurring archetype at a stable interval
- **THEN** the reconcile proposes a night vibe with that cadence for the member to confirm, writing nothing yet

#### Scenario: Repeated in-app removals become a prune proposal

- **WHEN** a member repeatedly removes a vibe's slot in-app
- **THEN** the reconcile proposes pruning that vibe rather than continuing to sample it

#### Scenario: Nothing is written without confirmation

- **WHEN** the reconcile identifies a change
- **THEN** it enqueues a proposal and writes nothing to the profile until the member confirms

### Requirement: Deterministic signal cron

A scheduled, deterministic **signal** pass SHALL compute the reconcile inputs per member — cadence debt, cluster/taste drift, and prune candidates — cheaply and always-fresh, with **no large-model call** (arithmetic over the cooking log plus, at most, small-model or `k`-means clustering). The signals SHALL be the substrate both synthesis tiers read; the cron itself SHALL NOT author profile edits.

#### Scenario: Signals are computed without a large model

- **WHEN** the signal cron runs
- **THEN** it records per-member debt/drift/prune signals without invoking a large model and without mutating any profile

#### Scenario: Synthesis reads precomputed signals

- **WHEN** a synthesis pass runs later
- **THEN** it reads the precomputed signals rather than recomputing them

### Requirement: Pending-proposals queue with member confirmation

Reconcile output SHALL land in a per-member **pending-proposals queue** (a D1 table), each proposal carrying a kind, payload (the proposed profile diff), a human-readable rationale, the evidence signals, and a status. A member SHALL confirm proposals from **either surface** (a chat tool or the web app): **accept** applies the diff to profile config; **reject** records the rejection as itself a revealed signal (so the same proposal is not re-surfaced). The queue's **producer SHALL be pluggable** — the consumer path (surface + confirmation) SHALL be identical regardless of which synthesis tier produced the proposal. In addition to the member-resolved statuses, a proposal MAY be resolved as **`superseded`** — a system resolution set only by the derivation convergence sweep, and only on `pending` rows, when the proposal is a near-duplicate of a palette vibe, of a rejected proposal, or of an earlier pending representative. Superseded proposals SHALL be excluded from member-facing pending reads (both surfaces), SHALL answer a confirm attempt with the same structured conflict as any already-resolved proposal, and SHALL be distinct from `rejected`: a member dismissal is a revealed signal only the member can produce, and no system pass may set or alter it.

#### Scenario: Accepting applies the diff

- **WHEN** a proposal is accepted
- **THEN** its diff is applied to the member's profile/palette and the proposal is marked
  accepted

#### Scenario: Rejecting is itself a signal

- **WHEN** a proposal is rejected
- **THEN** it is recorded as a rejection signal and is not re-proposed on the next reconcile

#### Scenario: Both surfaces see one queue

- **WHEN** either the web app or the chat surface reads the queue
- **THEN** it sees the same pending proposals irrespective of which tier produced them

#### Scenario: A superseded proposal leaves the member surfaces

- **WHEN** the convergence sweep marks a pending proposal superseded
- **THEN** it no longer appears in `list_proposals` or the web app's queue, and a confirm
  against its id answers a structured conflict naming its status

### Requirement: Pluggable synthesis across a model-frequency gradient

Proposal **synthesis** SHALL be pluggable across two tiers over the same signals: a **routine** pass on a server-side edge model (autonomous, high-confidence patterns) and an **occasional** deeper pass driven by the **operator's frontier model** (the operator's own Claude, for nuanced cross-member reconciliation). This realizes a **model-frequency gradient** — the hot path stays deterministic, the capture crons use small models, and the rarest, highest-judgment, human-gated reconcile reaches for the most capable model available. Both tiers SHALL write to the same pending-proposals queue.

#### Scenario: Routine pass runs autonomously

- **WHEN** the routine edge-model pass runs
- **THEN** it enqueues high-confidence proposals autonomously without operator involvement

#### Scenario: Operator deep pass shares the queue

- **WHEN** the operator runs a deep reconcile
- **THEN** its richer proposals enter the same per-member queues as the routine pass

### Requirement: Operator-privileged cross-tenant reconcile surface

The operator-frontier tier SHALL be enabled by an operator-privileged, cross-tenant surface: a tenant flagged `isOperator` (resolved before any tool runs, as identity already is) SHALL be the only identity able to read the cross-member signal bundle and enqueue per-member proposals. This SHALL be consistent with the operator's existing cross-tenant trust (the admin Data explorer) and SHALL NOT grant any non-operator cross-tenant reach. The operator-frontier path moves member behavior into the operator's model context; the edge-model path SHALL remain available as the alternative that keeps member data inside the Worker (an explicit privacy trade the operator chooses).

#### Scenario: A non-operator cannot reach across tenants

- **WHEN** a non-operator tenant invokes a reconcile tool
- **THEN** it is denied cross-tenant access and can act only on its own profile/queue

#### Scenario: The operator may synthesize cross-member, still gated by confirmation

- **WHEN** the operator tenant runs the reconcile
- **THEN** it may read the cross-member signal bundle and enqueue proposals into each member's queue, with member confirmation still required to apply any change

### Requirement: Deterministic cadence-tighten proposals

The deterministic signal pass SHALL draft a **tighten** proposal — the sibling of the existing defer-driven stretch — for a cadence vibe the member repeatedly satisfies well before its stated period: given the vibe's satisfaction dates (slot provenance from the cooking log), when the vibe has at least three satisfactions, each of its two most recent satisfaction intervals is at most half its `cadence_days`, and the vibe is currently on-track (days since last satisfied are under one period), the pass SHALL draft an `adjust_cadence` proposal suggesting the observed interval (the rounded mean of those recent intervals, floored at 3 days), and only when the suggestion is strictly below the current cadence. Tighten SHALL reuse the existing `adjust_cadence` kind, queue, stable-id dedupe (value-bucketed, so a rejected tighten near the same value is not re-surfaced while a materially different later suggestion is a new proposal), confirmation, and apply path — no new consumer surface — with the direction expressed in the rationale and the observed intervals in the evidence. Tighten and stretch SHALL be mutually exclusive for one vibe in one pass by construction (stretch requires the current interval to run long; tighten requires on-track). Like every deterministic signal, it SHALL draft with no model call and write nothing without member confirmation.

#### Scenario: Repeated early satisfaction proposes a tighter cadence

- **WHEN** a vibe with `cadence_days: 14` has been satisfied three times with its last two intervals at 6 and 7 days and is currently on-track
- **THEN** the pass drafts an `adjust_cadence` proposal suggesting ~7 days, with the observed intervals in its evidence, and writes nothing to the palette

#### Scenario: An overdue vibe is never tightened

- **WHEN** a vibe's historical intervals were tight but its current interval since last satisfaction has exceeded its cadence
- **THEN** no tighten proposal is drafted for it

#### Scenario: A rejected tighten is not re-surfaced

- **WHEN** a member rejects a tighten proposal and the next signal pass observes the same behavior
- **THEN** the re-drafted proposal resolves to the same stable id and is not re-enqueued, while a later, materially different suggested cadence yields a new proposal

#### Scenario: Accepting a tighten uses the existing apply path

- **WHEN** a member accepts a tighten proposal from either surface
- **THEN** the existing `adjust_cadence` apply updates the vibe's `cadence_days` to the suggested value, with no tighten-specific apply logic

