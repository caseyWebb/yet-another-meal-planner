## Why

Members can already record household waste and purchase prices, but the Retrospective Waste tab cannot yet answer what was tossed, what it was worth, why it happened, or whether waste is improving. Band 4 adds an honest, deterministic, read-only Waste analyzer over those existing tenant-scoped facts, after the Spend analyzer establishes their shared range and monetary-coverage conventions.

## What Changes

### Product behavior

- Add one shared, bounded read-time operation for `4w`, `8w`, and `12w` Waste aggregates. It reads existing `waste_events` through `(tenant, occurred_at)` and resolves each event's last-paid value through indexed `(tenant, line_key, occurred_on)` spend-history lookups; every query is tenant-bound, date-bounded or an indexed point lookup, deterministic, and read-only.
- Reuse the Spend analyzer's UTC range contract exactly: the household is the authenticated tenant, stored ISO dates are authoritative, weeks start on ISO Monday, the selected range contains N chronological buckets including the current partial week, and prior-period comparison shifts the same elapsed shape back N weeks. The largest request scans at most 24 weeks of waste facts; future-dated facts are excluded. No household-timezone field, timezone inference, or capture rewrite is introduced.
- Derive an event's value only from that household's spend history. The value is the latest non-voided, priced `spend_events.unit_price` whose `line_key` equals the waste event's `item_id` and whose `occurred_on` is on or before the waste event's `occurred_at`, ordered by `occurred_on` descending then `send_id` descending. A future purchase never values an earlier toss. The loose pantry `quantity` string is descriptive and is never parsed, multiplied, or treated as a package count.
- Never use a member-entered value, pantry input, SKU cache, flyer, store quote, cross-tenant history, recipe allocation, or heuristic fallback for Waste value. A missing last-paid match remains `null`/unavailable. A matched estimated spend price remains a known estimate and makes the affected monetary coverage partial; it is never relabeled as exact.
- Derive avoidability at read time from an immutable, versioned, reason-only registry in `src/`. Version `waste-avoidability-v1` maps `forgot`, `bought_too_much`, `never_opened`, `freezer_burned`, and `stale` to `avoidable`; it maps `spoiled`, `moldy`, `over_ripe`, `expired`, and `other` to `hard_to_avoid`. This conservative v1 does not infer preventability from item identity, department, name, quantity, or member input and has no override mechanism.
- Default reads use the registry's declared current version and echo it in the response. The member API and MCP read MAY request a specific supported version to reproduce a prior result. Published versions are frozen rather than edited or deleted; an unknown version is a validation error, never a silent fallback. A later mapping change therefore adds a new version and leaves v1 replayable without rewriting historical events.
- Derive the effective analytics department as `leftovers` whenever `prepared_from` is non-null; otherwise use the event's capture-stamped D17 `department`. This read-time rule makes the required Leftovers pseudo-department explicit while agreeing with existing capture behavior. A non-leftover NULL stamp remains pending, never becomes `Not mapped`, and the analyzer neither invokes nor replaces the existing ingredient-category fill.
- Report N weekly tossed buckets; KPI tiles for Tossed value, exact Items binned and items-per-week, Waste rate, and matched prior-period Waste trend; breakdowns by effective department, canonical reason, and avoidable versus hard-to-avoid; up to six most-wasted item groups; and one deterministic server-authored insight. Counts always come from persisted event rows, never inferred quantities.
- Define Tossed value as the known last-paid subtotal with explicit `empty`, `unavailable`, `partial`, or `complete` monetary coverage. No events is an exact empty zero; events with no resolved values are unavailable rather than `$0`; some missing or any estimated values are partial; all valued, non-estimated events are complete. Weekly buckets expose the same distinction and a text equivalent.
- Define Items binned as the exact selected event count and items-per-week as that count divided by N selected calendar buckets. The current partial week does not change the denominator. Zero events yields zero rather than an unavailable count.
- Define Waste rate as `known tossed value / (qualifying grocery spend + known tossed value)`. The grocery-spend term includes all selected non-voided Spend amounts except capture-stamped `household`; `beverages` remains included, so the Spend cost-per-meal exclusion set is not reused. Rate is available only when both Waste value and qualifying Spend coverage are exact and the combined denominator is positive. Exact empty Waste with positive complete grocery spend yields `0%`; zero/missing denominators and partial or unavailable inputs yield `null`. The UI marks an available rate red at `>= 10%` and never colors an unavailable rate as a threshold breach.
- Define Waste trend as the percent change in known Tossed value against the prior matched window. It is available only when current and prior monetary inputs are exact and the prior value is positive; an exact empty current window versus a positive prior window is `-100%`. A zero prior value, missing value, estimated value, or incomplete side produces a reasoned unavailable state, never infinity.
- For department breakdowns, event-count percentages use the number of events with an effective department as their denominator and monetary percentages use the known value attached to those classified events; pending-department events stay visible in department coverage but not in a synthetic bucket. For reason and avoidability breakdowns, count percentages use every selected waste event and monetary percentages use every known-value waste event. A zero denominator yields `null`. Each breakdown returns its denominator and coverage so partial subtotals cannot masquerade as household totals.
- Group most-wasted items by canonical `item_id`; count every persisted event and sum only known values. Every returned group is nonempty, so its status is exactly `unavailable`, `partial`, or `complete`, never a synthetic `empty`. Valued groups sort before unvalued-only groups, then by known amount descending, event count descending, and `item_id` ascending; unvalued-only groups sort by event count descending then `item_id` ascending. The display name comes from the latest event by `occurred_at` descending then event `id` descending, and the list is capped at six.
- Sort weekly buckets chronologically; all breakdowns by known amount descending, event count descending, then canonical key ascending; and every remaining tie by its stable canonical key. Insight selection is a fixed precedence ladder: empty, value unavailable, partial monetary coverage, then complete-data patterns. A complete-data insight uses the already-sorted leading Department only when every selected event has an effective department; if any selected department is pending, it uses the leading Reason over all events instead, so an incomplete classified subset is never called the household leader. The Avoidable share still uses its explicit all-event known-value denominator. No LLM, randomness, hash rotation, item-name heuristic, or threshold other than the specified `10%` Waste-rate presentation rule participates.
- Add a session-gated, ETag-aware `GET /api/retrospective/waste` read with the same `4w|8w|12w` range contract and optional mapping-version replay, and extend the existing read-only MCP `retrospective` tool with a shared `waste` object plus optional Waste range/version inputs. The direct member API and UI default to `8w`; the additive MCP inputs default to `4w` and the current mapping version for backward compatibility. Both transports expose the same aggregate object and validation behavior; no Waste write tool is created.
- Replace only the member Retrospective Waste placeholder. Spend and Waste share one canonical `?range=4w|8w|12w` URL control. The Waste panel provides semantic tabs/panels, keyboard-operable tab and range groups, textual equivalents for weekly bars and breakdowns, accessible loading status, structured error with retry, distinct empty/unavailable/partial states, and responsive narrow/tall behavior without a chart dependency. Waste-derived dollar values are labelled as last-paid estimates; any displayed qualifying Spend denominator is labelled as recorded/captured grocery spend, never as a per-toss estimate. Pending Waste department classification is shown separately and does not change complete Waste money from `Last-paid estimate` to a partial label. Trend presents its returned unavailable reason rather than inventing prior-period coverage fields.
- Align the MCP contract, event/derivation schema documentation, architecture's analyzer/cron account, `cooking-retrospective` persona guidance, generated-plugin check, living OpenSpec requirements, production-entry SQLite/API/MCP tests, and member Playwright coverage through the real seeded API.

