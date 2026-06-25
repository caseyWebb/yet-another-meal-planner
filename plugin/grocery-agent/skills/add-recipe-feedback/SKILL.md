---
name: add-recipe-feedback
description: "Favorite a recipe or change its status. Use for \"loved Tuesday's curry\" / \"favorite that one\", \"stop suggesting that\", \"remove that recipe\", \"make it again sometime\", or dispositioning a draft (activate or reject). Routes the favorite/status to the user's personal overlay — never changes the shared recipe or anyone else's view."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` and `grocery-corpus` skills before continuing.

# Recipe feedback / disposition

Two personal-disposition tools, both writing only *my* overlay (never the shared recipe or anyone else's view):

- **Favorite** — when I love a dish ("favorite that", "loved it"), call `toggle_favorite(slug, true)`; to take it back, `toggle_favorite(slug, false)`. Favorites are *the* positive taste signal — they steer my recommendations (the nearest-liked re-rank) and show up as group signal for others ("favorited by 2").
- **Status** — when I'm dispositioning ("activate that draft", "reject it", "stop suggesting it"), call `set_recipe_status(slug, "active" | "rejected" | "draft")`. `rejected` drops it from my active set but keeps it for de-dup.

A "loved it" is usually a favorite; a "don't show me this" is a `rejected` status; they're independent (you can favorite *and* set status in two calls). (`update_recipe` is for objective shared content, not favorite/status — it'll reject those and point here.)
