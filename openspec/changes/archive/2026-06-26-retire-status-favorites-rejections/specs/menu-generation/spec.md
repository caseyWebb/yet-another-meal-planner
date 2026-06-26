## MODIFIED Requirements

### Requirement: Discoveries are dispositioned conversationally

The agent SHALL let the user disposition discoveries through natural requests, mapping them to the favorites/rejections model: a "loved that one" request SHALL `toggle_favorite` the recipe; a "stop suggesting that" / "hide that" request SHALL `toggle_reject` it for the caller (or `reject_discovery` the URL when the candidate is not yet imported and is not corpus-worthy for the group); ready-to-eat items SHALL be dispositioned analogously via `update_ready_to_eat` (favorite / reject) against the caller's per-tenant catalog. There is no `draft` state and no de-prioritized-drafts behavior: an imported recipe is an available corpus recipe, and a non-imported discovery simply stays a discovery.

#### Scenario: A loved discovery is favorited

- **WHEN** the user says they loved a surfaced or just-imported recipe
- **THEN** the agent calls `toggle_favorite(slug, true)` for the caller, with no `status` or `rating` involved

#### Scenario: An unwanted ready-to-eat item is rejected

- **WHEN** the user says to stop suggesting a ready-to-eat item
- **THEN** the agent calls `update_ready_to_eat(slug, { reject: true })` in the caller's catalog, affecting no other member, with no `status` or `rating`

### Requirement: Menu-request context pre-pass

On a menu request, the agent SHALL gather all choice-independent context in a single parallel batch **before** settling on recipes. The batch SHALL always include: `read_pantry()`, `read_preferences()`, `read_taste()`, `read_diet_principles()`, `retrospective("month")`, `fetch_rss_discoveries()`, `read_discovery_inbox()`, `list_recipes()`, `get_weather_forecast()`, and `read_staples()` unconditionally (not gated on fulfillment mode). When the user's fulfillment mode is Kroger (`preferences [stores].primary == "kroger"`), the batch SHALL additionally include `kroger_flyer()`; for a non-Kroger store it SHALL be omitted and sale signals SHALL NOT influence recipe selection for that session. `ready_to_eat_available` is NOT called during the meal-plan flow — it is a buy-time tool used by the flush skills. `kroger_prices` is NOT issued in this batch; it is used only as a targeted deal-check for a handful of comparable items when verifying a specific sale claim during selection (see "Sale-steering as a soft selection pull"), and SHALL NOT be a full pre-pass over the proposed ingredient set — that costing belongs to the place-grocery-order flow. The `list_recipes()` call is the **single faceted load**: because `course` rides every entry's frontmatter, one call returns the available mains and sides with full metadata and the agent buckets them by `course` — there SHALL NOT be a separate later call to source sides. The recipe candidate set is the caller's **available corpus** — the whole shared corpus **minus the caller's rejects** — with no per-member "active set" to assemble and no `draft` recipes to surface separately (whether that candidate set is dumped in full via `list_recipes` or narrowed via `recipe_semantic_search` is the planner's choice and out of scope for this change). The **raw pantry** SHALL be loaded as a *selection* input — before recipes are chosen — so that what the member already has informs which recipes are proposed (and so the agent can spot inventory stand-ins by reasoning over it), not merely the post-selection buy list. There SHALL be no `verify_pantry_*` call: pantry matching, freshness, and inventory substitutions are the agent reasoning over the loaded pantry. The fulfillment mode SHALL be determined from the loaded preferences before the batch fires; if genuinely unknown, that is the one thing to confirm first. The weather tool is a best-effort read: when it returns `{ error: "forecast_unavailable" }`, `{ error: "no_location" }`, or any other structured error, the agent SHALL continue with season-based reasoning and SHALL NOT surface the failure to the user. `read_staples` returns `{ items: [] }` when absent — this is not a failure; staples-driven prompting is simply suppressed for that session.

#### Scenario: Open-ended request gathers all choice-independent context before proposing

- **WHEN** the user says "make me a menu" and their fulfillment mode is Kroger
- **THEN** the agent calls `read_pantry`, `read_preferences`, `read_taste`, `read_diet_principles`, `retrospective`, `fetch_rss_discoveries`, `read_discovery_inbox`, `kroger_flyer`, `list_recipes()`, `get_weather_forecast()`, and `read_staples()` in a single batch before presenting any proposal; `ready_to_eat_available` and a full-cart `kroger_prices` are NOT called here

#### Scenario: No activation gate on the candidate set

- **WHEN** the agent loads recipes for a menu request
- **THEN** it considers every non-rejected shared recipe (plus the caller's personal recipes), not a curated per-member active subset

#### Scenario: Non-Kroger session omits flyer and skips sale signals

- **WHEN** the user's `primary` store is a non-Kroger store slug
- **THEN** `kroger_flyer` is NOT called and sale data plays no role in recipe selection for that session

#### Scenario: One faceted load returns mains and sides together

- **WHEN** the up-front batch runs
- **THEN** the single `list_recipes()` result carries `course` on every entry, the agent buckets it into mains and sides, and no separate side-sourcing `list_recipes` call is made later in the flow

#### Scenario: Pantry informs selection, not just the buy list

- **WHEN** the member has salmon and bok choy on hand and makes an open-ended request
- **THEN** the agent reasons over the loaded pantry to favor recipes that use what is already on hand, before finalizing the proposed set

#### Scenario: Pantry confirmation pass is not skipped

- **WHEN** any menu request is made
- **THEN** the agent runs the comprehensive pantry confirmation pass (including staples and spices) by reasoning over the loaded pantry, rather than proposing a menu without considering pantry state

#### Scenario: Weather forecast is included in the pre-pass batch

- **WHEN** the user makes a menu request
- **THEN** `get_weather_forecast()` is called in the parallel context batch alongside `read_pantry`, `read_preferences`, etc., before any recipe is selected

#### Scenario: Forecast failure does not break the menu flow

- **WHEN** `get_weather_forecast()` returns an error (any error variant)
- **THEN** the agent continues with season-based recipe selection and does not tell the user the weather lookup failed

#### Scenario: Absent staples list does not break the menu flow

- **WHEN** `read_staples()` returns `{ items: [] }` because the member has no `staples.toml`
- **THEN** the agent continues without staples-driven prompting; no error is surfaced
