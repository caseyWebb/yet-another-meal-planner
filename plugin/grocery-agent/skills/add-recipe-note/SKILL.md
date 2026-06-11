---
name: add-recipe-note
description: "Capture a personal tweak or observation on a recipe as an attributed note. Use for \"next time I'd cut the sugar\", \"I subbed gochujang for the sriracha and it was better\", \"note that this needs a squeeze of lime\", \"leave a note that the group should try it cold\". Writes an attributed note — never edits the shared recipe body/frontmatter."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` and `grocery-corpus` skills before continuing.

# Recipe notes — capture tweaks, don't edit shared content

1. Call `add_recipe_note(slug, body, tags?, private?)`. `body` is the tweak/observation in my words. Use `tags` like `["tweak"]` or `["observation"]` when it helps. Notes default to **shared** with the group; pass `private: true` only when I say it's just for me ("note for myself…").
2. Only a genuine "this is now a different dish" warrants an actual new recipe — offer `create_recipe` (a personal recipe in my subtree) for that, not a note.
3. Confirm what you noted.
