## Context

Band 1 already captures one tenant-scoped, append-only `waste_events` row for each
successful pantry waste disposition. The row carries the canonical item id, display
name, loose quantity, `prepared_from`, canonical reason, capture-stamped D17
department (or NULL-pending), and authoritative ISO occurrence date. Band 3 already
captures immutable, non-voided/voidable `spend_events` with canonical line key,
unit price, amount, estimated flag, captured department, date, and stable send id.
The existing indexes are `(tenant, occurred_at)` for waste and
`(tenant, line_key, occurred_on)` plus `(tenant, occurred_on)` for spend.

The Waste tab is still a placeholder. The existing retrospective MCP/profile read has
the preceding Spend analyzer's shared range and monetary-coverage conventions, and the
member Retrospective route has the shared tab/range shell. This change adds one bounded,
read-time Waste analyzer and reuses that architecture. It does not change either writer.

The household boundary is the authenticated tenant. Stored ISO dates are authoritative
UTC calendar dates because there is no household-timezone field. The story's suggestion
of SKU-cache fallback is superseded by the Band 4 scope: Waste value comes only from the
household's spend history. The story also called Leftovers a read-time derivation while
D17 requires capture stamping; the archived pantry design ratified D17's capture stamp.
This analyzer keeps that stamp intact and defines an effective analytics department from
`prepared_from` so both truths agree without rewriting history.

## Goals / Non-Goals

**Goals:**

- Provide one deterministic `readWasteAnalyzer(env, tenant, range, mappingVersion?, now?)`
  operation reused verbatim by the member API and retrospective MCP/profile composition.
- Resolve honest last-paid Waste values from tenant-owned spend history and expose
  empty, unavailable, partial, and complete monetary states without fabricating money.
- Make 4/8/12-week buckets, counts, trend, Waste rate, dimension breakdowns, most-wasted
  items, and insight text reproducible with exact denominators and stable tie-breakers.
- Keep avoidability reason-only, read-time, explicitly versioned, and replayable.
- Replace only the member Waste placeholder with an accessible, responsive, real-API
  panel that shares the Spend range control.
- Keep every analyzer read tenant-bound, date-bounded or an indexed point lookup,
  deterministic, and side-effect-free.

**Non-Goals:**

- Any change to pantry disposition capture, waste identity/reasons, D17 stamping or its
  pending fill, spend capture, order/grocery/pantry writers, or historical facts.
- Member-entered Waste value; SKU-cache, flyer, catalog, receipt, recipe-allocation,
  store-quote, quantity-parsing, cross-tenant, or heuristic valuation.
- Item-, department-, name-, quantity-, or model-based avoidability; a member override;
  or mutation of events when the current mapping changes.
- A Waste write/edit/delete/correction tool, backfill, compensation, reconciliation,
  materialized aggregate, value/avoidability column, analyzer table, migration, index,
  queue, binding, dependency, scheduled job, or cron change.
- Cart recovery/ownership, pantry or grocery ownership tokens, generic CAS or error
  frameworks, re-key convergence, settlement/compensation state machines, operation
  registries, concurrency oracles, or satellite receipt atomicity.
- Proposal-scoring feedback, cooking-log or Spend redesign, unrelated member/admin UI,
  chart dependencies, or offline persistence of analyzer results.
- A speculative fallback, synthetic state, or test-only analyzer model.

## Decisions

### D1. Household, clock, ranges, and authorization

`WasteRange` is exactly `"4w" | "8w" | "12w"`, mapping to 4, 8, or 12 buckets.
Waste uses the Spend analyzer's range helper rather than a second date implementation.
The stacked Spend implementation already owns `SpendBounds`, `spendBounds`, and
`addUtcDays` privately in `packages/worker/src/spend.ts`; Waste makes those existing
pure declarations exported without changing their bodies or callers, then imports them
directly. It does not create a date utility module or a second range implementation.
`now` defaults to `new Date()` and is an ordinary clock boundary. It produces
`as_of = now.toISOString().slice(0, 10)`.

Weeks are ISO Monday through Sunday in UTC. If `current_start` is the Monday containing
`as_of`, for N buckets:

- `selected_start = current_start - (N - 1) * 7 days`;
- `selected_end = as_of`, inclusive;
- `prior_start = selected_start - N * 7 days`;
- `prior_end = as_of - N * 7 days`, inclusive.

The response contains N selected buckets oldest first, including the current partial
week. The prior comparison has the identical weekday endpoint shifted N weeks. Waste
rows are bounded by `prior_start <= occurred_at <= as_of`, so the largest scan covers
at most 24 weeks. The Waste-rate spend read is bounded by the selected window only.
Future-dated waste and spend facts are excluded. Date-only facts on the same day are
ordered only by the stated stable keys; the analyzer does not invent time-of-day.

