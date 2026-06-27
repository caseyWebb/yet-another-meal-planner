---
name: add-recipe-feedback
description: "Favorite a recipe or hide it. Use for \"loved Tuesday's curry\" / \"favorite that one\", \"stop suggesting that\", \"hide that recipe\", \"make it again sometime\". Routes the favorite/reject to the user's personal overlay — never changes the shared recipe or anyone else's view."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` and `grocery-corpus` skills before continuing.

# Recipe feedback / disposition

Two personal-disposition tools, both writing only *my* overlay (never the shared recipe or anyone else's view). They are **mutually exclusive** — favoriting clears a reject and vice-versa:

- **Favorite** — when I love a dish ("favorite that", "loved it"), call `toggle_favorite(slug, true)`; to take it back, `toggle_favorite(slug, false)`. Favorites are *the* positive taste signal — they steer my recommendations (the nearest-liked re-rank), mark my regular rotation, and show up as group signal for others ("favorited by 2").
- **Hide** — when I want a recipe out of my view ("stop suggesting that", "hide that one"), call `toggle_reject(slug, true)`; to un-hide, `toggle_reject(slug, false)`. A rejected recipe is dropped from my `search_recipes` results entirely (a hard gate, both membership and ranked modes) — it doesn't change the shared recipe or anyone else's view. This is **per-tenant**; it's different from `reject_discovery`, which suppresses a discovery *URL* group-wide before import.

Every other recipe is simply available by default — there's no "activate" step. (`update_recipe` is for objective shared content, not favorite/reject — it'll reject those and point here.)
