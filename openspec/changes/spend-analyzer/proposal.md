## Why

Members can already see captured purchase facts, a weekly budget, and cooking history, but they cannot answer the retrospective questions those facts support: what the household spent, what drove it, whether planned buying differs from impulse buying, or how spend relates to meals cooked. Band 4 adds an honest, deterministic, read-only Spend analyzer over the existing tenant-scoped telemetry without changing capture, ownership, or transaction behavior.

## What Changes

### Product behavior

- Add one shared, bounded read-time operation, `readSpendAnalyzer(env, tenant, range, now?)`, for `4w`, `8w`, and `12w` ranges. It reads existing non-voided `spend_events`, the household profile budget, qualifying `cooking_log` rows, and the existing awaiting-placement rows through `db(env)`. Every read is tenant-bound; the date-bearing `spend_events` and `cooking_log` history queries have both lower and upper date bounds, while the profile budget and current awaiting-placement counts are tenant-bounded point/current-state reads without date predicates.
- Define the household boundary as the tenant resolved by the existing authenticated member session or MCP identity. UTC calendar dates are authoritative, weeks start on ISO Monday, and no household-timezone field or capture rewrite is introduced. The selected range contains N chronological buckets including the current partial week; comparison uses the same elapsed shape shifted back N weeks, so the largest request scans at most 24 weeks.
- Report weekly spend, KPIs, the optional weekly budget, exact capture-stamped department/store/planned-versus-impulse breakdowns, up to six top line-item drivers, and one deterministic server-authored insight. The analyzer does not reclassify historical facts.
- Define cost per meal as the known spend numerator excluding the capture-stamped `household` and `beverages` departments, divided by all in-range `recipe` and `ad_hoc` `cooking_log` rows. Each qualifying row counts once, including breakfast, lunch, dinner, project, and legacy `NULL` meal values; `ready_to_eat` is excluded and servings are never inferred.
- Keep total spend inclusive of priced Household and Beverages rows. Known departments appear by their capture-stamped key; rows with no resolved department never produce a synthetic `Not mapped` bucket. Store and provenance groupings likewise use only their captured values.
- Make missingness explicit. Missing prices are excluded from the known subtotal; estimated prices remain visibly estimated; missing prices, missing departments, and estimated prices produce truthful `complete`, `partial`, `unavailable`, or `empty` coverage rather than fabricated values. Percentages and ratios are `null` when their denominator is zero. A hidden budget yields `over: null`; a known subtotal above a visible budget yields `over: true` even when the calendar week or price coverage is incomplete; otherwise partial or unavailable price coverage yields `over: null`; and otherwise `over` is false, including for the current partial calendar week as of its through date. Trend is unavailable when the prior denominator is zero or missing, or when either comparison side is incomplete.
- Make results reproducible: weeks are chronological; breakdowns sort by amount descending then key ascending; top drivers group by `line_key`, count events rather than quantity, sort by amount descending, event count descending, then key ascending, and select the display name from the latest row by `occurred_on` descending then `send_id` descending. The top-driver list is capped at six.
- Select insight text without an LLM, randomness, or hash rotation. Empty, unavailable, and partial-coverage templates take precedence. Complete data uses one fixed top-department sentence and appends only planned/impulse and trend clauses whose inputs are available.
- Add a session-gated `GET /api/retrospective/spend?range=4w|8w|12w` endpoint and add optional `spend_range` to the existing read-only MCP `retrospective` tool, defaulting to `4w` for backward compatibility. Both expose the same spend aggregate shape. The existing profile retrospective contract remains compatible and may delegate its legacy spend section to the same operation.
- Replace only the member Retrospective Spend placeholder. The member UI defaults to `8w`, preserves the selected range in the URL, and provides semantic tabs/panels, an accessible range group, weekly bars with text equivalents, loading status, structured error and retry, distinct empty and partial/unavailable states, the existing awaiting-placement notice, and responsive horizontal overflow for narrow and tall layouts. No chart dependency or offline aggregate persistence is added. The Waste placeholder is unchanged.
- Align the MCP contract, data/architecture documentation, the `cooking-retrospective` persona guidance, generated-plugin check, living OpenSpec requirements, production-entry SQLite/API/MCP coverage, and Playwright coverage through the real seeded member API.

