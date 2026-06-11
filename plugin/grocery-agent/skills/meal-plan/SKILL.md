---
name: meal-plan
description: "Plan meals and build the grocery list for the week. Use when the user wants a menu or to shop — \"make me a menu\", \"let's do groceries\", \"I'm running low\", \"I want to make X tonight\", \"plan dinners for the week\" — or seeds the week with new pantry items (a farmers-market haul). Runs the pantry-confirmation → context-gathering → proposal → capture-to-grocery-list flow. Captures buy/cook intent only; never places the order."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core`, `grocery-cart` and `grocery-corpus` skills before continuing.

# Menu request

**Two standing habits before you propose:** (1) **Reconcile the plan.** A new conversation starts fresh, so call `read_meal_plan` and surface any *due* planned recipes (`planned_for` on or before today, or unset; leave future-dated ones alone) — ask which I actually cooked, log + clear those (via the cooked flow), and drop the ones I abandoned (`meal_plan_ops` `remove`). Never assume a planned recipe was cooked; if nothing's due, say nothing. (2) **The pantry pass is the whole point** — don't skip staples and spices to save time, they're the category that silently runs out. Weight recently-added items (within ~5 days) higher; fresh purchases should get used soon. Don't track leftover portions ("1.5 cups of rice left") — that's a whiteboard problem. And propose what I asked for: if I said 3 nights, propose 3, not 5 with extras.

Two starting points: **open-ended** (you pick recipes) or **recipe-seeded** (I name a recipe and you work outward). The rest is identical.

**When I name a dish, find it deterministically — don't recall the corpus from memory.** Call `list_recipes({ query: "<dish words>" })` — `query` is the single text search over title **and** tags (every token must appear; connective words like "and" are dropped, so "chicken and rice" and "chicken rice" behave the same, and a recipe titled "Chicken and Rice" is found even if its tags omit "rice"). Enumerate **all** genuine matches it returns, including exact-title hits — never surface a vibe-matched couple and never claim a smaller count than the tool returned. If there are several genuine matches, disambiguate ("you've got *Chicken and Rice*, *Arroz Caldo*, and *Galinhada Mineira* — which one?"); if there's a clear single match, confirm it. Only **after** I've picked do you run the pantry walk for that recipe. (`list_recipes` has no relevance ranking — it's a membership filter; you reason over the returned set, but the set is complete.)

1. Call `verify_pantry_for_recipe(slug)` for recipe-seeded, or `verify_pantry_for_candidates(slugs)` for open-ended. The tool returns **facts, not verdicts** — it never classifies freshness; there is no stale bucket.

2. Work the buckets in chat, then `mark_pantry_verified(items)` for anything I confirm. Specifically:
   - **Freshness is your judgment, not the tool's.** Scan `in_pantry` age metadata (`days_since_verified`, `category`, `prepared_from`) and prompt me about anything that looks like it may have drifted — perishables long-unverified, leftovers (`prepared_from`) more than a few days old ("basil verified 9 days ago — still good?"), long-frozen items worth using up ("pork shoulder's been in the freezer 4 months — want to factor it in?"). Don't interrogate me about every item; nudge the genuinely questionable ones. If nothing looks off, skip this.
   - **Confirm `possible_matches`.** These are fuzzy candidates the tool refuses to assume ("recipe wants `long-grain white rice`; you have `rice` — same thing?"). On a yes, treat it as in-pantry; on a no, it's to-buy. When a fuzzy pair is genuinely the same item, offer to add an `aliases.toml` entry so it resolves automatically next time (suggest only — don't write unless I say so).
   - **Optional ingredients:** for an `optional` item I don't have, *ask* whether to add it ("the parsley garnish is optional and you're out — want it on the order?"). Never add it silently, never drop it silently.
   - **Inventory substitutions:** surface `inventory_substitutes_available` here ("recipe calls for salmon, you have trout — sub it?"). This is the inventory-substitution moment; sale-based substitutions wait for step 5.

3. **Sequencing isn't available yet** (`suggest_sequencing` ships with Change 13, once the component vocabulary is seeded). Until then, skip this step — you may still note an obvious shared-perishable pairing conversationally, but there's no tool call here.

4. Call the context-gathering tools **in parallel** (one batch, not sequentially): `kroger_flyer()`, `kroger_prices(ingredients)` for the menu's ingredients (compare across brands/sizes and pick), `ready_to_eat_available()`, `read_preferences()`, `read_taste()`, `read_diet_principles()`, `retrospective("month")` (real recent protein/cuisine mix, cadence, and ready-to-eat favorites — for variety honoring and restock suggestions in step 5), and `fetch_rss_discoveries()`. (`fetch_rss_discoveries` returns a *pool* of recipe candidates with no taste score — you judge fit against the taste profile in step 5. On-sale ready-to-eat items surface from the same `kroger_flyer` call — see the discovery bullet in step 5.)

5. Reason over the assembled context and my original message (including any freeform constraints like "comfort food one night," "I'm feeling lazy," "something Italian," "date night Thursday" — incorporate the mood/vibe naturally, it's reasoning context, not a separate input). Propose:
   - A dinner plan sized to my cooking frequency (default from preferences, currently 3 nights, unless I specified otherwise)
   - Mix of recipes + ready-to-eat dinners + acknowledgment of nights I'll eat out
   - Recipe combinations that share or sequence perishables (soft preference, not a hard rule — if a menu I want has some perishable waste, mention it, don't refuse it)
   - Meal-prep callouts when `meal_preppable: true` recipes are on the menu
   - Sale-based substitution opportunities (now that you have flyer data — this is the moment for sale subs, distinct from the inventory subs surfaced during the pantry pass)
   - 1–2 ready-to-eat dinner options from `ready_to_eat_available` (good for the lazy / eat-out-adjacent nights)
   - Restocking list for staples
   - Stockup alerts for bulk-buy items on sale
   - **Variety honoring (soft).** Weigh the menu against `diet_principles.md`, grounded in the real history from `retrospective` (not intent). Bias toward satisfying the variety targets ("fish once a week" and I haven't had fish → favor a fish night); when you can't satisfy them all, **say so and explain the tradeoff** rather than silently violating or rigidly enforcing. Treat declared hard restrictions as gates (never propose a recipe that violates one); treat variety targets as preferences.
   - **Ready-to-eat restock suggestions.** Cross-reference `retrospective`'s `ready_to_eat_favorites` against `pantry.toml` on-hand — for a favorite that's low/out, *suggest* a restock ("you've reached for the frozen lasagna a lot and you're out — add it?"). On a yes, add to `grocery_list.toml` (or `stockup.toml` for a conditional bulk buy).
   - **Discoveries (every menu request, as a small side channel — 1–2 of each, never dominating the proposal):**
     - *Recipes:* from the `fetch_rss_discoveries` pool, pick the 1–2 best fits for the taste profile and this request. For each, call `import_recipe(url)` → clean up and classify the parsed data (protein, cuisine, tags, dietary, `ingredients_key`, `meal_preppable`), assemble the body with `## Ingredients` / `## Instructions`, and `create_recipe(...)` with `status: draft`, `discovered_at`, `discovery_source`. Import immediately — don't wait for me to express interest. If `import_recipe` returns `unreachable`/`no_jsonld`/`not_a_recipe`, just present the link and skip the import (I can paste it later). The pool already excludes recipes I have. Drafts don't clutter later proposals — they sit until I disposition them.
     - *Ready-to-eat:* scan the `kroger_flyer` results for on-sale heat-and-eat / grab-and-go items, skip any already in `ready_to_eat/*.toml`, and draft 1–2 worthwhile ones via `add_draft_ready_to_eat` (with `source: "kroger-flyer"`). This is the on-sale-RTE discovery path (there's no dedicated tool).

6. Send the proposal in chat. Iterate based on my revisions — rerun affected tool calls as needed.

7. On agreement, persist the repo side of the session in one `commit_changes` call: the agreed recipes as `[[planned]]` rows via `meal_plan_ops` (set `planned_for` to the intended night when known), draft imports, pantry verifications, and the to-buy items added to `grocery_list.toml`. **Do not bump `last_cooked` here** — agreeing to a menu is not cooking it. `last_cooked` moves only when I report a cook (the cooked flow). This does **not** touch the cart — capturing intent into the list is separate from placing the order. (The cart flush is `place_order`, invoked when I'm ready to order, which may be this sitting or later. See the place-grocery-order flow.)

8. Final message in chat: summarize what was added to the list / committed, and when an order is placed, remind me to review the cart in the Kroger app before checkout (the API can't remove items, so I have to do it manually if I want to adjust).

**Empty-cart case:** if the pantry covers what's needed, say so explicitly. Commit any pantry verifications, skip the cart write.
