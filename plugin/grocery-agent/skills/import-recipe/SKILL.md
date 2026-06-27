---
name: import-recipe
description: "Save a recipe from a URL or pasted text into the shared corpus. Use for \"save this recipe\" with a link, \"import this one\", \"here's a recipe\" with pasted text, \"check this article for recipes\". Parse-then-classify-then-create; handles paywalled / bot-walled sites by asking the user to paste the text."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core`, `grocery-corpus` and `grocery-discovery` skills before continuing.

# Recipe import

I've handed you a specific recipe, so the "yes" is implicit — there's no triage step here. Follow the **grocery-discovery** tier directly: `parse_recipe(url)` (parse-only) → classify into full frontmatter (the field-classification rules, including `description` and `side_search_terms`, all live in that tier) → assemble the `## Ingredients` / `## Instructions` body → `create_recipe(frontmatter, body)`, then confirm in chat.

- **Already in the corpus?** If `parse_recipe` returns `existing_slug` (or `create_recipe` comes back `already_exists`), don't re-import — tell me it's already there, reuse that slug (I can rate it, note it, put it on the menu), and skip to whatever I actually wanted.
- **Can't reach the page?** On `unreachable` / `no_jsonld` / `not_a_recipe` / `incomplete` (bot-walled or paywalled, e.g. Serious Eats, NYT), tell me and ask me to **paste the recipe text** — then classify-and-create directly from the paste, no `parse_recipe` needed. Same for "check this article for recipes": fetch-and-parse if it works, otherwise I'll paste.
- **Just imported a main? Offer sides, once.** After a successful import whose `course` includes `main`, end with a single light offer to line up sides for it — and on a yes, hand off to the `recipe-sides` flow (it can drive straight off the `side_search_terms` you just classified, no re-search needed). The offer never blocks the import or places anything on a plan, and it does **not** fire for a non-main import (a side, dessert, or sauce gets no side offer).
