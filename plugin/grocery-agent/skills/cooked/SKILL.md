---
name: cooked
description: "Capture a meal that was actually cooked or eaten, and update inventory from it. Use when the user reports a COMPLETED meal — \"I made the chili last night\", \"had the frozen lasagna for dinner\", \"we finished the arroz caldo\". The only flow that writes the cooking log and moves last_cooked; logs only what was actually cooked, never what was merely planned. (For a hands-free walkthrough WHILE cooking, that's the cook flow, which hands off here on completion.)"
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` skill before continuing.

# Cooking — capture a completed meal (cooked)

This is the **only** flow that writes the cooking log and moves `last_cooked`. Capture it honestly — log only what I tell you I cooked, never what was merely planned.

1. **Identify what was cooked — check the meal plan first.** Call `read_meal_plan()` before reaching for `search_recipes`: most cooks are something I planned, and a planned dish gives you the slug directly. If what I said clearly maps to one planned dish even when phrased loosely — the plan has a soup and I say "I made the soup," or it has *arroz caldo* and I say "made the rice porridge" — take that match **without** confirming. Only when the meal plan has no obvious match (an off-plan cook, or two planned dishes both plausibly fit) fall back to a vibe-less `search_recipes({ specs: [{ label: "named", facets: { query } }] })` to resolve a corpus slug, or treat it as a ready-to-eat / ad-hoc meal. If you're arriving here from a guided `cook`, you already know the dish — carry it over.
2. **Update inventory.** Cooking consumes pantry items — walk the recipe's ingredients (or just ask for an ad-hoc/RTE meal) and ask whether I **used the last of** anything ("did that finish the ginger?"). For each yes, an `update_pantry` `remove`. For a ready-to-eat item, removing it from the pantry is how its on-hand stock decrements (the ready-to-eat catalog is options, not stock).
3. **Log it** with `log_cooked` (D1-backed; no commit):
   - `log_cooked({ type: "recipe", recipe: <slug> })` for a corpus cook; `{ type: "ready_to_eat", name }` for an RTE meal; `{ type: "ad_hoc", name, protein?, cuisine? }` for something off-corpus (add the inline dims so it still counts in retrospective). `date` defaults to today — pass an explicit `date` if I said "last night" / a past day. An unknown recipe slug is rejected (`not_found`) — resolve it first with a vibe-less `search_recipes({ specs: [{ label: "named", facets: { query } }] })`.
   - A `type: "recipe"` entry **auto-clears** that recipe from the meal plan — you don't need a separate `update_meal_plan` remove for the cooked dish.
   - **Don't** set `last_cooked` yourself — it's derived from the log entry (logging the recipe updates its effective `last_cooked` automatically).
4. Confirm in chat what was logged and decremented.
5. **Offer feedback once, lightly.** A just-cooked meal is the best moment to capture a reaction, so ask — "how was it? want to favorite it or jot a note for next time?". On a yes, hand off: a favorite or disposition goes through the add-recipe-feedback flow; a tweak ("needed more salt", "I'd cut the sugar") goes through the add-recipe-note flow. One light offer — don't push, and skip it for a plain reheated ready-to-eat item unless I volunteer something. Don't propose a new menu unless I ask.
