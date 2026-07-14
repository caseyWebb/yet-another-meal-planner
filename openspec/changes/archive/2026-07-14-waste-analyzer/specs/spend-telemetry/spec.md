## ADDED Requirements

### Requirement: Waste aggregates are agent-readable through the shared retrospective operation
The `retrospective` tool SHALL return a read-only, household-scoped `waste` value produced by the shared `readWasteAnalyzer` operation. Its optional `waste_range` input SHALL accept exactly `4w`, `8w`, or `12w` and SHALL default to `4w` when omitted. Its optional `waste_mapping_version` input SHALL select an explicitly supported immutable avoidability mapping and SHALL default to the declared current mapping when omitted. The existing cooking `period`, Spend input, cooking result, and `.spend` value SHALL remain independent and unchanged.

The existing profile retrospective result SHALL add the same shared object at `.waste`, using the compatible `4w` range and current mapping defaults without adding a profile query input. The dedicated member Waste response, MCP `.waste`, and profile `.waste` SHALL expose the same aggregate object without a transport-specific reducer or renamed field. The addition SHALL be backward-compatible for existing callers. No MCP tool SHALL accept a waste event, value, classification, or aggregate for writing.

#### Scenario: Omitted MCP Waste inputs use compatible defaults
- **WHEN** an authenticated member invokes `retrospective` without `waste_range` or `waste_mapping_version`
- **THEN** `.waste.range` is `4w`, `.waste.weeks` contains four chronological ISO-week buckets, and `.waste.avoidability_mapping.version` is the declared current version

#### Scenario: Explicit MCP Waste inputs affect only Waste
- **WHEN** an authenticated member invokes `retrospective` with `waste_range: "12w"`, `waste_mapping_version: "waste-avoidability-v1"`, and independently selected cooking and Spend inputs
- **THEN** `.waste` is the shared twelve-week v1 aggregate while the cooking and Spend inputs retain their own documented behavior

#### Scenario: Existing profile callers receive the additive shared object
- **WHEN** an existing caller reads profile retrospective without any Waste argument
- **THEN** its existing fields are unchanged and `.waste` is the same shared analyzer shape using `4w` and the current avoidability mapping

#### Scenario: Agent reads are household scoped and side-effect free
- **WHEN** one authenticated identity reads retrospective while another tenant has overlapping waste and spend history
- **THEN** `.waste` contains only facts owned by the resolved tenant, accepts no public tenant override, and the read performs no write

#### Scenario: No Waste write tool exists
- **WHEN** the MCP surface is enumerated
- **THEN** no tool accepts a Waste event, member-entered value, avoidability result, or analyzer aggregate for writing

### Requirement: The Waste analyzer uses the shared bounded UTC ISO-week contract
`readWasteAnalyzer(env, tenant, range, mappingVersion?, now?)` SHALL accept exactly `4w`, `8w`, or `12w`, reuse the existing `SpendBounds`, `spendBounds`, and `addUtcDays` declarations exported from `packages/worker/src/spend.ts`, and map the range to N weekly buckets. The export-only Spend edit SHALL NOT alter helper bodies, Spend callers, or Spend behavior, and Waste SHALL NOT create a generic date-helper module or second range implementation. `now` SHALL default to the current clock and `as_of` SHALL equal `now.toISOString().slice(0, 10)`. Stored ISO dates SHALL be authoritative UTC calendar dates; the analyzer SHALL NOT infer a household timezone or reinterpret captured dates.

Weeks SHALL start on ISO Monday and end on Sunday. If `current_start` is the Monday containing `as_of`, the selected interval SHALL be `selected_start = current_start - (N - 1) * 7 days` through `selected_end = as_of`, inclusive. The matched prior interval SHALL be `prior_start = selected_start - N * 7 days` through `prior_end = as_of - N * 7 days`, inclusive. The response SHALL contain exactly N selected buckets, oldest first, including the current partial bucket. Each bucket SHALL expose Monday `week_start`, Sunday `week_end`, `through` equal to the earlier of that Sunday and `as_of`, and `is_partial` equal to whether `through` precedes `week_end`. Date-only facts on one day SHALL use only the specified stable keys; the analyzer SHALL NOT invent a time of day.

The outer Waste read SHALL be bounded from `prior_start` through `as_of`; the qualifying-spend read SHALL be bounded from `selected_start` through `as_of`; and future-dated waste and spend facts SHALL be excluded. The largest `12w` request SHALL scan no more than the matched 24-week Waste interval, plus indexed last-paid seeks and the selected twelve-week Spend interval. Session or MCP authentication SHALL resolve the internal tenant before analysis, every database predicate SHALL include that tenant, and no public input SHALL accept a tenant id.

#### Scenario: Four weeks include the current partial UTC week
- **WHEN** Waste is read for `4w` on UTC Wednesday 2026-07-15
- **THEN** four buckets run from Monday 2026-06-22 through the bucket beginning Monday 2026-07-13, `selected_end` is 2026-07-15, and the last bucket has `through: "2026-07-15"` and `is_partial: true`

