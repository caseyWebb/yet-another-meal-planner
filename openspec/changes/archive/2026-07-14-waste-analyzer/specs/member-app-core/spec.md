## MODIFIED Requirements

### Requirement: Retrospective page shell with tabs
The "Cooking log" nav destination SHALL remain the **Retrospective** page at `/retrospective` ("Look back at what you cooked — and what it cost."), with three tabs — **Cooking log** (default), **Spend analyzer**, and **Waste analyzer** — whose selected tab is held in the `?tab` URL search parameter. The Cooking log SHALL retain its composer and log list. The Spend and Waste tabs SHALL each render their production analyzer. The legacy `/log` route SHALL redirect to `/retrospective`.

The Spend and Waste panels SHALL share one `?range` URL search parameter accepting exactly `4w`, `8w`, or `12w`. Entering either analyzer with a missing or invalid range SHALL canonicalize it to `8w` with replace navigation before that analyzer request. Selecting a range SHALL write the selected valid value to the URL and both analyzers SHALL use it when active. Cooking log SHALL ignore but retain a valid range so returning to either analyzer preserves it. The Spend query key SHALL include range and run only while Spend is active; the Waste query key SHALL include range and run only while Waste is active. Neither aggregate SHALL be persisted for offline use.

The tab list SHALL use stable tab and panel ids, with each tab's `aria-controls` pointing to its panel and each panel's `aria-labelledby` pointing back. The selected tab SHALL have `aria-selected="true"` and `tabIndex=0`; unselected tabs SHALL have `aria-selected="false"` and `tabIndex=-1`. `ArrowLeft` and `ArrowRight` SHALL wrap through tabs and activate and focus the destination; `Home` and `End` SHALL activate and focus the first and last tab. The shared range selector SHALL be a named `role="group"` of buttons whose selected state is exposed with `aria-pressed`.

Loading SHALL use a status region. A failed analyzer request SHALL render the structured API message and a keyboard-operable retry for the same tab and range. Empty, unavailable, partial, and complete presentations SHALL branch on response status and coverage rather than infer state from a zero subtotal. In Spend, awaiting placement SHALL render as a separate notice; a null weekly budget SHALL omit the budget line; and a positive budget SHALL render with each week's documented tri-state comparison. Weekly bars SHALL be semantic chronological lists with visible week, known amount or unavailable value, and coverage text; bar geometry SHALL be decorative and hidden from assistive technology. KPIs and breakdowns SHALL retain textual labels and values.

Both panels SHALL use existing components and shared styles. On narrow and tall layouts, controls and cards SHALL remain readable and each labelled weekly chart SHALL use horizontal overflow without clipping information. No canvas, chart dependency, offline cache, speculative fallback, client-side aggregate model, or unrelated page redesign SHALL be introduced.

#### Scenario: The retrospective shell defaults to the cooking log
- **WHEN** a member opens `/retrospective` with no `?tab`
- **THEN** the Cooking log tab is selected and its composer and log list render

#### Scenario: Spend canonicalizes a missing range to eight weeks
- **WHEN** a member enters the Spend analyzer with no `?range`
- **THEN** the URL is replace-canonicalized to `range=8w`, the Spend query uses `8w`, and eight chronological weekly rows render from the production response

#### Scenario: Spend canonicalizes an invalid range
- **WHEN** a member enters the Spend analyzer with any range other than `4w`, `8w`, or `12w`
- **THEN** replace navigation writes `range=8w` before the Spend request rather than sending the invalid value

#### Scenario: Waste canonicalizes a missing range to eight weeks
- **WHEN** a member enters the Waste analyzer with no `?range`
- **THEN** the URL is replace-canonicalized to `range=8w`, the Waste query uses `8w`, and eight chronological weekly rows render from the production response

#### Scenario: Waste canonicalizes an invalid range
- **WHEN** a member enters the Waste analyzer with any range other than `4w`, `8w`, or `12w`
- **THEN** replace navigation writes `range=8w` before the Waste request rather than sending the invalid value

#### Scenario: Range selection is shared and URL-persisted
- **WHEN** a member selects 4 weeks or 12 weeks in the named range group
- **THEN** the pressed button and `?range` value update, the active analyzer query key and response use that range, and the other analyzer uses the same range when selected

