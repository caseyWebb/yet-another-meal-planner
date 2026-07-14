## Context

Band 3 already persists immutable, tenant-scoped `spend_events` at purchase assertion, including captured amount, estimated flag, department, store, provenance, line key, name, event date, and void state. `cooking_log` already holds the denominator facts, `profile.weekly_budget` holds the optional budget, and `grocery_list` identifies sent rows awaiting placement. The current retrospective exposes a four-week `SpendSection`, but it does not provide Band 4 metrics, coverage truth, breakdowns, drivers, or a member Spend panel.

The change crosses the Worker operation, member API, MCP transport, member SPA, browser harness, and contracts. It remains a bounded read over existing facts. The household boundary is the already-resolved tenant. Stored ISO dates and UTC request time are authoritative; no household timezone exists to infer or migrate.

## Goals / Non-Goals

**Goals:**

- Provide one deterministic `readSpendAnalyzer(env, tenant, range, now?)` operation reused by every transport.
- Make 4/8/12-week totals, averages, cost per meal, matched trend, budgets, breakdowns, drivers, and insight reproducible and honest about missing data.
- Preserve the existing Spend fields additively and keep existing profile/MCP callers compatible.
- Replace only the Retrospective Spend placeholder with an accessible, responsive, real-API panel.
- Keep every query tenant-bound, indexed, date-bounded, deterministic, and read-only.

**Non-Goals:**

- Cart ownership/recovery, grocery or pantry ownership tokens, generic CAS, re-key convergence, order settlement/compensation, operation registries, generated concurrency oracles, satellite receipt atomicity, and generic error frameworks.
- Spend capture, correction, placement, grocery, pantry, store, profile, cooking-log, or transaction redesign.
- A Spend writer, historical rewrite, backfill, materialized aggregate, analyzer table, index, migration, queue, dependency, or cron. The existing ingredient-category cron is not invoked or changed.
- Waste analysis or any Waste placeholder change; unrelated member/admin design; offline aggregate persistence; or a chart library.
- Speculative fallbacks, synthetic states, heuristic thresholds, or a test-only analyzer model.

## Decisions

### D1. Household, clock, ranges, and authorization

`SpendRange` is exactly `"4w" | "8w" | "12w"`, mapping to 4, 8, or 12 buckets. `readSpendAnalyzer` receives an internal tenant id and a range; `now` defaults to `new Date()` and exists as a normal clock boundary, not a test-only alternate implementation. It derives `as_of = now.toISOString().slice(0, 10)`.

Weeks are ISO Monday through Sunday in UTC. If `current_start` is the Monday containing `as_of`, then:

- `selected_start = current_start - (N - 1) * 7 days`;
- `selected_end = as_of` (inclusive);
- `prior_start = selected_start - N * 7 days`;
- `prior_end = as_of - N * 7 days` (inclusive).

The selected result contains N buckets oldest first. The last bucket ends at its Sunday but is partial unless `as_of` is that Sunday. The comparison has the identical weekday endpoint shifted N weeks. Spend SQL is bounded by `prior_start <= occurred_on <= as_of`, so 12w scans no more than 24 weeks. Cooking SQL is bounded by `selected_start <= date <= as_of`. Future-dated rows are excluded.

The authenticated member session and MCP authentication resolve tenant before the operation. Public inputs never accept tenant. Every query includes that tenant and goes through `db(env)`. UTC was chosen over a new timezone preference because the stored facts are date-only and the repository already defines ISO-week spend in UTC; inventing a conversion would rewrite their meaning.

### D2. One additive aggregate contract

The dedicated API body is the `SpendAnalyzer` object directly. The existing profile retrospective and MCP result expose the exact same object at `.spend`; there is no second transport shape.

