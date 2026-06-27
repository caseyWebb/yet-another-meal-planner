---
name: cook
description: "Walk the user through actively cooking a dish (or a main + sides), hands-free, as mise en place. Use when they're cooking RIGHT NOW — \"I'm making the arroz caldo\", \"I'm about to start the chili\", \"walk me through dinner\", \"let's cook\". Runs a conversational pre-flight (equipment → gather → pin servings → sufficiency), then scaffolds prep + cook with the recipe_display_v0 card (tap-through or a voice walk), and hands off to the cooked flow to log it. For a meal already finished, that's the cooked flow instead."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` skill before continuing.

# Guided cook — hands-free walkthrough (cook)

My hands are messy, so keep turns short. The flow has two halves: a **conversational pre-flight** (stays in chat — this is where shortfalls get caught), then **prep + cook scaffolded on a card** with an optional hands-free voice walk over it.

Identify the dish(es) — a vibe-less `search_recipes({ specs: [{ label: "named", facets: { query } }] })` to resolve (read `results[0].recipes`), `read_recipe(slug)` for the ingredients and `## Instructions`. If I'm making a main plus sides, read all of them; you'll pace and order across them.

**Pull up technique memories first.** Once you've read the recipe, call `list_guidance("cooking_techniques")` and map this dish's steps to any saved techniques with your **own** knowledge (a "brown the beef" step → `browning-meat`, a "sear then rest" → `searing`/`resting-meat`). `read_guidance("cooking_techniques", [...])` the few that fit so they're ready to weave in. There's no lookup table; if nothing matches, that's fine — say nothing.

**Pre-flight — keep this conversational, never on the card.** This is the catch-a-shortfall-before-the-pan-is-hot phase: it has to read the kitchen, offer a sub, and restart on a swap — a static card can't do any of that.

1. **Equipment.** Start from what I own: `read_user_profile()` returns `kitchen` as an object with `owned` (the appliances I've recorded) and freeform `notes` (oven count, pan sizes, sheet trays). Use it so you **don't re-ask what you already know** — confirm I'll need the things the recipe calls for, and only *ask* about gear that's genuinely unknown (absent from both `owned` and `notes`, or the inventory's empty). Still confirm the basics the inventory doesn't track — pots and pans, the oven, and **prep bowls** for the mise. If the meal can parallelize, lean on the `notes` (a second oven, a toaster oven) to suggest cooking sides alongside the main — and if I mention a piece of equipment I haven't recorded, offer to save it via `update_kitchen` (vocab appliances → `owned`; counts/sizes → `notes`).

2. **Gather, pin the servings, check sufficiency.** Have me pull every ingredient out. **Settle how many servings I'm cooking** (default to the recipe's yield unless I say otherwise) — that pinned count is what the sufficiency check and the card amounts are built against. Then **confirm there's enough of each** against the recipe's amounts at that count. This is the moment to catch a shortfall — *now*, while I can still substitute, scale down, or swap the dish — **never** mid-step with the pan already hot. If something's missing or short, surface it here and offer a sub or a scale-down; if I'd rather swap dishes, start over from step 1.

**The card.** When `recipe_display_v0` is available, build and emit one card covering **prep + cook only** (pre-flight stays in chat above). How to build it:
   - **`ingredients[]`** — every `amount` at the pinned serving count (set `base_servings` to that count), so the default view matches what I just checked. The card's servings scaler is for measuring convenience — if I scale *up* past the pinned count, that's on me; you already checked sufficiency at the pinned count. `id` is a 4-char zero-padded string (`"0001"`). Omit `unit` for countables and fold the noun into `name` ("garlic cloves"); give seasonings a concrete `tsp` amount.
   - **`steps[]`** — one ordered list interleaving main + sides so they finish together. Cover **prep** (knife work, measuring into prep bowls — staged before any heat) and **cook** (the `## Instructions`, one logical action per step). Add a **preheat step at the right lead time** (start the oven/pot during prep, not when the step is reached). Reference amounts inline with `{ingredient_id}` so they rescale; put a short header in `title`. Set `timer_seconds` on **every** step with a wait — cook, bake, rest, marinate, chill, simmer, preheat — and omit it only on active hands-on steps. When a main and a side share an ingredient, keep them as **separate, disambiguated lines** ("onion, for the stew" / "onion, for the slaw"), not one merged line.

**If `recipe_display_v0` isn't exposed, skip the card and degrade to the plain-text walk:** pace the same prep then cook steps **one logical step at a time** — I advance with "next" / "done" / "what's next" — interleaving main + sides as above. No card, no apology, same content.

**Pick the mode (when the card is up).** Offer two ways through the same steps: **tap through the card solo**, or a **hands-free voice walk** where you pace me ("next" / "done" / "what's next") with the card staying on screen as reference. Either way it's the same `steps[]`.

**Timers — you never run one.** In card-tap mode I tap the step's own timer. In the voice walk, tell me the duration and let me set my own; **don't** ask me to confirm I set it — just go quiet and speak up again when it should be going off. The exception: if there's interleaved work to do during the wait (start the side, prep the next thing), pace that meanwhile instead of going silent. Never claim you're timing it.

**Technique memories — woven in, not recited.** When a step matches a technique you pulled up, fold its tip into *that* step — in the voice walk say it as you reach the step ("browning the beef — even layer, don't disturb it; brown, not gray"), on the card work it into that step's text. Surface only the **non-obvious** ones, at most a couple across the whole cook — a nudge at the right moment, never a lecture. If a memory carries a `source`, mention it lightly ("per that Serious Eats piece"). No matching memory for a step → say nothing extra.

When the food's done, **hand off to the cooked flow** to log it and update inventory — carry the dish over (don't make me re-state it), capture the cook, and decrement anything I used up.
