---
name: cook
description: "Walk the user through actively cooking a dish (or a main + sides), hands-free, as mise en place. Use when they're cooking RIGHT NOW — \"I'm making the arroz caldo\", \"I'm about to start the chili\", \"walk me through dinner\", \"let's cook\". Paces equipment → gather → prep → cook, then hands off to the cooked flow to log it. For a meal already finished, that's the cooked flow instead."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` skill before continuing.

# Guided cook — hands-free walkthrough (cook)

This is hands-free / voice-first: my hands are messy, so keep turns short and pace me **one step at a time**.

Identify the dish(es) — `list_recipes({ query })` to resolve, `read_recipe(slug)` for the ingredients and `## Instructions`. If I'm making a main plus sides, read all of them; you'll pace and order across them.

Run it as **mise en place**, in order — don't jump to the cooking steps:

1. **Equipment.** Start from what I own: `read_user_profile()` returns `kitchen` as an object with `owned` (the appliances I've recorded) and freeform `notes` (oven count, pan sizes, sheet trays). Use it so you **don't re-ask what you already know** — confirm I'll need the things the recipe calls for, and only *ask* about gear that's genuinely unknown (absent from both `owned` and `notes`, or the inventory's empty). Still confirm the basics the inventory doesn't track — pots and pans, the oven, and **prep bowls** for the mise. If the meal can parallelize, lean on the `notes` (a second oven, a toaster oven) to suggest cooking sides alongside the main — and if I mention a piece of equipment I haven't recorded, offer to save it via `update_kitchen` (vocab appliances → `owned`; counts/sizes → `notes`).

2. **Gather + check sufficiency.** Have me pull every ingredient out, and **confirm there's enough of each** against the recipe's amounts. This is the moment to catch a shortfall — *now*, while I can still substitute, scale down, or swap the dish — **never** mid-step with the pan already hot. If something's missing or short, surface it here and offer a sub or a scale-down; if I'd rather swap dishes, start over from step 1.

3. **Prep.** Walk me through the knife work and measuring into the prep bowls — chop, mince, portion — so everything's staged before any heat.
   - **Preheat exception:** if a later step needs a hot oven (or a pot at a boil), have me start it *now*, during prep, at the right lead time — not when the step is finally reached.

4. **Cook.** Now pace the `## Instructions`, **one logical step at a time** — I advance with "next" / "done" / "what's next". For a main + sides, interleave the steps so things finish together, leaning on the parallel equipment from step 1.
   - **Timers:** you can't run a real timer — when a step has a duration, tell me the time and have me set my own ("set a 20-minute timer," "tell me when it dings"). Never claim you're timing it.

When the food's done, **hand off to the cooked flow** to log it and update inventory — carry the dish over (don't make me re-state it), capture the cook, and decrement anything I used up.
