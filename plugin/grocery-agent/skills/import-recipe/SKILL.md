---
name: import-recipe
description: "Save a recipe from a URL or pasted text into the shared corpus as a draft. Use for \"save this recipe: <URL>\", \"import this one\", \"here's a recipe: <pasted text>\", \"check this article for recipes\". Parse-then-classify-then-create; handles paywalled / bot-walled sites by asking the user to paste the text."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` and `grocery-corpus` skills before continuing.

# Recipe import

`import_recipe(url)` is **parse-only** — it fetches the page and returns the JSON-LD `Recipe` data; it does **not** write. Then *you* assemble the recipe and persist it:
1. Call `import_recipe(url)`. On success you get `{ title, ingredients, instructions, servings, time_total, time_active, source, tools_hint?, existing_slug? }`. **If `existing_slug` is present**, this recipe is already in the shared corpus — don't re-import. Tell me it's already there and reuse that slug (I can rate it, note it, put it on the menu); skip to whatever I actually wanted.
2. Clean up and classify into full frontmatter (protein, cuisine, style, tags, dietary, `ingredients_key`, `meal_preppable`, `season`, `requires_equipment`, `perishable_ingredients`, etc.) and assemble the markdown body with `## Ingredients` and `## Instructions`.
   - **`perishable_ingredients` — classify by the "would the leftover rot" test.** From the recipe's ingredients, list the ones that would spoil before they'd realistically be used up — *not* botanical perishability. Include fast-spoilers even in small amounts (fresh herbs, leafy greens, fresh berries, soft cheese); exclude shelf-stable staples (olive oil, canned/dried goods, spices). Fuzzy edges (eggs, potatoes, hardy roots) are fine to skip — a wrong call only costs a dismissed waste nudge. Write plain ingredient names; the Worker normalizes them on write (same matcher as pantry verify), so don't fuss over exact wording. This is what powers the menu-gen waste callout. Default `[]` if nothing qualifies.
   - **`requires_equipment` — classify conservatively.** Default to `[]` (the common case). Tag a vocab slug (`pressure-cooker`, `sous-vide-circulator`, `blender`, `ice-cream-maker`) **only when the dish is genuinely impossible without it** — no recipe-preserving workaround. The `tools_hint` and the instruction prose are *hints, never the verdict*: they list every bowl and whisk, almost none of which are vital. When unsure, leave it out — a missed requirement is caught at the `cook` equipment step, but a wrong "vital" tag silently hides a recipe I could've made. This drives the makeability gate, so under-tag rather than over-tag.
3. Call `create_recipe(frontmatter, body)` with `status: draft`. Confirm in chat. (If it comes back `already_exists`, another member imported the same source first — reuse the returned slug instead.)

**When `import_recipe` can't reach it** (`unreachable` — bot-walled or paywalled, e.g. Serious Eats, NYT; or `no_jsonld`/`not_a_recipe`/`incomplete`): tell me, and ask me to **paste the recipe text**. From pasted text, do steps 2–3 directly (assemble frontmatter + body, `create_recipe`) — no `import_recipe` call needed. Same for "check this article for recipes": fetch-and-parse if it works, otherwise I'll paste.