#### Scenario: Sunday closes the current bucket
- **WHEN** Waste is read on a UTC Sunday
- **THEN** the final bucket's `through` equals its `week_end` and `is_partial` is false

#### Scenario: All supported ranges have matched prior shapes
- **WHEN** `4w`, `8w`, or `12w` is requested on any weekday
- **THEN** the selected result has respectively 4, 8, or 12 chronological buckets and the prior interval ends on the same weekday exactly N weeks earlier

#### Scenario: The largest request remains bounded
- **WHEN** `12w` is requested
- **THEN** the outer Waste facts are read only across the matched 24-week span, last-paid history is reached only through indexed item seeks, and qualifying Spend is read only across the selected twelve weeks

#### Scenario: Future facts are excluded
- **WHEN** Waste or Spend rows carry authoritative dates after `as_of`
- **THEN** they affect no selected bucket, prior comparison, last-paid value, or Waste-rate input

#### Scenario: Tenant and UTC boundaries cannot be overridden
- **WHEN** two tenants have overlapping dates and a caller supplies tenant-like or timezone-like public values
- **THEN** the analyzer uses only the authenticated tenant and groups authoritative stored dates by UTC ISO Monday without accepting either override

### Requirement: Avoidability is a frozen named reason mapping selected at read time
Avoidability SHALL be derived at read time from an exhaustively typed immutable registry, never stored on or written back to a waste event. The declared first and current mapping SHALL be named exactly `waste-avoidability-v1` and SHALL classify exactly five canonical reasons as `avoidable` — `forgot`, `bought_too_much`, `never_opened`, `freezer_burned`, and `stale` — and exactly five as `hard_to_avoid` — `spoiled`, `moldy`, `over_ripe`, `expired`, and `other`.

The mapping SHALL depend only on canonical reason. Item id, name, department, quantity, value, member input, and model output SHALL NOT affect it, and no member override SHALL exist. Compile-time typing and a production-registry test SHALL establish that every canonical `WASTE_REASONS` member appears exactly once and no extra reason appears.

Omitting a version SHALL select `CURRENT_WASTE_AVOIDABILITY_VERSION`. An explicit supported name SHALL select that frozen table. An unknown name SHALL raise `ToolError("validation_failed", "unsupported waste avoidability mapping version; supported versions: waste-avoidability-v1")`; it SHALL NOT silently fall back. The result SHALL expose `avoidability_mapping: { version, current_version, is_current }`. Published mappings SHALL be retained unchanged; a later policy SHALL add a new immutable version and may separately advance the current pointer. An explicit historical version SHALL therefore reproduce classification for unchanged facts and range even after the default advances, while live late facts or Spend voids may still alter the live aggregate.

#### Scenario: Version one classifies every reason five and five
- **WHEN** one event for each canonical Waste reason is read with version `waste-avoidability-v1`
- **THEN** the five specified preventable reasons group as `avoidable`, the other five group as `hard_to_avoid`, and every event appears in exactly one class

#### Scenario: Omission selects and echoes the current version
- **WHEN** no mapping version is requested
- **THEN** the analyzer uses `CURRENT_WASTE_AVOIDABILITY_VERSION`, echoes it as both selected and current, and returns `is_current: true`

#### Scenario: A named frozen version remains replayable
- **WHEN** the declared current pointer later advances and the same facts, range, clock, and explicit `waste-avoidability-v1` are read
- **THEN** reason classification is identical to the earlier v1 read and `is_current` truthfully reflects whether v1 is still current

#### Scenario: Unknown mappings fail explicitly
- **WHEN** any unregistered version is requested through the shared resolver
- **THEN** analysis fails with `validation_failed` and the exact supported-version message rather than using the current mapping

#### Scenario: Avoidability ignores non-reason data
- **WHEN** two events have the same reason but different item ids, names, departments, quantities, values, or prepared-from state
- **THEN** the selected mapping assigns the same avoidability class without a model call or member override

### Requirement: Waste value comes only from eligible household Spend history
For each Waste event, the analyzer SHALL resolve at most one last-paid row from `spend_events`: the latest row for the same tenant whose `line_key` equals the event's canonical `item_id`, whose `voided_at` is NULL, whose `unit_price` is non-NULL, and whose `occurred_on` is on or before the Waste event's `occurred_at`, ordered by `occurred_on` descending and then `send_id` descending. Price and `estimated` SHALL come from that same selected row. A same-date purchase SHALL be eligible; a future purchase SHALL never value an earlier toss; a NULL-priced newer row SHALL be skipped in favor of an eligible older priced row; and a voided row SHALL fall back to the next eligible older row or leave value unavailable.

One selected `unit_price` SHALL value one persisted Waste event. Each selected decimal SHALL be rounded once with `Math.round(unit_price * 100)` before integer-cent aggregation. A zero price SHALL be a known value. `estimated=1` SHALL be a usable known estimate that forces affected monetary coverage to partial. The analyzer SHALL ignore `spend_events.amount`, Spend package quantity, and the Waste event's loose `quantity` for valuation.

