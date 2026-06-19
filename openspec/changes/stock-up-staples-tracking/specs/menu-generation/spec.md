## MODIFIED Requirements

### Requirement: Menu-request context pre-pass

On a menu request, the agent SHALL gather all choice-independent context in a single parallel batch **before** settling on recipes. The batch SHALL always include: `read_pantry()`, `read_preferences()`, `read_taste()`, `read_diet_principles()`, `retrospective("month")`, `fetch_rss_discoveries()`, `read_discovery_inbox()`, `list_recipes({ status: "active" })`, `get_weather_forecast()`, and `read_staples()` unconditionally (not gated on fulfillment mode). When the user's fulfillment mode is Kroger (`preferences [stores].primary == "kroger"`), the batch SHALL additionally include `kroger_flyer()`; for a non-Kroger store it SHALL be omitted and sale signals SHALL NOT influence recipe selection for that session. `ready_to_eat_available` is NOT called during the meal-plan flow — it is a buy-time tool used by the flush skills. `kroger_prices` is NOT issued in this batch; it is used only as a targeted deal-check for a handful of comparable items when verifying a specific sale claim during selection (see "Sale-steering as a soft selection pull"), and SHALL NOT be a full pre-pass over the proposed ingredient set — that costing belongs to the place-grocery-order flow. The `list_recipes` call is the **single faceted load**: because `course` rides every entry's frontmatter, one call returns active mains and sides with full metadata and the agent buckets them by `course` — there SHALL NOT be a separate later call to source sides. The **raw pantry** SHALL be loaded as a *selection* input — before recipes are chosen — so that what the member already has informs which recipes are proposed (and so the agent can spot inventory stand-ins by reasoning over it), not merely the post-selection buy list. There SHALL be no `verify_pantry_*` call: pantry matching, freshness, and inventory substitutions are the agent reasoning over the loaded pantry. The fulfillment mode SHALL be determined from the loaded preferences before the batch fires; if genuinely unknown, that is the one thing to confirm first. The weather tool is a best-effort read: when it returns `{ error: "forecast_unavailable" }`, `{ error: "no_location" }`, or any other structured error, the agent SHALL continue with season-based reasoning and SHALL NOT surface the failure to the user. `read_staples` returns `{ items: [] }` when absent — this is not a failure; staples-driven prompting is simply suppressed for that session.

#### Scenario: Open-ended request gathers all choice-independent context before proposing

- **WHEN** the user says "make me a menu" and their fulfillment mode is Kroger
- **THEN** the agent calls `read_pantry`, `read_preferences`, `read_taste`, `read_diet_principles`, `retrospective`, `fetch_rss_discoveries`, `read_discovery_inbox`, `kroger_flyer`, `list_recipes({ status: "active" })`, `get_weather_forecast()`, and `read_staples()` in a single batch before presenting any proposal; `ready_to_eat_available` and a full-cart `kroger_prices` are NOT called here

#### Scenario: Non-Kroger session omits flyer and skips sale signals

- **WHEN** the user's `primary` store is a non-Kroger store slug
- **THEN** `kroger_flyer` is NOT called and sale data plays no role in recipe selection for that session

#### Scenario: One faceted load returns mains and sides together

- **WHEN** the up-front batch runs
- **THEN** the single `list_recipes({ status: "active" })` result carries `course` on every entry, the agent buckets it into mains and sides, and no separate side-sourcing `list_recipes` call is made later in the flow

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

### Requirement: Full proposal assembly

The agent SHALL assemble a menu proposal that reasons over the gathered context and the user's original message, and SHALL incorporate, when applicable: freeform constraints (mood/cuisine/effort such as "comfort food," "something Italian," "I'm feeling lazy"); recipe notes surfaced from `read_recipe_notes` (tweaks worth baking in, warnings, group ratings); meal-prep callouts for `meal_preppable` recipes; **inventory substitutions** spotted by reasoning over the loaded pantry (a stand-in the member already has for a missing ingredient, surfaced during the pantry pass for confirmation before the item reaches the buy list); a **staples-backed restocking callout** (cross-referencing the loaded `read_staples` result against pantry — missing or low staples are surfaced and confirmed before being added to the list; perishable staples with a stale `last_verified_at` are batched into a staleness nudge); and — **Kroger sessions only** — sale-based substitution opportunities (surfaced after flyer/price data is available, substitute candidates enumerated from world knowledge and verified via `kroger_prices`/`kroger_flyer`) and stockup alerts for bulk-buy items on sale. The proposal SHALL be sized to the user's cooking frequency (`default_cooking_nights`) unless the user specified otherwise. Ready-to-eat options, on-sale RTE discovery, and restock-of-RTE-favorites are **not** part of the proposal — the no-cook-night offer comes after the plan is saved (see "Ready-to-eat no-cook night offer"), and on-sale RTE discovery and restock suggestions are buy-time concerns handled by the flush skills (place-grocery-order, shopping-list).

#### Scenario: Recipe notes are surfaced with the proposal

- **WHEN** the chosen recipes have notes from `read_recipe_notes`
- **THEN** the proposal surfaces the relevant ones — a tweak worth baking in, a warning worth a late swap, positive group signal — not a full transcript of every note

#### Scenario: Inventory substitution is spotted from the loaded pantry

- **WHEN** a chosen recipe calls for salmon, salmon is in `not_in_pantry`, and the loaded pantry contains trout
- **THEN** the agent offers the trout as a stand-in for confirmation during the pantry pass, and on acceptance the salmon is not added to the buy list

#### Scenario: Freeform constraint shapes selection

- **WHEN** the user says "something comforting, I'm feeling lazy this week"
- **THEN** the proposal biases toward comforting and low-effort/meal-preppable recipes while still running the pantry pass and proposing a restock list

#### Scenario: Staples restocking callout is backed by loaded staples data

- **WHEN** olive oil is in the member's staples list and absent from pantry
- **THEN** the agent includes olive oil in the restocking callout and confirms with the user before adding to the shopping list; model judgment is not the primary signal

#### Scenario: Perishable-staple staleness is batched into one nudge

- **WHEN** eggs and butter are both perishable staples with stale `last_verified_at` values
- **THEN** the agent surfaces them together in a single prompt ("I haven't seen you update eggs or butter recently — do you still have those?") rather than two separate questions

#### Scenario: No staples list — restocking callout falls back to model judgment

- **WHEN** the member has no `staples.toml` and a menu is requested
- **THEN** the restocking callout (if any) is based on model judgment, same as current behavior

#### Scenario: Sale substitutions appear with the proposal (Kroger), not during pantry verify

- **WHEN** a menu recipe calls for an ingredient whose substitute is on sale (Kroger session)
- **THEN** the sale-based substitution is surfaced alongside the menu proposal (after flyer data), with the substitute candidates enumerated by the agent and verified via the Kroger tools, not during the pantry confirmation pass

#### Scenario: Sale-based features are skipped for non-Kroger sessions

- **WHEN** the user's fulfillment mode is not Kroger
- **THEN** no sale-based substitutions and no stockup alerts are surfaced in the proposal

#### Scenario: Proposal sized to cooking frequency

- **WHEN** the user makes an open-ended request and `default_cooking_nights` is 3
- **THEN** the agent proposes 3 cooking nights (not 5 with extras), unless the user asked for a different count
