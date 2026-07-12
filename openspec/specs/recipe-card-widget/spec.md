# recipe-card-widget Specification

## Purpose
TBD - created by archiving change add-recipe-card-widget. Update Purpose after archive.
## Requirements
### Requirement: Dedicated recipe-display tool

The Worker SHALL expose a `display_recipe` MCP tool that renders a recipe as an inline card. The tool SHALL reuse the existing recipe reader (`readRecipeDetail`) and SHALL NOT alter the contract of `read_recipe`, which remains a plain data read. The tool result SHALL carry `_meta.ui.resourceUri` referencing `ui://recipe/card`, a `structuredContent` payload with the recipe's display fields, and a text `content` fallback. Failures SHALL be returned as structured errors, not thrown.

#### Scenario: Displaying an existing recipe

- **WHEN** `display_recipe` is called with the slug of a recipe in the caller's corpus
- **THEN** the result carries `_meta.ui.resourceUri` equal to `ui://recipe/card`
- **AND** `structuredContent` contains the recipe's title, facets (protein/cuisine/course/season/dietary/tags as available), total time, and the recipe body
- **AND** `content` includes a text rendering of the recipe as a fallback for hosts that cannot render the widget

#### Scenario: Unknown slug

- **WHEN** `display_recipe` is called with a slug that resolves to no recipe
- **THEN** the tool returns a structured `not_found` error rather than throwing

### Requirement: Recipe card served as an MCP Apps resource

The Worker SHALL register a `ui://recipe/card` resource over MCP `resources/read` with the MCP Apps MIME type `text/html;profile=mcp-app`. The resource SHALL be a single self-contained HTML document. Serving SHALL NOT require a new Worker HTTP route or `run_worker_first` entry.

#### Scenario: Reading the card resource

- **WHEN** a host reads the `ui://recipe/card` resource
- **THEN** it receives one content item whose `mimeType` is `text/html;profile=mcp-app`
- **AND** whose text is a single HTML document

### Requirement: Self-contained, zero-external-request widget bundle

The recipe card widget SHALL be produced by a single-file build target that inlines all JavaScript and CSS into one HTML document and makes ZERO external network requests. The bundle SHALL use the canonical `@modelcontextprotocol/ext-apps` `App` client for the host bridge (not a hand-rolled bridge) and SHALL reuse the shared `packages/ui` component + token layer.

#### Scenario: The built widget makes no external requests

- **WHEN** the widget bundle is built
- **THEN** the emitted HTML contains no external stylesheet links, script `src` references, font imports, or other external resource URLs
- **AND** all JavaScript and CSS are inlined into the document

### Requirement: Widget delivery is not capability-gated

The `display_recipe` tool SHALL return `_meta.ui.resourceUri` unconditionally, regardless of whether the connected client advertises the MCP Apps capability, because that capability signal is unreliable on the pinned SDK. Hosts that cannot render the widget SHALL still receive the text `content` fallback.

#### Scenario: Client does not advertise MCP Apps support

- **WHEN** `display_recipe` is called by a client that does not advertise the `io.modelcontextprotocol/ui` capability
- **THEN** the result still carries `_meta.ui.resourceUri`
- **AND** the text `content` fallback is present so a non-rendering host degrades to a readable response

### Requirement: Guided cook mode over the recipe card

The recipe card SHALL render a guided cook mode: an entry ("Start Cooking") that walks the recipe
as a presentational step machine — an optional mise-en-place ingredient check-off, ordered
step-by-step navigation with a progress indicator, and per-step timers — ending on a "Plated up"
completion screen. Cook mode's phase, check-offs, and timers are ephemeral client-local state and
SHALL NOT be persisted. The step data SHALL come from the payload's `cook` block (`CookModeData`)
when a skill supplies it, and otherwise be derived client-side by parsing the recipe `body` (the
no-skill annotation path), so every card is cook-capable with no interim dual-card state. The card
SHALL NOT provide a servings-scaling control in this version even when `cook.base_servings` is
present.

#### Scenario: Stepping through a recipe