The member session and MCP authentication resolve tenant before this operation. No
public input accepts tenant, and every D1 predicate includes it through `db(env)`.
UTC is selected over timezone inference or migration because converting stored date-only
facts would silently change their meaning.

**Alternative rejected:** add a household timezone and reinterpret existing dates. That
is a capture/schema change with no source value and would make old results speculative.

### D2. Immutable named avoidability mappings and replay

`packages/worker/src/waste-avoidability.ts` owns a small, exhaustively typed mapping
table and resolver. The first frozen version is exactly:

```ts
const WASTE_AVOIDABILITY_MAPPINGS = Object.freeze({
  "waste-avoidability-v1": Object.freeze({
    forgot: "avoidable",
    bought_too_much: "avoidable",
    never_opened: "avoidable",
    freezer_burned: "avoidable",
    stale: "avoidable",
    spoiled: "hard_to_avoid",
    moldy: "hard_to_avoid",
    over_ripe: "hard_to_avoid",
    expired: "hard_to_avoid",
    other: "hard_to_avoid",
  }),
} as const);

const CURRENT_WASTE_AVOIDABILITY_VERSION = "waste-avoidability-v1";
```

The mapping has five reasons in each class. It is reason-only: no item, name,
department, quantity, value, or member field participates. A compile-time exhaustive
`Record<WasteReason, Avoidability>` plus a focused runtime test pins every canonical
`WASTE_REASONS` member exactly once and rejects any extra/missing member.

Omission selects `CURRENT_WASTE_AVOIDABILITY_VERSION`. An explicit supported name
selects that frozen table. An unknown name throws
`ToolError("validation_failed", "unsupported waste avoidability mapping version; supported versions: waste-avoidability-v1")`.
The response echoes the resolved version, the declared current version, and whether
they match. A later mapping is a new immutable key; v1 is never edited or removed, and
changing the current pointer is a distinct reviewed change. An explicit v1 read therefore
reproduces v1 classification for the same facts/range even after the default changes.
The analyzer remains a live view, so a later committed spend void or late fact may still
change value; mapping replay promises classification reproducibility, not a historical
database snapshot.

**Alternative rejected:** stamp avoidability on capture or rewrite events when policy
changes. Either loses replay and creates a migration/backfill writer. Effective-dated
implicit selection is also rejected: named replay makes caller intent and output version
visible and testable.

### D3. Last-paid value is an indexed, tenant-scoped read

For each waste event, value is the `unit_price` from the latest eligible spend row:

```sql
SELECT unit_price, estimated, occurred_on, send_id
FROM spend_events
WHERE tenant = ?tenant
  AND line_key = ?item_id
  AND voided_at IS NULL
  AND unit_price IS NOT NULL
  AND occurred_on <= ?waste_occurred_at
ORDER BY occurred_on DESC, send_id DESC
LIMIT 1
```

The production waste read expresses that as a correlated seek and joins the selected
row back by `(send_id, line_key, tenant)`, so price and estimated flag always come from
the same row. `(tenant, line_key, occurred_on)` bounds the seek; `send_id DESC` resolves
same-day ties. A same-day purchase is eligible because both persisted facts are date-only.
A future purchase never values an earlier toss. A voided row is ineligible; on the next
read the next older eligible priced row wins or value becomes unavailable. NULL prices
are skipped, so a recent unpriced event does not hide an older known last-paid price.

One matched `unit_price` values one persisted waste event. The analyzer ignores
`spend_events.amount` and both spend and waste quantities for this derivation: loose
pantry quantity is descriptive and cannot safely express package count. Each matched
price is rounded once to integer cents with `Math.round(unit_price * 100)` before sums.
Zero is a known value. `estimated = 1` remains a usable known estimate but marks monetary
coverage partial. No member input or fallback source is consulted.

**Alternative rejected:** multiply by loose quantity, use purchase `amount`, allocate a
recipe's ingredients to leftovers, or fall back to SKU/flyer data. None has a production
fact that states the quantity/value of the tossed portion.

### D4. One exact aggregate contract

