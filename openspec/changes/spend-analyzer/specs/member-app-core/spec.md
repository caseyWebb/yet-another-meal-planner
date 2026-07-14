## MODIFIED Requirements

### Requirement: Retrospective page shell with tabs
The "Cooking log" nav destination SHALL remain the **Retrospective** page at `/retrospective` ("Look back at what you cooked — and what it cost."), with three tabs — **Cooking log** (default), **Spend analyzer**, and **Waste analyzer** — whose selected tab is held in the `?tab` URL search parameter. The Cooking log SHALL retain its composer and log list. The Spend tab SHALL render the production Spend analyzer; the Waste tab SHALL remain the existing placeholder until its separate analyzer ships. The legacy `/log` route SHALL redirect to `/retrospective`.

The Spend panel's range SHALL be held in the `?range` URL search parameter and SHALL accept exactly `4w`, `8w`, or `12w`. Entering Spend with a missing or invalid range SHALL canonicalize it to `8w` with replace navigation. Selecting a range SHALL write the selected valid value to the URL. Other tabs SHALL ignore but retain a valid range so returning to Spend preserves it. The Spend query key SHALL include range and SHALL run only while Spend is active. The aggregate SHALL NOT be persisted for offline use.

The tab list SHALL use stable tab and panel ids, with each tab's `aria-controls` pointing to its panel and each panel's `aria-labelledby` pointing back. The selected tab SHALL have `aria-selected="true"` and `tabIndex=0`; unselected tabs SHALL have `aria-selected="false"` and `tabIndex=-1`. `ArrowLeft` and `ArrowRight` SHALL wrap through tabs and activate and focus the destination; `Home` and `End` SHALL activate and focus the first and last tab. The range selector SHALL be a named `role="group"` of buttons whose selected state is exposed with `aria-pressed`.

Loading SHALL use a status region. A failed Spend request SHALL render the structured API message and a keyboard-operable retry. Empty, unavailable, partial, and complete presentations SHALL branch on response status and coverage rather than infer state from a zero subtotal. Awaiting placement SHALL render as a separate notice. A null weekly budget SHALL omit the budget line; a positive budget SHALL render it with each week's documented tri-state comparison. Weekly bars SHALL be a semantic chronological list with visible week, known amount, and coverage text; bar geometry SHALL be decorative and hidden from assistive technology. KPIs and breakdowns SHALL retain textual labels and values.

The panel SHALL use existing components and shared styles. On narrow and tall layouts, controls and cards SHALL remain readable and the labelled weekly chart SHALL use horizontal overflow without clipping information. No canvas, chart dependency, offline cache, speculative fallback, or unrelated page redesign SHALL be introduced.

#### Scenario: The retrospective shell defaults to the cooking log
- **WHEN** a member opens `/retrospective` with no `?tab`
- **THEN** the Cooking log tab is selected and its composer and log list render
#### Scenario: Spend canonicalizes a missing range to eight weeks
- **WHEN** a member enters the Spend analyzer with no `?range`
- **THEN** the URL is replace-canonicalized to `range=8w`, the Spend query uses `8w`, and eight chronological weekly rows render from the production response
#### Scenario: Spend canonicalizes an invalid range
- **WHEN** a member enters the Spend analyzer with any range other than `4w`, `8w`, or `12w`
- **THEN** replace navigation writes `range=8w` before the Spend request rather than sending the invalid value
#### Scenario: Range selection is URL-persisted
- **WHEN** a member selects 4 weeks or 12 weeks in the named range group
- **THEN** the pressed button, `?range` value, query key, and rendered shared aggregate all use the selected range
#### Scenario: Another tab retains a valid Spend range without querying Spend
- **WHEN** a member selects a valid Spend range, switches to Cooking log or Waste, and then returns
- **THEN** the inactive tab retains that valid URL range, no Spend query runs while Spend is inactive, and the preserved range is used on return
#### Scenario: Switching tabs is reflected in the URL
- **WHEN** a member selects the Spend analyzer or Waste analyzer tab
- **THEN** the `?tab` search parameter and selected tab semantics update and the selected panel renders, with Spend implemented and Waste still a placeholder
#### Scenario: Tab keyboard navigation activates and focuses predictably
- **WHEN** focus is in the tab list and the member presses ArrowLeft, ArrowRight, Home, or End
- **THEN** focus and selection move together using the documented wrapping order and tab/panel relationships remain valid
#### Scenario: Range controls expose their selected state
- **WHEN** the Spend panel renders or a range changes
- **THEN** its named group contains three buttons and exactly the active range exposes `aria-pressed="true"`
#### Scenario: Loading and retry are operable
- **WHEN** the Spend query is pending and then returns a structured error
- **THEN** a status region announces loading, the error view presents the server message, and a keyboard member can retry the same range
#### Scenario: Empty and unavailable history are not shown as ordinary zero spend
- **WHEN** the shared result status is `empty` or `unavailable`
- **THEN** the panel renders the corresponding distinct truthful state and coverage counts rather than presenting a complete zero-like KPI set
#### Scenario: Partial history labels every known subtotal honestly
- **WHEN** monetary or department coverage makes the shared result partial
- **THEN** the panel labels displayed amounts as known/incomplete and shows the response's unpriced, estimated, or pending-classification evidence without inventing a remainder
#### Scenario: Budget absence and presence remain distinct
- **WHEN** `weekly_budget` is null
- **THEN** no budget line or under-budget claim renders; when it is positive, the budget line and true, false, or unknown weekly comparison follow the response exactly
#### Scenario: Awaiting placement is separate from recorded spend
- **WHEN** `awaiting_mark_placed` is positive
- **THEN** a separate notice reports the count without adding those rows to weekly bars, KPIs, or insight
#### Scenario: Weekly bars have a text equivalent
- **WHEN** the Spend chart renders
- **THEN** assistive technology encounters a chronological list containing each week's label, known amount, and coverage while decorative geometry is hidden
#### Scenario: Narrow and tall layouts preserve all chart information
- **WHEN** the Spend panel renders at the member harness's narrow or tall viewport
- **THEN** controls and cards remain readable and the labelled weekly region scrolls horizontally rather than clipping weeks or textual values
#### Scenario: Waste remains outside Spend scope
- **WHEN** the member selects Waste analyzer after Spend ships
- **THEN** the existing Waste placeholder renders unchanged and no Spend range or aggregate is presented as Waste data
#### Scenario: The legacy log route redirects
- **WHEN** a member navigates to `/log`
- **THEN** they land on `/retrospective`
## ADDED Requirements