No member-entered value, pantry field, SKU cache, flyer, catalog, store quote, receipt substitute, recipe allocation, prepared-from ingredient allocation, cross-tenant history, external request, or heuristic fallback SHALL participate. When no eligible row exists, the event value SHALL remain unresolved; the analyzer SHALL NOT fabricate zero.

#### Scenario: Latest eligible last-paid price wins with a stable tie
- **WHEN** an event has multiple same-tenant priced Spend rows on or before its date, including two on the latest date
- **THEN** the row with greatest `occurred_on` and then greatest `send_id` supplies both `unit_price` and `estimated`

#### Scenario: Same-day is eligible but future is not
- **WHEN** one matching purchase shares the Waste event's date and another has a later date
- **THEN** the same-day row may value the toss and the future row cannot

#### Scenario: Null and voided prices fall through honestly
- **WHEN** the newest matching row has NULL `unit_price` or is voided and an older non-voided priced row exists
- **THEN** the older eligible price is selected; when none exists, the Waste event remains unvalued

#### Scenario: Estimated and zero prices retain their facts
- **WHEN** a selected last-paid row has an estimated zero price
- **THEN** the event is valued at zero, counted as priced and estimated, and the corresponding monetary coverage is partial

#### Scenario: Loose quantity never multiplies value
- **WHEN** otherwise identical Waste events carry quantities such as `2`, `half`, or `a little`
- **THEN** each event contributes one selected unit price and the quantity text does not change value or event count

#### Scenario: No other value source fills a miss
- **WHEN** an event has no eligible household Spend row but a member value, SKU cache, flyer, prepared recipe, or another tenant could suggest a price
- **THEN** its value remains unresolved and no fallback source is read

### Requirement: Waste exposes one exact coverage-aware aggregate object
The workerd-free production `waste-shapes` leaf SHALL reuse the public workerd-free Spend `SpendRange`, `CoverageStatus`, `MonetaryCoverage`, `ClassificationCoverage`, and `MoneyKpi` primitives, with `WasteRange` aliasing `SpendRange`; it SHALL NOT copy them or create a test-only response model. The shared `WasteAnalyzer` result SHALL contain exactly these top-level fields: `range`, `as_of`, `selected_start`, `selected_end`, `prior_start`, `prior_end`, `status`, `avoidability_mapping`, `coverage`, `weeks`, `kpis`, `breakdowns`, `most_wasted`, and `insight`. `status` SHALL equal selected Waste monetary status; pending department classification SHALL remain orthogonal in `coverage.department` and SHALL NOT relabel a known monetary subtotal.

`avoidability_mapping` SHALL contain `version`, `current_version`, and `is_current`. `coverage` SHALL contain `monetary` and `department`. Every monetary-coverage object SHALL contain `status`, `event_count`, `priced_event_count`, `unpriced_event_count`, `estimated_event_count`, and `known_amount`. Every classification-coverage object SHALL contain `status`, `event_count`, `classified_event_count`, and `pending_event_count`.

For its applicable event set, classification status SHALL be `empty` when there are no events, `unavailable` when events exist but none is classified, `partial` when some but not all events are classified, and `complete` when every event is classified. Weekly and selected department coverage SHALL use effective analytics department, so a `prepared_from` event is classified as `leftovers`; reason and avoidability classification SHALL be `empty` with no events and `complete` otherwise.

Each `weeks` item SHALL contain `week_start`, `week_end`, `through`, `is_partial`, `events`, `amount`, `status`, `monetary_coverage`, and `department_coverage`. `kpis` SHALL contain `tossed_value: { amount, status }`, `items_binned: { count, per_week }`, `waste_rate`, and `trend`. `trend` SHALL contain `percent`, `current_known_amount`, `prior_known_amount`, `status`, and `reason`. `waste_rate` SHALL contain `percent`, `known_waste_amount`, `qualifying_spend_amount`, `status`, `reason`, and `spend_coverage`; its Spend coverage SHALL contain `status`, `spend_event_count`, `qualifying_event_count`, `excluded_household_event_count`, `pending_department_event_count`, `priced_event_count`, `unpriced_event_count`, `estimated_event_count`, and `known_amount`.

Each of `breakdowns.department`, `breakdowns.reason`, and `breakdowns.avoidability` SHALL contain `count_denominator`, `known_amount_denominator`, `classification_coverage`, `monetary_coverage`, and `items`. Each breakdown item SHALL contain `key`, `label`, `event_count`, `valued_event_count`, `unvalued_event_count`, `estimated_event_count`, `amount`, `count_percentage`, and `amount_percentage`. `most_wasted` SHALL contain literal `cap: 6`, pre-cap `total_count`, and `items`; each item SHALL contain `key`, `name`, nullable `{ key, label }` `department`, `event_count`, `valued_event_count`, `unvalued_event_count`, `estimated_event_count`, `amount`, `amount_percentage`, and `status`. Every returned item group is nonempty, so its production `WasteItemStatus` SHALL be exactly `unavailable | partial | complete`; `empty` SHALL NOT be a returned group status.

