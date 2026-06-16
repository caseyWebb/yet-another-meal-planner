## MODIFIED Requirements

### Requirement: Menu-request context pre-pass

The batch SHALL always include `get_weather_forecast()` unconditionally (not gated on fulfillment mode), in addition to the existing batch members. The tool is a best-effort read: when it returns `{ error: "forecast_unavailable" }`, `{ error: "no_location" }`, or any other structured error, the agent SHALL continue with season-based reasoning and SHALL NOT surface the failure to the user.

#### Scenario: Weather forecast is included in the pre-pass batch

- **WHEN** the user makes a menu request
- **THEN** `get_weather_forecast()` is called in the parallel context batch alongside `read_pantry`, `read_preferences`, etc., before any recipe is selected

#### Scenario: Forecast failure does not break the menu flow

- **WHEN** `get_weather_forecast()` returns an error (any error variant)
- **THEN** the agent continues with season-based recipe selection and does not tell the user the weather lookup failed

---

## ADDED Requirements

### Requirement: Weather-aware recipe selection (soft hints, silent)

When `get_weather_forecast` returns a valid forecast, the agent SHALL use the `meal_vibes` array on each forecast day as **soft weighting** when assigning recipes to `planned_for` dates. The agent SHALL prefer:
- recipes without grill-style preparation on days carrying `no-grill`
- soups, stews, and comfort-food recipes on days carrying `soup` or `comfort`
- lighter meals on days carrying `light`
- grill-style recipes on days carrying `grill-friendly`

This weighting SHALL be a nudge applied during holistic reasoning, not a filter or hard exclusion. An explicit user preference ("I want burgers Tuesday") SHALL always override weather hints. The agent SHALL NOT mention the weather forecast or its weather-based reasoning in the proposal unless the user explicitly asks.

#### Scenario: Rainy day steers away from grilling

- **WHEN** the forecast for a `planned_for` date carries `no-grill` and the recipe corpus includes both a grilled dish and a braised dish equally fitting the user's taste
- **THEN** the agent favors the braised dish for that date, without explaining the weather rationale in the proposal

#### Scenario: User preference overrides weather hint

- **WHEN** the forecast carries `no-grill` for Tuesday but the user explicitly requests burgers on Tuesday
- **THEN** the agent proposes burgers on Tuesday; weather hints do not override expressed preference

#### Scenario: Cold rainy day favors comfort food

- **WHEN** the forecast for a date carries both `no-grill` and `soup`
- **THEN** the agent weights toward soups, stews, and hearty comfort meals for that day

#### Scenario: Weather reasoning is not narrated

- **WHEN** the agent has used `meal_vibes` to steer recipe selection
- **THEN** the proposal reads like a normal meal plan; weather is not mentioned unless the user asks why a particular recipe was chosen
