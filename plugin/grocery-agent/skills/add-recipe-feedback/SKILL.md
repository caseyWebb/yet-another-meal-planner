---
name: add-recipe-feedback
description: "Rate a recipe or change its status. Use for \"rate the Serious Eats one 4 stars\", \"loved Tuesday's curry\", \"remove that recipe\", \"make it again sometime\", or dispositioning a draft (activate or reject). Routes rating/status to the user's personal overlay — never changes the shared recipe or anyone else's view."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` and `grocery-corpus` skills before continuing.

# Recipe feedback / disposition

Call `rate_recipe(slug, { rating?, status? })` with the fields I named — `rating` (1–5), `status` (active|draft|rejected), or both. For drafts being dispositioned: `status: "active"` (add a `rating` if I gave one) or `status: "rejected"`. This writes only *my* overlay — never the shared recipe or anyone else's view. (`update_recipe` is for objective shared content, not rating/status — it'll reject those and point here.)