Currency fields SHALL be produced from integer-cent sums and exposed rounded to cents. Percentages and `items_binned.per_week` SHALL round to one decimal. Percentages SHALL be NULL when their documented denominator is zero. Canonical labels SHALL split `_` or `-`, lowercase words, capitalize each word, and join with spaces; avoidability labels SHALL be exactly `Avoidable` and `Hard to avoid`. A label SHALL never replace a canonical grouping key. Waste SHALL import the existing pure `toCents`, `fromCents`, `roundPercent`, `compareRawKeys`, and `presentationLabel` declarations exported from `packages/worker/src/spend.ts`; those exports SHALL NOT change their implementations or Spend results and SHALL NOT be replaced by a generic helper layer.

#### Scenario: All transports expose the same complete shape
- **WHEN** the same tenant, range, mapping version, clock, and committed facts are read through the shared operation, dedicated API, MCP, and profile composition
- **THEN** each carries the same fields, nested coverage, ordered items, amounts, mapping metadata, and insight without client-side or transport-specific recomputation

#### Scenario: Department uncertainty does not rewrite monetary status
- **WHEN** every Waste event has an exact last-paid value but at least one non-leftover event has a pending department
- **THEN** top-level and Tossed-value monetary status are complete while department coverage reports the pending event; pending classification alone does not create monetary partial status

#### Scenario: Classification coverage distinguishes none from some pending
- **WHEN** an applicable event set has zero, no classified, some classified, or all classified events
- **THEN** classification status is respectively empty, unavailable, partial, or complete, with prepared-from events counted as classified Leftovers

#### Scenario: Output arithmetic is deterministic
- **WHEN** source decimals or ratios have more precision than their output fields
- **THEN** each source amount is rounded once to cents before sums, currency is cents-rounded, and percentages and items per week are rounded to one decimal

#### Scenario: Zero denominators stay unavailable as percentages
- **WHEN** any breakdown or KPI percentage denominator is zero
- **THEN** the corresponding percentage is NULL unless another requirement explicitly defines an available zero rate against a positive denominator

#### Scenario: Returned most-wasted groups cannot be empty
- **WHEN** a most-wasted item group is returned
- **THEN** it contains at least one event and its status is exactly unavailable, partial, or complete, never empty

### Requirement: Tossed value, weekly buckets, item counts, and trend preserve missingness
For any selected, prior, or weekly event set, monetary status SHALL be `empty` when it has no Waste event; `unavailable` when it has events but no matched last-paid value; `partial` when it has at least one matched value and any event is unmatched or any matched value is estimated; and `complete` when every event is matched and none is estimated. `priced_event_count` SHALL include matched zero values. `unpriced_event_count` SHALL equal events minus priced events.

An empty set SHALL have known amount zero and exposed amount zero. An unavailable set SHALL have known amount zero and exposed amount NULL. Partial and complete sets SHALL expose the known subtotal. `tossed_value` and top-level `status` SHALL follow selected monetary coverage. Every chronological weekly bucket SHALL independently follow the same rule and carry its own monetary and department coverage so geometry is never the only representation.

`items_binned.count` SHALL equal the exact selected persisted Waste row count, not parsed quantity. `items_binned.per_week` SHALL equal count divided by N selected calendar buckets, including empty buckets and the current partial week. Empty history SHALL return count and per-week zero.

Trend SHALL compare selected known Tossed value to the matched prior known value. `empty` and `complete` SHALL be exact; `partial` and `unavailable` SHALL be incomplete. Trend reason precedence SHALL be `current_incomplete`, then `prior_incomplete`, then `prior_zero`. Only exact current and prior inputs with a positive prior amount SHALL return `status: "available"`, `reason: null`, and `(current - prior) / prior * 100`. An exact empty current interval against positive complete prior SHALL return `-100.0`. A zero prior or incomplete side SHALL return NULL percent, `status: "unavailable"`, and the applicable reason, never infinity.

Trend SHALL retain only its documented percent, current/prior known amounts, status, and reason fields; it SHALL NOT add prior-period coverage/count fields. Presentation SHALL use `current_incomplete`, `prior_incomplete`, or `prior_zero` as the truthful evidence for an unavailable trend rather than fabricate unmatched or estimated counts for the prior interval.

#### Scenario: Empty history is exact rather than unavailable
- **WHEN** the selected interval has no Waste event
- **THEN** selected and weekly empty statuses expose amount zero, Tossed value zero, and exact item count and per-week zero

#### Scenario: Fully unvalued history is not shown as zero value
- **WHEN** selected Waste events have no eligible last-paid value
- **THEN** monetary status is unavailable, known amount remains zero, Tossed amount is NULL, and event/unpriced counts remain visible

#### Scenario: Missing and estimated matches make a truthful partial subtotal
- **WHEN** at least one selected event is valued and another is unvalued or any selected match is estimated
- **THEN** status is partial, amount is the known subtotal, and unpriced and estimated counts identify why it is incomplete

