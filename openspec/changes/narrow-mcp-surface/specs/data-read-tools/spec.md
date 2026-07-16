# data-read-tools — delta

## ADDED Requirements

### Requirement: read_user_profile carries a server-computed attention block

`read_user_profile()` SHALL include an `attention` object computed deterministically in the Worker from existing per-tenant data: `retrospective_due` (boolean — true when the caller's cooking log is non-empty AND `profile.last_retrospective_at` is NULL or older than the due threshold, 42 days), `unverified_perishables` (number — pantry rows in the perishable categories `produce | dairy | seafood | meat` whose `last_verified_at` is NULL or older than the 7-day staleness threshold, the member app's needs-verification rule), and `stale_areas` (string[] — the existing onboarding-area `missing` derivation). The computation SHALL make no AI call and no write; it rides the profile assembly's existing batched reads plus bounded aggregate queries. The `retrospective` tool and the member retrospective endpoints SHALL stamp `profile.last_retrospective_at` (today's date) on each read — the `last_planned_at` watermark precedent — without any other mutation. The member API's profile read (the same assembly) SHALL carry the same block.

#### Scenario: A neglected retrospective surfaces as due

- **WHEN** a member with cooking history has never read a retrospective (watermark NULL) and calls `read_user_profile`
- **THEN** `attention.retrospective_due` is `true`

#### Scenario: Reading the retrospective resets the nudge

- **WHEN** the member's `retrospective` tool runs and `read_user_profile` is called the next day
- **THEN** `last_retrospective_at` was stamped and `attention.retrospective_due` is `false`

#### Scenario: Long-unverified perishables are counted, not listed

- **WHEN** three produce/dairy pantry rows have `last_verified_at` older than 7 days
- **THEN** `attention.unverified_perishables` is `3`, computed with no AI call and no write

#### Scenario: An empty profile degrades cleanly

- **WHEN** a brand-new tenant with no pantry, no cooking log, and no watermark calls `read_user_profile`
- **THEN** `attention` is `{ retrospective_due: false, unverified_perishables: 0, stale_areas: [...] }` with `stale_areas` equal to the onboarding `missing` areas, and nothing errors

## REMOVED Requirements

### Requirement: recipe_site_url resolves the hosted browse URL at runtime

**Reason**: The tool leaves the member MCP surface in the surface cull. The cookbook site and the member app's recipe detail remain the browse/share surfaces; the member app links them natively, and the persona no longer hands out URLs from chat.
**Migration**: No tool successor. The Worker-served `/cookbook` site and the member app `/recipe/<slug>` pages (and their lens rules, owned by `shared-corpus`/`member-app-core`) are unchanged; the URL-resolution helper is deleted with its registration.

### Requirement: get_weather_forecast returns a daily forecast with meal_vibes hints

**Reason**: Weather is engine context, not an agent verb. The shared propose operation already loads the tenant forecast server-side (`resolveTenantForecast`), and the persona was already forbidden from narrating weather; a model-visible forecast tool only invites narration and misuse.
**Migration**: `propose_meal_plan` (and the member app's propose surface) keep loading the forecast internally through the same shared operation, exposed to the member app via `GET /api/propose/weather` (`member-app-propose`). The location-resolution order, structured errors, and Worker-derived hint thresholds live on in that operation.