### Production-event behavior

- Late or backdated waste and spend facts appear on the next read when their authoritative dates place them in the selected window or valuation history. Existing `(tenant, id)` waste-event idempotency means a replayed event id contributes once; the analyzer adds no duplicate detector or synthetic event identity.
- Voided spend rows cannot value waste. If a price row is later voided, the next read selects the next eligible older priced row or reports the value unavailable. Waste capture has no production correction path beyond its existing append-only/idempotent semantics, so this change does not invent edit, delete, compensation, or reconciliation states for waste events.
- A read observes normally committed D1 facts; a refresh after concurrent capture or voiding converges on the new committed state. The analyzer adds no lock, snapshot protocol, ownership token, compare-and-swap layer, or writer coordination.
- Empty history returns exact empty buckets and counts. Sparse history returns useful exact counts and classified dimensions with monetary coverage describing unresolved or estimated values. Zero and missing denominators return `null`, never infinity or a fabricated percentage.
- Existing and previously migrated schemas remain readable because all values and classifications are computed from existing columns and immutable in-code mapping versions. The route, MCP inputs, response fields, and mapping replay are additive; unsupported versions and invalid ranges fail explicitly.

### Exact in-scope production surfaces

- One Worker Waste aggregation operation beside the existing Spend/read-side code, using `waste_events`, non-voided `spend_events`, the shared Spend range/coverage conventions, and `db(env)`. The production `waste-shapes` leaf reuses the public workerd-free Spend range/coverage/money primitives. Waste imports the existing pure `SpendBounds`, `spendBounds`, `addUtcDays`, `toCents`, `fromCents`, `roundPercent`, `compareRawKeys`, and `presentationLabel` helpers after an export-only edit to `packages/worker/src/spend.ts`; it does not introduce a generic helper module or change Spend behavior.
- Existing authenticated member API composition plus one Waste GET route with existing ETag/session middleware.
- Existing MCP `retrospective` read tool and its compatible profile retrospective composition in `packages/worker/src/cooking-tools.ts`, both carrying the shared Waste object.
- Existing member Retrospective route's Waste panel, shared range state, and shared member-app styles. Spend behavior is consumed, not redesigned.
- Focused Worker operation, SQLite-backed schema/reader, member API, MCP, and Playwright tests that invoke production entry points rather than a parallel analyzer model.
- The existing telemetry and member-app living specifications; `docs/TOOLS.md`, `docs/SCHEMAS.md`, and `docs/ARCHITECTURE.md`; and the Worker `cooking-retrospective` persona source.

