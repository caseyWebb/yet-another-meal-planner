## MODIFIED Requirements

### Requirement: Menu-request context pre-pass

On a menu request, the agent SHALL gather all choice-independent context in a single parallel batch **before** selecting recipes, but SHALL NOT load the whole corpus. The batch SHALL always include: `read_pantry()`, `read_user_profile()`, `retrospective("month")`, `fetch_rss_discoveries()`, `read_discovery_inbox()`, and `get_weather_forecast()` unconditionally (not gated on fulfillment mode). It SHALL NOT include a whole-corpus `search_recipes` membership load — recipe selection is done by **bounded retrieval** (vibe-bearing `search_recipes` specs for open-ended weeks; a vibe-less `query` spec for a named dish), issued after the context is in hand, not by dumping every recipe into context. `read_user_profile()` returns preferences, taste, diet_principles, kitchen, staples, stockup, and ready_to_eat in one call — there is no need for separate `read_preferences`, `read_taste`, `read_diet_principles`, or `read_staples` calls. When the user's fulfillment mode is Kroger (`preferences[stores].primary == "kroger"`), the batch SHALL additionally include `kroger_flyer()`; for a non-Kroger store it SHALL be omitted and sale signals SHALL NOT influence recipe selection for that session. `ready_to_eat_available` is NOT called during the meal-plan flow — it is a buy-time tool used by the flush skills. `kroger_prices` is NOT issued in this batch; it is used only as a targeted deal-check for a handful of comparable items when verifying a specific sale claim during selection, and SHALL NOT be a full pre-pass over the proposed ingredient set — that costing belongs to the place-grocery-order flow. The recipe candidate space is the caller's **available corpus** — the whole shared corpus **minus the caller's rejects**, with no per-member "active set" and no `draft` recipes — reached through `search_recipes` rather than loaded wholesale. The **raw pantry** SHALL be loaded as a *selection* input — before recipes are chosen — so that what the member already has informs which recipes are proposed (and so the agent can spot inventory stand-ins), and so its at-risk perishables can seed `boost_ingredients` on the use-it-up search. There SHALL be no `verify_pantry_*` call: pantry matching, freshness, and inventory substitutions are the agent reasoning over the loaded pantry. The fulfillment mode SHALL be determined from the loaded preferences before the batch fires; if genuinely unknown, that is the one thing to confirm first. The weather tool is a best-effort read: when it returns any structured error, the agent SHALL continue with season-based reasoning and SHALL NOT surface the failure to the user. An empty `read_user_profile().staples` array means no staples-driven prompting for that session — this is not a failure.

#### Scenario: Open-ended request gathers context but does not dump the corpus

- **WHEN** the user says "make me a menu" and their fulfillment mode is Kroger
- **THEN** the agent calls `read_pantry`, `read_user_profile`, `retrospective`, `fetch_rss_discoveries`, `read_discovery_inbox`, `kroger_flyer`, and `get_weather_forecast()` in a single batch before proposing; it does NOT issue a whole-corpus `search_recipes` membership load, `ready_to_eat_available`, a full-cart `kroger_prices`, or separate `read_preferences`/`read_taste`/`read_diet_principles`/`read_staples` calls; recipe candidates are obtained by bounded `search_recipes` retrieval afterward

#### Scenario: No activation gate on the candidate set

