## ADDED Requirements

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

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Hand off to the cooked flow on completion

**Reason**: The `cooked` flow dissolves into the `cook` skill in the 17→6 consolidation — the walkthrough's natural ending is the log, so a cross-skill hand-off added a seam (and a skill) with no behavioral payoff.
**Migration**: The new "Cook completion logs the meal in-flow" requirement carries the same guarantees inside `cook`: the dish carries over without restatement, `log_cooked` is written honestly, the plan row clears, and pantry decrements are asked-then-applied.