#### Scenario: Cooking log retains a valid analyzer range without querying either analyzer
- **WHEN** a member selects a valid analyzer range, switches to Cooking log, and later returns
- **THEN** Cooking log retains the URL range, neither analyzer query runs while Cooking log is active, and the preserved range is used on return

#### Scenario: Switching tabs is reflected in the URL
- **WHEN** a member selects the Spend analyzer or Waste analyzer tab
- **THEN** the `?tab` search parameter and selected tab semantics update and the selected production panel renders

#### Scenario: Tab keyboard navigation activates and focuses predictably
- **WHEN** focus is in the tab list and the member presses ArrowLeft, ArrowRight, Home, or End
- **THEN** focus and selection move together using the documented wrapping order and tab/panel relationships remain valid

#### Scenario: Range controls expose their selected state
- **WHEN** either analyzer panel renders or range changes
- **THEN** the shared named group contains three buttons and exactly the active range exposes `aria-pressed="true"`

#### Scenario: Spend loading and retry remain operable
- **WHEN** the Spend query is pending and then returns a structured error
- **THEN** a status region announces loading, the error view presents the server message, and a keyboard member can retry the same range

#### Scenario: Empty and unavailable Spend are not shown as ordinary zero spend
- **WHEN** the shared Spend result status is `empty` or `unavailable`
- **THEN** the Spend panel renders the corresponding distinct truthful state and coverage counts rather than presenting a complete zero-like KPI set

#### Scenario: Partial Spend labels every known subtotal honestly
- **WHEN** monetary or department coverage makes the shared Spend result partial
- **THEN** the Spend panel labels displayed amounts as known/incomplete and shows the response's unpriced, estimated, or pending-classification evidence without inventing a remainder

#### Scenario: Budget absence and presence remain distinct
- **WHEN** Spend `weekly_budget` is null
- **THEN** no budget line or under-budget claim renders; when it is positive, the budget line and true, false, or unknown weekly comparison follow the response exactly

#### Scenario: Awaiting placement remains separate from recorded Spend
- **WHEN** Spend `awaiting_mark_placed` is positive
- **THEN** a separate notice reports the count without adding those rows to weekly bars, KPIs, or insight

#### Scenario: Spend weekly bars retain their text equivalent
- **WHEN** the Spend chart renders
- **THEN** assistive technology encounters a chronological list containing each week's label, known amount, and coverage while decorative geometry is hidden

#### Scenario: Narrow and tall layouts preserve analyzer information
- **WHEN** either analyzer panel renders at the member harness's narrow or tall viewport
- **THEN** controls and cards remain readable and the labelled weekly region scrolls horizontally rather than clipping weeks or textual values

#### Scenario: Spend and Waste remain distinct read models
- **WHEN** the member switches between Spend and Waste with one shared range
- **THEN** only the active analyzer is queried, each panel renders only its own shared aggregate, and no Spend amount or rule is relabeled as Waste data or vice versa

#### Scenario: The legacy log route redirects
- **WHEN** a member navigates to `/log`
- **THEN** they land on `/retrospective`

## ADDED Requirements

### Requirement: The member Waste endpoint is a session-gated adapter over the shared analyzer
The member API SHALL expose `GET /api/retrospective/waste?range=4w|8w|12w&mapping_version=<name>` under the existing Worker-first `/api/*` dispatch. Existing session middleware SHALL resolve tenant identity; the route SHALL accept no tenant parameter, call the shared `readWasteAnalyzer` operation, perform no direct D1 read or write, and return the shared `WasteAnalyzer` object directly through the existing `jsonWithEtag` private/no-cache helper. A matching `If-None-Match` SHALL yield the existing 304 behavior.

A missing `range` SHALL default to `8w`. Any other range SHALL produce HTTP 400 with `{ "error": "validation_failed", "message": "range must be 4w | 8w | 12w" }` through the existing structured-error middleware. A missing `mapping_version` SHALL select the declared current avoidability mapping. An explicit supported name SHALL replay that immutable mapping. An unsupported value SHALL produce HTTP 400 with `validation_failed` and exact message `unsupported waste avoidability mapping version; supported versions: waste-avoidability-v1`; it SHALL never silently select current. The HTTP query name SHALL be exactly `mapping_version`; `waste_mapping_version` SHALL remain the distinct MCP input name.

