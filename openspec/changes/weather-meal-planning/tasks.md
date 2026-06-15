## 1. `src/weather.ts` — Open-Meteo fetch + `meal_vibes` derivation

- [ ] 1.1 Add `fetchWeatherForecast(zip: string, days: number): Promise<WeatherForecast | WeatherError>` to a new `src/weather.ts`. Make two sequential fetches: (a) Open-Meteo geocoding (`https://geocoding-api.open-meteo.com/v1/search?name=<zip>&count=1&language=en&format=json`) to resolve `{ latitude, longitude, name, admin1 }`; (b) Open-Meteo daily forecast (`https://api.open-meteo.com/v1/forecast?...daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&temperature_unit=fahrenheit&forecast_days=<days>&timezone=auto`). Return a structured `{ error: "forecast_unavailable" }` on any non-200 or network failure; `{ error: "no_results" }` when geocoding returns an empty result set. Clamp `days` to 1–16 before the fetch.
- [ ] 1.2 Add `deriveVibes(highF: number, precipChance: number): string[]` — pure function that applies the threshold rules from design D3:
  - `precipChance >= 60` → push `no-grill`, `comfort`
  - `highF < 55` → push `soup`; push `comfort` if not already present
  - `highF >= 80 && precipChance < 30` → push `grill-friendly`
  - `highF >= 85` → push `light`
  Returns an empty array when no threshold fires.
- [ ] 1.3 Export `WeatherForecast` type: `{ location: string; forecast: Array<{ date: string; high_f: number; low_f: number; precipitation_chance: number; condition: string; meal_vibes: string[] }> }`. Map WMO weather codes to a `condition` string (`clear`, `partly_cloudy`, `overcast`, `rainy`, `snowy`, `stormy`) using a compact lookup table in `src/weather.ts`.
- [ ] 1.4 Add unit tests in `test/weather.test.ts` covering: `deriveVibes` for each threshold branch (cold+dry, hot+sunny, rainy, neutral); WMO code mapping for a representative set; `fetchWeatherForecast` with mocked fetch responses for the happy path, geocoding empty-result, and a non-200 forecast response.

## 2. `get_weather_forecast` tool

- [ ] 2.1 Add `get_weather_forecast` to `src/tools.ts` using the **prefixed (per-tenant) client** to read preferences (for `location_zip` and `preferred_location`). Parse: check `preferences.location_zip` first; fall back to extracting a 5-digit ZIP from `preferred_location` via `/\b(\d{5})\b/`; if neither yields a ZIP, return `{ error: "no_location" }`. On success, call `fetchWeatherForecast(zip, days)` and return its result or structured error.
- [ ] 2.2 Zod input schema: `{ days?: number }` — optional, defaults to 7 in the implementation.
- [ ] 2.3 Add a tool-level test in `test/tools.test.ts` (or a dedicated `test/weather-tool.test.ts`): location from `location_zip`; location parsed from `preferred_location`; `no_location` when both absent; `forecast_unavailable` forwarded from the fetch layer.

## 3. `AGENT_INSTRUCTIONS.md` — meal-plan flow update

- [ ] 3.1 In the `### Meal plan` skill's context pre-pass step (step 1), add `get_weather_forecast` to the parallel batch alongside `read_pantry`, `read_preferences`, `read_taste`, etc. The call is unconditional (not gated on fulfillment mode).
- [ ] 3.2 Add a brief paragraph to the meal-plan reasoning step (after context loads, before proposal assembly) instructing the agent to: for each `planned_for` date in the proposed plan, consult the matching forecast entry's `meal_vibes` and weight recipe selection accordingly — avoid `grill`-tagged or grill-style recipes on `no-grill` days, prefer `soup` / `stew` / comfort-food recipes on `soup`/`comfort` days, prefer lighter meals on `light` days. This weighting is **a soft nudge** — it does not filter or exclude. If `get_weather_forecast` returns an error, continue without weather context (season-based reasoning applies).
- [ ] 3.3 Do NOT add any instruction to mention weather to the user unprompted. The guidance should be framed as silent reasoning context.
- [ ] 3.4 In the `### Configure grocery profile` flow, add a note that `location_zip` can be derived from `preferred_location`; the agent SHALL only ask for a standalone ZIP if `preferred_location` is absent or contains no parseable 5-digit code.
- [ ] 3.5 Run `npm run build:plugin` to regenerate the `plugin/grocery-agent/` bundle from source.

## 4. Docs

- [ ] 4.1 Add a `get_weather_forecast(days?)` entry to `docs/TOOLS.md` under a new "Weather tools" (or "Context tools") section: params (`days?` number, default 7, max 16), returns (`WeatherForecast` shape including `forecast[].meal_vibes`), errors (`no_location` | `forecast_unavailable` | `no_results`), and a note that the tool reads `preferences.location_zip` with fallback parse of `preferred_location`.
- [ ] 4.2 Add `location_zip` to the `preferences.toml` schema in `docs/SCHEMAS.md` (optional string, 5-digit US ZIP or city name; used as the weather-lookup location; derived automatically from `preferred_location` when absent).

## 5. Verify

- [ ] 5.1 `npm run typecheck`, `npm test` (Worker/vitest) all green.
- [ ] 5.2 `npm run build:plugin` (connector URL only) and `node scripts/build-plugin.mjs --check` pass.
- [ ] 5.3 Manual smoke: call `get_weather_forecast` against the live Worker with a known ZIP and verify the `forecast` array and `meal_vibes` values look correct for current conditions.