### Explicit non-goals

- No change to pantry disposition capture, the reason vocabulary, waste-event identity, D17 stamping, pending-department fill, spend capture, order flow, grocery flow, or any existing writer.
- No member-entered Waste value and no SKU-cache, flyer, catalog, receipt, quantity parsing, prepared-recipe allocation, cross-tenant, or heuristic valuation fallback.
- No item-class, department, name, quantity, or model-based avoidability inference; no member override; no mutation of captured events when the current mapping version changes.
- No Waste write/edit/delete/correction tool, compensation state, historical rewrite, backfill, or silent data repair.
- No materialized aggregate, Waste value column, avoidability column, analyzer table, new index, migration, queue, binding, dependency, scheduled aggregation, or new/expanded cron work.
- No cart ownership/recovery, pantry or grocery ownership token, generic compare-and-swap framework, re-key convergence, order settlement/compensation, operation registry, concurrency oracle, satellite receipt atomicity, or generic error-handling framework.
- No proposal-scoring use of Waste signals; the product story explicitly defers that feedback loop.
- No unrelated Spend, Retrospective cooking-log, member, admin, profile, pantry, grocery, or transaction-system redesign; no new visualization dependency or offline persistence for analyzer aggregates.
- No speculative guard, fallback, synthetic state, catch-all recovery, or heuristic without a documented production-reachable input. Tests exercise real readers and public routes and do not introduce a test-only design.

## Capabilities

### New Capabilities

None. This change extends the existing telemetry and member application capabilities rather than creating a parallel Waste contract.

### Modified Capabilities

- `spend-telemetry`: Add the household-scoped Waste analyzer over existing waste and spend history, including last-paid valuation, versioned avoidability replay, exact metrics/denominators, coverage, ordering, compatibility, concurrency, read-only guarantees, and the additive MCP Waste contract.
- `member-app-core`: Add the authenticated Waste endpoint and the accessible, responsive Retrospective Waste panel with shared URL range, loading, empty, partial/unavailable, error/retry, and real-API browser behavior.

## Impact

### Dependency map

```text
authenticated member session / MCP identity
                 |
                 v
          resolved tenant id
                 |
                 v
       shared readWasteAnalyzer operation
          |          |             |
          |          |             +-- immutable avoidability registry
          |          +---------------- waste_events (bounded selected + prior facts)
          +--------------------------- spend_events (indexed last-paid + rate facts)
                 |
        +--------+----------------+
        |                         |
        v                         v
session-gated Waste API     retrospective MCP/profile read
        |                         |
        v                         +-- tool docs/persona/plugin check
member Waste panel
        |
        +-- shared Spend range control and styles
        +-- real-API Playwright coverage

shared operation + contracts
        +-- SQLite/reader/API/MCP production-entry tests
        +-- living OpenSpec and TOOLS/SCHEMAS/ARCHITECTURE docs
```

Every analyzer arrow is a read. `waste_events` supplies event count, reason, item, `prepared_from`, captured department, and date; `spend_events` supplies only eligible tenant-scoped last-paid values and qualifying grocery spend. No edge points to a writer, cache fill, queue, scheduled handler, historical backfill, or member-entered value.

### Anticipated files and frozen footprint forecast

The exact anticipated set below contains **29 changed files**. The frozen forecast is
**24-32 changed files and 4,200-5,600 added lines**: the package already contains about
1,650 archive-bound planning lines and about 600 delta lines that will also enter the
two living specs, so the earlier 2,500-4,300 line estimate no longer left a defensible
implementation/test allowance.

- 6 archived OpenSpec artifacts: `.openspec.yaml`, `proposal.md`, `design.md`,
  `tasks.md`, and the two capability deltas; plus 2 living specs,
  `openspec/specs/spend-telemetry/spec.md` and
  `openspec/specs/member-app-core/spec.md`.
