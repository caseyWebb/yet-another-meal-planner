## MODIFIED Requirements

### Requirement: Full proposal assembly

The agent SHALL assemble a menu proposal by **driving `propose_meal_plan`** with an ephemeral vibe set distilled from the gathered context and the user's original message (the `meal-plan-proposal` capability), then layering narration over the returned proposal — it SHALL NOT hand-compose the week by selecting recipes over a retrieved union itself. The distillation SHALL incorporate, when applicable, freeform constraints (mood/cuisine/effort such as "comfort food," "something Italian," "I'm feeling lazy") as vibe phrases and hard exclusions as facets. The narration layered over the proposal SHALL incorporate, when applicable: recipe notes surfaced from `read_recipe_notes` (tweaks worth baking in, warnings, group ratings); meal-prep callouts for `meal_preppable` recipes; **inventory substitutions** spotted by reasoning over the loaded pantry (a stand-in the member already has for a missing ingredient, surfaced during the pantry pass for confirmation before the item reaches the buy list); a **staples-backed restocking callout** (cross-referencing the `staples` array from `read_user_profile()` against pantry — missing or low staples are surfaced and confirmed before being added to the list; perishable staples with a stale `last_verified_at` are batched into a staleness nudge); and — **Kroger sessions only** — sale-based substitution opportunities (surfaced after flyer/price data is available, substitute candidates enumerated from world knowledge and verified via `kroger_prices`/`kroger_flyer`) and stockup alerts for bulk-buy items on sale. The proposal SHALL be sized to the user's cooking frequency (`default_cooking_nights`) unless the user specified otherwise — passed as the `nights` input to `propose_meal_plan`. Ready-to-eat options, on-sale RTE discovery, and restock-of-RTE-favorites are **not** part of the proposal.

#### Scenario: Recipe notes are surfaced with the proposal

- **WHEN** the chosen recipes have notes from `read_recipe_notes`
- **THEN** the proposal surfaces the relevant ones — a tweak worth baking in, a warning worth a late swap, positive group signal — not a full transcript of every note

#### Scenario: Inventory substitution is spotted from the loaded pantry

- **WHEN** a chosen recipe calls for salmon, salmon is in `not_in_pantry`, and the loaded pantry contains trout
- **THEN** the agent offers the trout as a stand-in for confirmation during the pantry pass, and on acceptance the salmon is not added to the buy list

#### Scenario: Freeform constraint shapes the ephemeral vibe set

- **WHEN** the user says "something comforting, I'm feeling lazy this week"
- **THEN** the agent distills a comforting, low-effort ephemeral vibe set (and any facet gates) passed to `propose_meal_plan`, then runs the pantry pass and restock list over the returned proposal

#### Scenario: Staples restocking callout is backed by loaded staples data

- **WHEN** olive oil is in the member's staples list and absent from pantry
- **THEN** the agent includes olive oil in the restocking callout and confirms with the user before adding to the shopping list; model judgment is not the primary signal

#### Scenario: Sale substitutions appear with the proposal (Kroger), not during pantry verify

- **WHEN** a menu recipe calls for an ingredient whose substitute is on sale (Kroger session)
- **THEN** the sale-based substitution is surfaced alongside the returned proposal (after flyer data), with the substitute candidates enumerated by the agent and verified via the Kroger tools, not during the pantry confirmation pass

#### Scenario: Proposal sized to cooking frequency

- **WHEN** the user makes an open-ended request and `default_cooking_nights` is 3
- **THEN** the agent passes `nights: 3` to `propose_meal_plan` (not 5 with extras), unless the user asked for a different count

### Requirement: Distill context into searches, retrieve, then compose

The flow SHALL keep the bounded context pre-pass (pantry, preferences, taste, diet, retrospective, weather, staples, discoveries, and flyer when Kroger), then **distill that context plus the user message into an ephemeral vibe set** (`{ vibe, facets }` entries) and pass it to `propose_meal_plan`, which retrieves candidates and **composes the week deterministically** (MMR diversify + facet spread + plate composition, the `meal-plan-proposal` capability) — rather than loading the whole active corpus or having the agent select recipes by hand. Each vibe entry SHALL separate a semantic `vibe` phrase from structured `facets`, because contrast/variety is anti-similarity and cannot be expressed as a similarity query. Anti-similarity constraints derived from the retrospective (e.g. avoid recently-repeated proteins/cuisines) SHALL be expressed as facets, never as the vibe phrase. When the caller supplies no intent, the agent MAY call `propose_meal_plan` with no ephemeral set, letting the saved night-vibe palette shape the week by cadence-debt.

