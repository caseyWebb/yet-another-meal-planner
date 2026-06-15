## ADDED Requirements

### Requirement: get_weather_forecast returns a daily forecast with meal_vibes hints

The system SHALL provide a `get_weather_forecast(days?)` read tool that resolves the caller's location and returns a daily weather forecast for planning purposes. Location resolution SHALL follow this order: (1) `preferences.location_zip`; (2) a 5-digit ZIP parsed from `preferences.preferred_location` via the `"Kroger - <zip>"` convention. If neither yields a ZIP, the tool SHALL return `{ error: "no_location" }` rather than throwing, so the agent can ask the user once and store the result. On a successful location resolve, the tool SHALL call Open-Meteo (geocoding + forecast APIs) and return `{ location: string, forecast: Array<{ date, high_f, low_f, precipitation_chance, condition, meal_vibes }> }`. A network failure or non-200 response from Open-Meteo SHALL return `{ error: "forecast_unavailable" }`. The `meal_vibes` array SHALL be derived deterministically in the Worker from thresholds (not delegated to the LLM): `no-grill` and `comfort` when precipitation_chance ≥ 60; `soup` when high_f < 55; `grill-friendly` when high_f ≥ 80 and precipitation_chance < 30; `light` when high_f ≥ 85. The `days` parameter defaults to 7 and is clamped to 1–16. The tool SHALL be read-only and have no side effects.

#### Scenario: Returns forecast with meal_vibes for a normally-onboarded member

- **WHEN** `get_weather_forecast()` is called and `preferences.preferred_location` is `"Kroger - 76104"`
- **THEN** the tool parses ZIP `76104`, calls Open-Meteo, and returns a 7-day forecast array where each entry carries `meal_vibes` derived from that day's temperature and precipitation data

#### Scenario: location_zip takes precedence over preferred_location parsing

- **WHEN** both `preferences.location_zip = "10001"` and `preferences.preferred_location = "Kroger - 76104"` are set
- **THEN** the tool uses `10001` for the geocoding lookup, not `76104`

#### Scenario: No location returns a structured error

- **WHEN** `get_weather_forecast()` is called and neither `location_zip` nor a parseable ZIP in `preferred_location` exists
- **THEN** the tool returns `{ error: "no_location" }`, not a throw

#### Scenario: Open-Meteo failure returns a structured error

- **WHEN** the Open-Meteo API returns a non-200 response or times out
- **THEN** the tool returns `{ error: "forecast_unavailable" }`, not a throw

#### Scenario: meal_vibes is empty on mild, dry days

- **WHEN** the forecast for a day has high_f = 72 and precipitation_chance = 15
- **THEN** that day's `meal_vibes` is `[]` — no strong signal, no hints applied