- **WHEN** the agent retrieves recipes for a menu request
- **THEN** the candidate space is every non-rejected shared recipe (plus the caller's personal recipes), not a curated per-member active subset

#### Scenario: Non-Kroger session omits flyer and skips sale signals

- **WHEN** the user's `primary` store is a non-Kroger store slug
- **THEN** `kroger_flyer` is NOT called and sale data plays no role in recipe selection for that session

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

### Requirement: Named-dish exhaustive enumeration

When the user names a specific dish, the agent SHALL resolve it deterministically with a **vibe-less** `search_recipes` `query` spec (membership mode), NOT a semantic vibe search, and SHALL enumerate **all** genuine matches returned, rather than surfacing a partial subset from memory. Because the spec carries no `vibe`, the result is the complete membership set — exhaustive, unranked, and inclusive of a recipe imported earlier this session (membership mode keeps the unembedded). The spec SHALL pass `include_unmakeable: true` so a named recipe is surfaced flagged rather than silently dropped by the makeability gate. The agent SHALL disambiguate among multiple genuine matches (or confirm the single match) with the user **before** walking the pantry for the chosen recipe.

#### Scenario: Named dish surfaces the exact-title recipe

- **WHEN** the user says "let's make chicken and rice this week" and the corpus contains a recipe titled "Chicken and Rice" plus other chicken-and-rice dishes
- **THEN** the agent calls `search_recipes({ specs: [{ label: "named", facets: { query: "chicken rice", include_unmakeable: true } }] })`, lists every returned match including the recipe titled "Chicken and Rice," and asks which one (or confirms) before verifying the pantry

#### Scenario: No silent under-counting

- **WHEN** the vibe-less `query` spec returns N genuine matches for a named dish
- **THEN** the agent presents all N (not a vibe-matched couple) and does not claim a smaller count than the tool returned

#### Scenario: A just-imported named dish is still found

- **WHEN** the user names a dish that was imported earlier this session and has no embedding yet
- **THEN** the vibe-less `query` spec still returns it (membership mode keeps the unembedded), and it is not dropped as it would be by a vibe-bearing search

### Requirement: Discovery surfaced during menu requests

On a menu request, the agent SHALL triage and import the loaded discovery pools (`fetch_rss_discoveries`, `read_discovery_inbox`) **before** issuing the `search_recipes` retrieval, so the freshest, most intentional candidates seed the plan first and retrieval cannot tunnel onto the established corpus and bury a just-found candidate. The agent SHALL triage cheap-first from each candidate's title/summary/blurb against the taste profile and this request, `parse_recipe` only the genuine fits, classify, and `create_recipe` (no `draft` state — imports land available). For inbox emails, the agent SHALL scan each `body` for recipe titles and links (newsletters list several) and pick the 1–2 best fits. Accepted discovery picks SHALL claim plan slots first, and the `search_recipes` retrieval SHALL then be sized to the **remaining** nights (gap-fill), not the full week. Discovery import SHALL NOT block or dominate the proposal. On-sale ready-to-eat discovery is **not** surfaced during the menu request — it is a buy-time concern handled by the place-grocery-order and shopping-list flows.

#### Scenario: Discovery is triaged and imported before retrieval

- **WHEN** the agent assembles a menu and `fetch_rss_discoveries`/`read_discovery_inbox` return candidates
- **THEN** the agent scans each inbox email body for recipe titles and URLs, triages cheap-first, imports the genuine fits via `parse_recipe` + `create_recipe` before issuing `search_recipes`, and the accepted picks occupy plan slots before retrieval is consulted

#### Scenario: Retrieval fills only the remaining nights

- **WHEN** accepted discoveries already fill some of the week's nights
- **THEN** the `search_recipes` retrieval is sized to the nights not yet filled, rather than retrieving a full week and folding discoveries in afterward

#### Scenario: Unreachable candidate is presented as a link, not an import

- **WHEN** `parse_recipe` returns `unreachable`/`no_jsonld`/`not_a_recipe` for a candidate
- **THEN** the agent presents the link and skips the import (common for inbox candidates from walled sources) — it does not block or defer the proposal

#### Scenario: On-sale ready-to-eat discovery is not surfaced here

- **WHEN** a menu request runs
- **THEN** the agent does NOT scan `kroger_flyer` for on-sale RTE items during the menu flow — that discovery happens at order/shopping time in the flush skills

### Requirement: Perishable-ingredient waste callout

When assembling a menu proposal, for each perishable that a proposed recipe uses in **less than a typical purchase unit** (a partial-package amount — judged by the agent from the recipe body plus its own knowledge of how the item is sold, e.g. 2 tbsp of cilantro from a bunch; **no Kroger lookup**), the agent SHALL determine whether another recipe in the proposal also uses that perishable. If none does, it SHALL offer either to add a recipe that uses up the remainder or to swap the recipe. The agent SHALL make this determination by **reasoning over the `perishable_ingredients` already present on the candidate rows** it holds (every `search_recipes` row carries `perishable_ingredients`) — it SHALL NOT require a dedicated perishable-search or filter tool; a use-up recipe is found with a targeted `search_recipes` spec (a vibe naming the item, or `boost_ingredients`). A perishable consumed in roughly a full purchase unit (no meaningful leftover), or already shared by another proposed recipe, SHALL NOT trigger a callout.

#### Scenario: Partial-unit, unshared perishable triggers a callout

- **WHEN** a proposed recipe uses a partial purchase unit of cilantro (e.g. a few tablespoons from a bunch) and no other proposed recipe lists cilantro in its `perishable_ingredients`
- **THEN** the agent flags the likely leftover and offers to add a recipe that uses cilantro up (via a targeted `search_recipes` spec), or to swap the recipe

#### Scenario: Full-unit use does not trigger a callout

- **WHEN** a proposed recipe uses roughly a whole purchase unit of a perishable (no meaningful remainder)
- **THEN** no waste callout is raised for that item, even if it is the only recipe using it

#### Scenario: Shared perishable does not trigger a callout

- **WHEN** a perishable appears in the `perishable_ingredients` of two or more proposed recipes
- **THEN** no waste callout is raised for that item

#### Scenario: Determination is reasoning over candidate rows, not a dedicated tool

- **WHEN** the agent evaluates leftover perishables for the proposal
- **THEN** it reasons over the `perishable_ingredients` already present on the `search_recipes` rows it holds, with no dedicated perishable-search tool and no Kroger lookup

### Requirement: Plate-rounding with side pairings

When assembling a menu, the agent SHALL round out each main that is not an already-complete plate by surfacing or sourcing a savory side (starch, vegetable, salad, or bread), reasoned in the **same compose pass** as the mains, not a separate post-hoc phase. Whether a main is an already-rounded plate (a one-pot dish, a composed grain bowl, a protein-plus-vegetable sheet-pan dinner) SHALL be **inferred by the agent at plan time** from the recipe's content — there is no persisted `standalone` flag to gate on, and the agent SHALL NOT prompt for a side when it judges the main already stands alone. For a non-standalone main, if its `pairs_with` already names one or more **corpus sides**, the agent SHALL surface those remembered sides for the user to choose from rather than sourcing a new one. Otherwise the agent SHALL retrieve a side with a `search_recipes` spec whose **vibe is the main's `side_search_terms`** (the AI-memoized phrases describing the desired side) and `facets: { course: "side" }`, folded into the main retrieval call when the mains are known or issued as a small second search when they are not. A chosen side MAY instead be an **open-world side** (a trivial preparation named from world knowledge — "white rice", "a simple arugula salad" — that needs no recipe file). Drink, wine, and dessert pairings are out of scope for this capability.

#### Scenario: Already-rounded main is not prompted for a side

- **WHEN** the agent judges a chosen main to be an already-rounded one-pot plate
- **THEN** the agent does not propose or source a side for it and proceeds to assemble the proposal — without writing or reading any persisted standalone flag

#### Scenario: Remembered corpus pairing is surfaced

- **WHEN** a non-standalone main's `pairs_with` already names a corpus side recipe
- **THEN** the agent surfaces that remembered side for the user to accept rather than searching for a new one

#### Scenario: Side retrieved via side_search_terms in the same compose pass

- **WHEN** a non-standalone main has no remembered pairing and warrants a corpus side
- **THEN** the agent retrieves candidates with a `search_recipes` spec using the main's `side_search_terms` as the vibe and `facets: { course: "side" }`, reasoned together with the mains rather than in a separate later phase

#### Scenario: Open-world side rounds out a main

- **WHEN** a non-standalone main has no remembered pairing and the natural companion is a trivial preparation (e.g. steamed rice)
- **THEN** the agent MAY propose it as an open-world side, without minting a recipe for it

### Requirement: Side pairing bootstrap when the edge is empty

When a non-standalone main has an empty `pairs_with` and the natural companion warrants a saved recipe (a side with technique worth keeping, not a one-line preparation), the agent SHALL bootstrap a **corpus** pairing at plan time: it SHALL prefer existing `course: side` recipes (retrieved via a `search_recipes` side spec driven by the main's `side_search_terms`), then the RSS discovery pool (`fetch_rss_discoveries`), then a web parse (`parse_recipe`); it SHALL propose at most two candidate sides in chat; and on the user accepting such a side it SHALL ensure the side exists as a recipe (importing it via `parse_recipe` → `create_recipe` when it does not already exist, classified with `course: [side]`) and SHALL record the pairing by adding the side's slug to the main's `pairs_with` through `update_recipe`. The recorded edge is shared content, so a later menu request for the same main SHALL find the pairing already present and surface it. When the natural companion is instead a **trivial open-world side**, the agent SHALL NOT import a recipe or record a `pairs_with` edge — it proposes the open-world side directly (re-derived by reasoning each time, since it has no slug to remember). The bootstrap SHALL select sides by plate fit.

#### Scenario: Empty pairs_with bootstraps a corpus side

- **WHEN** a non-standalone main has an empty `pairs_with`, the natural companion warrants a saved recipe, and the user requests a menu including it
- **THEN** the agent searches corpus (via a `search_recipes` side spec) then RSS then web, proposes one or two savory sides, and asks the user to choose

#### Scenario: Accepted corpus bootstrap imports the side and records the edge

- **WHEN** the user accepts a proposed corpus side that is not yet in the corpus
- **THEN** the agent imports it as a recipe with `course: [side]` via `parse_recipe` + `create_recipe` and adds its slug to the main's `pairs_with` via `update_recipe` in the same operation

#### Scenario: Trivial companion stays open-world, not recorded

- **WHEN** the natural companion is a one-line preparation (steamed rice, dressed greens)
- **THEN** the agent proposes it as an open-world side and records no `pairs_with` edge and imports no recipe

#### Scenario: Recorded pairing is reused next time

- **WHEN** a later menu request includes the same main whose `pairs_with` now names the previously-recorded corpus side
- **THEN** the agent surfaces the recorded side and does not re-run the bootstrap search

### Requirement: Menu-generation smoke-test validation

The meal-plan flow SHALL be validated by a scripted smoke test of three seeded requests — open-ended ("make me a menu"), recipe-seeded ("let's make chicken and rice this week"), and freeform-constraint ("something comforting, I'm feeling lazy") — each run from a fresh conversation against live data, with a per-seed rubric of required behaviors. The flow is considered correct when each seed's response satisfies its rubric, the user can iterate with a revision, and agreement lands items in the D1 grocery list (via `add_to_grocery_list`) with the cart untouched.

#### Scenario: Recipe-seeded smoke test passes its rubric

- **WHEN** the recipe-seeded seed "let's make chicken and rice this week" is run
- **THEN** the response uses a vibe-less `search_recipes({ specs: [{ facets: { query: "chicken rice", include_unmakeable: true } }] })`, enumerates all genuine matches including the exact-title recipe, disambiguates before verifying the pantry, then runs verification and a proposal

#### Scenario: Open-ended smoke test uses bounded retrieval

- **WHEN** the open-ended seed "make me a menu" is run
- **THEN** the response selects recipes via bounded vibe-bearing `search_recipes` specs (not a whole-corpus dump), triaging the discovery pools before retrieval

#### Scenario: Capture-not-flush holds across all seeds

- **WHEN** any smoke-test seed reaches agreement
- **THEN** to-buy items are persisted to the grocery list via `add_to_grocery_list` and the Kroger cart is not written

## ADDED Requirements

### Requirement: Distill context into searches, retrieve, then compose

The flow SHALL keep the bounded context pre-pass (pantry, preferences, taste, diet, retrospective, weather, staples, discoveries, and flyer when Kroger), then distill that context plus the user message into K search specs, retrieve compact candidate lists via `search_recipes`, and compose the plate over the union — rather than loading the whole active corpus. Each spec SHALL separate a semantic `vibe` query from structured `facets`, because contrast/variety is anti-similarity and cannot be expressed as a similarity query. Anti-similarity constraints derived from the retrospective (e.g. avoid recently-repeated proteins/cuisines) SHALL be expressed as facets, never as the vibe query.

#### Scenario: Whole corpus is not dumped

- **WHEN** the flow runs against a large corpus
- **THEN** it issues bounded vibe-bearing `search_recipes` specs and reasons over the returned compact candidates, and does NOT load every recipe into context

#### Scenario: Variety is a facet, not a vibe query

- **WHEN** the retrospective shows chicken cooked three times this week
- **THEN** the relevant search specs carry a facet excluding chicken, and "different from chicken" is not phrased as a semantic query

### Requirement: Recall is engineered into the search set

To bound the recall lost by not dumping the corpus, the distillation SHALL include diverse specs: the vibe searches implied by the request, a variety/wildcard spec, a novelty spec (never-cooked × taste), and pantry-overlap specs for expiry-matching (passing the at-risk on-hand items as `boost_ingredients`). K SHALL be generous (candidate rows are compact). Side selection SHALL run within the same compose pass (driven by the chosen mains' `side_search_terms`, facet `course: side`), not as a separate post-hoc round, preserving holistic mains+sides reasoning. When retrieval does worse than reasoning over the full corpus would — a good recipe no spec surfaced — the agent SHALL widen `k` or add a spec rather than silently accepting the recall gap.

#### Scenario: Diverse specs cover the space

- **WHEN** the flow distills an open-ended request
- **THEN** the search set includes at least one variety/wildcard spec and one never-cooked novelty spec alongside the request-driven vibe specs

#### Scenario: Sides reasoned with mains in one pass

- **WHEN** mains are selected
- **THEN** side candidates are retrieved via the mains' `side_search_terms` within the same compose pass and the plate is reasoned over holistically

### Requirement: Aggressive in-session import of preference-matched discoveries

During the flow, when the agent judges a loaded discovery matches the member's preferences, it SHALL import it in-session: cheap triage on the discovery blurb, then `parse_recipe` and agent-written `description`/`side_search_terms`/facets, then `create_recipe`. Only matched discoveries SHALL be fully parsed and imported, so per-session cost is proportional to matches, not discovery volume. Import is performed on the agent's session (no external embedding/Anthropic API and no headless cron). The agent SHALL avoid importing a recipe already present (exact source-URL dedup at minimum).

#### Scenario: Match is imported on the spot

- **WHEN** a loaded discovery clearly matches the member's taste during planning
- **THEN** the agent imports it with a generated description in the same session, and it becomes a candidate for this plan and a corpus recipe for future plans

#### Scenario: Non-matches are not fully parsed

- **WHEN** a discovery does not pass cheap blurb-level triage
- **THEN** it is not `parse_recipe`'d or imported, and remains a discovery for later re-judgment

#### Scenario: Already-present recipe is not re-imported

- **WHEN** a matched discovery's source URL already exists in the corpus
- **THEN** the agent does not create a duplicate

### Requirement: Disposition collapses into the import decision

Importing a discovery into the shared corpus is cheap and reversible, so the agent SHALL import every genuine fit autonomously, without a per-candidate approval gate — import is **not** a consequential decision. Importing SHALL be **decoupled from plan placement**: a created recipe does NOT automatically land on this week's menu. The disposition SHALL resolve to one of these outcomes:

- **accept** — import the recipe **and** place it on this week's plan (the agent works from the parse directly; a just-imported recipe is not semantically retrievable the same session, but is found by a vibe-less `query` spec);
- **maybe next time** — import the recipe (it joins the corpus and reconciles an embedding, so it is retrievable next session) **but leave it off this week's plan**. This is the silent resting state of a good import that did not fit the week's gaps; it SHALL be surfaced only as a light "saved … for later" mention in the proposal, never as an approval prompt;
- **no-action skip** — leave a non-fitting candidate as a discovery to be re-judged later (no write);
- **reject** — `reject_discovery(url, reason?)`, suppressing the URL **group-wide**, reserved for "not corpus-worthy for the group" (junk, broken link, non-recipe, duplicate, clearly off-base for the group). A mere personal not-for-me-this-time SHALL be a no-action skip, NOT a reject.

Because rejection is shared, one member's passing taste SHALL NOT hide a recipe another member would favorite. What goes on the plan remains the consequential choice surfaced in the proposal for the member to iterate on; what enters the corpus is autonomous.

#### Scenario: Import is autonomous and does not auto-plan

- **WHEN** the agent judges a discovery worth adding during planning
- **THEN** it imports the recipe in-session without asking, and the recipe lands on this week's plan only if it is an accepted pick — importing alone does not place it on the menu

#### Scenario: A good import that does not fit the week is "maybe next time"

- **WHEN** a discovery is a genuine fit but the week's plan is already filled by better-fitting picks
- **THEN** the recipe is still imported (joining the corpus for future plans) and is left off this week's plan, surfaced as a light "saved for later" line rather than a per-candidate question

#### Scenario: Explicit rejection suppresses the URL group-wide

- **WHEN** a candidate is not corpus-worthy for the group (junk, broken, non-recipe, duplicate, off-base)
- **THEN** the agent calls `reject_discovery` and the URL is suppressed for the whole group and not re-surfaced to any member

#### Scenario: Personal taste-misfit is a skip, not a reject

- **WHEN** the agent simply judges a candidate not a fit for this member this session (personal preference, not a corpus-worthiness judgment)
- **THEN** it is left as a discovery (no shared suppression) and may surface again for that member or another

### Requirement: An exploration allowance keeps the loop from over-tightening

Because both import-match and retrieval-match pull toward established taste, the flow SHALL permit a deliberate "a bit outside your usual" pick — surfacing or importing an occasional candidate that is adjacent to, but not squarely inside, the member's established taste — so the corpus and rotation do not collapse into a filter bubble.

#### Scenario: An adjacent pick is offered

- **WHEN** the flow assembles a proposal
- **THEN** it MAY include a clearly-flagged "a bit outside your usual" option alongside the squarely-on-taste picks

## REMOVED Requirements

### Requirement: Holistic plate reasoning over one faceted load

**Reason**: The dump-and-reason model — selecting and plate-rounding over a single whole-corpus faceted load — is retired in favor of distill→retrieve→compose over bounded `search_recipes` specs.
**Migration**: See the ADDED requirements "Distill context into searches, retrieve, then compose" and "Recall is engineered into the search set" (sides now retrieved via `side_search_terms` in the same compose pass per "Plate-rounding with side pairings"). Expiry-matching is now a `boost_ingredients` pantry-overlap spec; the no-full-cart-`kroger_prices` guarantee is retained in "Menu-request context pre-pass" and "Capture to grocery list, never flush to cart".