The dedicated API body is the `WasteAnalyzer` directly. The retrospective MCP/profile
result carries that exact object at `.waste`; there is no transport-specific reducer or
renamed field. The workerd-free wire contract lives in
`packages/worker/src/waste-shapes.ts` and is exported from
`packages/worker/package.json` for Worker, app, and typed presentation fixtures; this is
production contract code, not a test model. That leaf imports/reuses the public
`SpendRange`, `CoverageStatus`, `MonetaryCoverage`, `ClassificationCoverage`, and
`MoneyKpi` wire primitives from the workerd-free `spend-shapes` leaf rather than copying
them; `WasteRange` aliases `SpendRange`. Waste production code also imports exactly the
existing pure `SpendBounds`, `spendBounds`, `addUtcDays`, `toCents`, `fromCents`,
`roundPercent`, `compareRawKeys`, and `presentationLabel` declarations after making
them exported from `packages/worker/src/spend.ts`. Their bodies and Spend behavior stay
unchanged; no generic helper module is introduced.

```ts
type WasteRange = SpendRange; // "4w" | "8w" | "12w"
type WasteItemStatus = "unavailable" | "partial" | "complete";
type Avoidability = "avoidable" | "hard_to_avoid";

interface WasteWeek {
  week_start: string;
  week_end: string;
  through: string;
  is_partial: boolean;
  events: number;
  amount: number | null;
  status: CoverageStatus;
  monetary_coverage: MonetaryCoverage;
  department_coverage: ClassificationCoverage;
}


interface ItemsBinnedKpi {
  count: number;
  per_week: number;
}

interface WasteTrendKpi {
  percent: number | null;
  current_known_amount: number;
  prior_known_amount: number;
  status: "available" | "unavailable";
  reason: null | "current_incomplete" | "prior_incomplete" | "prior_zero";
}

interface QualifyingSpendCoverage {
  status: CoverageStatus;
  spend_event_count: number;
  qualifying_event_count: number;
  excluded_household_event_count: number;
  pending_department_event_count: number;
  priced_event_count: number;
  unpriced_event_count: number;
  estimated_event_count: number;
  known_amount: number;
}

interface WasteRateKpi {
  percent: number | null;
  known_waste_amount: number;
  qualifying_spend_amount: number;
  status: "available" | "unavailable";
  reason: null | "waste_incomplete" | "spend_incomplete" | "zero_denominator";
  spend_coverage: QualifyingSpendCoverage;
}

interface WasteBreakdownItem {
  key: string;
  label: string;
  event_count: number;
  valued_event_count: number;
  unvalued_event_count: number;
  estimated_event_count: number;
  amount: number | null;
  count_percentage: number | null;
  amount_percentage: number | null;
}

interface WasteBreakdown {
  count_denominator: number;
  known_amount_denominator: number;
  classification_coverage: ClassificationCoverage;
  monetary_coverage: MonetaryCoverage;
  items: WasteBreakdownItem[];
}

interface WasteItemGroup {
  key: string;
  name: string;
  department: { key: string; label: string } | null;
  event_count: number;
  valued_event_count: number;
  unvalued_event_count: number;
  estimated_event_count: number;
  amount: number | null;
  amount_percentage: number | null;
  status: WasteItemStatus;
}

interface WasteAnalyzer {
  range: WasteRange;
  as_of: string;
  selected_start: string;
  selected_end: string;
  prior_start: string;
  prior_end: string;
  status: CoverageStatus;
  avoidability_mapping: {
    version: string;
    current_version: string;
    is_current: boolean;
  };
  coverage: {
    monetary: MonetaryCoverage;
    department: ClassificationCoverage;
  };
  weeks: WasteWeek[];
  kpis: {
    tossed_value: MoneyKpi;
    items_binned: ItemsBinnedKpi;
    waste_rate: WasteRateKpi;
    trend: WasteTrendKpi;
  };
  breakdowns: {
    department: WasteBreakdown;
    reason: WasteBreakdown;
    avoidability: WasteBreakdown;
  };
  most_wasted: { cap: 6; total_count: number; items: WasteItemGroup[] };
  insight: string;
}
```

`status` is the selected Waste monetary status. Department incompleteness is orthogonal
and travels in `coverage.department` and the department breakdown; it never makes a
known last-paid subtotal look monetarily incomplete. Currency outputs are cents-rounded;
percentages and `items_binned.per_week` are rounded to one decimal. A percentage is null
at a zero denominator. Canonical labels split `_`/`-`, lowercase words, capitalize each,
and join with spaces; avoidability uses the explicit labels `Avoidable` and
`Hard to avoid`. Labels never change grouping keys.

**Alternative rejected:** return a compact API shape and rebuild UI/MCP calculations.
That creates drift and a parallel model. Moving the eight reused Spend declarations to
a generic utility is also rejected: an export-only edit preserves the established owner
and behavior with the smallest possible cross-file change. One typed Waste object keeps
every channel honest.

### D5. Coverage, weekly buckets, counts, and trend

Selected/prior monetary coverage uses persisted waste-event count and matched prices:

