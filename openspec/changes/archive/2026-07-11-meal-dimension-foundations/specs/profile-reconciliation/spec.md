## MODIFIED Requirements

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

## ADDED Requirements

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