```ts
type SpendRange = "4w" | "8w" | "12w";
type CoverageStatus = "empty" | "unavailable" | "partial" | "complete";

interface MonetaryCoverage {
  status: CoverageStatus;
  event_count: number;
  priced_event_count: number;
  unpriced_event_count: number;
  estimated_event_count: number;
  known_amount: number;
}

interface ClassificationCoverage {
  status: CoverageStatus;
  event_count: number;
  classified_event_count: number;
  pending_event_count: number;
}

interface SavingsCoverage {
  status: CoverageStatus;
  event_count: number;
  known_event_count: number;
  unknown_event_count: number;
  known_savings: number;
}

interface SpendWeek {
  week_start: string;
  total: number;             // legacy field: known amount subtotal
  savings: number;           // legacy field: known savings subtotal
  events: number;            // legacy field
  estimated: number;         // legacy field
  week_end: string;
  through: string;
  is_partial: boolean;
  status: CoverageStatus;
  monetary_coverage: MonetaryCoverage;
  department_coverage: ClassificationCoverage;
  savings_coverage: SavingsCoverage;
  over_budget: boolean | null;
}

interface MoneyKpi {
  amount: number | null;
  status: CoverageStatus;
}

interface CostPerMealKpi {
  amount: number | null;
  known_numerator: number;
  meal_count: number;
  status: CoverageStatus;
  reason: null | "zero_meals" | "numerator_unavailable";
}

interface TrendKpi {
  percent: number | null;
  current_known_amount: number;
  prior_known_amount: number;
  status: "available" | "unavailable";
  reason: null | "current_incomplete" | "prior_incomplete" | "prior_zero";
}

interface BreakdownItem {
  key: string;
  label: string;
  amount: number;
  event_count: number;
  priced_event_count: number;
  unpriced_event_count: number;
  percentage: number | null;
}

interface SpendBreakdown {
  known_denominator: number;
  status: CoverageStatus;
  items: BreakdownItem[];
}

interface SpendDriver {
  key: string;
  name: string;
  department: { key: string; label: string } | null;
  amount: number;
  event_count: number;
  priced_event_count: number;
  unpriced_event_count: number;
  percentage: number | null;
}

interface SpendAnalyzer {
  range: SpendRange;
  as_of: string;
  selected_start: string;
  selected_end: string;
  prior_start: string;
  prior_end: string;
  status: CoverageStatus;
  coverage: {
    monetary: MonetaryCoverage;
    department: ClassificationCoverage;
    savings: SavingsCoverage;
  };
  weekly_budget: number | null; // legacy field; null also represents stored <= 0
  weeks: SpendWeek[];           // legacy array, N buckets for the requested range
  awaiting_mark_placed: number; // legacy field
  kpis: {
    total_spend: MoneyKpi;
    average_per_week: MoneyKpi;
    cost_per_meal: CostPerMealKpi;
    trend: TrendKpi;
  };
  breakdowns: {
    department: SpendBreakdown;
    store: SpendBreakdown;
    provenance: SpendBreakdown;
  };
  top_drivers: { cap: 6; total_count: number; items: SpendDriver[] };
  insight: string;
}
```

Legacy `weeks[].total` and `savings` remain numeric known subtotals so old consumers do not break. The adjacent week/analyzer coverage counts and statuses are normative: new UI/docs must never label a partial or unavailable subtotal as complete spend or savings. `weekly_budget` is normalized to `null` when absent or non-positive. Default callers still receive four weeks; only an explicit 8w/12w request changes array length.

### D3. Coverage, KPIs, denominators, and budget

All event counts refer to selected, tenant-owned, non-voided events unless a prior range is named.

Monetary coverage is `empty` for zero events; `unavailable` for events but zero priced events; `partial` when at least one event is priced and at least one is unpriced or estimated; otherwise `complete`. Estimated amounts are usable known amounts, but never exact confidence. Department coverage is `empty` for zero events; `unavailable` when no event has a department; `partial` when some but not all do; otherwise `complete`. Savings uses the analogous null/non-null rule and does not affect spend status.

Overall status is `empty` for zero events, `unavailable` when monetary coverage is unavailable, `partial` when monetary coverage is partial or department coverage is not complete, and `complete` otherwise. Each week uses the same rules over its rows. This keeps a useful total available when only classification is pending.

Amounts are reduced as integer cents: round each stored decimal amount/savings once with `Math.round(value * 100)`, sum integers, and divide by 100 only at output. Currency metrics round to cents. Percentages, including trend, round to one decimal. A percentage is `null` when its denominator is zero.