### Requirement: The member Spend endpoint is a session-gated adapter over the shared analyzer
The member API SHALL expose `GET /api/retrospective/spend?range=4w|8w|12w`. The member session SHALL resolve tenant identity; the route SHALL accept no tenant parameter, SHALL call the shared `readSpendAnalyzer` operation, SHALL perform no direct D1 read or write, and SHALL return the shared `SpendAnalyzer` object directly through the existing ETag response helper. A missing range SHALL default to `8w`. Any other value SHALL produce HTTP 400 with `{ "error": "validation_failed", "message": "range must be 4w | 8w | 12w" }` through the existing structured-error middleware. The dedicated body, profile retrospective `.spend`, and MCP retrospective `.spend` SHALL conform to the same additive aggregate shape defined by the spend-telemetry capability; only their documented default ranges differ.

#### Scenario: An authenticated request returns the shared object
- **WHEN** a signed-in member requests `/api/retrospective/spend?range=12w`
- **THEN** the route resolves that session's tenant and returns the shared twelve-week `SpendAnalyzer` object directly with the existing ETag behavior
#### Scenario: A missing API range defaults to eight weeks
- **WHEN** a signed-in member requests `/api/retrospective/spend` without `range`
- **THEN** the endpoint returns the shared aggregate with `range: "8w"`
#### Scenario: An invalid API range returns the exact structured error
- **WHEN** a signed-in member requests the endpoint with a range outside `4w`, `8w`, or `12w`
- **THEN** the response is HTTP 400 with error `validation_failed` and message `range must be 4w | 8w | 12w`
#### Scenario: An unauthenticated request cannot read Spend
- **WHEN** a caller without a valid member session requests the Spend endpoint
- **THEN** existing session middleware rejects the request before analysis and no household data is returned
#### Scenario: Tenant identity cannot be overridden publicly
- **WHEN** a signed-in caller adds an arbitrary tenant-like query or header value
- **THEN** the route ignores it, uses only the session-resolved tenant, and returns no other tenant's spend, cooking, budget, or awaiting-placement facts
#### Scenario: The API read has no side effect
- **WHEN** an authenticated Spend GET is repeated with unchanged committed facts
- **THEN** it returns the same deterministic object and performs no write, historical correction, cache persistence, scheduled work, or capture action
#### Scenario: The legacy profile endpoint retains its default
- **WHEN** an existing member client calls the profile retrospective endpoint without any new Spend input
- **THEN** its `.spend` value uses the same shared aggregate with the compatible four-week default and its existing non-Spend contract is unchanged
### Requirement: The Retrospective Spend panel is verified through real production entry points
The member-app Playwright page object and specs SHALL cover the Spend panel in the same change. The primary populated Spend case SHALL use the real seeded session-gated member API and its production analyzer operation, not a parallel browser-only aggregate. It SHALL verify the eight-week default, URL range changes, semantic tabs and range controls, textual KPI and weekly content, the awaiting-placement notice, and reviewed desktop plus tall/narrow screenshots. Narrow route interception SHALL be permitted only for otherwise unreachable presentation timing or branches such as sustained loading, forced structured error/retry, or a particular valid partial/unavailable response; such interception SHALL use the production response type and SHALL NOT be the primary analyzer proof.

#### Scenario: Primary browser coverage uses seeded production data
- **WHEN** the primary Spend Playwright case signs in and opens the Spend tab
- **THEN** its values come through the composed member API and production analyzer over seeded facts, and the case verifies default range, URL changes, semantic content, awaiting notice, and responsive screenshots
#### Scenario: Presentation-only interception cannot replace production proof
- **WHEN** a loading, structured-error, partial, or unavailable branch cannot be held reliably with seeded production timing
- **THEN** a narrowly scoped interception may return the exact production response shape for that branch, while the primary aggregate assertions continue to use the real endpoint
#### Scenario: No test-only analyzer model is introduced
- **WHEN** member UI and route tests are reviewed
- **THEN** they invoke the production API/operation or a narrowly typed presentation fixture and do not duplicate classification, coverage, KPI, ordering, or insight logic as an alternate implementation
