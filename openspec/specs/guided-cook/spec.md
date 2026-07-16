# guided-cook Specification

## Purpose

Define the hands-free guided cook walkthrough owned by the `cook` skill: a conversational pre-flight (dish resolution, equipment confirmation against the kitchen, ingredient gather, pinned serving count, and sufficiency check) that stays out of any card; the `recipe_display_v0` card scaffolding only the prep + cook half of the walkthrough with amounts normalized to the pinned count and steps interleaved across a main and its sides; an offer of card-tap vs hands-free voice over the same steps; a harness-widget guard that degrades to the plain-text one-step-at-a-time walk when the widget is absent; voice-mode timers that the user owns (the agent never starts or confirms a timer); and a hand-off to the `cooked` flow on completion.
## Requirements
### Requirement: Conversational pre-flight before any card

The `cook` skill SHALL run pre-flight conversationally — never inside the `recipe_display_v0` card. Pre-flight covers: identify the dish(es) (a vibe-less `search_recipes` query to resolve, `read_recipe` for ingredients and `## Instructions`, reading all of a main + its sides); confirm equipment against `read_user_profile().kitchen` (`owned` + `notes`), asking only about genuinely unknown gear and capturing volunteered equipment silently via `update_pantry`'s kitchen operations (per `ambient-preference-learning`); have the user gather every ingredient; **pin the serving count** for the cook; and **check sufficiency against that pinned count**. When something is missing or short, the skill SHALL surface it here and offer a substitution or scale-down, and SHALL restart pre-flight from the top if the user swaps the dish. Pre-flight is deliberately kept out of the card because a static card cannot read the kitchen, offer a substitution, or restart on a swap.

#### Scenario: Sufficiency shortfall is caught conversationally before the card

- **WHEN** the gathered amount of an ingredient is short of what the recipe needs at the pinned serving count
- **THEN** the skill surfaces the shortfall in conversation and offers a substitution or scale-down (or a dish swap, which restarts pre-flight), and does NOT emit the card until pre-flight resolves

#### Scenario: Known equipment is not re-asked

- **WHEN** the recipe calls for an appliance already present in the kitchen `owned` list or `notes`
- **THEN** the skill confirms its use without asking whether the user has it, and only asks about gear absent from both `owned` and `notes`

#### Scenario: Volunteered equipment is captured silently

- **WHEN** the user mentions owning an appliance not yet recorded
- **THEN** the skill saves it via `update_pantry`'s kitchen operations without an offer-and-confirm ceremony

### Requirement: Guard the widget and degrade to the text walk

The skill SHALL guard the `display_recipe` cook-mode card emit on the host rendering MCP Apps, because that card renders only where MCP Apps is supported. When the host does NOT render MCP Apps, the skill SHALL fall back to the plain-text one-step-at-a-time walkthrough (paced prep then cook, advancing on "next"/"done") instead of emitting a card. The text walk SHALL be retained as this fallback branch.

#### Scenario: MCP Apps host present

- **WHEN** the host renders MCP Apps
- **THEN** the skill emits `display_recipe`'s cook-mode card

#### Scenario: MCP Apps host absent

- **WHEN** the host does not render MCP Apps
- **THEN** the skill paces the same prep and cook steps as plain text, one logical step at a time, and
  emits no card and reports no error

### Requirement: Offer card-tap or hands-free voice over the same steps

After emitting the card, the skill SHALL offer two ways to proceed over the same steps: tap through the card solo, or a hands-free voice walk in which the agent paces the steps ("next"/"done"/"what's next") while the card stays on screen as reference. The voice walk SHALL pace the same `steps[]` rendered in the card, not a divergent step list.

#### Scenario: Mode is offered after emit

- **WHEN** the card has been emitted
- **THEN** the skill offers tap-through-solo or a hands-free voice walk over the same steps

#### Scenario: Voice walk paces the card's steps

- **WHEN** the user chooses the voice walk
- **THEN** the agent paces the same steps shown in the card, advancing on the user's cue, with the card remaining on screen as reference

### Requirement: Voice-mode timers are owned by the user

In the voice walk the agent SHALL NOT start or claim to run a timer. When a step has a `timer_seconds`, the agent SHALL tell the user the duration and let the user set their own timer, SHALL NOT ask the user to confirm the timer is set, and SHALL next speak when the timer should be going off — unless there is interleaved work to pace in the meantime, in which case it paces that work. Card-tap mode uses the card's own native timers (user-initiated); the agent starts no timers in either mode. The companion voice-timer-control seam (#87) is out of scope and not relied upon.

#### Scenario: Agent does not confirm the timer is set

- **WHEN** a voice-walk step has a `timer_seconds` and there is no other work to do meanwhile
- **THEN** the agent states the duration, does not ask the user to confirm the timer is set, and speaks again only when the timer should be going off

#### Scenario: Interleaved work is paced during a wait

- **WHEN** a voice-walk step is waiting on a timer but another dish's step can be started meanwhile
- **THEN** the agent paces that interleaved step during the wait rather than going silent until the timer

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

### Requirement: Cook completion logs the meal in-flow

The `cook` skill SHALL own completed-meal capture — there is no separate `cooked` flow. On completion of a walkthrough (card or text), the skill SHALL log the cook via `log_cooked` with the dish(es) already in hand (the member never restates them), clear the matching meal-plan row (via `log_cooked`'s plan-row clearing, passing `plan_row_id` when a specific row is anchored), and decrement consumed pantry items via `update_pantry` after asking what was used up. The same capture path SHALL serve a **reported** completed meal ("I made the chili last night"): the skill checks the meal plan first for an obvious match, resolves off-plan dishes with a vibe-less `search_recipes`, logs honestly (only what was actually cooked, with an explicit past `date` when stated, and `meal` only when known), and never logs what was merely planned. After logging, the skill MAY make one light reaction offer (a favorite/hide via `set_recipe_disposition`, or a tweak as an `add_recipe_note`) — one offer, never pushed.

#### Scenario: Walkthrough completion logs without restating the dish

- **WHEN** the guided walkthrough finishes
- **THEN** the skill logs the cook via `log_cooked` with the dish(es) carried over, clears the matching plan row, and asks about used-up pantry items to decrement — without the member restating what was cooked

#### Scenario: A reported past meal uses the same capture

- **WHEN** the member reports "I made the chili last night" with no walkthrough
- **THEN** the `cook` skill resolves the dish (meal plan first), logs it via `log_cooked` with yesterday's date, and updates the pantry — logging only what was actually cooked

#### Scenario: One light reaction offer after logging

- **WHEN** a cook has just been logged
- **THEN** the skill makes at most one light offer to capture a reaction or note, and drops it without comment if declined

