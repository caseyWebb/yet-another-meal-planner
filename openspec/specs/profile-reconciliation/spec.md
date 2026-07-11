# profile-reconciliation Specification

## Purpose
TBD - created by archiving change propose-meal-plan-tool. Update Purpose after archive.
## Requirements
### Requirement: Retrospective reconciles stated against revealed preference

The `retrospective` capability SHALL grow from reporting eating patterns to **proposing profile edits** that reconcile **stated** preference (the profile: taste, palette, cadences) against **revealed** behavior (the cooking log, overlay favorites/rejects, and in-app slot edits). Proposals SHALL cover palette/cadence **add, prune, and adjust** (e.g. "you cook a simple pasta ~weekly — formalize a weekly pasta vibe?", "you keep removing the salad slot — drop it?", "your monthly project vibe fires but you cook it off-plan — stretch the cadence?"). An `add_vibe` proposal's payload SHALL carry the vibe's **`meal`** (`breakfast | lunch | dinner`, default `dinner`) — every producer (the derivation cron, the pref-retirement seed pass, the reconcile tiers) sets it, and the confirm apply path writes it onto the created meal vibe. Reconciliation SHALL **propose, never silently write** — every change is gated on member confirmation.

#### Scenario: A recurring archetype becomes a cadence proposal

- **WHEN** the cooking log shows a recurring archetype at a stable interval
- **THEN** the reconcile proposes a meal vibe with that cadence (its payload carrying the vibe's `meal`) for the member to confirm, writing nothing yet

#### Scenario: Repeated in-app removals become a prune proposal

- **WHEN** a member repeatedly removes a vibe's slot in-app
- **THEN** the reconcile proposes pruning that vibe rather than continuing to sample it

#### Scenario: Accepting an add_vibe proposal writes its meal

- **WHEN** a member accepts a pending `add_vibe` proposal whose payload carries `meal: "lunch"`
- **THEN** the created palette vibe carries `meal = 'lunch'`

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

### Requirement: Off-plan cadence is attributed at cook time, reconcile is the backstop

The off-plan cadence blind spot — a vibe cooked off-plan not resetting its clock — SHALL be handled primarily at **cook time** by the cosine attribution in `log_cooked` (the `cooking-history` and `night-vibe-palette` capabilities), not by the reconcile pass. The reconcile SHALL therefore no longer treat "cooked it off-plan, cadence never reset" as a primary cause of drift, because such cooks now advance `last_satisfied` immediately. The reconcile SHALL remain a **backstop** for systematic drift the cook-time signal cannot resolve — a vibe whose stated cadence persistently mismatches revealed frequency across many cooks (a stretch/tighten proposal), or a threshold-calibration gap — reading the whole cooking log as before. This narrows the reconcile's mandate; it does not remove the retrospective's stated-vs-revealed reconciliation.

#### Scenario: An off-plan cook no longer needs the reconcile to reset cadence

- **WHEN** a member cooks a vibe's dish off-plan
- **THEN** cook-time cosine attribution advances that vibe's `last_satisfied` immediately, and the reconcile does not need to catch the miss

#### Scenario: The reconcile still catches persistent cadence mismatch

- **WHEN** a vibe's stated `cadence_days` persistently mismatches how often it is actually satisfied across many cooks
- **THEN** the reconcile proposes a cadence stretch/tighten as before, reading the whole cooking log

### Requirement: Preference retirement converges through a seeding signal producer

A named, idempotent scheduled pass — **`runPrefRetirementSeedJob`**, a registered signal producer in the reconcile's scheduled() phase — SHALL converge the retired `lunch_strategy` / `ready_to_eat_default_action` preferences onto seeded meal-vibe suggestions (the D8/D21 value migration, run as pipeline convergence, never manual surgery). For each tenant with a profile row where `lunch_strategy IS NOT NULL OR ready_to_eat_default_action IS NOT NULL`, the pass SHALL, **in one D1 batch**:

1. Enqueue vibe **suggestions** through the existing pending-proposals channel (kind `add_vibe`, the existing `(tenant, kind, target)` enqueue idempotency, deterministic targets) — suggestions, not silent inserts; the palette is member-curated. The mapping is total and decisive: `lunch_strategy = 'leftovers'` → "leftovers remixed into lunch"; `'buy'` → "grab-and-go bought lunch"; `'mixed'` → "leftovers or something quick and easy" (all target `pref-retire:lunch_strategy`, meal `lunch`); `ready_to_eat_default_action = 'auto-add'` → "a zero-effort heat-and-eat night" (target `pref-retire:rte`, meal `dinner`); `'opt-in'` → **no seed** (opt-in is the new universal behavior).
2. **NULL both retired columns** — the convergence marker is the columns themselves (converged ⇔ both NULL). Nothing reads these columns after this deploy except this pass, so NULLing is safe (unlike `default_cooking_nights`, which the cadence read-fallback reads and which therefore stays frozen-not-NULLed until the window-close migration).

The pass SHALL **terminate**: converged tenants match nothing on later ticks; a member's dismissal is final (nothing re-reads the now-NULL columns, so nothing resurrects — no dependence on proposal-disposition retention); the crash window between enqueue and NULL is covered by the enqueue idempotency. The `custom` bag SHALL never be read or written (defined columns only — column wins over any `custom` shadow); tenants with no profile row are skipped structurally by the WHERE clause. The columns-NULL predicate is the deprecation-window column-drop gate, verified read-only against production after deploy (fixture F5).

#### Scenario: A tenant's retired values seed suggestions and converge in one tick (F5)

- **WHEN** the pass first runs over a tenant with `lunch_strategy = 'mixed'` and `ready_to_eat_default_action = 'auto-add'`
- **THEN** exactly two pending `add_vibe` proposals exist afterward — targets `pref-retire:lunch_strategy` (meal `lunch`) and `pref-retire:rte` (meal `dinner`) — both retired columns are NULL, and the tenant's `custom` bag is byte-identical

#### Scenario: The second tick is a no-op

- **WHEN** the pass runs again over the converged tenant
- **THEN** nothing is enqueued and nothing is written — columns-NULL is the convergence predicate, and a dismissed suggestion never resurrects

#### Scenario: Opt-in seeds nothing

- **WHEN** a tenant's only retired value is `ready_to_eat_default_action = 'opt-in'`
- **THEN** the pass NULLs the column and enqueues no proposal — opt-in is the new universal behavior

#### Scenario: NULL-valued and row-less tenants are untouched

- **WHEN** the pass runs over tenants whose retired columns are already NULL and tenants with no profile row at all
- **THEN** none of them is written and no `pref-retire:*` proposal is enqueued for them

#### Scenario: A crash between enqueue and NULL cannot double-seed

- **WHEN** a run crashes after enqueueing but before NULLing, and the next tick re-processes the tenant
- **THEN** the `(tenant, kind, target)` enqueue idempotency suppresses duplicate proposals and the columns are NULLed — convergence completes without a second suggestion

