# consumer-facing-descriptions — delta

## ADDED Requirements

### Requirement: Show-me routing is a description-owned guarantee

Each widget-bearing display tool's description SHALL state, as its leading contract, that it is the canonical answer to a member's show-me ask for its surface (`display_grocery_list` for "show / what's on my list", `display_recipe` for a recipe, `display_meal_plan` for a **proposed** week), and each reasoning read with a true display twin (`read_to_buy`, `read_recipe`) SHALL state that it is an agent-internal read whose contents are never presented as the answer to a show-me request. `read_meal_plan` — whose surface has no saved-plan card — SHALL instead disambiguate: it is the saved plan's source of truth, answered in plain language, and `display_meal_plan` proposes a new week rather than showing the saved one. This allocation follows the capability's litmus test — a skill-less agent must route a show-me ask correctly from descriptions alone — so the routing guarantee SHALL NOT live only in a skill. The core skill MAY keep the matching choreography (when in a flow to render versus reason); the two are complementary halves, not duplicates.

#### Scenario: A bare list question routes to the widget without any skill loaded

- **WHEN** a member asks "what's on my list?" on a host with no plugin skills loaded
- **THEN** the tool descriptions alone direct the agent to `display_grocery_list` rather than answering with `read_to_buy` prose

#### Scenario: A reasoning read declares itself non-presentational

- **WHEN** an agent reads `read_to_buy` while planning
- **THEN** its description states the read is internal and never the presented answer to a show-me ask
