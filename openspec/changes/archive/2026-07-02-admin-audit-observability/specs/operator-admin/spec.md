# operator-admin — delta for admin-audit-observability

## ADDED Requirements

### Requirement: Normalize area has an Audits tab showing audit convergence

The Normalize area SHALL have an **Audits** sub-nav tab (deep-linkable by query param) presenting the self-healing audit pipeline as a convergence surface, server-rendered with no client JS. It SHALL show: (1) a **backlog-burndown hero** with the live count of unaudited alias rows and unaudited edge rows (`source='auto' AND audited_at IS NULL`), each with a short recent burndown series derived from the audit jobs' run history; (2) **three pass cards** — alias audit, edge audit, sku-cache re-key — each with its latest-run summary counts from the job's `job_runs` summary and a per-tick worked-rows sparkline; (3) a **restorations log** of `edge_restore` decisions, each linking the origin decision it revisits (via the structured `replay_of` detail); and (4) a **merge-rejection table** over `ingredient_coresolution_rejection` (pair, rejected-at, backoff expiry). A fully drained backlog (both counts zero) SHALL render as a **positive terminal state** (green, "holds at zero" language) — never as a dead zero or a failure.

#### Scenario: Draining backlog renders as converging

- **WHEN** unaudited alias or edge rows remain
- **THEN** the Audits tab shows the live per-table counts with a falling burndown series and "draining" language, and each pass card shows its latest-run summary counts

#### Scenario: Cleared backlog renders green, not dead

- **WHEN** both unaudited counts are zero
- **THEN** the hero renders the converged (green/positive) state with "holds at zero" language, and the pass cards render their settled state

#### Scenario: A restoration links back to its origin decision

- **WHEN** an `edge_restore` log row carries a `replay_of` reference to the original `edge_drop` decision
- **THEN** the restorations log renders the restored edge with its verdict and a pointer to the origin decision id

### Requirement: Normalize Decisions view has a Terms/Edges segment

The Normalize › Decisions view SHALL have a **Terms / Edges** segment control (query-param state, Terms default; both segments deep-linkable). **Terms** SHALL remain the existing term-decision stream, which SHALL continue to exclude `edge_*` outcomes. **Edges** SHALL be a stream of edge decisions read from the normalization log (`edge_keep` / `edge_drop`), filterable All / Kept / Dropped, rendering each decision's directed edge (from → to, relationship kind), outcome, and — when present — its verdict and reason. Kept decisions SHALL carry the positive (green) treatment and drops the neutral one; a decision flagged as a self-loop or cycle drop SHALL show an amber flag chip; a drop later revisited by the replay pass SHALL show a "revisited → Restorations" pointer. Edge identity SHALL come from the structured `detail` fields when present, falling back to the strict legacy `term` parse (`from -[kind]-> to`) shared with the edge-audit job — never a looser parse.

#### Scenario: Edges segment lists keep and drop verdicts

- **WHEN** the operator opens Decisions › Edges
- **THEN** edge decisions render newest-first with from→to, kind, outcome badge, and the Kept/Dropped filters partition them

#### Scenario: Terms stream is unchanged

- **WHEN** the operator views Decisions › Terms
- **THEN** the term-decision stream renders exactly as before, with no `edge_*` rows in it

#### Scenario: A revisited drop points at Restorations

- **WHEN** an `edge_drop` decision was later re-decided by the replay pass
- **THEN** its card shows a pointer to the restorations log entry that revisited it

### Requirement: Status shows the identity audit as one self-terminating convergence row

The Status › Background jobs list SHALL show the identity audit as **one** sibling row (like the grocery-reconcile row), presenting a **backlog burndown** — the combined unaudited alias + edge counts and their burndown series — with **no uptime percentage** (meaningless for a draining backlog). The row SHALL expand to per-pass this-tick counts for the three audit passes, and SHALL link to the Normalize › Audits tab. A drained backlog SHALL render as a calm positive state (clean/settled), never as failing or never-run.

#### Scenario: One audit row, burndown not uptime

- **WHEN** the operator views Status while the audit backlog is draining
- **THEN** exactly one identity-audit row renders with the remaining-row count and burndown sparklines, and no uptime % is shown for it

#### Scenario: Expanding reveals per-pass counts

- **WHEN** the operator expands the identity-audit row
- **THEN** the alias, edge, and sku-cache passes' this-tick counts render

### Requirement: Recipe-index Status row carries an inline backfill gauge

The `recipe-index` job row on Status SHALL include an inline **backfill gauge** when run history exists: the current `unresolved` count, the percent resolved relative to the window's starting count, and a burndown series read from the job's run summaries. A run summary with `degraded: true` SHALL surface as a **calm amber chip** — visually distinct from the failure treatment — since a degraded tick resumes next run and is not a job failure.

#### Scenario: Backfill gauge renders from run summaries

- **WHEN** recipe-index runs report a positive `unresolved` count
- **THEN** the row shows the unresolved count, % resolved, and the burndown series

#### Scenario: Degraded is amber, never failure-styled

- **WHEN** the latest recipe-index run reports `degraded: true`
- **THEN** the gauge shows an amber degraded chip and the row keeps its normal (non-failing) state treatment
