# member-app-propose — delta

## MODIFIED Requirements

### Requirement: Propose endpoints are thin adapters over the shared planner operation

The member app SHALL expose the propose surface as a session-gated `/api` route group calling shared operations extracted from the MCP tool closures — one operation running the full propose pipeline (context loads, per-meal week shaping, slot filling, assembly) called by both `propose_meal_plan` and `POST /api/propose`, and one resolving the tenant's preference-derived weather forecast (`resolveTenantForecast`) consumed by the propose pipeline server-side — there is no `get_weather_forecast` MCP tool and no client-side weather read; the forecast reaches the model only as the engine's silent context. The propose endpoint SHALL accept the tool's full input (the per-meal `meals` counts map with the window-scoped `nights` alias, `attendance`, seed, lock, exclude, boost ingredients, nudges, per-slot constraints, `ephemeral_vibes` with per-entry `meal`) and return the tool's result shape (meal-carrying slots, per-meal and attendance diagnostics), so the tool and the endpoint are **one contract** maintained in the same pass. The attendance **web control** is deferred (D29-final routes its design through the Claude Design project; band 2+) — the endpoint accepts the param now so the contract is fixed before any UI exists. Structured errors (including the weather `no_location` family) SHALL cross the HTTP boundary through the shared error middleware with their codes intact.

#### Scenario: The endpoint and the tool return the same proposal

- **WHEN** the same tenant sends the same propose input (same seed and vectors) to `POST /api/propose` and `propose_meal_plan`
- **THEN** both run the one shared operation and return the same result shape with the same chosen week

#### Scenario: The forecast is engine context, not a model verb

- **WHEN** the propose pipeline runs for a window
- **THEN** it loads the tenant forecast through the shared weather operation itself — no forecast tool appears on the MCP surface and the member app has no client-side weather read

#### Scenario: Weather errors stay structured across surfaces

- **WHEN** the weather operation cannot resolve a ZIP for the tenant
- **THEN** the structured `no_location` error crosses the member API boundary with its code intact, and the propose pipeline degrades to season-based reasoning exactly as before