- no events -> `empty`, known amount 0, KPI/bucket amount 0;
- events but no matched prices -> `unavailable`, known amount 0, amount null;
- at least one match plus any unmatched event or any matched estimated price ->
  `partial`, amount is the known subtotal;
- every event matched and no matched price estimated -> `complete`.

`priced_event_count` means matched last-paid rows, including zero prices.
`unpriced_event_count = event_count - priced_event_count`. Each weekly bucket applies
the same rule to that week's events and carries visible text derived from its status and
counts; the geometry is never the only representation. `through` is the lesser of the
bucket Sunday and `as_of`; `is_partial` is `through < week_end`.

Items binned is the exact selected waste row count. `per_week = count / N`, including
all N calendar buckets and the current partial bucket. A row counts once regardless of
its loose quantity. Empty returns `{ count: 0, per_week: 0 }`.

Trend compares selected and matched-prior known Tossed value. `empty` and `complete`
are exact; `partial` and `unavailable` are incomplete. Reason precedence is:

1. current incomplete -> `current_incomplete`;
2. prior incomplete -> `prior_incomplete`;
3. exact prior amount zero -> `prior_zero`.

Only otherwise does `percent = (current - prior) / prior * 100`. An exact empty current
window against a positive exact prior window is `-100.0`. Zero prior is unavailable,
never infinity.

**Alternative rejected:** treat missing as zero or compare unequal elapsed windows.
Both would fabricate improvement. The matched shape reuses Spend's settled contract.

### D6. Waste rate uses qualifying captured Spend, not cost-per-meal rules

The qualifying grocery-spend term sums selected, non-voided `spend_events.amount` whose
captured department is non-NULL and not `household`. `beverages` is included. This does
not reuse D17's `{household, beverages}` cost-per-meal exclusion. Household rows are
exactly excluded even if unpriced/estimated because they cannot enter the term. A NULL
department is unresolved: it may later stamp `household`, so neither its amount nor its
estimated flag enters known grocery spend and it makes coverage incomplete. The analyzer
does not invoke the fill.

`QualifyingSpendCoverage` counts all selected spend rows in `spend_event_count`;
`qualifying_event_count` counts classified non-household rows;
`excluded_household_event_count` counts classified household rows; and pending is
separate. Priced/unpriced/estimated counts are among qualifying rows. Its status is:

- `empty` when there are no qualifying or pending rows (including a range containing
  only classified Household rows): qualifying spend is an exact zero;
- `unavailable` when no qualifying amount is known and a qualifying-unpriced or pending
  row could affect the term;
- `partial` when some qualifying amount is known but any qualifying row is unpriced or
  estimated, or any department is pending;
- `complete` when at least one qualifying row exists and all are priced, non-estimated,
  and classified, with no pending row.

Each eligible stored `amount` is rounded once to cents before summing. Zero amount is a
known priced event. Rate is available only when Waste monetary coverage and qualifying
Spend coverage are each exact (`empty` or `complete`) and their combined cents are
positive:

`known_waste / (qualifying_spend + known_waste) * 100`.

Reason precedence is Waste incomplete, Spend incomplete, then zero denominator. Exact
empty Waste plus positive complete Spend returns `0.0%`; positive complete Waste plus
exact-empty Spend returns `100.0%`. Partial/unavailable inputs or a zero combined
denominator return null. The member UI colors an available `percent >= 10.0` red. It
never applies threshold styling when percent is null.

**Alternative rejected:** call the full Spend analyzer or reuse cost-per-meal numerator.
The former performs unrelated cooking/budget reads; the latter incorrectly excludes
beverages. One selected-window indexed spend read is simpler and exact.

### D7. Effective department and exact breakdown denominators

For Waste analytics, effective department is `leftovers` whenever
`prepared_from IS NOT NULL`; otherwise it is the capture-stamped `department`. This
read-time override is deterministic belt-and-suspenders for older or inconsistent
capture stamps and does not mutate D17 history. A non-leftover NULL remains pending and
never becomes `Not mapped`.

Every breakdown includes only groups with at least one selected event. Items include
unvalued-only groups; their `amount` is null, never zero-as-value. Sort all breakdown
items by internal known cents descending, event count descending, then canonical key
ascending. Count and monetary denominators are independent:

- **Department:** count denominator is events with an effective department; money
  denominator is known value attached to those classified events. Pending events are
  absent from items but remain in `classification_coverage`. Department monetary
  coverage is computed over classified events, while classification coverage explains
  any omitted event/value.
- **Reason:** count denominator is every selected event; money denominator is every
  selected known Waste value. Canonical capture guarantees a reason for every event, so
  classification is `empty` or `complete`; monetary coverage is selected coverage.