#### Scenario: Weekly coverage is independent per bucket
- **WHEN** one selected week is complete, one has only unvalued events, and another is empty
- **THEN** their statuses and amounts are respectively complete/known, unavailable/NULL, and empty/zero regardless of aggregate status

#### Scenario: Items per week uses all calendar buckets
- **WHEN** eight selected event rows occur in an `8w` interval whose current week is partial
- **THEN** Items binned is 8 and items per week is 1.0 without elapsed-day or quantity weighting

#### Scenario: Trend is available against a positive exact prior value
- **WHEN** exact prior Tossed value is $100 and exact current value is $75
- **THEN** trend is available at -25.0 percent

#### Scenario: Empty current can yield negative one hundred percent
- **WHEN** current is exact empty and prior is exact positive
- **THEN** trend is available at -100.0 percent

#### Scenario: Trend reason precedence is deterministic
- **WHEN** current is incomplete and prior is also incomplete or zero
- **THEN** reason is `current_incomplete`; otherwise prior incompleteness precedes `prior_zero`, and no case yields infinity

### Requirement: Waste rate uses exact qualifying captured Spend coverage
Waste-rate qualifying grocery Spend SHALL sum selected, non-voided `spend_events.amount` for rows whose capture-stamped department is non-NULL and not `household`. `beverages` SHALL be included; the Spend cost-per-meal exclusion set `{household, beverages}` SHALL NOT be reused. A classified Household row SHALL be excluded even when its price is missing or estimated. A NULL department SHALL be pending because it may later become Household: its amount and estimated flag SHALL not enter known qualifying Spend, and it SHALL make coverage incomplete. The analyzer SHALL not invoke or replace the existing department fill.

`known_waste_amount` and other Waste-derived dollar values SHALL represent last-paid estimates. `qualifying_spend_amount` SHALL represent recorded/captured grocery Spend summed from `spend_events.amount`; it SHALL NOT be described as a per-toss last-paid estimate.

Spend coverage SHALL count all selected non-voided rows in `spend_event_count`, classified non-Household rows in `qualifying_event_count`, classified Household rows in `excluded_household_event_count`, and NULL departments in `pending_department_event_count`. Priced, unpriced, and estimated counts SHALL describe qualifying rows. Each eligible stored `amount` SHALL be rounded once to cents before summation; zero SHALL be known.

Qualifying Spend status SHALL be `empty` when there are no qualifying or pending rows, including an interval containing only classified Household rows; `unavailable` when no qualifying amount is known and a qualifying-unpriced or pending row could affect the term; `partial` when some qualifying amount is known and any qualifying row is unpriced or estimated or any row is pending; and `complete` when at least one qualifying row exists, every qualifying row is priced and non-estimated, and no row is pending.

Waste rate SHALL be available only when selected Waste monetary status and qualifying Spend status are each exact (`empty` or `complete`) and their combined integer-cent denominator is positive. Its value SHALL be `known_waste / (qualifying_spend + known_waste) * 100`. Reason precedence SHALL be `waste_incomplete`, then `spend_incomplete`, then `zero_denominator`. Exact empty Waste with positive complete Spend SHALL yield `0.0`; positive complete Waste with exact-empty Spend SHALL yield `100.0`. An incomplete input or zero denominator SHALL yield NULL percent and the applicable reason.

#### Scenario: Household is excluded and Beverages is included
- **WHEN** selected exact Spend is $20 produce, $8 beverages, and $12 household and selected exact Waste is $7
- **THEN** qualifying Spend is $28, Household is excluded, Beverages is included, and the rate denominator is $35

#### Scenario: Household-only Spend is exact empty qualifying Spend
- **WHEN** the interval contains only classified Household Spend rows
- **THEN** qualifying Spend status is empty with known amount zero regardless of those rows' missing or estimated prices

#### Scenario: Pending department blocks an exact rate
- **WHEN** any selected Spend row has a NULL department and could later qualify or be excluded
- **THEN** qualifying Spend is unavailable or partial according to known qualifying amount and Waste rate is unavailable with `spend_incomplete` unless Waste incompleteness takes precedence

#### Scenario: Exact empty Waste against positive Spend is zero percent
- **WHEN** Waste is empty and qualifying Spend is complete and positive
- **THEN** Waste rate is available at 0.0 percent

#### Scenario: Positive Waste against exact empty Spend is one hundred percent
- **WHEN** Waste is complete and positive and qualifying Spend is exact empty
- **THEN** Waste rate is available at 100.0 percent

#### Scenario: Missing input and zero denominator return reasons
- **WHEN** Waste is incomplete, Spend is incomplete, or both exact amounts sum to zero
- **THEN** percent is NULL and reason follows `waste_incomplete`, `spend_incomplete`, then `zero_denominator` precedence

### Requirement: Waste breakdowns use effective Leftovers and explicit denominators
For Waste analytics, effective department SHALL be `leftovers` whenever `prepared_from` is non-NULL; otherwise it SHALL be the event's capture-stamped `department`. This read-time rule SHALL not mutate the D17 stamp. A non-leftover NULL department SHALL remain pending, SHALL be absent from department items, and SHALL never become a synthetic `Not mapped` group.