- 7 Worker production/manifest files: `packages/worker/src/spend.ts` (exports only),
  `packages/worker/src/waste-shapes.ts`,
  `packages/worker/src/waste-avoidability.ts`,
  `packages/worker/src/waste-analyzer.ts`,
  `packages/worker/src/api/retrospective.ts`,
  `packages/worker/src/cooking-tools.ts`, and `packages/worker/package.json` for the
  production `waste-shapes` subpath export.
- 3 member UI files: `packages/app/src/lib/data.ts`,
  `packages/app/src/routes/_app.retrospective.tsx`, and
  `packages/ui/src/cookbook.css`.
- 7 production-entry test/harness files:
  `packages/worker/test/waste-analyzer.test.ts`,
  `packages/worker/test/api-member.test.ts`,
  `packages/worker/test/cooking-tools.test.ts`,
  `packages/worker/admin/visual/seed.mjs`,
  `packages/worker/admin/visual/seed.d.mts`,
  `packages/worker/app/visual/pages/retrospective.page.ts`, and
  `packages/worker/app/visual/specs/retrospective.spec.ts`.
- 4 contract/persona files: `docs/TOOLS.md`, `docs/SCHEMAS.md`,
  `docs/ARCHITECTURE.md`, and `packages/worker/AGENT_INSTRUCTIONS.md`.

No generated file is expected. The only authored manifest/configuration change is the
`packages/worker/package.json` subpath export already counted above; `/api/*` routing,
dependencies, bindings, Wrangler configuration, and migration state need no edit.
Work stops for approval if the actual footprint exceeds the frozen upper forecast by
more than 25%: **more than 40 changed files or more than 7,000 added lines**. The user's
independent hard stop also applies at **more than 70 changed files or more than 7,000
added lines**. Discovery alone is not a reason to widen this list.

### Schema and scheduling impact

Migration count is **zero**. `waste_events` already stores tenant, id, item/name, `prepared_from`, loose quantity, capture-stamped/pending department, canonical reason, and authoritative date behind `(tenant, occurred_at)`. `spend_events` already stores tenant, canonical line key, unit price, estimated/void state, amount, department, date, and deterministic send id behind `(tenant, line_key, occurred_on)`. Those indexes support the bounded event scan, indexed last-paid seeks, and selected grocery-spend read.

Avoidability versions are immutable TypeScript constants, not rows or event columns. Read-time derivation is required so a caller can apply the current mapping or replay a named frozen version without mutating history. Materializing values or avoidability would duplicate derived state and require backfill/correction machinery that has no production need. No new table, column, index, migration, binding, queue, dependency, scheduled job, `scheduled()` wiring, or cron phase is justified; the existing ingredient-category job may fill pending capture stamps independently, and the analyzer only reads the committed stamp.

### Simplest design and cross-cutting assessment

The simplest design considered is the selected design: one deterministic aggregation path over existing tenant/date-bounded waste rows, indexed last-paid price seeks, the shared Spend range/coverage rules, and one small immutable avoidability registry. The only cross-file reuse change is to export the eight existing pure Spend helpers/types that Waste actually calls; their bodies and Spend call sites stay unchanged, and no generic utility layer is introduced. The API, MCP/profile read, and member panel reuse the one exported Waste wire object. Existing React/query, ETag, session, CSS, and Playwright patterns provide the transport and presentation. Production-entry tests call the same reader and routes; there is no test-only Waste model.

No new cross-cutting mechanism is unavoidable. The export-only `spend.ts` edit is the
smallest way to reuse already-tested range, cents, percent, key-order, and label behavior;
it creates no new mechanism and is accepted by existing Spend tests plus focused Waste
reader assertions. Existing authentication resolves the tenant, `db(env)` owns D1
access, existing keys dedupe events, existing void flags express Spend corrections,
existing indexes serve the reads, and ordinary refresh observes late/concurrent facts.
Any discovered need to change helper bodies, Spend results, capture, correction,
ownership, recovery, concurrency, settlement, compensation, registry, atomicity, or
generic error infrastructure is outside this boundary and requires an exact
production-reachable blocker plus user approval before work continues.

### Compatibility and dependencies

- This change is stacked after `spend-analyzer` and consumes its merged range, monetary-coverage, API-composition, and Retrospective UI conventions. It does not reopen Spend metric or capture decisions.
- Public changes are additive: one member GET route, optional MCP Waste inputs, one shared Waste result object, and an optional supported mapping-version selector. There is no breaking contract.
- Runtime dependencies remain unchanged; no charting, date, statistics, or aggregation package is introduced.
- Documentation and specs must describe the same mapping version, range, valuation, rate, trend, denominator, missing-data, ordering, authorization, and read-only behavior exposed by code.
- Existing databases require no migration. Existing NULL departments and unmatched/estimated Spend history remain truthful partial or unavailable states rather than compatibility failures.