- **Avoidability:** identical denominators to Reason after applying the selected mapping
  version. Classification is `empty` or `complete`; the two possible keys are
  `avoidable` and `hard_to_avoid`, and only present groups are returned.

For each item, count percentage uses its breakdown count denominator and amount
percentage uses the known-money denominator. A zero denominator yields null. Event
count includes matched and unmatched rows; valued/unvalued/estimated counts and the
coverage objects make sparse data visible. Percentages are one decimal.

**Alternative rejected:** use all events as the Department denominator or create a
`Not mapped` group. Both would imply pending classification is a real department.

### D8. Most-wasted items and stable ordering

Most-wasted groups use canonical `item_id`. Every persisted event contributes to
`event_count`; only matched prices contribute money. `amount` is null when the group has
no matched value, otherwise its known subtotal (including a known zero). Group status
uses the normal monetary-coverage rule narrowed to `WasteItemStatus = "unavailable" |
"partial" | "complete"`. A returned group is nonempty by construction, so `empty` is
unreachable and is not part of its production type. `amount_percentage` uses total
selected known Waste value, or null at zero.

Valued groups sort before unvalued-only groups. Valued groups then sort by known cents
descending, event count descending, and `item_id` ascending. Unvalued-only groups sort
by event count descending then `item_id` ascending. `total_count` is the pre-cap group
count and `items` is capped at six.

The representative event is latest `occurred_at`, then lexicographically greatest event
`id`. Its captured `name` is the display name. Its effective department supplies the
optional department badge; a pending representative yields null. Neither representative
field affects grouping or sort.

Waste weeks are chronological. The source Waste query orders `occurred_at ASC, id ASC`;
the Spend-rate query orders `occurred_on ASC, send_id ASC, line_key ASC`; reducers still
apply every stated tie-breaker and never rely on incidental D1 order.

**Alternative rejected:** omit unpriced groups. Counts remain useful production facts
when money is unavailable, so hiding those groups would make sparse history look empty.

### D9. Deterministic insight templates

Insight selection has this exact ladder and no LLM, random/hash rotation, name heuristic,
or data threshold:

1. Empty: `No recorded waste in this range.`
2. Monetary unavailable: `Waste value is unavailable because none of the recorded tosses in this range has a matching last-paid price.`
3. Monetary partial: `Known waste value is incomplete: {clauses}.`
4. Monetary complete: the exact complete-data composition below.

Partial clauses appear in fixed order when their count is positive:

- `{n} tossed item had no matching last-paid price` / `{n} tossed items had no matching last-paid price`;
- `{n} tossed item used an estimated last-paid price` / `{n} tossed items used an estimated last-paid price`.

Join two clauses with ` and `. A partial state necessarily has at least one clause.

For complete monetary data, use the already-sorted first Reason item. Use the
already-sorted first Department item only when selected Department classification is
`complete`. Then begin
`{Department label} accounted for the most waste at {currency}` and append
`; {Reason label} was the leading reason by known waste value with {n} tossed item(s)`.
If any selected effective department is pending — whether some or every department is
pending — begin
`{Reason label} was the leading waste reason by known value with {n} tossed item(s)`
instead. Reason covers every selected event, so this never promotes a leader computed
from an incomplete Department subset to a household claim. This wording follows the
required amount-first breakdown sort and never calls the leading-value group the most
frequent unless its count actually says so. When known total is positive, append
`; avoidable waste represented {p.toFixed(1)}% of known waste value`. End with one
period. Singular is `1 tossed item`; every other count uses `items`. Currency is `$`
plus cents with exactly two decimals. The avoidable percentage comes from the
`avoidable` amount item and is `0.0` when that class is absent but the denominator is
positive. Thus one reducer-authored string is identical on every transport.

**Alternative rejected:** port the mock's item-specific advice or choose a phrase by
threshold. The mock has synthetic values/classifications, and such advice has no
captured production fact.

### D10. Existing-index read sequence, concurrency, and read-only guarantee

After input validation and range derivation, the operation performs two tenant-scoped
reads through `db(env)`:

1. one ordered Waste query for prior start through as-of, with the D3 correlated
   last-paid seek and joined price/estimated fields;
2. one ordered selected-window non-voided Spend query for `amount`, `estimated`, and
   captured `department` used only by Waste rate.

The first outer scan uses `idx_waste_events_when`; every correlated price selection uses
`idx_spend_events_item`; the second uses `idx_spend_events_tenant`. TypeScript performs
one shared reduction. No all-history scan, unbounded join, write statement, mutation
helper, cache fill, external request, model call, cron invocation, or scheduled work is
present. Mapping lookup is an in-code constant read.

