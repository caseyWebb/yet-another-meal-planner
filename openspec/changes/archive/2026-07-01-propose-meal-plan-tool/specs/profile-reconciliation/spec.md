## ADDED Requirements

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

Reconcile output SHALL land in a per-member **pending-proposals queue** (a D1 table), each proposal carrying a kind, payload (the proposed profile diff), a human-readable rationale, the evidence signals, and a status. A member SHALL confirm proposals from **either surface** (a chat tool or the web app): **accept** applies the diff to profile config; **reject** records the rejection as itself a revealed signal (so the same proposal is not re-surfaced). The queue's **producer SHALL be pluggable** — the consumer path (surface + confirmation) SHALL be identical regardless of which synthesis tier produced the proposal.

#### Scenario: Accepting applies the diff

- **WHEN** a proposal is accepted
- **THEN** its diff is applied to the member's profile/palette and the proposal is marked accepted

#### Scenario: Rejecting is itself a signal

- **WHEN** a proposal is rejected
- **THEN** it is recorded as a rejection signal and is not re-proposed on the next reconcile

#### Scenario: Both surfaces see one queue

- **WHEN** either the web app or the chat surface reads the queue
- **THEN** it sees the same pending proposals irrespective of which tier produced them

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