`total_spend.amount` is 0 for empty, `null` for unavailable, and the known subtotal for partial/complete. `average_per_week` uses the same availability and divides the known subtotal by N, including empty and the current partial bucket; elapsed-day weighting is rejected because the product selects week buckets, not a prorated interval.

Cost per meal counts every selected `cooking_log` row whose type is `recipe` or `ad_hoc`, one each. Breakfast, lunch, dinner, project, and `NULL` meal all count; `ready_to_eat` does not. Servings, quantities, household size, and weights are never inferred. The numerator sums priced non-voided rows whose non-null captured department is not in the existing `COST_PER_MEAL_EXCLUDED` (`household`, `beverages`).

Cost numerator coverage is `empty` with no spend events; `unavailable` when at least one pending-department or eligible-unpriced row could affect the numerator and there is no priced eligible row; `partial` when a priced eligible row exists and any eligible row is unpriced/estimated or any department is pending; otherwise `complete` (including an exact zero made only of excluded rows). If `meal_count` is zero, the KPI is unavailable with `amount: null` and `reason: "zero_meals"`. Otherwise an unavailable numerator returns `null`/`numerator_unavailable`; empty returns 0; partial/complete return `known_numerator / meal_count` with their status.

Trend compares total spend for the selected and matched prior shapes. Empty means an exact zero for this comparison. Estimated or unpriced coverage is incomplete. Reason precedence is current incomplete, prior incomplete, then prior zero. Only complete-or-empty current coverage, complete prior coverage, and `prior_known_amount > 0` produce a percentage: `(current - prior) / prior * 100`. Thus exact current zero against positive prior is `-100.0`; any zero prior is unavailable, never infinity.

For each week, `through` is the lesser of its Sunday and `as_of`; `is_partial` is true when `through < week_end`. Budget precedence is exact: a hidden budget yields `over_budget: null`; otherwise a known subtotal above budget yields `true`, even for a current-partial or price-incomplete week; otherwise partial/unavailable monetary coverage yields `null`; otherwise it yields `false`. A current-partial calendar week can therefore be `false` for the facts observed through `through`, while `is_partial` separately says the week can still change.

### D4. Captured classifications, breakdowns, drivers, and ordering

Department, store, and provenance use immutable captured values only. `NULL` department rows are omitted from department items and never become `Not mapped`; their counts remain in coverage. Store groups use the raw stored key, without a registry lookup. Provenance keys are exactly `planned` and `impulse`.

Labels are deterministic presentation only: split an ASCII key on runs of `_`/`-`, lowercase each word, capitalize its first character, and join with spaces; `manual` therefore displays `Manual`. Provenance displays `Planned`/`Impulse`. No label changes a grouping key.

Each breakdown includes groups having at least one event, including an unpriced-only group. Amount is its known subtotal. Event counts include priced and unpriced rows. Department `known_denominator` is the known amount on non-null departments; store/provenance denominators are total known amount. Items sort by amount descending then raw key ascending. Percentage is item amount divided by that denominator, or null at zero. Department status combines selected monetary and department coverage; store/provenance status is selected monetary coverage.

Top drivers group by captured `line_key` and include only groups with at least one priced event. `total_count` is the eligible pre-cap group count; `items` is capped at six. Amount is the known subtotal and event count counts rows, not quantity. Name and department come from the same representative row: latest `occurred_on`, then lexicographically greatest `send_id`; a null representative department stays null. Sort by amount descending, event count descending, then line key ascending. Driver percentage uses total known spend and is null at zero.

Weeks are chronological. Every SQL result is explicitly ordered when order matters, and reducers apply the stated tie-breakers rather than relying on D1 row order.

### D5. Deterministic insight

Insight selection has this exact ladder and no LLM, randomness, hashing, or threshold:

1. Empty: `No recorded spend in this range.`
2. Monetary unavailable: `Spend is unavailable because none of the recorded purchases in this range has a usable price.`
3. Any partial overall status: `Known spend is incomplete: {clauses}.`
4. Complete: `{Department label} was the largest department at {currency}.` followed by available clauses below.