Late/backdated waste enters its authoritative bucket on the next read; late/backdated
spend may become the last-paid value when its date is eligible. Existing
`PRIMARY KEY (tenant, id)` plus insert-or-ignore makes a duplicate Waste event id count
once. Voided/corrected Spend converges as D3 describes. Waste has no production edit or
void path, so the analyzer invents none.

Each D1 query observes committed facts. A concurrent waste capture or spend void may
commit before or after its corresponding query; no cross-table snapshot is promised.
A refresh converges on all committed facts. Repeated reads with unchanged facts, UTC
day, range, and mapping version return the same object. No lock, token, CAS, recovery,
or writer coordination is justified.

**Alternative rejected:** materialize values/aggregates or schedule recomputation. Live
voids, late facts, named mapping replay, and 24-week bounds make read-time derivation both
simpler and more correct.

### D11. API, MCP, profile, validation, ETag, and compatibility

Add session-gated
`GET /api/retrospective/waste?range=4w|8w|12w&mapping_version=<name>`.
Missing `range` defaults to `8w`; any other value throws
`ToolError("validation_failed", "range must be 4w | 8w | 12w")`, which existing
middleware serves as HTTP 400. Missing `mapping_version` selects current; unsupported
uses D2's exact HTTP-400 structured error. `requireSession` supplies tenant, and
`jsonWithEtag` serves the direct `WasteAnalyzer` with private/no-cache ETag/304 behavior.
`/api/*` already has a `run_worker_first` entry, so no Wrangler change is needed.

The MCP `retrospective` input adds optional
`waste_range: z.enum(["4w", "8w", "12w"])` and
`waste_mapping_version: z.string().optional()`. Omission defaults to `4w` and current
mapping; the mapping string goes through the same resolver/error as HTTP. The existing
`period` and Spend range remain independent. `loadRetrospective` accepts additive Waste
options defaulted to 4w/current and adds `.waste` without changing cooking or `.spend`.
The existing `/api/profile/retrospective` keeps its public `period` input only and uses
those compatible 4w/current defaults; the dedicated Waste API is the member replay and
8w UI surface. No Waste write tool exists.

Old MCP/profile callers therefore receive one additive field and keep all existing
defaults. Existing databases already have every queried column/index. Existing NULL
departments and unmatched/estimated prices are valid partial/unavailable inputs. Future
mapping versions are additive names. No migration or version branch is required for a
fresh database or one migrated before this analyzer deploy.

**Alternative rejected:** expose a second transport shape or silently fall back from an
unknown mapping version. Both make a requested replay non-reproducible.

### D12. Member UI, URL state, and accessibility

Spend and Waste share the one `range` search parameter and one control. Entering either
analyzer tab with missing/invalid `range` canonicalizes to `8w` with replace navigation;
selecting 4w/8w/12w writes that value. Cooking log ignores but retains a valid range, so
returning to an analyzer preserves it. Waste always requests the current mapping by
omitting `mapping_version`. Its TanStack key is
`["retrospective", "waste", range]`, runs only while Waste is active, and remains outside
the offline persistence allowlist.

Reuse the semantic tabs ratified by Spend: stable tab/panel ids, reciprocal
`aria-controls`/`aria-labelledby`, one selected `tabIndex=0`, and wrapping
ArrowLeft/ArrowRight plus Home/End activation/focus. The shared range selector is a
named `role="group"` whose buttons expose `aria-pressed`.

The Waste panel renders:

- an accessible status while loading (`Loading waste analysis…`);
- a structured `role="alert"` error message and keyboard-operable Retry that refetches;
- a distinct empty state for `status=empty`, retaining the range control and exact zero
  item count without rendering misleading dollar breakdowns;
- unavailable money as `Last-paid value unavailable` while exact item counts and
  reason/avoidability/department counts remain visible;
- partial money as `Known last-paid estimate`, with unmatched and estimated counts
  visible beside selected/Tossed value and every weekly, breakdown, and item-group
  value whose returned coverage/counts identify those facts; and
- complete money as `Last-paid estimate`, never `receipt total`, because even an exact
  match is the last unit price, not measured tossed quantity.

Pending Waste department classification is presented separately from Waste money. If
every Waste event has an exact non-estimated match, a pending effective department does
not change `Last-paid estimate` to the partial label; it instead makes Department
coverage incomplete. Separately, a pending department on a selected Spend row may make
Waste rate incomplete through the qualifying Spend rules. Trend has no prior-period
coverage fields by design: an unavailable trend renders its returned
`current_incomplete`, `prior_incomplete`, or
`prior_zero` reason next to the current/prior known amounts, and the UI does not invent
unmatched or estimated counts for the prior interval.

