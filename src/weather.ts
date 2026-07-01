// Weather forecast fetch + meal_vibes derivation (menu-generation capability).
// Calls Open-Meteo (free, no API key) via two sequential requests:
//   1. Geocoding: location string → { lat, lon, city }
//   2. Forecast: { lat, lon } → daily high/low, precipitation, WMO weather code
// `deriveVibes` is a pure function — exported for unit tests.

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

export interface WeatherDay {
  date: string;
  high_f: number;
  low_f: number;
  precipitation_chance: number;
  condition: string;
  meal_vibes: string[];
}

export interface WeatherForecast {
  location: string;
  forecast: WeatherDay[];
}

export type WeatherError =
  | { error: "forecast_unavailable" }
  | { error: "no_results" }
  | { error: "no_location" };

// WMO weather interpretation codes → condition label.
// https://open-meteo.com/en/docs#weathervariables
const WMO_CONDITION: Record<number, string> = {
  0: "clear",
  1: "clear",
  2: "partly_cloudy",
  3: "overcast",
  45: "overcast",
  48: "overcast",
  51: "rainy",
  53: "rainy",
  55: "rainy",
  56: "rainy",
  57: "rainy",
  61: "rainy",
  63: "rainy",
  65: "rainy",
  66: "rainy",
  67: "rainy",
  71: "snowy",
  73: "snowy",
  75: "snowy",
  77: "snowy",
  80: "rainy",
  81: "rainy",
  82: "rainy",
  85: "snowy",
  86: "snowy",
  95: "stormy",
  96: "stormy",
  99: "stormy",
};

export function wmoToCondition(code: number): string {
  return WMO_CONDITION[code] ?? "partly_cloudy";
}

/** Derive meal planning hints from a day's high temperature and precipitation chance. */
export function deriveVibes(highF: number, precipChance: number): string[] {
  const vibes: string[] = [];
  if (precipChance >= 60) {
    vibes.push("no-grill", "comfort");
  }
  if (highF < 55) {
    vibes.push("soup");
    if (!vibes.includes("comfort")) vibes.push("comfort");
  }
  if (highF >= 80 && precipChance < 30) {
    vibes.push("grill-friendly");
  }
  if (highF >= 85) {
    vibes.push("light");
  }
  return vibes;
}

/**
 * The discrete, mutually-exclusive weather CATEGORY set `weather-bucket-planning` allocates slot
 * quotas over. Every forecast day collapses to exactly one of these (never several) — `mild` is
 * the no-strong-signal default. Distinct from `deriveVibes`' graded tag set: a category is a
 * single classification for a day, not a bag of hints.
 */
export type WeatherCategory = "grill" | "cold-comfort" | "wet" | "mild";

/** Every non-`mild` category — the buckets a night vibe can declare membership in. */
export const WEATHER_BUCKETS: readonly WeatherCategory[] = ["grill", "cold-comfort", "wet"];

/**
 * Collapse ONE forecast day's `meal_vibes` (from `deriveVibes`) into exactly one discrete
 * `WeatherCategory`, via a fixed priority order — never a union, never a function of any other
 * day. Priority (highest first):
 *   1. `no-grill` (rain-driven)               → `wet`
 *   2. `soup` (cold-driven)                    → `cold-comfort`
 *   3. `grill-friendly` or `light` (hot/dry)   → `grill`
 *   4. otherwise                               → `mild`
 * `condition` is accepted for forward-compatibility (a future tie-break) but the current rule is
 * driven entirely by `mealVibes`.
 */
export function deriveCategory(mealVibes: string[], condition?: string): WeatherCategory {
  void condition; // not currently a tie-break input; kept for signature stability
  if (mealVibes.includes("no-grill")) return "wet";
  if (mealVibes.includes("soup")) return "cold-comfort";
  if (mealVibes.includes("grill-friendly") || mealVibes.includes("light")) return "grill";
  return "mild";
}

/** Convenience: derive a `WeatherDay`'s category straight from its `meal_vibes`/`condition`. */
export function dayCategory(day: Pick<WeatherDay, "meal_vibes" | "condition">): WeatherCategory {
  return deriveCategory(day.meal_vibes, day.condition);
}

/** Fetch a daily weather forecast for a location string (ZIP or city name). */
export async function fetchWeatherForecast(
  location: string,
  days: number,
  fetchImpl: typeof fetch = fetch,
): Promise<WeatherForecast | WeatherError> {
  const clampedDays = Math.max(1, Math.min(16, days));

  // Step 1: geocode the location string → lat/lon
  const geoParams = new URLSearchParams({
    name: location,
    count: "1",
    language: "en",
    format: "json",
  });
  let geoJson: { results?: { latitude: number; longitude: number; name: string; admin1?: string }[] };
  try {
    const geoRes = await fetchImpl(`${GEOCODING_URL}?${geoParams}`);
    if (!geoRes.ok) return { error: "forecast_unavailable" };
    geoJson = (await geoRes.json()) as typeof geoJson;
  } catch {
    return { error: "forecast_unavailable" };
  }

  const place = geoJson.results?.[0];
  if (!place) return { error: "no_results" };

  const cityLabel = [place.name, place.admin1].filter(Boolean).join(", ");

  // Step 2: fetch daily forecast
  const forecastParams = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode",
    temperature_unit: "fahrenheit",
    forecast_days: String(clampedDays),
    timezone: "auto",
  });
  let forecastJson: {
    daily?: {
      time: string[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      precipitation_probability_max: number[];
      weathercode: number[];
    };
  };
  try {
    const forecastRes = await fetchImpl(`${FORECAST_URL}?${forecastParams}`);
    if (!forecastRes.ok) return { error: "forecast_unavailable" };
    forecastJson = (await forecastRes.json()) as typeof forecastJson;
  } catch {
    return { error: "forecast_unavailable" };
  }

  const daily = forecastJson.daily;
  if (!daily?.time?.length) return { error: "forecast_unavailable" };

  const forecast: WeatherDay[] = daily.time.map((date, i) => {
    const highF = daily.temperature_2m_max[i] ?? 70;
    const lowF = daily.temperature_2m_min[i] ?? 55;
    const precipChance = daily.precipitation_probability_max[i] ?? 0;
    const code = daily.weathercode[i] ?? 0;
    return {
      date,
      high_f: Math.round(highF),
      low_f: Math.round(lowF),
      precipitation_chance: precipChance,
      condition: wmoToCondition(code),
      meal_vibes: deriveVibes(highF, precipChance),
    };
  });

  return { location: cityLabel, forecast };
}
