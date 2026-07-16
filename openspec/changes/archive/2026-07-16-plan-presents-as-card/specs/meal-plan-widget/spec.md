# meal-plan-widget — delta

## ADDED Requirements

### Requirement: Member-initiated planning presents as the card

A member-initiated planning ask ("plan my week", "what should we eat") SHALL present as the propose card wherever the host renders widgets: the `plan` flow's choreography renders `display_meal_plan` with its authored entries as the proposal surface, and a card Commit — which already writes the plan itself (D18) — supersedes the flow's chat-save step. `propose_meal_plan` remains contract-unchanged and agent-internal: the fallback presentation on hosts that render no widgets, and the data form for reasoning over a proposal without showing it.

#### Scenario: Plan my week renders the card

- **WHEN** a member asks to plan their week on a widget-rendering host with the plugin loaded
- **THEN** the flow renders `display_meal_plan` as the proposal — not a prose narration of `propose_meal_plan` output

#### Scenario: A card Commit ends the save step

- **WHEN** the member commits the week from the card
- **THEN** the flow does not call `update_meal_plan` for those slots — the card's commit already wrote them