KPI labels/text expose Tossed value, exact Items binned and items/week, Waste rate with
its unavailable reason, and matched trend. Weekly bars are a semantic chronological
list with visible week, event count, amount/unavailable label, and coverage text; bar
geometry is decorative and hidden from assistive technology. Breakdown rows expose
labels, counts, known amounts, both percentages, and denominator/coverage text.
Most-wasted rows expose name, `tossed N×`, optional effective department, and known or
unavailable value. An available rate at 10.0% or above gets the reviewed red treatment;
null never does.

Every Waste-derived dollar amount is labelled as a spend-history last-paid estimate.
If `qualifying_spend_amount` is displayed as the Waste-rate denominator input, it is
labelled recorded/captured grocery spend, not a per-toss last-paid estimate; neither
label implies receipt reconciliation or measured tossed quantity.

Desktop follows the reviewed Retrospective composition. Narrow layouts stack KPI,
breakdown, and item cards in reading order; controls wrap without overlap. Tall layouts
remain compact at the top and preserve all rows. The weekly visual sits in a labelled
horizontal-overflow region at narrow widths, with textual data never clipped. Use
existing components/CSS only: no canvas, chart package, hover-only content, or offline
aggregate fallback.

**Alternative rejected:** duplicate a Waste-only range control or calculate aggregates
in React. Shared URL state prevents divergent Spend/Waste windows, and server results are
the only analyzer model.

### D13. Production-entry tests, docs, deployment, and footprint

Focused Worker tests invoke `readWasteAnalyzer` against the migration-backed SQLite D1
and cover tenant isolation; Monday/Sunday and all 4/8/12 selected/prior boundaries;
future exclusion; empty/unavailable/partial/complete and zero-price states; cents
rounding; exact last-paid date/send tie, future, NULL-price, estimated, void fallback,
and quantity-ignore rules; prepared-from Leftovers; all five/five v1 reasons and named
replay/unknown-version validation; rate exclusions/coverage/reason precedence; trend;
every breakdown denominator; item representative/sort/cap ties; insight strings; and
late, duplicate, void-corrected, concurrent-refresh, and repeated-read behavior.
They exercise the imported Spend helpers through the production Waste reader, while
the existing Spend tests prove the export-only `spend.ts` edit leaves Spend behavior
unchanged; no duplicate helper oracle or direct copy of the reducer is added.

API tests use the composed session-gated member app and verify 8w/current defaults,
explicit range/version, exact validation errors, tenant non-overridability, ETag 304,
and unauthorized rejection. MCP tests invoke the registered production tool and verify
4w/current defaults, explicit replay, shared object identity, and no write. A fresh
SQLite schema created by the full migration chain and fixtures containing previously
migrated NULL/past rows exercise the same reader; because there is no new migration,
there is no alternate schema or migration-only model.

Playwright's primary Waste case signs into the seeded app and reaches the production
analyzer through the real member API. It verifies 8w URL canonicalization, range changes,
tabs/range keyboard behavior, KPI/chart/breakdown/item text, rate styling, and reviewed
desktop plus narrow/tall screenshots. Narrow interception is allowed only to hold an
otherwise unreachable loading/error/retry or valid unavailable/partial presentation
state, including a prior-incomplete trend. It must use the exported production response
type and cannot replace the seeded aggregate proof. That prior-incomplete case renders
the returned `prior_incomplete` reason; it does not add or invent prior coverage counts.

Update the two living specs, `docs/TOOLS.md`, `docs/SCHEMAS.md`,
`docs/ARCHITECTURE.md`, and `packages/worker/AGENT_INSTRUCTIONS.md` together.
TOOLS owns exact inputs/returns/read-only guarantees; SCHEMAS owns last-paid/effective
department/mapping derivation and no value column; ARCHITECTURE owns the bounded
read-time analyzer and explicitly says no analyzer cron; the `cooking-retrospective`
persona acts on returned facts and performs no write. Plugin generation/check must stay
clean.

The exact anticipated final merge-base set contains 29 files:

- six archived OpenSpec artifacts (`.openspec.yaml`, proposal, this design, tasks, and
  two deltas) plus the two corresponding living specs;
- `packages/worker/src/spend.ts` for exports only,
  `packages/worker/src/waste-shapes.ts`,
  `packages/worker/src/waste-avoidability.ts`,
  `packages/worker/src/waste-analyzer.ts`,
  `packages/worker/src/api/retrospective.ts`,
  `packages/worker/src/cooking-tools.ts`, and `packages/worker/package.json` for the
  production `waste-shapes` subpath;