The dedicated body, MCP retrospective `.waste`, and profile retrospective `.waste` SHALL conform to the same additive aggregate contract; only their documented default ranges and exposed selectors SHALL differ. The dedicated API and UI SHALL default to `8w`/current; MCP and profile composition SHALL default to `4w`/current, and profile SHALL expose no new selector. The GET SHALL be deterministic and read-only and SHALL create no Waste writer.

#### Scenario: An authenticated request returns the direct shared object
- **WHEN** a signed-in member requests `/api/retrospective/waste?range=12w&mapping_version=waste-avoidability-v1`
- **THEN** the route resolves that session's tenant and returns the direct shared twelve-week v1 `WasteAnalyzer` with private ETag behavior

#### Scenario: Missing API inputs use the UI defaults
- **WHEN** a signed-in member requests `/api/retrospective/waste` without query inputs
- **THEN** the endpoint returns the shared object with `range: "8w"` and the declared current avoidability mapping

#### Scenario: Invalid API range returns the exact structured error
- **WHEN** a signed-in member requests a range outside `4w`, `8w`, or `12w`
- **THEN** the response is HTTP 400 with error `validation_failed` and message `range must be 4w | 8w | 12w`

#### Scenario: Unknown mapping returns the exact structured error
- **WHEN** a signed-in member requests an unsupported `mapping_version`
- **THEN** the response is HTTP 400 with error `validation_failed` and message `unsupported waste avoidability mapping version; supported versions: waste-avoidability-v1`

#### Scenario: ETag revalidation returns not modified
- **WHEN** an authenticated caller repeats an unchanged Waste GET with its matching ETag in `If-None-Match`
- **THEN** the existing helper returns 304 with no aggregate body and no side effect

#### Scenario: An unauthenticated request cannot read Waste
- **WHEN** a caller without a valid member session requests the Waste endpoint
- **THEN** existing session middleware rejects the request before analysis and no household data is returned

#### Scenario: Tenant identity cannot be overridden publicly
- **WHEN** a signed-in caller adds an arbitrary tenant-like query or header value while another tenant has matching facts
- **THEN** the route uses only the session-resolved tenant and returns no other household's Waste or Spend history

#### Scenario: API and MCP selector names remain exact
- **WHEN** callers request explicit mapping replay on the member and MCP transports
- **THEN** HTTP accepts `mapping_version`, MCP accepts `waste_mapping_version`, and both feed the same resolver and return the same selected-version object

#### Scenario: The API read has no writer or side effect
- **WHEN** an authenticated Waste GET repeats with unchanged committed facts
- **THEN** it returns the same ordered object and performs no event write, correction, cache persistence, classification fill, or scheduled work

### Requirement: The Retrospective Waste panel presents truthful server-authored analysis accessibly
The Waste panel SHALL request `GET /api/retrospective/waste` with the shared active range, omit `mapping_version` so the UI uses the current mapping, use TanStack query key `['retrospective', 'waste', range]`, and run only while Waste is selected. It SHALL render the server-authored aggregate without recalculating values, classification, KPIs, percentages, ordering, or insight in React, and SHALL remain outside the offline persistence allowlist.

While pending, the panel SHALL expose an accessible status reading `Loading waste analysis…`. A failed request SHALL expose a structured `role="alert"` containing the server message and a keyboard-operable Retry that refetches the same range. `status=empty` SHALL render a distinct empty state that retains the range control and exact zero Items-binned count without misleading dollar breakdowns. Unavailable money SHALL be labelled `Last-paid value unavailable` while exact item counts and classified count breakdowns remain visible. Monetary partial status caused by an unmatched event or estimated match SHALL be labelled `Known last-paid estimate`; unmatched and estimated counts SHALL appear beside selected/Tossed value and every weekly row, breakdown, or group whose returned coverage/counts supply that evidence. Complete money SHALL be labelled `Last-paid estimate`, never a receipt total or measured tossed-quantity value. Pending Waste department classification alone SHALL NOT relabel complete money as partial: it SHALL retain `Last-paid estimate` while Department coverage is presented separately. A separately pending selected Spend department may independently make the returned Waste rate incomplete.

