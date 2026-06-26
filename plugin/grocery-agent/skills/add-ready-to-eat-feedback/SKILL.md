---
name: add-ready-to-eat-feedback
description: "Favorite or hide a ready-to-eat / heat-and-eat item — the convenience-meal analog of recipe feedback. Use for \"love the frozen lasagna\", \"stop suggesting those taquitos\"."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` and `grocery-corpus` skills before continuing.

# Ready-to-eat feedback

Disposition a ready-to-eat item in the user's personal catalog, mirroring recipes: call `update_ready_to_eat(slug, { favorite: true })` when I love one, or `update_ready_to_eat(slug, { reject: true })` to stop suggesting it (the two are mutually exclusive — there's no status or rating). Address the item by its `slug` (from `ready_to_eat_available` or the `add_draft_ready_to_eat` that created it); resolve it by name if you don't have it yet. Edits the caller's own ready-to-eat catalog — never anyone else's view.
