---
name: add-recipe-feedback
description: "Rate a recipe or change its status. Use for \"rate the Serious Eats one 4 stars\", \"loved Tuesday's curry\", \"remove that recipe\", \"make it again sometime\", or dispositioning a draft (activate or reject). Routes rating/status to the user's personal overlay — never changes the shared recipe or anyone else's view."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` and `grocery-corpus` skills before continuing.

# Recipe feedback / disposition

Call `update_recipe(slug, updates)` with the appropriate fields. For drafts being dispositioned: status → active (with rating) or status → rejected.