- `packages/app/src/lib/data.ts`,
  `packages/app/src/routes/_app.retrospective.tsx`, and
  `packages/ui/src/cookbook.css`;
- `packages/worker/test/waste-analyzer.test.ts`,
  `packages/worker/test/cooking-tools.test.ts`,
  `packages/worker/test/api-member.test.ts`,
  `packages/worker/admin/visual/seed.mjs`,
  `packages/worker/admin/visual/seed.d.mts`,
  `packages/worker/app/visual/pages/retrospective.page.ts`, and
  `packages/worker/app/visual/specs/retrospective.spec.ts`; and
- the three docs and `packages/worker/AGENT_INSTRUCTIONS.md` named above.

That exact set sits inside a frozen **24-32 changed-file / 4,200-5,600 added-line**
forecast after archive. The package itself already contributes about 1,650
archive-bound lines and its two deltas contribute about 600 additional living-spec
lines, so the prior 2,500-4,300 line range did not leave a credible production/test
allowance. Stop for approval above 40 files or 7,000 added lines (more than 25% over the
frozen upper forecasts), and independently at more than 70 files or 7,000 added lines.
No generated file is expected. `packages/worker/package.json` is the one anticipated
authored manifest/configuration edit; `/api/*` routing, dependencies, bindings, Wrangler
configuration, and migration state are already sufficient.

**Alternative rejected:** unit-test a pure fixture reducer as the primary proof. Reader,
API, MCP, and seeded-browser entry points already make the production algorithm directly
testable.

### Requirement-to-decision map

| Product/proposal requirement | Design decision |
|---|---|
| Household isolation, UTC and 4/8/12 selected/prior boundaries | D1 |
| Versioned reason-only five/five avoidability and replay | D2 |
| Spend-history-only value, missing price, tie/null/estimated behavior | D3, D5 |
| Exact shared response and truthful partial/unavailable states | D4, D5 |
| Items/week, Tossed value, trend, zero/missing denominators | D5 |
| Waste rate and Household/Beverages treatment | D6 |
| Leftovers and department/reason/avoidability denominators | D7 |
| Most-wasted item representative, ordering, unpriced groups, cap | D8 |
| Exact deterministic insight selection and grammar | D9 |
| Bounded indexed read-time aggregation, late/duplicate/corrected/concurrent facts | D10 |
| API/MCP/profile inputs, defaults, ETag, auth, compatibility, read-only | D11 |
| Browser loading/empty/unavailable/partial/error/accessibility/layout | D12 |
| Production-entry tests, docs/persona parity, no test-only design, footprint | D13 |
| No migration/index/cron/dependency/cross-cutting infrastructure | Non-Goals, D10, D13 |

## Risks / Trade-offs

- **Last unit price is not the value of an arbitrary tossed quantity** -> Label every
  Waste-derived dollar as a last-paid estimate, label any qualifying denominator as
  recorded/captured Spend, never parse quantity, and expose event/value coverage.
- **A price can disappear after a spend correction** -> Re-resolve non-voided history on
  every read and truthfully become partial/unavailable; never snapshot stale money.
- **Pending Waste department omits a row from Department; pending Spend department may
  block Waste rate** -> Return the separate classification/Spend coverage counts and let
  the existing NULL-to-value cron converge on its own; do not guess or invoke it.
- **Independent waste/spend reads are not one transaction** -> Promise committed
  per-query facts and convergence on refresh, not a cross-table snapshot.
- **UTC may differ from a member's civil week** -> State UTC in contracts and
  architecture/tool/schema docs, and render the authoritative returned date labels
  without inventing a separate visible UTC badge; a future timezone feature needs its
  own capture-compatible proposal.
- **Named mappings enlarge the public contract over time** -> Freeze every published
  version, validate names explicitly, and echo selected/current versions.
- **Dense charts can overflow narrow screens** -> Keep semantic text primary and use a
  labelled horizontal overflow region for decorative geometry.

## Migration Plan

1. Implement the immutable v1 mapping and shared bounded analyzer over existing rows.
2. Add the dedicated authenticated route and additive MCP/profile composition.
3. Replace the Waste placeholder and extend real-API Playwright coverage.
4. Synchronize specs, docs, persona, and plugin check; archive only after implementation.
5. Deploy Worker and member assets together. Existing data and old callers need no
   migration, backfill, or client flag.

Rollback is code-only: remove the route, optional MCP inputs/result field, UI, and
mapping/analyzer modules. No stored data or scheduled state needs reversal.

## Open Questions

None. All product, data, transport, ordering, failure, compatibility, and presentation
behavior required for implementation is settled above.
