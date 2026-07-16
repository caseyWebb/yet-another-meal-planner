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

The widget's controls SHALL iterate by re-invoking the **stateless** propose operation client-side,
so refinement costs no additional frontier-model turn. The widget-initiated control set is the
D8/D20 shared-component enumeration: **per-meal slot counts, the swap menu (from the returned
alternates), facet chips, per-slot vibe override, sides editing, and commit** — the cut dials (slot
lock/exclude controls, the adventurousness slider, protein-want chips, the freeform phrase input,
global reroll, the weather strip) are member-surface control removals only and do not appear in the
widget either; the underlying **tool params** (`lock`, `exclude`, `nudges`, `freeform`, `seed`) are
retained unchanged, and swap/session replay are implemented atop lock/pin/exclude in the replayed
request. Because `runProposeMealPlan` is deterministic given its request body (the
`meal-plan-proposal` capability), the widget replays the adjusted request and re-renders from the
new result — the same client-side session-replay guarantee the member web app relies on. Every
mutating interaction SHALL follow the three-channel discipline (D18): a **request-changing** edit
(per-meal count, swap, facet, vibe) re-invokes the op via `App.callServerTool` AND pushes the full
proposed-week snapshot to the host model via `ui/update-model-context`; a **sides edit** pushes the
snapshot via `ui/update-model-context` ONLY, with no re-invocation (a local refinement, not a
re-query). When a host cannot support widget-initiated re-invocation, the widget SHALL degrade to
the rendered text `content` fallback of the initial proposal rather than failing.

#### Scenario: A control change re-renders without a model turn

- **WHEN** the member adjusts a per-meal count or swaps a slot from its alternates in the widget
- **THEN** the widget re-invokes the stateless propose op with the adjusted request (expressed via the retained tool params) and pushes the full proposed-week snapshot to the host model, spending no frontier-model turn and sending no `ui/message`

#### Scenario: A sides edit updates context without re-querying

- **WHEN** the member adds or removes a side on a slot in the widget
- **THEN** the widget pushes the updated full-state snapshot via `ui/update-model-context` ONLY — no `callServerTool`, no re-query — and the edited sides ride into the commit

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

### Requirement: The widget commits the chosen week itself (D18)

The propose widget SHALL perform the plan write itself rather than delegating it to the model. On
commit, when the host can proxy tool calls, the widget SHALL run the client-side sequence, in order:
`read_meal_plan` (re-read the live plan) → compute client-assigned open dates within the planning
window → `update_meal_plan` (one `add` op per chosen slot, carrying a client-minted row id, the
slot's `meal`, its edited sides, and its vibe id as `from_vibe`; never `duplicate`) → `read_meal_plan`
(re-read the committed plan) → `ui/update-model-context` (the committed snapshot) → `ui/message`
(commit provenance). No new tool SHALL be introduced — `read_meal_plan` and `update_meal_plan` are
the existing app-callable tools. The commit SHALL degrade down a capability ladder: a host that can
proxy tool calls runs the write; a host that can only message falls back to a single sendMessage
delegation; a host that can do neither disables commit (read-only render).

#### Scenario: Commit writes the plan and announces it

- **WHEN** the member commits a proposed week in a host that advertises `serverTools`
- **THEN** the widget re-reads the plan, writes each chosen slot via `update_meal_plan` (with edited sides + `from_vibe`), re-reads, pushes the committed snapshot via `ui/update-model-context`, and sends one `ui/message` announcing the commit — the write never routes through the model

#### Scenario: Commit degrades to a message when the host cannot proxy tools

- **WHEN** the member commits in a host without `serverTools` but with message support
- **THEN** the widget falls back to a single sendMessage delegation asking the agent to persist the week, and does not attempt the tool write

#### Scenario: A failed write is never announced as a success

- **WHEN** the commit's `update_meal_plan` fails — a rejection OR a throw-free `isError` result (the worker tools resolve failures as `isError`, they do not reject)
- **THEN** the widget reports the week NOT committed, pushes no committed-context snapshot, and sends no commit-provenance message — a write that did not land is never announced as done

### Requirement: A newer contract version renders the widget read-only (D19)

Each widget payload SHALL carry a `contract_version`; the widget SHALL render read-only (no
refinement controls, no commit) when the payload's `contract_version` exceeds the version its build
knows, degrading rather than mis-parsing a newer shape. An absent `contract_version` SHALL read
as version 1.

#### Scenario: An unknown-newer payload degrades to read-only

- **WHEN** the widget hydrates a `ProposeCardData` whose `contract_version` exceeds its known version
- **THEN** it renders the proposed week read-only — no dials, no commit — rather than crashing or mis-parsing

### Requirement: Member-initiated planning presents as the card

A member-initiated planning ask ("plan my week", "what should we eat") SHALL present as the propose card wherever the host renders widgets: the `plan` flow's choreography renders `display_meal_plan` with its authored entries as the proposal surface, and a card Commit — which already writes the plan itself (D18) — supersedes the flow's chat-save step. `propose_meal_plan` remains contract-unchanged and agent-internal: the fallback presentation on hosts that render no widgets, and the data form for reasoning over a proposal without showing it.

#### Scenario: Plan my week renders the card

- **WHEN** a member asks to plan their week on a widget-rendering host with the plugin loaded
- **THEN** the flow renders `display_meal_plan` as the proposal — not a prose narration of `propose_meal_plan` output

#### Scenario: A card Commit ends the save step

- **WHEN** the member commits the week from the card
- **THEN** the flow does not call `update_meal_plan` for those slots — the card's commit already wrote them

