## MODIFIED Requirements

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

## ADDED Requirements

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