### Production-event behavior

- Late or backdated facts appear on the next read when their authoritative `occurred_on` falls in the bounded window. Existing primary-key idempotency controls duplicates; existing void facts remove corrected rows; a refreshed read observes the committed state before or after concurrent writes. The analyzer adds no writer coordination, historical mutation, or speculative recovery path.
- Empty history is `empty`; sparse or partly priced history remains useful with explicit coverage; events with no usable amount are `unavailable`. Zero and missing denominators yield `null`, never infinity or a fabricated percentage.
- Existing rows and previously migrated databases remain readable because the response is computed from existing columns. New response fields and `spend_range` are additive, and the legacy retrospective surface keeps its compatible defaults.

### Exact in-scope surfaces

- Worker read operation and its existing D1 access layer for `spend_events`, profile `weekly_budget`, `cooking_log`, and awaiting-placement grocery rows.
- Existing authenticated member API composition plus one Spend read route.
- Existing MCP `retrospective` read tool and its shared aggregate result.
- Existing member Retrospective route's Spend panel and shared member-app styles; Waste remains a placeholder.
- Focused Worker operation, SQLite-backed schema/operation, member API, MCP, and member Playwright tests that invoke production entry points.
- The `spend-telemetry` and `member-app-core` living specifications; `docs/TOOLS.md`, `docs/SCHEMAS.md`, and `docs/ARCHITECTURE.md`; and the Worker `cooking-retrospective` persona source.

### Explicit non-goals

- No cart ownership or recovery protocol.
- No grocery or pantry ownership token.
- No generic compare-and-swap framework.
- No re-key convergence system.
- No order settlement or compensation state machine.
- No operation registry or generated concurrency oracle.
- No satellite receipt atomicity work.
- No generic error-handling framework.
- No Spend write tool, capture-path redesign, correction workflow, or mutation of historical telemetry.
- No materialized analyzer rollup, analyzer table, new index, scheduled aggregation, or new cron job. The existing ingredient-category cron remains the only eventual dependency for capture-stamped departments.
- No store, department, provenance, cart, pantry, grocery, cooking-log, profile, or unrelated transaction-system redesign.
- No unrelated member or admin UI redesign, new visualization dependency, or offline persistence for analyzer results.
- No Waste analyzer implementation, waste valuation, avoidability mapping, or change to the Waste placeholder in this change.
- No speculative guard, fallback, synthetic state, catch-all recovery, or heuristic without a documented production-reachable input. Tests exercise production entry points and do not introduce a parallel model that primarily validates itself.

## Capabilities

### New Capabilities

None. This change extends the existing spend telemetry and member application capabilities rather than creating a parallel analyzer contract.

### Modified Capabilities

- `spend-telemetry`: Add the bounded, deterministic, tenant-scoped Spend analyzer aggregate; its exact metric, coverage, ordering, tie-breaking, compatibility, concurrency, and read-only semantics; and the additive MCP contract.
- `member-app-core`: Add the session-gated Spend endpoint and the accessible, responsive Retrospective Spend panel with URL-persisted range, loading, empty, partial/unavailable, error/retry, and real-API browser behavior.

## Impact

### Dependency map

```text
authenticated member session / MCP identity
                 |
                 v
          resolved tenant id
                 |
                 v
  shared readSpendAnalyzer operation
    |       |          |             |
    |       |          |             +-- awaiting-placement rows
    |       |          +---------------- cooking_log denominator
    |       +--------------------------- profile.weekly_budget
    +----------------------------------- spend_events facts
                 |
        +--------+----------------+
        |                         |
        v                         v
session-gated Spend API     retrospective MCP tool
        |                         |
        v                         +-- tool docs/persona/plugin check
member Spend panel
        |
        +-- shared styles and real-API Playwright coverage

shared operation + contracts
        +-- SQLite/operation/API/MCP production-entry tests
        +-- living OpenSpec and TOOLS/SCHEMAS/ARCHITECTURE docs
```

