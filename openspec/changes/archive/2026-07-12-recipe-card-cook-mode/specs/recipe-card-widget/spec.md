## REMOVED Requirements

### Requirement: Read-only recipe rendering

**Reason**: D32 — the Recipe Card becomes the ONE conversation cooking card. Its read-only
justification (no structured step data, deferring servings/timers to the built-in
`recipe_display_v0`) is obsoleted by the `CookModeData` annotation contract. Replaced by the
guided-cook-mode, D18-write, and D19-freshness requirements added below.

## ADDED Requirements

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