Every breakdown SHALL return groups with at least one event, including unvalued-only groups whose `amount` is NULL. Items SHALL sort by internal known amount descending, event count descending, and canonical key ascending. Item event count SHALL include matched and unmatched rows. Valued, unvalued, and estimated counts and the returned coverage SHALL make incomplete monetary input explicit.

Department `count_denominator` SHALL equal events with an effective department, and its `known_amount_denominator` SHALL equal known value attached to those classified events. Its monetary coverage SHALL be computed over classified events; its classification coverage SHALL report selected classified and pending events. Reason and avoidability count denominators SHALL equal every selected Waste event, their known-amount denominators SHALL equal every selected known Waste value, their monetary coverage SHALL equal selected Waste monetary coverage, and their classification coverage SHALL be `empty` or `complete`. Reason SHALL use the canonical captured reason; avoidability SHALL use the selected mapping and only return present `avoidable` and `hard_to_avoid` groups. Each item percentage SHALL use its matching count or known-money denominator and SHALL be NULL when that denominator is zero.

#### Scenario: Prepared-from always appears as Leftovers
- **WHEN** an event has non-NULL `prepared_from` and any captured department, including NULL or a conflicting food value
- **THEN** its effective department key is `leftovers`, it is classified for the department denominator, and no stored row is rewritten

#### Scenario: Pending non-leftovers remain visible only in coverage
- **WHEN** a non-leftover event has NULL captured department
- **THEN** it is absent from department items and denominators, increments pending classification coverage, and no `Not mapped` item is created

#### Scenario: Department uses classified denominators
- **WHEN** selected events include classified and pending departments with both valued and unvalued rows
- **THEN** count percentages use classified-event count, amount percentages use known value on classified events, and coverage exposes every omitted pending or unvalued fact

#### Scenario: Reason and avoidability use all-event denominators
- **WHEN** selected events span several reasons, mapping classes, and missing values
- **THEN** count percentages use every event, money percentages use every known Waste value, and each event belongs to its canonical reason and exactly one selected-version avoidability class

#### Scenario: Unvalued-only groups remain observable
- **WHEN** a department, reason, or avoidability group has events but no resolved value
- **THEN** the group remains in `items` with its exact event count, NULL amount, and truthful monetary coverage

#### Scenario: Breakdown ties are stable
- **WHEN** groups tie on known amount and event count
- **THEN** they sort by canonical key ascending and labels do not affect order or identity

### Requirement: Most-wasted items preserve sparse groups and stable representatives
Most-wasted items SHALL group selected Waste events by canonical `item_id`. Every persisted event SHALL contribute to `event_count`; only matched last-paid values SHALL contribute to known amount. A group with no matched value SHALL expose NULL amount; a known zero SHALL remain a valued group. Group monetary status SHALL use the normal empty/unavailable/partial/complete rule, and `amount_percentage` SHALL use total selected known Waste value or be NULL when that denominator is zero.

Valued groups SHALL sort before unvalued-only groups. Valued groups SHALL then sort by known amount descending, event count descending, and `item_id` ascending. Unvalued-only groups SHALL sort by event count descending and then `item_id` ascending. `total_count` SHALL be the group count before capping and `items` SHALL contain at most six.

The representative event SHALL be the event with latest `occurred_at`, breaking a same-date tie by lexicographically greatest event `id`. Its captured `name` SHALL be the display name and its effective department SHALL be the optional department badge; a pending representative SHALL expose NULL department. Representative fields SHALL not affect grouping or sort. Weekly buckets SHALL remain chronological, and source/reducer ordering SHALL use the explicit date, id, send id, line key, amount, count, and canonical-key tie-breakers rather than incidental D1 row order.

#### Scenario: Valued groups precede unvalued groups
- **WHEN** selected history contains valued, known-zero, and unvalued-only item groups
- **THEN** valued and known-zero groups precede unvalued-only groups and every group retains its exact event and value-coverage counts

#### Scenario: Valued item ties are deterministic
- **WHEN** valued groups tie on amount and event count
- **THEN** they sort by canonical `item_id` ascending

#### Scenario: Unvalued item ties are deterministic
- **WHEN** unvalued-only groups tie on event count
- **THEN** they sort by canonical `item_id` ascending without fabricating zero value

#### Scenario: Representative fields come from the latest stable event
- **WHEN** a group has multiple names or departments including two events on its latest date
- **THEN** the lexicographically greatest id on that date supplies display name and effective department without changing group rank

#### Scenario: Cap and total count are distinct
- **WHEN** more than six item groups exist
- **THEN** `total_count` reports all groups and ordered `items` contains exactly the first six

### Requirement: Waste insight selection uses exact deterministic templates
The analyzer SHALL author one `insight` string with this fixed precedence and no LLM, randomness, hash rotation, item-name heuristic, or data threshold: empty, monetary unavailable, monetary partial, then monetary complete.