All analyzer arrows are reads. No analyzer edge points to a writer, queue, scheduled handler, or historical backfill. The existing ingredient-category cron can fill a pending `NULL` department stamp on existing send/event rows after capture; the analyzer only reads the resulting stamped-or-null fact and neither invokes nor replaces that cron.

### Anticipated files and frozen footprint forecast

The expected final merge-base diff is **24-34 changed files and 2,800-4,500 added lines**. Anticipated files are:

- 5-6 archived OpenSpec artifact files for this proposal, design, two capability deltas, and tasks, plus the archive metadata produced by the repository workflow.
- 2 living OpenSpec files: `openspec/specs/spend-telemetry/spec.md` and `openspec/specs/member-app-core/spec.md`.
- 4-6 Worker production files centered on `packages/worker/src/spend.ts`, `packages/worker/src/cooking-tools.ts`, and the existing member API composition/area files.
- 3 member UI files centered on `packages/app/src/routes/_app.retrospective.tsx`, `packages/app/src/lib/data.ts`, and `packages/ui/src/cookbook.css`; the typed API client changes only if later design proves it is required.
- 5-7 focused test files centered on `packages/worker/test/spend.test.ts`, retrospective/tool/member-API tests, and `packages/worker/app/visual/pages/retrospective.page.ts` plus `packages/worker/app/visual/specs/retrospective.spec.ts`; shared visual fixtures change only if the real seeded API requires it.
- 4 contract/persona files: `docs/TOOLS.md`, `docs/SCHEMAS.md`, `docs/ARCHITECTURE.md`, and `packages/worker/AGENT_INSTRUCTIONS.md`.
- At most 1 generated or configuration file, and only if an existing repository check proves it is required.

Work stops for approval if the analyzer exceeds 70 changed files or 7,000 added lines. It also stops earlier if the actual footprint exceeds the frozen upper forecast by more than 25%: 43 or more changed files, or more than 5,625 added lines. Discovery alone is not a reason to widen this list.

### Schema and scheduling impact

Migration count is **zero**. `spend_events` already stores the captured amount, estimated flag, canonical department, store, provenance, line key, display name, event date, void state, and tenant; its existing tenant/date index supports the maximum bounded scan. `cooking_log` already stores tenant, date, type, and meal with a tenant/date index; the profile already stores `weekly_budget`; and awaiting-placement state already has a tenant-scoped read path. A materialized aggregate would duplicate authoritative facts, require correction/version/backfill semantics, and violate the read-only scope. No new table, column, index, binding, queue, or cron is justified.

### Simplest design and cross-cutting assessment

The simplest design considered is the selected design: one pure aggregation path beside the existing spend capture code, using a few bounded tenant-scoped reads and deterministic TypeScript reduction, then reused by the API, MCP tool, and compatible legacy retrospective section. The member panel renders that response with existing React/query and shared CSS patterns. Production-entry tests call the same operation and public routes; there is no test-only analyzer model.

No new cross-cutting mechanism is unavoidable. Existing authentication resolves tenant identity, existing D1 helpers enforce the database boundary, existing immutable/idempotent spend facts and void filtering define correction behavior, existing date indexes make the read bounded, existing API/tool composition exposes the result, and existing member UI/test harnesses cover the browser surface. Any discovered need for ownership, recovery, CAS, convergence, settlement, compensation, registry, oracle, atomicity, or generalized error infrastructure is outside this ratified boundary and requires an exact production-reachable blocker plus user approval before work continues.

### Compatibility and dependencies

- Public changes are additive: one member GET route, one optional MCP input, and additive Spend aggregate fields. There is no breaking contract.
- Runtime dependencies remain unchanged; no charting or aggregation package is introduced.
- Documentation and specs must describe the same range, metric, missing-data, ordering, authorization, and read-only semantics exposed by code.
- Waste may depend on the merged Spend foundation later, but Spend does not depend on or implement Waste.