KPI text SHALL expose Tossed value, exact Items binned and items per week, Waste rate with its returned unavailable reason when NULL, and matched Waste trend. An unavailable trend SHALL show its returned `current_incomplete`, `prior_incomplete`, or `prior_zero` reason and current/prior known amounts; because the contract does not return prior coverage counts, React SHALL NOT invent unmatched or estimated evidence for the prior interval. Weekly bars SHALL be a labelled semantic chronological list whose visible text includes week, event count, known amount or unavailable label, and coverage; decorative bar geometry SHALL be hidden from assistive technology. Department, reason, and avoidability rows SHALL expose labels, event counts, known amounts, count and amount percentages, and denominator/coverage text. Most-wasted rows SHALL expose display name, `tossed N×`, optional effective department, and known or unavailable value. The exact server `insight` SHALL render as text.

An available Waste rate at `10.0%` or above SHALL use the reviewed red treatment and SHALL retain a textual percentage so color is not the only signal. A NULL or otherwise unavailable rate SHALL never receive threshold styling. The panel SHALL label Waste-derived dollar figures as spend-history last-paid estimates and SHALL never imply member-entered value, SKU/flyer fallback, receipt reconciliation, or quantity multiplication. If it displays the qualifying Spend denominator, it SHALL label that value as recorded/captured grocery spend, not as a per-toss last-paid estimate.

The shared tabs and range controls SHALL retain the tab/panel, keyboard, named-group, and `aria-pressed` semantics in the modified shell requirement. Desktop SHALL follow the reviewed Retrospective composition. Narrow layouts SHALL stack KPI, breakdown, and item cards in reading order and let controls wrap without overlap. Tall layouts SHALL keep controls and KPIs compact at the top while preserving every row. The weekly visual SHALL sit in a labelled horizontal-overflow region at narrow widths with no clipped textual data. The implementation SHALL use existing components and CSS only: no canvas, chart package, hover-only content, offline aggregate fallback, or client-side analyzer model.

#### Scenario: Waste query runs only for the active shared range
- **WHEN** the member selects Waste with `range=12w`, switches away, and later returns
- **THEN** the query key is `['retrospective', 'waste', '12w']`, no Waste request runs while inactive, and return uses the retained shared range

#### Scenario: Loading and retry are announced and operable
- **WHEN** the Waste request is pending and then returns a structured error
- **THEN** `Loading waste analysis…` is announced as status, the server message appears in an alert, and keyboard activation of Retry refetches the same range

#### Scenario: Empty Waste does not render misleading dollar analysis
- **WHEN** the shared result has `status: "empty"`
- **THEN** the panel retains range selection, shows exact zero Items binned, and renders the distinct empty state without ordinary dollar breakdowns

#### Scenario: Unavailable value preserves exact non-monetary facts
- **WHEN** events exist but monetary status is unavailable
- **THEN** the panel reads `Last-paid value unavailable` and still shows exact event counts and returned reason, avoidability, and classified-department counts without displaying `$0` as value

#### Scenario: Partial value exposes every returned source of incompleteness
- **WHEN** the shared result has unmatched events or estimated matches
- **THEN** known money is labelled `Known last-paid estimate` and returned unmatched/estimated evidence remains visible beside selected/Tossed value and affected weeks, breakdowns, and item groups

#### Scenario: Pending department is separate from complete Waste money
- **WHEN** every Waste event has a non-estimated eligible last-paid match but at least one effective department is pending
- **THEN** Waste money remains labelled `Last-paid estimate` while pending Department coverage and any independently incomplete Waste rate are displayed separately

#### Scenario: Complete value remains an estimate
- **WHEN** every event has a non-estimated eligible last-paid match
- **THEN** dollar output is labelled `Last-paid estimate`, not receipt total or exact tossed-quantity value