For empty data the string SHALL be exactly `No recorded waste in this range.` For unavailable money it SHALL be exactly `Waste value is unavailable because none of the recorded tosses in this range has a matching last-paid price.` For partial money it SHALL be `Known waste value is incomplete: {clauses}.` Clauses SHALL appear in this fixed order when their count is positive: `{n} tossed item had no matching last-paid price` or `{n} tossed items had no matching last-paid price`; then `{n} tossed item used an estimated last-paid price` or `{n} tossed items used an estimated last-paid price`. Two clauses SHALL be joined by ` and `.

For complete monetary data, the analyzer SHALL use the already-sorted first Reason item. It SHALL use the already-sorted first Department item only when selected Department classification is complete, beginning `{Department label} accounted for the most waste at {currency}; {Reason label} was the leading reason by known waste value with {n} tossed item(s)`. If any selected effective department is pending, it SHALL instead begin `{Reason label} was the leading waste reason by known value with {n} tossed item(s)`. Reason covers all selected events, so the analyzer SHALL NOT call a leader from an incomplete classified Department subset the household leader. When known total is positive, it SHALL append `; avoidable waste represented {p.toFixed(1)}% of known waste value`. It SHALL end with one period. Singular SHALL be `1 tossed item`; every other count SHALL use `items`. Currency SHALL be `$` plus cents with exactly two decimals. If no Avoidable group is present with a positive denominator, `p` SHALL be `0.0`.

#### Scenario: Empty data uses the exact empty template
- **WHEN** selected monetary status is empty
- **THEN** insight is exactly `No recorded waste in this range.`

#### Scenario: Unavailable data uses the exact unavailable template
- **WHEN** selected monetary status is unavailable
- **THEN** insight is exactly `Waste value is unavailable because none of the recorded tosses in this range has a matching last-paid price.`

#### Scenario: Partial clauses have fixed order and grammar
- **WHEN** selected partial data has one unvalued event and two estimated matched events
- **THEN** insight is exactly `Known waste value is incomplete: 1 tossed item had no matching last-paid price and 2 tossed items used an estimated last-paid price.`

#### Scenario: Complete insight uses the sorted amount leaders
- **WHEN** complete monetary data and complete Department classification have tied leading Department or Reason groups
- **THEN** the amount-descending, event-count-descending, canonical-key-ascending winners supply the labels, value, and reason count

#### Scenario: Any pending department uses the all-event reason opening
- **WHEN** monetary coverage is complete but one or more selected effective departments are pending, including a mix of classified and pending events
- **THEN** the complete insight begins with the leading Reason over all selected events and does not claim the leading classified Department subset is the household leader

#### Scenario: Complete department coverage permits the department opening
- **WHEN** monetary coverage and selected Department classification are both complete
- **THEN** the complete insight uses the stable leading Department and Reason wording

#### Scenario: Avoidable share appears only with positive known value
- **WHEN** complete known total is positive
- **THEN** insight appends the one-decimal Avoidable value share, using 0.0 when the class is absent; with a zero known denominator it appends no percentage

### Requirement: Waste analysis is a bounded read-time projection of existing facts
The analyzer SHALL perform exactly the needed tenant-scoped reads through `db(env)`: one `waste_events` scan from prior start through `as_of` using `idx_waste_events_when`, with an indexed correlated last-paid seek through `idx_spend_events_item (tenant, line_key, occurred_on)`, and one selected-window non-voided `spend_events` read for Waste rate through `idx_spend_events_tenant (tenant, occurred_on)`. The Waste rows SHALL order by `occurred_at` ascending then `id` ascending; the Spend-rate rows SHALL order by `occurred_on` ascending, `send_id` ascending, then `line_key` ascending. Reduction and mapping SHALL occur in plain code. The operation SHALL perform no insert, update, delete, mutation helper, cache fill, external request, model call, queue action, cron invocation, or scheduled work.

The analyzer SHALL add no materialized aggregate, Waste value or avoidability column, analyzer table, migration, index, binding, dependency, queue, scheduled job, or `scheduled()` wiring. Existing schema columns and indexes SHALL support fresh databases and databases migrated before this analyzer. The existing ingredient-category job may fill pending capture stamps independently; the analyzer SHALL neither invoke nor replace it.

Late or backdated Waste and Spend facts SHALL appear on the next read when their authoritative dates or eligible last-paid order place them in the result. Existing `(tenant, id)` Waste idempotency SHALL make a replayed event id contribute once; the analyzer SHALL add no duplicate identity. A later Spend void SHALL make the next eligible older priced row win or make value unavailable. Waste capture has no production correction path, so the analyzer SHALL invent no edit, delete, compensation, or reconciliation state for a Waste event.

Each read SHALL observe normally committed facts before or after concurrent writers without promising a cross-table snapshot. A refresh SHALL converge on all newly committed facts. Repeated reads with unchanged tenant, facts, UTC day, range, and mapping version SHALL return the same ordered object. The analyzer SHALL introduce no lock, ownership token, compare-and-swap layer, cart recovery, re-key convergence, settlement or compensation state machine, operation registry, concurrency oracle, satellite receipt atomicity, generic error framework, writer coordination, speculative guard, fallback, or synthetic state.