#### Scenario: Whole corpus is not dumped and the agent does not hand-compose

- **WHEN** the flow runs against a large corpus
- **THEN** it distills an ephemeral vibe set and calls `propose_meal_plan`, which retrieves and composes; the agent does NOT load every recipe into context nor select the week's recipes itself

#### Scenario: Variety is a facet, not a vibe phrase

- **WHEN** the retrospective shows chicken cooked three times this week
- **THEN** the relevant vibe entries carry a facet excluding chicken, and "different from chicken" is not phrased as a semantic vibe

#### Scenario: A bare request lets the palette shape the week

- **WHEN** the user says only "plan me a meal" with no further intent
- **THEN** the agent MAY call `propose_meal_plan` with no ephemeral vibe set, and the saved palette + cadence-debt shape the week

### Requirement: Recall is engineered into the search set

The distilled ephemeral vibe set SHALL be diverse — the vibes implied by the request, a variety/wildcard vibe, a novelty vibe (never-cooked × taste), and use-it-up intent (passing at-risk on-hand items as `boost_ingredients`) — but **recall and cross-slot diversity are the engine's job**: `propose_meal_plan` retrieves a generous candidate pool per vibe and runs the MMR + facet-spread diversify over the week, so the agent SHALL NOT engineer recall by hand-selecting across a retrieved union. Side selection runs inside the engine's compose pass (driven by the chosen mains' `pairs_with` / `side_search_terms`), not as a separate agent round. When the returned proposal misses a good recipe the agent knows should fit, the agent SHALL adjust the ephemeral vibe set (add a vibe, widen intent) or re-invoke with a different seed rather than silently accepting the gap.

#### Scenario: Diverse vibes cover the space, the engine diversifies

- **WHEN** the flow distills an open-ended request
- **THEN** the ephemeral vibe set includes at least one variety/wildcard vibe and one never-cooked novelty vibe alongside the request-driven vibes, and `propose_meal_plan` performs the cross-slot diversify

#### Scenario: A recall gap is closed by adjusting intent, not hand-selecting

- **WHEN** the returned proposal omits a recipe the agent judges a good fit
- **THEN** the agent adds or widens a vibe (or re-seeds) and re-invokes `propose_meal_plan`, rather than composing the week by hand

### Requirement: Menu-generation smoke-test validation

The meal-plan flow SHALL be validated by a scripted smoke test of three seeded requests — open-ended ("make me a menu"), recipe-seeded ("let's make chicken and rice this week"), and freeform-constraint ("something comforting, I'm feeling lazy") — each run from a fresh conversation against live data, with a per-seed rubric of required behaviors. The flow is considered correct when each seed's response satisfies its rubric, the user can iterate with a revision, and agreement lands planned rows in the D1 meal plan (via `update_meal_plan`) whose ingredient needs appear in the derived to-buy read — with only open-world-side ingredients, extras, and materializations written as grocery rows, and the cart untouched. The open-ended and freeform rubrics require that composition is driven by `propose_meal_plan` over a distilled ephemeral vibe set — **not** by the agent hand-selecting mains over a retrieved union.

#### Scenario: Recipe-seeded smoke test passes its rubric

- **WHEN** the recipe-seeded seed "let's make chicken and rice this week" is run
- **THEN** the response resolves the dish with a vibe-less `search_recipes({ specs: [{ facets: { query: "chicken rice", include_unmakeable: true } }] })`, enumerates all genuine matches including the exact-title recipe, disambiguates before verifying the pantry, then `lock`s the chosen dish into `propose_meal_plan` and authors the remaining nights' vibes rather than hand-composing

#### Scenario: Open-ended smoke test drives the engine over an ephemeral vibe set

- **WHEN** the open-ended seed "make me a menu" is run
- **THEN** the response distills a bounded ephemeral vibe set (not a whole-corpus dump), folds the `list_new_for_me` discoveries in by authoring, and calls `propose_meal_plan` to compose the week — it does NOT hand-select mains over a retrieved union or poll/import discovery sources in-flow

#### Scenario: Capture-not-flush holds across all seeds

- **WHEN** any smoke-test seed reaches agreement
- **THEN** planned rows land in the meal plan, the derived to-buy read reflects their needs, only open-world-side/extra/materialization items are written via `add_to_grocery_list`, and the Kroger cart is not written
