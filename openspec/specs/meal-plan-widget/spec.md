# meal-plan-widget Specification

## Purpose
TBD - created by archiving change converge-meal-planning-surfaces. Update Purpose after archive.
## Requirements
### Requirement: Dedicated propose-display tool

The Worker SHALL expose a widget-bearing MCP tool that renders a `propose_meal_plan` result as an inline interactive card. The tool SHALL reuse the shared planner operation (`runProposeMealPlan`) — including the per-meal `meals` counts map and the `attendance` input (the `meal-plan-proposal` capability) — and SHALL NOT alter the contract of `propose_meal_plan`, which remains a plain data-returning tool. The tool result SHALL carry `_meta.ui.resourceUri` referencing `ui://plan/propose`, a `structuredContent` payload matching the shared `@yamp/contract` `ProposeCardData` type — a **flat, meal-ordered** slot list (breakfast → lunch → dinner, position-stable within meal) in which each slot carries its **`meal`**, with the `request` echo carrying `meals` and `attendance` — and a text `content` fallback rendering the proposal. This change reshapes the **data contract only**; no widget UI work ships with it (the widget rendering of meals is band 2's `plan-your-week-widget`). Failures SHALL be returned as structured errors, not thrown.

#### Scenario: Displaying a proposed multi-meal week

- **WHEN** the propose widget tool is invoked with `meals: { breakfast: 2, dinner: 4 }`
- **THEN** the result carries `_meta.ui.resourceUri` equal to `ui://plan/propose` and a `structuredContent` payload whose slots each carry their `meal`, ordered breakfast → lunch → dinner, with the request echo carrying `meals` (and `attendance` when supplied), plus a text `content` fallback listing the proposed slots

#### Scenario: A failure is a structured error

- **WHEN** the underlying `runProposeMealPlan` returns a structured error (e.g. no palette and no ephemeral set)
- **THEN** the tool returns that structured error, not a thrown exception, and no partial widget payload

### Requirement: Widget-initiated iteration re-invokes the stateless op

The widget's controls SHALL iterate by re-invoking the **stateless** propose operation client-side, so refinement costs no additional frontier-model turn. The widget-initiated control set is the D8/D20 shared-component enumeration: **per-meal slot counts, the swap menu (from the returned alternates), facet chips, per-slot vibe override, sides editing, and commit** — the cut dials (slot lock/exclude controls, the adventurousness slider, protein-want chips, the freeform phrase input, global reroll, the weather strip) are member-surface control removals only and do not appear in the widget either; the underlying **tool params** (`lock`, `exclude`, `nudges`, `freeform`, `seed`) are retained unchanged, and swap/session replay are implemented atop lock/pin/exclude in the replayed request. Because `runProposeMealPlan` is deterministic given its request body (the `meal-plan-proposal` capability), the widget replays the adjusted request and re-renders from the new result — the same client-side session-replay guarantee the member web app relies on. When a host cannot support widget-initiated re-invocation, the widget SHALL degrade to the rendered text `content` fallback of the initial proposal rather than failing.

#### Scenario: A control change re-renders without a model turn

- **WHEN** the member adjusts a per-meal count or swaps a slot from its alternates in the widget
- **THEN** the widget re-invokes the stateless propose op with the adjusted request (expressed via the retained tool params) and re-renders, spending no frontier-model turn

#### Scenario: A host without callbacks degrades to the render

- **WHEN** the host cannot support widget-initiated tool re-invocation
- **THEN** the widget still renders the initial proposal via the text `content` fallback, and the plan is not blocked

### Requirement: Widget delivery is not capability-gated

The propose widget tool SHALL return `_meta.ui.resourceUri` unconditionally, regardless of whether the connected client advertises the MCP Apps capability, because that capability signal is unreliable on the pinned SDK. Hosts that cannot render the widget SHALL still receive the text `content` fallback.

#### Scenario: Client does not advertise MCP Apps support

- **WHEN** the tool is called by a client that does not advertise the MCP Apps UI capability
- **THEN** the result still carries `_meta.ui.resourceUri`, and the text `content` fallback is present

### Requirement: Propose card served as an MCP Apps resource

The Worker SHALL register a `ui://plan/propose` resource over MCP `resources/read` with the MCP Apps MIME type `text/html;profile=mcp-app`, serving a self-contained widget document. Serving SHALL NOT require a new Worker HTTP route or a `run_worker_first` entry — it rides `resources/read`, like the recipe-card widget.

#### Scenario: The resource is served over resources/read

- **WHEN** a host reads `ui://plan/propose`
- **THEN** the Worker returns the widget HTML with MIME `text/html;profile=mcp-app`, with no dedicated HTTP route or `run_worker_first` entry added

### Requirement: Self-contained, zero-external-request widget bundle

The widget bundle SHALL be built by `packages/widgets` as a single self-contained document with no external network requests, using the canonical `@modelcontextprotocol/ext-apps` `App` client and reusing the shared `packages/ui` component + token layer, and SHALL be emitted into the Worker's static-assets widgets root. The bundle SHALL register its tool-result handler before connecting so the first tool result is not dropped, and SHALL hydrate from the result's `structuredContent`.

#### Scenario: The bundle makes no external requests

- **WHEN** the propose widget renders
- **THEN** it loads only inlined assets, issues no external network request, and hydrates from `structuredContent`

