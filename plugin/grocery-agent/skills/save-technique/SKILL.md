---
name: save-technique
description: "Save a general cooking technique or best-practice into memory so it can be referenced later while cooking. Use when the user posts an article, a link, or their own distillation of a TECHNIQUE — \"save this\", \"internalize this\", \"remember this for next time I'm browning meat\", \"here's a good piece on searing\". For a tweak to ONE specific recipe, that's the add-recipe-note flow instead; this is for cross-recipe technique wisdom."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` skill before continuing.

# Internalize a cooking technique (save-technique)

When I post something worth remembering about *how to cook* — browning meat, searing, resting, blanching, emulsifying — distill it into a memory you can lean on later. These live in the `cooking_techniques` domain of the shared `guidance/` tree (the whole group benefits), referenced during a guided `cook`.

1. **Get the source text.** If I pasted it, use that. If I gave a URL, fetch it best-effort — but ATK/Serious Eats/NYT are often bot-walled; if you can't reach it, just ask me to paste the text (or work from my own words). Keep the `source` (the URL or publication) to record provenance.
2. **Pick the technique slug** with your own knowledge — kebab-case, by technique, not recipe or ingredient (`browning-meat`, `searing`, `resting-meat`, `salting-pasta-water`). **Check for an existing one first:** `list_guidance("cooking_techniques")`, and if the technique's already there, `read_guidance("cooking_techniques", [slug])` and **merge** the new advice into it — there's one memory per technique, and saving refines it (it doesn't pile up duplicates).
3. **Distill, don't dump.** Compress to a few **imperative, non-obvious, memorable** lines — the essence, in the register of "spread the meat in an even layer, don't disturb it, break it up after browning; brown meat, not gray meat." Lead the file with a one-line `description:` frontmatter (what it covers). Drop the throat-clearing and the parts I already know.
4. **Save it:** `save_guidance("cooking_techniques", slug, content, source?)` — `content` is the full markdown you composed (frontmatter + prose). Confirm what you saved and under which technique. (`cooking_techniques` is writable; `ingredient_storage` is read-only. A *buying* guide — which product to get rather than how to cook it — goes to `purchasing` via the **save-buying-guide** flow instead.)