Partial clauses are included in fixed order for positive counts: `{n} purchase(s) had no usable price`, `{n} purchase(s) used an estimated price`, `{n} purchase(s) is/are awaiting department classification`. Use singular grammar at one and join clauses with commas plus `and` before the last. Currency is `$` plus the cents-rounded amount with exactly two decimal places.

For complete data, append ` Planned purchases were {p.toFixed(1)}% of known spend; impulse purchases were {i.toFixed(1)}%.` only when known total is positive. Append a trend clause only when trend is available: ` Spend was {abs.toFixed(1)}% higher than the matched prior range.`, the corresponding `lower` string, or ` Spend was unchanged from the matched prior range.` at zero. Awaiting placement remains a separate notice and never affects insight selection.

### D6. Read plan, concurrency, and read-only guarantee

The operation issues bounded tenant-scoped reads through `db(env)`: profile budget; raw non-voided spend rows for prior start through as-of; a selected-window `COUNT(*)` of recipe/ad-hoc cooking rows; and the existing count of `in_cart` rows with `sent_in`. Existing tenant/date indexes support spend and cooking reads. TypeScript performs the one deterministic reduction shared by transports. There is no write statement, mutation helper, cron invocation, cache fill, or side effect.

Late/backdated events enter the appropriate bucket on the next read. Existing `(send_id, line_key)` identity suppresses duplicate materialization. Existing void facts remove corrected events. Each query observes committed facts; concurrent independent writers may be observed before or after their commit, without a promised cross-table snapshot, and refresh converges. No new coordination mechanism is warranted.

Existing nullable rows are valid input. When the ingredient-category cron later fills a pending department, a subsequent analyzer read reflects it; the analyzer neither waits for nor invokes that cron.

### D7. API, MCP, profile, and compatibility

Add session-gated `GET /api/retrospective/spend?range=4w|8w|12w`. Missing `range` defaults to `8w`; any other value throws `ToolError("validation_failed", "range must be 4w | 8w | 12w")`, producing HTTP 400 `{ "error": "validation_failed", "message": "range must be 4w | 8w | 12w" }` through existing middleware. The route obtains tenant from `requireSession` and returns `jsonWithEtag` over the shared object.

The MCP `retrospective` input adds optional `spend_range: z.enum(["4w", "8w", "12w"])`; omission defaults to `4w`. `loadRetrospective` accepts an additive spend-range argument defaulting to `4w`, so the existing profile endpoint and old MCP calls retain their four-week behavior. The legacy cooking `period` remains independent. The profile/MCP `.spend` value and dedicated API body are the same `SpendAnalyzer` type and operation result.

No schema migration is required. Fresh and already-migrated databases use the same existing columns and indexes. JSON/tool changes are additive, runtime dependencies do not change, and old clients can ignore new fields. Explicit longer ranges are the only case where legacy `weeks` has more than four entries.

### D8. Member UI and accessibility

The Spend tab defaults to `8w`. Its URL key is `range`; entering Spend with a missing/invalid value canonicalizes it to `8w` with replace navigation, and selecting a range writes `4w`, `8w`, or `12w` to the URL. Other tabs ignore but retain a valid range so returning to Spend preserves it. The query key includes range and runs only while Spend is active. Waste remains untouched.

Tabs use stable tab and panel ids with `aria-controls` from each tab to its panel and `aria-labelledby` back to the tab. The selected tab has `aria-selected="true"` and `tabIndex=0`; other tabs have `aria-selected="false"` and `tabIndex=-1`. `ArrowLeft`/`ArrowRight` wrap through tabs and both activate and focus the destination; `Home`/`End` activate and focus the first/last tab. The range selector is a named `role="group"` of buttons, each exposing its selected state with `aria-pressed`. Loading uses a status region; API failure shows the structured message and a keyboard-operable retry; empty, unavailable, and partial states use the response status/coverage rather than zero-like inference. Awaiting placement is a separate notice. Bars are a semantic chronological list with visible week, known amount, and coverage text; CSS bar geometry is decorative/hidden from assistive technology. KPIs and breakdowns retain textual labels and values.

