## Context

The menu-generation flow's context pre-pass loads pantry, taste, preferences, diet, cooking history, discovery pools, and (in Kroger mode) the flyer — but no weather signal. The `season` field on recipes captures calendar season (`spring | summer | fall | winter`) and is already filterable via `list_recipes({ season })`, but calendar season ≠ actual conditions. A mid-summer cold snap, a rainy weekend, a late-October heat wave: the `season` tag knows none of it.

What we need is already in reach:
- `planned_for` dates anchor each proposed recipe to a specific day.
- The user's ZIP is derivable from `preferred_location = "Kroger - 76104"` (or stored explicitly in the new `location_zip` field).
- Open-Meteo (`open-meteo.com`) provides a free, unauthenticated, global forecast API that returns daily high/low temperatures, precipitation probability, and a WMO weather-code condition.

## Goals / Non-Goals

**Goals:**
- The agent naturally steers toward weather-appropriate meals without the user having to describe the forecast.
- Location is resolved from existing preferences — the user is never asked for their location again if it's already derivable.
- No operator setup, no API key, no new MCP server dependency.
- Weather signal is a soft, behind-the-scenes influence on recipe-to-day matching.

**Non-Goals:**
- No hard-filtering recipes based on weather; weather hints never exclude a recipe.
- No surfacing weather data, forecast summaries, or weather-based reasoning to the user (unless they ask).
- No hourly granularity — daily high/low + precipitation chance is sufficient for meal planning.
- No change to the `season` field or `list_recipes` season filter behavior.
- No new MCP server; the tool lives in the existing grocery-mcp Worker.

## Decisions

### D1 — Location resolution: `location_zip` → parse `preferred_location` → structured error

```
get_weather_forecast()
  1. Read preferences.location_zip              ← clean stored value; fast path
  2. Parse preferred_location with /\b(\d{5})\b/  ← "Kroger - 76104" → "76104"
  3. Neither found → { error: "no_location" }
```

The onboarding convention writes `preferred_location` as `"Kroger - <zip>"`, so step 2 succeeds for any normally-onboarded member. The `location_zip` field is optional and acts as an explicit override or a future non-US fallback. The tool itself never writes preferences — it is a pure read. When `no_location` is returned, the agent asks the user once and writes `location_zip` via `update_preferences`.

- **Alternative — a mandatory `location_zip` in onboarding:** rejected. It would require every existing member to re-onboard; the fallback parse gives the same result with no disruption.
- **Alternative — derive from Kroger locationId:** the Kroger `locationId` is an opaque numeric string (not a ZIP) once resolved; deriving a postal location from it would require a reverse-lookup not worth the complexity.

### D2 — Open-Meteo as the weather provider

Two sequential API calls:
1. `https://geocoding-api.open-meteo.com/v1/search?name=<zip>&count=1&language=en&format=json` → `{ results: [{ latitude, longitude, name, admin1 }] }`
2. `https://api.open-meteo.com/v1/forecast?latitude=<lat>&longitude=<lon>&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&temperature_unit=fahrenheit&forecast_days=<days>&timezone=auto` → `{ daily: { time[], temperature_2m_max[], temperature_2m_min[], precipitation_probability_max[], weathercode[] } }`

Rationale:
- **Free, no API key, no account.** Zero operator setup.
- **Global coverage.** Works for non-US members; NWS/NOAA is US-only.
- **Cloudflare Workers fetch budget.** Two lightweight JSON calls, well within the free tier.
- **Stable, versioned API.** Open-Meteo has a public SLA and a stable v1 endpoint.

Error handling: a non-200 response or a network failure returns `{ error: "forecast_unavailable" }`. The agent falls back to season-based reasoning silently.

### D3 — `meal_vibes` derived deterministically in the Worker

The Worker translates raw forecast numbers into a string-array `meal_vibes` field per day. The LLM gets clean labels; it doesn't re-derive thresholds from raw degrees and percentages each call.

Threshold rules (applied in order, additive):

| Condition | `meal_vibes` appended |
|---|---|
| `precipitation_probability_max >= 60` | `no-grill`, `comfort` |
| `temperature_2m_max < 55°F` | `soup`, `comfort` (if not already) |
| `temperature_2m_max >= 80 AND precipitation_probability_max < 30` | `grill-friendly` |
| `temperature_2m_max >= 85` | `light` |

An empty `meal_vibes` array means "no strong signal either way" — the agent treats it as neutral.

`comfort` is deduplicated (cold AND rainy doesn't add it twice). The thresholds are conservative and intentionally coarse — this is a nudge, not a classifier.

### D4 — Soft hints, not hard gates

`meal_vibes` is reasoning context, not a filter. The agent MAY weight toward `no-grill` on rainy days and toward `grill-friendly` on sunny ones, but it SHALL NOT reject a recipe purely because of weather. A user who asks for "burgers on Tuesday" when rain is forecast gets burgers — the weather signal is a default nudge, never an override of expressed preference.

This is consistent with how the flyer's sale signals work: a soft pull, not a hard reorder.

### D5 — Silent reasoning

The agent SHALL NOT narrate weather-based reasoning to the user unless the user explicitly asks about it (e.g. "why did you pick soup?" or "is it going to rain this week?"). The meal-plan proposal reads like a normal plan. The weather signal is infrastructure, not a conversational feature.

This matches the existing pattern for sale-steering: the flyer nudges recipe selection, but the agent doesn't open with "I noticed chicken thighs are on sale."

### D6 — `days` parameter defaults to 7; capped at 16

Open-Meteo supports up to 16 forecast days. The tool defaults to 7 (one week, sufficient for weekly meal planning). The caller can pass `days` up to 16 to support a two-week plan. Values outside 1–16 are clamped silently.

### D7 — Tool lives in `src/tools.ts` with implementation in `src/weather.ts`

Following the pattern of other multi-step read tools (`src/kroger.ts`, `src/discovery.ts`): business logic in a dedicated module, thin tool-binding in `src/tools.ts`. `src/weather.ts` exports `fetchWeatherForecast(zip, days)` and the `deriveVibes(day)` helper. The tool reads preferences via the standard prefixed client to resolve location, then calls the pure `fetchWeatherForecast`.

## Risks / Trade-offs

- **[Open-Meteo downtime]** → structured `{ error: "forecast_unavailable" }`; the agent falls back to season-based selection. No hard dependency on uptime.
- **[ZIP geocodes to wrong city]** → Open-Meteo geocoding by 5-digit ZIP is accurate for US ZIPs; international members can set `location_zip` to a city name (Open-Meteo's geocoding accepts city names too). An inaccurate geocode produces a plausible-but-wrong forecast — acceptable for a soft hint.
- **[Member has no `preferred_location` and no `location_zip`]** → `no_location` error; agent asks once, stores. This only happens for a member who never completed store setup.
- **[Thresholds are US-centric (Fahrenheit)]** → Open-Meteo returns in Fahrenheit when requested; the thresholds are hardcoded in °F. International members experience the same logic. Could be localized later, but it's a soft hint either way.

## Open Questions

None blocking. Future follow-ups: per-user temperature unit preference (°C vs °F for display, if we ever surface weather to the user); caching the forecast for a session (currently one fetch per meal-plan invocation, which is fine given Open-Meteo's free tier).
