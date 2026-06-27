---
name: save-buying-guide
description: "Save buy-side selection wisdom — which kind of a product to get, or how to pick a good/ripe one — so it can be surfaced later while shopping. Use when the user posts a buying guide, a taste test, a link, or their own distillation about WHAT TO BUY — \"save this olive oil guide\", \"remember this for picking canned tomatoes\", \"here's the fish sauce to get\". For how to COOK something, that's the save-technique flow; for a tweak to ONE specific recipe, that's add-recipe-note."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` skill before continuing.

# Internalize a buying guide (save-buying-guide)

When I post something worth remembering about *what to buy* — which olive oil, which canned tomatoes, how to pick a ripe melon — distill it into a memory you can lean on at the shelf. These live in the `purchasing` domain of the shared `guidance/` tree (the whole group benefits), surfaced while shopping (see **Picking what to buy**).

1. **Get the source text.** If I pasted it, use that. If I gave a URL, fetch it best-effort — but ATK / Serious Eats / Wirecutter are often bot-walled; if you can't reach it, just ask me to paste the text (or work from my own words). Keep the `source` (the URL or publication) to record provenance.
2. **Pick the item slug** with your own knowledge — kebab-case, by product/item, not by brand or recipe (`olive-oil`, `canned-tomatoes`, `stone-fruit`, `parmesan`). **Check for an existing one first:** `list_guidance("purchasing")`, and if the item's already there, `read_guidance("purchasing", [slug])` and **merge** the new advice into it — there's one memory per item, and saving refines it (it doesn't pile up duplicates).
3. **Distill to "what to actually grab."** Compress to a few **imperative, non-obvious** lines — the decision rule, in the register of "for sauce, get whole peeled with no calcium chloride; read the ingredient list, not the front of the can." Lead the file with a one-line `description:` frontmatter. Drop the throat-clearing and what I already know. **Pre-hedge anything contested** — ripeness lore especially ("some swear by the stem-end smell — unreliable on its own") — so relaying the file faithfully is relaying it honestly.
4. **Save it:** `save_guidance("purchasing", slug, content, source?)` — `content` is the full markdown you composed (frontmatter + prose). Confirm what you saved and under which item. (`purchasing` and `cooking_techniques` are writable; `ingredient_storage` is curated and read-only.)
