## RENAMED Requirements

- FROM: `### Requirement: Sale-steering as a soft selection pull (Kroger only)`
- TO: `### Requirement: Sale-steering as a soft selection pull`

## MODIFIED Requirements

### Requirement: Menu-request context pre-pass

On a menu request, the agent SHALL gather all choice-independent context in a single parallel batch **before** selecting recipes, but SHALL NOT load the whole corpus. The batch SHALL always include: `read_pantry()`, `read_user_profile()`, `retrospective("month")`, `list_new_for_me()` (the background sweep's discoveries for the caller — replacing the retired `fetch_rss_discoveries`/`read_discovery_inbox` pull), and `get_weather_forecast()` unconditionally (not gated on fulfillment mode). It SHALL NOT include a whole-corpus `search_recipes` membership load — recipe selection is done by **bounded retrieval** (vibe-bearing `search_recipes` specs for open-ended weeks; a vibe-less `query` spec for a named dish), issued after the context is in hand, not by dumping every recipe into context. `read_user_profile()` returns preferences, taste, diet_principles, kitchen, staples, stockup, and ready_to_eat in one call — there is no need for separate `read_preferences`, `read_taste`, `read_diet_principles`, or `read_staples` calls. When the caller's **primary fulfillment store has a warmed flyer**, the batch SHALL additionally include the **store-aware flyer read** — `kroger_flyer()` when the primary store is Kroger, `store_flyer()` when it is a satellite-scanned store — so satellite-scanned sales feed selection the same way Kroger sales do; when the primary store has no warmed flyer (no Kroger rollup and no satellite scan), the flyer read SHALL be omitted and sale signals SHALL NOT influence recipe selection for that session. `ready_to_eat_available` is NOT called during the meal-plan flow — it is a buy-time tool used by the flush skills. `kroger_prices` is NOT issued in this batch; it is used only as a targeted deal-check for a handful of comparable items when verifying a specific sale claim during selection, and SHALL NOT be a full pre-pass over the proposed ingredient set — that costing belongs to the place-grocery-order flow. The recipe candidate space is the caller's **available corpus** — the whole shared corpus **minus the caller's rejects**, with no per-member "active set" and no `draft` recipes — reached through `search_recipes` rather than loaded wholesale. The **raw pantry** SHALL be loaded as a *selection* input — before recipes are chosen — so that what the member already has informs which recipes are proposed (and so the agent can spot inventory stand-ins), and so its at-risk perishables can seed `boost_ingredients` on the use-it-up search. There SHALL be no `verify_pantry_*` call: pantry matching, freshness, and inventory substitutions are the agent reasoning over the loaded pantry. The fulfillment mode SHALL be determined from the loaded preferences before the batch fires; if genuinely unknown, that is the one thing to confirm first. The weather tool is a best-effort read: when it returns any structured error, the agent SHALL continue with season-based reasoning and SHALL NOT surface the failure to the user. An empty `read_user_profile().staples` array means no staples-driven prompting for that session — this is not a failure.

#### Scenario: Open-ended request gathers context but does not dump the corpus

- **WHEN** the user says "make me a menu" and their fulfillment mode is Kroger
- **THEN** the agent calls `read_pantry`, `read_user_profile`, `retrospective`, `list_new_for_me`, `kroger_flyer`, and `get_weather_forecast()` in a single batch before proposing; it does NOT issue a whole-corpus `search_recipes` membership load, `ready_to_eat_available`, a full-cart `kroger_prices`, `fetch_rss_discoveries`/`read_discovery_inbox`, or separate `read_preferences`/`read_taste`/`read_diet_principles`/`read_staples` calls; recipe candidates are obtained by bounded `search_recipes` retrieval afterward

#### Scenario: No activation gate on the candidate set

- **WHEN** the agent retrieves recipes for a menu request
- **THEN** the candidate space is every non-rejected shared recipe (plus the caller's personal recipes), not a curated per-member active subset

#### Scenario: A satellite-scanned store's sales feed selection the same way

- **WHEN** the caller's `primary` store is a non-Kroger store slug that has a warmed satellite scan
- **THEN** the batch includes `store_flyer()` for that store and its sales inform recipe selection the same way a Kroger flyer would, rather than being omitted

#### Scenario: A store with no warmed flyer omits sale signals

- **WHEN** the caller's primary store has neither a Kroger rollup nor a satellite scan
- **THEN** the flyer read is omitted and sale data plays no role in recipe selection for that session

#### Scenario: Pantry informs selection, not just the buy list

- **WHEN** the member has salmon and bok choy on hand and makes an open-ended request
- **THEN** the agent reasons over the loaded pantry to favor recipes that use what is already on hand (passing at-risk items as `boost_ingredients` on the use-it-up search), before finalizing the proposed set

#### Scenario: Pantry confirmation pass is not skipped

- **WHEN** any menu request is made
- **THEN** the agent runs the comprehensive pantry confirmation pass (including staples and spices) by reasoning over the loaded pantry, rather than proposing a menu without considering pantry state

#### Scenario: Weather forecast is included in the pre-pass batch

- **WHEN** the user makes a menu request
- **THEN** `get_weather_forecast()` is called in the parallel context batch alongside `read_pantry`, `read_user_profile`, etc., before any recipe is selected

#### Scenario: Forecast failure does not break the menu flow

- **WHEN** `get_weather_forecast()` returns an error (any error variant)
- **THEN** the agent continues with season-based recipe selection and does not tell the user the weather lookup failed

#### Scenario: Absent staples list does not break the menu flow

- **WHEN** `read_user_profile().staples` returns `[]` because the member has no staples in D1
- **THEN** the agent continues without staples-driven prompting; no error is surfaced

### Requirement: Sale-steering as a soft selection pull

When the caller's primary store surfaced a sale (Kroger via `kroger_flyer`, or a satellite-scanned store via `store_flyer`), the agent MAY let a genuine deal act as a **soft pull** toward recipes that use the discounted ingredient — weaker than expiry-matching but real. Before a flyer sale steers the menu, the agent SHALL verify the deal is actually cheap: for a **Kroger** store it SHALL call `kroger_prices` on a small set of standard alternatives, rank by `compare_unit_price`, and count the deal as real only if the sale item wins on **unit price** (not just on its own percent-off discount, which may merely bring a premium brand in line with a standard brand's everyday price); for a **satellite-scanned** store — where no live cross-brand price API is available — it SHALL rely on the Worker-re-derived saving already reflected in `store_flyer` (the raw `{ regular, promo }` markdown clearing the deal floor), steering more conservatively and never on a percent-off figure it did not itself observe. Any `kroger_prices` use here is a **targeted deal-check on a handful of comparable items** — it SHALL NOT be a price-the-whole-proposed-list pass.

#### Scenario: A Kroger sale is verified against comparable unit prices before steering the menu

- **WHEN** a Kroger flyer item shows a percent-off discount
- **THEN** the agent checks it against comparable-item unit prices via `kroger_prices` before treating the sale as a selection pull, and does not steer on discount percentage alone

#### Scenario: A satellite-scanned sale steers on the re-derived markdown

- **WHEN** a satellite-scanned store's `store_flyer` surfaces a sale (no `kroger_prices` API available for that store)
- **THEN** the agent steers only on the Worker-re-derived saving that already cleared the deal floor, conservatively, without a cross-brand unit-price check it cannot perform

#### Scenario: Sale check is targeted, not a full-cart price pass

- **WHEN** the agent verifies a Kroger sale claim during selection
- **THEN** the `kroger_prices` call covers only the handful of items being compared — not the entire proposed grocery list