Use existing components and shared CSS. Narrow/tall layouts keep controls and cards readable and place the weekly chart in labelled horizontal overflow with no clipped information. No canvas, chart library, offline cache, or speculative fallback is added.

### D9. Tests, docs, deployment, and footprint

Worker tests call `readSpendAnalyzer` against SQLite/current migrations and cover UTC Monday/Sunday boundaries, all ranges, matched prior windows, future exclusion, tenant isolation, empty/unavailable/partial/complete coverage, cost exclusions and denominator rows, budget tri-state, ties, rounding, late/duplicate/voided/corrected facts, and concurrent-read refresh behavior. API tests use the composed session-gated app, including unauthorized and invalid-range responses. MCP tests invoke the registered production tool and verify defaults/shared shape. Tests do not recreate aggregation logic.

Playwright's primary Spend case uses the real seeded member API and verifies 8w default, URL range changes, semantic content, awaiting notice, and narrow/tall screenshots. Only otherwise unreachable presentation branches (loading duration, forced error/retry, or a specific partial/unavailable payload) may use a narrow route interception; it must return the production response type and cannot be the primary analyzer proof.

Update the two living specs, `docs/TOOLS.md`, `docs/SCHEMAS.md`, `docs/ARCHITECTURE.md`, and `packages/worker/AGENT_INSTRUCTIONS.md` together. Architecture explicitly records read-time aggregation and no analyzer cron. Plugin generation/check must remain clean.

The frozen forecast is 24-34 changed files and 2,800-4,500 added lines. Stop for approval above 70 files or 7,000 added lines, and stop earlier at 43 files or more or above 5,625 added lines (more than 25% beyond the forecast). No discovery expands scope automatically.

### Requirement-to-decision map

| Product/proposal requirement | Design decision |
|---|---|
| Household scope, authorization, timezone, 4/8/12 windows, week boundaries | D1 |
| Shared operation and exact API/tool/profile shape | D2, D7 |
| Weekly bars, KPIs, budget, missing data, zero denominators | D2, D3 |
| D17 exclusions and cost-per-meal denominator | D3 |
| Department/store/planned-vs-impulse classification | D4 |
| Ordering, top-driver tie-breaking and cap | D4 |
| Deterministic insight templates | D5 |
| Read-time versus materialized aggregation and cron decision | D6, D7 |
| Empty/sparse/late/duplicate/corrected/concurrent/version behavior | D3, D6, D7 |
| Read-only analyzer guarantee | D6 |
| API/tool/docs/persona alignment | D7, D9 |
| Browser accessibility, loading, empty, error, narrow/tall layouts | D8, D9 |
| Existing architecture, production-entry tests, no adjacent redesign | D6, D9 and Non-Goals |

## Risks / Trade-offs

- **UTC may differ from a member's civil week** -> State UTC in contract/UI copy; do not invent timezone data. A future timezone feature requires its own capture-compatible change.
- **Known subtotal can understate partial spend** -> Coverage status/counts travel beside every legacy subtotal and the UI labels it as known/incomplete.
- **Read-time work grows with event density** -> Hard-bound indexed reads to at most 24 weeks and add no all-history scan.
- **Independent reads are not a cross-table transaction** -> Promise only committed per-query facts and convergence on refresh; do not add writer coordination.
- **Additive contract is larger** -> Reuse one typed object and preserve existing defaults/fields instead of parallel legacy and analyzer reducers.
- **Dense chart on narrow screens** -> Semantic text remains primary and the visual row scrolls horizontally.

## Migration Plan

1. Implement and test the shared reducer and production transports without schema changes.
2. Add the member panel and real-API browser coverage.
3. Synchronize living specs, docs, persona, and generated-plugin check; archive only after implementation completes.
4. Deploy Worker and member assets together. Existing clients continue using the four-week defaults.

Rollback is code-only: revert the endpoint, optional MCP parameter, UI, and additive fields. Existing data is untouched, so no data rollback or compensation is required.

## Open Questions

None. All behavior required for implementation is settled above.
