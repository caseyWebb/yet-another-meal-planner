## MODIFIED Requirements

### Requirement: Menu-request context pre-pass

On a menu request, the agent SHALL gather all choice-independent context in a single parallel batch **before** selecting recipes, but SHALL NOT load the whole corpus. The batch SHALL always include: `read_pantry()`, `read_user_profile()`, `retrospective("month")`, `list_new_for_me()` (the background sweep's discoveries for the caller — replacing the retired `fetch_rss_discoveries`/`read_discovery_inbox` pull), and `get_weather_forecast()` unconditionally (not gated on fulfillment mode). It SHALL NOT include a whole-corpus `search_recipes` membership load — recipe selection is done by **bounded retrieval** (vibe-bearing `search_recipes` specs for open-ended weeks; a vibe-less `query` spec for a named dish), issued after the context is in hand, not by dumping every recipe into context. `read_user_profile()` returns preferences, taste, diet_principles, kitchen, staples, and stockup in one call — there is no need for separate `read_preferences`, `read_taste`, `read_diet_principles`, or `read_staples` calls. When the caller's **primary fulfillment store has a warmed flyer**, the batch SHALL additionally include the **store-aware flyer read** — `kroger_flyer()` when the primary store is Kroger, `store_flyer()` when it is a satellite-scanned store — so satellite-scanned sales feed selection the same way Kroger sales do; when the primary store has no warmed flyer (no Kroger rollup and no satellite scan), the flyer read SHALL be omitted and sale signals SHALL NOT influence recipe selection for that session. `kroger_prices` is NOT issued in this batch; it is used only as a targeted deal-check for a handful of comparable items when verifying a specific sale claim during selection, and SHALL NOT be a full pre-pass over the proposed ingredient set — that costing belongs to the place-grocery-order flow. The recipe candidate space is the caller's **available corpus** — the whole shared corpus **minus the caller's rejects**, with no per-member "active set" and no `draft` recipes — reached through `search_recipes` rather than loaded wholesale. The **raw pantry** SHALL be loaded as a *selection* input — before recipes are chosen — so that what the member already has informs which recipes are proposed (and so the agent can spot inventory stand-ins), and so its at-risk perishables can seed `boost_ingredients` on the use-it-up search. There SHALL be no `verify_pantry_*` call: pantry matching, freshness, and inventory substitutions are the agent reasoning over the loaded pantry. The fulfillment mode SHALL be determined from the loaded preferences before the batch fires; if genuinely unknown, that is the one thing to confirm first. The weather tool is a best-effort read: when it returns any structured error, the agent SHALL continue with season-based reasoning and SHALL NOT surface the failure to the user. An empty `read_user_profile().staples` array means no staples-driven prompting for that session — this is not a failure.

#### Scenario: Open-ended request gathers context but does not dump the corpus

- **WHEN** the user says "make me a menu" and their fulfillment mode is Kroger
- **THEN** the agent calls `read_pantry`, `read_user_profile`, `retrospective`, `list_new_for_me`, `kroger_flyer`, and `get_weather_forecast()` in a single batch before proposing; it does NOT issue a whole-corpus `search_recipes` membership load, a full-cart `kroger_prices`, `fetch_rss_discoveries`/`read_discovery_inbox`, or separate `read_preferences`/`read_taste`/`read_diet_principles`/`read_staples` calls; recipe candidates are obtained by bounded `search_recipes` retrieval afterward

#### Scenario: No activation gate on the candidate set

- **WHEN** the agent retrieves recipes for a menu request
- **THEN** the candidate space is every non-rejected shared recipe (plus the caller's personal recipes), not a curated per-member active subset

#### Scenario: A satellite-scanned store's sales feed selection the same way

- **WHEN** the caller's `primary` store is a non-Kroger store slug that has a warmed satellite scan
- **THEN** the batch includes `store_flyer()` for that store and its sales inform recipe selection the same way a Kroger flyer would, rather than being omitted

### Requirement: Full proposal assembly

The agent SHALL assemble a menu proposal by **driving `propose_meal_plan`** with an ephemeral vibe set distilled from the gathered context and the user's original message (the `meal-plan-proposal` capability), then layering narration over the returned proposal — it SHALL NOT hand-compose the week by selecting recipes over a retrieved union itself. The distillation SHALL incorporate, when applicable, freeform constraints (mood/cuisine/effort such as "comfort food," "something Italian," "I'm feeling lazy") as vibe phrases, hard exclusions as facets, and each entry's **`meal`** when the request is meal-specific (an omitted `meal` defaults to dinner). The narration layered over the proposal SHALL incorporate, when applicable: recipe notes surfaced from `read_recipe_notes` (tweaks worth baking in, warnings, group ratings); meal-prep callouts for `meal_preppable` recipes; **inventory substitutions** spotted by reasoning over the loaded pantry (a stand-in the member already has for a missing ingredient, surfaced during the pantry pass for confirmation before the item reaches the buy list); a **staples-backed restocking callout** (cross-referencing the `staples` array from `read_user_profile()` against pantry — missing or low staples are surfaced and confirmed before being added to the list; perishable staples with a stale `last_verified_at` are batched into a staleness nudge); and — **Kroger sessions only** — sale-based substitution opportunities (surfaced after flyer/price data is available, substitute candidates enumerated from world knowledge and verified via `kroger_prices`/`kroger_flyer`) and stockup alerts for bulk-buy items on sale. The proposal SHALL be sized from the member's **per-meal `cadence` map** (from `read_user_profile().preferences.cadence`) unless the user specified otherwise — passed as the `meals` input to `propose_meal_plan` (a meal the user didn't ask about and whose cadence is 0 gets no slots). When a requested meal comes back as explicit empty slots (`empty_reason: "no_palette_for_meal"`), the agent SHALL surface the nudge — offer to add a meal vibe for that meal (`add_meal_vibe`) or author an `ephemeral_vibes` entry carrying that `meal` — rather than silently re-proposing dinner.

#### Scenario: Recipe notes are surfaced with the proposal

- **WHEN** the chosen recipes have notes from `read_recipe_notes`
- **THEN** the proposal surfaces the relevant ones — a tweak worth baking in, a warning worth a late swap, positive group signal — not a full transcript of every note

#### Scenario: Inventory substitution is spotted from the loaded pantry

- **WHEN** a chosen recipe calls for salmon, salmon is in `not_in_pantry`, and the loaded pantry contains trout
- **THEN** the agent offers the trout as a stand-in for confirmation during the pantry pass, and on acceptance the salmon is not added to the buy list

#### Scenario: Freeform constraint shapes the ephemeral vibe set

- **WHEN** the user says "something comforting, I'm feeling lazy this week"
- **THEN** the agent distills a comforting, low-effort ephemeral vibe set (and any facet gates) passed to `propose_meal_plan`, then runs the pantry pass and restock list over the returned proposal

### Requirement: Discoveries are dispositioned conversationally

The agent SHALL let the user disposition discoveries through natural requests, mapping them to the favorites/rejections model: a "loved that one" request SHALL `toggle_favorite` the recipe; a "stop suggesting that" / "hide that" request SHALL `toggle_reject` it for the caller. Because discoveries are now auto-imported by the background sweep (there is no pre-import candidate for a member to triage in-conversation), a "stop suggesting that" disposition on a surfaced recipe is `toggle_reject` (per-tenant); `reject_discovery` is reserved for group-wide suppression of a discovery **source** (see the `recipe-discovery` capability), not a per-conversation disposition of a surfaced recipe. There is no `draft` state: an imported recipe is an available corpus recipe.

#### Scenario: A loved discovery is favorited

- **WHEN** the user says they loved a surfaced or imported recipe
- **THEN** the agent calls `toggle_favorite(slug, true)` for the caller, with no `status` or `rating` involved

#### Scenario: A surfaced recipe the member dislikes is toggle_reject, not reject_discovery

- **WHEN** the user says to stop suggesting a recipe surfaced by `list_new_for_me`
- **THEN** the agent calls `toggle_reject(slug)` for the caller (hiding it for them, leaving it for others), not `reject_discovery`
