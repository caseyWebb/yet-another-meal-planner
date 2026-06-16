## Why

The meal-planning flow picks recipes based on taste, pantry, diet, and calendar season — but has no awareness of what the weather will actually be like during the planned week. A hearty lamb stew is technically a "winter" recipe, but the `season` tag doesn't know it's 55°F and raining in July because a cold front blew through. A weekend grill session is a great fit for warm sunny Saturday, but the agent happily suggests it when a rainstorm is forecast. The agent misses the chance to feel like it knows the user's week.

The gap is narrow: we already have the user's ZIP (embedded in `preferred_location`), we already anchor recipes to specific days via `planned_for`, and Open-Meteo provides a free, no-key, global 7-day forecast API. The only missing piece is a tool that fetches and interprets it.

## What Changes

- **New `get_weather_forecast` tool.** A read-only Worker tool that resolves the user's location (from `preferences.location_zip`, falling back to parsing the ZIP from `preferred_location`), calls the Open-Meteo geocoding and forecast APIs, and returns a structured daily forecast for the next N days. The Worker derives `meal_vibes` hints from temperature/precipitation thresholds (e.g. `no-grill`, `comfort`, `soup`, `grill-friendly`, `light`) so the LLM gets clean labels rather than raw numbers to re-interpret.
- **Meal-plan context pre-pass.** `get_weather_forecast` is added to the step-1 context load in the meal-plan flow, alongside `read_pantry`, `read_preferences`, etc. The agent weights `meal_vibes` against `planned_for` dates as soft hints when matching recipes to days — no hard gates, no user-facing narration.
- **`location_zip` preferences field.** An optional `location_zip` scalar is added to `preferences.toml`. The tool checks this first; if absent, it parses the ZIP from `preferred_location` ("Kroger - 76104" → "76104"). If neither yields a ZIP, the tool returns a structured `no_location` error and the agent asks once and stores the result. Onboarding notes the derivation path so the ZIP is never asked for twice.
- **Docs in sync.** `docs/TOOLS.md` gains the `get_weather_forecast` entry; `docs/SCHEMAS.md` gains the `location_zip` field under `preferences.toml`.

## Capabilities

### Modified Capabilities
- `menu-generation`: the context pre-pass adds `get_weather_forecast`; the agent weights forecast `meal_vibes` as soft hints against `planned_for` dates during recipe selection, without narrating the reasoning unless the user asks.
- `data-read-tools`: adds the `get_weather_forecast` tool (read-only, no side effects, structured `no_location` error when location is unresolvable).
- `guided-onboarding`: the store-setup area notes that `location_zip` can be derived from `preferred_location`; it only asks for a standalone ZIP if `preferred_location` is absent or non-parseable.

## Impact

- **Worker (`src/`)** — new `src/weather.ts` with Open-Meteo fetch logic and `meal_vibes` derivation; new `get_weather_forecast` tool wired in `src/tools.ts`.
- **`AGENT_INSTRUCTIONS.md`** — meal-plan context load step gains `get_weather_forecast`; soft weather-weighting guidance added; plugin rebuild regenerates the skill bundle under `plugin/`.
- **`docs/TOOLS.md`** and **`docs/SCHEMAS.md`** updated in the same pass.
- **No data-model migration.** `location_zip` is optional; absence is handled gracefully by falling back to `preferred_location` parsing. No existing behavior changes.
- **No operator config, no API key, no new MCP server.** Open-Meteo requires no authentication.
