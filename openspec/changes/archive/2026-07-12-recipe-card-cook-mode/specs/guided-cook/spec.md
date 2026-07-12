## REMOVED Requirements

### Requirement: Emit recipe_display_v0 scaffolding the prep + cook steps

**Reason**: D32 — the built-in `recipe_display_v0` lacks the MCP Apps bridge that D4 requires for
cook completion, log-cooked, and favorite to reach the agent. Guided cook emits `display_recipe`'s
cook-mode card instead (added below), reconciling the structured-step path onto `CookModeData`.

## ADDED Requirements

### Requirement: Emit the display_recipe cook-mode card scaffolding the prep + cook steps

When the host renders MCP Apps, the `cook` skill SHALL scaffold the **prep + cook** half of the
walkthrough onto `display_recipe`'s cook-mode card rather than the built-in `recipe_display_v0`. The
structured step data is one reconciled path: the skill supplies `display_recipe`'s
`structuredContent.cook` (`CookModeData`), and the member-app / no-skill path parses the recipe body
client-side to the same shape. The card SHALL be constructed from the resolved recipe(s):
`ingredients[]` each with a stable `id` and its text at the pinned serving count (so `base_servings`
equals that count) and an optional authored `group`; `steps[]` a single ordered list covering prep
(including a preheat step at the right lead time) and cook (each step one logical action), with main
and sides interleaved so they finish together, each step's `content` referencing ingredients via
`{id}` interpolation so amounts rescale, and a `title` used as the step header and timer label. A
`timer_seconds` SHALL be included on every step that involves waiting and omitted on active
hands-on steps. When a main and a side share an ingredient, they SHALL be kept as separate,
disambiguated ingredient lines rather than merged.

#### Scenario: Card scaffolds prep and cook, not pre-flight

- **WHEN** pre-flight has resolved and the host renders MCP Apps
- **THEN** the skill emits `display_recipe`'s cook-mode card whose `steps[]` cover prep and cook only,
  with equipment/gather/sufficiency left in the prior conversation

#### Scenario: Amounts are normalized to the pinned count and rescale by reference

- **WHEN** the user pinned a serving count that differs from the recipe's authored yield
- **THEN** every `ingredients[].amount` is the quantity at the pinned count, `base_servings` equals the
  pinned count, and step text references amounts via `{id}` rather than hardcoding numbers

#### Scenario: Waiting steps carry timers, active steps do not

- **WHEN** a step involves any wait (simmer, bake, rest, marinate, chill, preheat)
- **THEN** that step carries a `timer_seconds`, while a purely active hands-on step (e.g. chopping) omits it

#### Scenario: Main and sides interleave into one ordered step list

- **WHEN** the cook is a main plus one or more sides
- **THEN** their steps are merged into a single ordered `steps[]` timed so the dishes finish together,
  and a shared ingredient appears as separate disambiguated lines

## MODIFIED Requirements

### Requirement: Guard the widget and degrade to the text walk

The skill SHALL guard the `display_recipe` cook-mode card emit on the host rendering MCP Apps, because that card renders only where MCP Apps is supported. When the host does NOT render MCP Apps, the skill SHALL fall back to the plain-text one-step-at-a-time walkthrough (paced prep then cook, advancing on "next"/"done") instead of emitting a card. The text walk SHALL be retained as this fallback branch.

#### Scenario: MCP Apps host present

- **WHEN** the host renders MCP Apps
- **THEN** the skill emits `display_recipe`'s cook-mode card

#### Scenario: MCP Apps host absent

- **WHEN** the host does not render MCP Apps
- **THEN** the skill paces the same prep and cook steps as plain text, one logical step at a time, and
  emits no card and reports no error