#### Scenario: Qualifying Spend keeps its recorded-spend meaning
- **WHEN** the panel displays Waste-derived money and the qualifying Spend denominator together
- **THEN** Waste money is labelled as a last-paid estimate and qualifying Spend is labelled as recorded/captured grocery spend, not a per-toss estimate

#### Scenario: KPI and charts have textual equivalents
- **WHEN** Waste KPIs, weekly bars, breakdowns, and most-wasted items render
- **THEN** their labels, dates, counts, amounts or unavailable states, percentages, denominators, coverage, and insight are available as text while decorative geometry is hidden

#### Scenario: Prior-incomplete trend uses returned evidence only
- **WHEN** trend has `status: "unavailable"` and `reason: "prior_incomplete"`
- **THEN** the panel displays the prior-incomplete reason and returned current/prior known amounts without inventing prior unmatched or estimated counts

#### Scenario: Waste-rate threshold is available-only and not color-only
- **WHEN** rate is available at 10.0 percent or above
- **THEN** the reviewed red treatment and textual percentage render; when rate is NULL, threshold styling does not render and the returned unavailable reason does

#### Scenario: Shared controls meet keyboard semantics
- **WHEN** a keyboard member navigates tabs and changes the Waste range
- **THEN** tab focus/selection wraps and activates as documented, stable tab/panel relationships remain reciprocal, and exactly one range button exposes `aria-pressed="true"`

#### Scenario: Narrow and tall Waste layouts retain every fact
- **WHEN** the panel renders at reviewed narrow or tall viewport sizes
- **THEN** cards stack in reading order, controls do not overlap, every row remains reachable, and the labelled weekly region scrolls horizontally without clipping its text

#### Scenario: React does not become a parallel analyzer
- **WHEN** the Waste panel receives a valid production response
- **THEN** it presents the returned values, reasons, ordering, and insight without deriving alternative value, coverage, avoidability, rate, trend, or tie-breaking behavior

### Requirement: The Retrospective Waste panel is verified through real production entry points
The member-app Playwright page object and specs SHALL cover the Waste panel in the same change. The primary populated Waste case SHALL sign in through the seeded member harness and reach the production analyzer through the composed session-gated API, not a browser-only aggregate. It SHALL verify `8w` URL canonicalization, shared range changes, tab and range keyboard behavior, KPI/weekly/breakdown/most-wasted/insight text, qualified Waste-versus-recorded-Spend labels, available-only Waste-rate styling, and reviewed desktop plus narrow and tall screenshots.

Narrow route interception SHALL be allowed only to hold an otherwise unreachable presentation timing or branch such as sustained loading, forced structured error/retry, one valid unavailable/partial response, pending-department monetary-label orthogonality, or an unavailable trend with `prior_incomplete`. Any intercepted aggregate SHALL use the exported production response type and SHALL not add prior coverage fields, replace the seeded production proof, or duplicate server calculations. API tests SHALL use the composed production app to verify session rejection, tenant non-overridability, `8w`/current defaults, explicit range and `mapping_version`, exact validation errors, ETag 304, direct shared shape, and read-only behavior.

#### Scenario: Primary browser coverage uses seeded production data
- **WHEN** the primary Waste Playwright case signs in and opens Waste
- **THEN** its aggregate comes through the real member API and production reader over seeded facts and the case verifies default range, shared URL changes, semantics, textual analysis, rate styling, and responsive screenshots

#### Scenario: Presentation-only interception cannot replace production proof
- **WHEN** loading, structured-error, unavailable, partial, pending-department, or prior-incomplete-trend timing cannot be held reliably with seeded production data
- **THEN** a narrowly scoped typed interception may hold that presentation branch while primary aggregate assertions continue to use the real endpoint

#### Scenario: API tests exercise the composed authenticated route
- **WHEN** route tests verify defaults, explicit replay, validation, ETag, authorization, tenant isolation, and repeat reads
- **THEN** they call the composed production member app and shared analyzer rather than a parallel route or test-only reducer

#### Scenario: Browser and API tests do not encode an alternate model
- **WHEN** the member UI and route tests are reviewed
- **THEN** they assert production outputs and presentation states without duplicating valuation, mapping, coverage, KPI, denominator, ordering, or insight algorithms