#### Scenario: A late fact appears on refresh
- **WHEN** a backdated Waste event or eligible Spend price commits after an earlier read
- **THEN** the next read reflects its authoritative bucket or last-paid position without backfill, history mutation, or scheduled aggregation

#### Scenario: Existing idempotency suppresses a duplicate replay
- **WHEN** the same Waste event id is captured again through the existing production entry
- **THEN** one stored row contributes once and the analyzer creates no duplicate registry or heuristic

#### Scenario: Spend correction converges through the existing void fact
- **WHEN** the last-paid row used by an earlier response is later voided
- **THEN** refresh selects the next eligible older priced row or reports the Waste value unresolved without mutating Waste history

#### Scenario: Concurrent commits require only refresh
- **WHEN** Waste capture and Spend void or capture commit around the two analyzer reads
- **THEN** each query reflects committed facts visible to it, no cross-table snapshot is promised, no coordination state is written, and refresh converges

#### Scenario: Previously migrated nullable rows remain valid
- **WHEN** analysis runs against existing rows with NULL department or missing price under the current migrated schema
- **THEN** the documented coverage and effective-department rules apply without a migration, backfill, fallback, or schema-version branch

#### Scenario: Repeated reads are deterministic and read-only
- **WHEN** the same authenticated request repeats with unchanged facts, UTC day, range, and mapping version
- **THEN** it returns the same ordered object and leaves database, cache, queue, writer, and scheduled state unchanged

### Requirement: Waste contracts, documentation, and tests use production entry points
The shared operation, exported `waste-shapes` production wire contract, avoidability registry, MCP input/result, profile composition, member API, member UI, `docs/TOOLS.md`, `docs/SCHEMAS.md`, `docs/ARCHITECTURE.md`, `packages/worker/AGENT_INSTRUCTIONS.md`, and living OpenSpec specifications SHALL state the same ranges, UTC bounds, last-paid rules, `waste_mapping_version` MCP input, `mapping_version` HTTP input, mapping metadata, fields, coverage, denominators, ordering, insight strings, authorization, compatibility, and read-only behavior. TOOLS SHALL own exact inputs, returns, and no-write guarantee; SCHEMAS SHALL document that value/effective department/avoidability are read-time derivations and no value column exists; ARCHITECTURE SHALL describe the bounded analyzer and explicitly state that it adds no analyzer cron; persona guidance SHALL act only on returned facts. The only shared-helper change SHALL be export modifiers on the eight existing pure declarations in `packages/worker/src/spend.ts`, and the only manifest/configuration change SHALL be the `packages/worker/package.json` production subpath export. Generated-plugin validation SHALL remain clean and no generated file SHALL change.

Focused tests SHALL invoke the production `readWasteAnalyzer` against the full migration-backed SQLite schema, the registered production MCP `retrospective` tool, and the composed session-gated member API. They SHALL cover tenant isolation; Monday/Sunday and all range/prior boundaries; future exclusion; coverage and zero-price cases; rounding; last-paid date/send ties, same-day, future, NULL, estimated, void fallback, and quantity-ignore behavior; prepared-from Leftovers; all five/five v1 reasons, named replay, and unknown validation; Waste-rate exclusions, coverage, and reason precedence; trend; every denominator; item representative/sort/cap/status ties; exact insights including some-pending Department fallback; and late, duplicate, corrected, concurrent-refresh, and repeated-read behavior. Tests SHALL exercise reused Spend helpers through the production Waste reader and keep existing Spend reader tests green; they SHALL NOT add a duplicate helper oracle. Tests SHALL use real migrated tables and production readers rather than a parallel synthetic analyzer model. Because no migration is added, fresh-schema and previously migrated fixtures SHALL exercise the same code and existing columns.

#### Scenario: Reader tests enter through migrated production storage
- **WHEN** focused tests exercise value, mapping, ranges, coverage, KPIs, breakdowns, ties, insights, late facts, duplicates, void corrections, and refresh
- **THEN** they call the production analyzer over migration-backed SQLite facts rather than primarily validating a test-only reducer

#### Scenario: MCP tests use exact public names and shared output
- **WHEN** tests verify omitted and explicit Waste tool inputs
- **THEN** they invoke registered `retrospective` with `waste_range` and `waste_mapping_version` and compare `.waste` with the shared aggregate without finding a Waste writer

#### Scenario: API and UI use the HTTP mapping name
- **WHEN** the dedicated member surface requests mapping replay
- **THEN** it uses `mapping_version`, receives the direct shared object, and does not expose `waste_mapping_version` as an HTTP parameter

#### Scenario: Schema compatibility uses one production reader
- **WHEN** fresh migrated storage and fixtures representing older nullable rows are tested
- **THEN** both use the same current schema and analyzer with no analyzer migration, alternate model, or fabricated compatibility state

#### Scenario: Contract artifacts stay aligned
- **WHEN** Waste ships
- **THEN** tool, schema, architecture, persona, API, UI, living specs, and plugin validation agree on the additive read-only contract