- **WHEN** the member starts cooking a card whose body (or `cook` block) yields steps
- **THEN** the card presents the mise-en-place check-off, then one step at a time with a progress
  indicator and a per-step timer when the step declares a duration, and a completion screen at the end
- **AND** the check-offs and timer are client-local and are not written to the server

#### Scenario: A card is cook-capable without a skill-supplied cook block

- **WHEN** `display_recipe` returns a card with no `cook` block
- **THEN** the host parses the recipe body client-side to the same step shape and still offers cook mode

#### Scenario: No servings-scaling control

- **WHEN** cook mode renders, whether or not `base_servings` is known
- **THEN** it presents no servings-scaling control (deferred beyond v1)

### Requirement: The recipe card performs its favorite and log-cooked writes (D18)

The recipe card SHALL perform its two persistent writes itself through the D18 three-channel bridge
protocol rather than delegating them to the model, when the host can proxy tool calls. A favorite
tap SHALL call `toggle_favorite` and then push a full current-state snapshot via
`ui/update-model-context`, with NO `ui/message`. A log-cooked action SHALL call `log_cooked`
(`type: "recipe"`, the slug, and a local-calendar `YYYY-MM-DD` date) and then push
`ui/update-model-context` and one `ui/message` announcing the log. Cook completion ("Plated up")
SHALL send a `ui/message` only, with no write and no context push. Because the Worker tools resolve
failures as `isError` rather than rejecting, a write whose result is `isError` (or which rejects)
SHALL be treated as NOT landed: the optimistic favorite rolls back, and no context snapshot or
provenance message is pushed. The controls SHALL degrade down a capability ladder: a host that can
proxy tools performs the writes; a host that cannot proxy tools presents cook mode without the
favorite/log write controls; the text `content` fallback remains for a host that cannot render the
widget at all.

#### Scenario: A favorite tap writes and syncs context, without a message

- **WHEN** the member toggles the favorite on a card in a host that advertises `serverTools`
- **THEN** the widget calls `toggle_favorite` and pushes a full-state `ui/update-model-context`
  snapshot, and sends no `ui/message`

#### Scenario: A log-cooked writes, syncs context, and announces

- **WHEN** the member logs the recipe as cooked from the card
- **THEN** the widget calls `log_cooked` with the slug and a local-calendar date, pushes
  `ui/update-model-context`, and sends one `ui/message` announcing the log

#### Scenario: A failed write is never announced as a success

- **WHEN** a favorite or log write returns `isError` or rejects
- **THEN** the widget reports it as not landed — the optimistic favorite rolls back, and no
  context snapshot or provenance message is pushed

#### Scenario: Completion announces once

- **WHEN** the walk reaches the "Plated up" completion screen
- **THEN** the widget sends one `ui/message` that the cook finished, with no write and no context push

### Requirement: Boot re-hydrate and the contract-version gate (D19)

The card payload SHALL carry a `contract_version`. Before enabling its write controls the widget
SHALL re-hydrate the caller's `favorite` via `read_recipe` (the spawning payload is a render-only
snapshot), and SHALL gate the favorite/log writes on a successful re-hydrate; a bridge-unavailable
or failed re-hydrate SHALL render read-only (cook mode without the write controls). A payload whose
`contract_version` exceeds the version the widget's build knows SHALL degrade to the plain read-only
card with no cook entry and no write controls, rather than mis-parsing a newer shape. An absent
`contract_version` SHALL read as version 1.

#### Scenario: Writes are gated on a successful boot re-hydrate

- **WHEN** the widget boots on a host that can proxy tools
- **THEN** it re-reads `favorite` via `read_recipe` before enabling the favorite/log controls, and if
  the re-hydrate fails it renders cook mode without those write controls

#### Scenario: An unknown-newer payload degrades to the plain card

- **WHEN** the widget hydrates a `RecipeCardData` whose `contract_version` exceeds its known version
- **THEN** it renders the plain read-only recipe card — no cook entry, no write controls — rather than
  crashing or mis-parsing

