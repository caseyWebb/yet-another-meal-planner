---
name: shop-groceries
description: "Flush the grocery list — the deliberate act distinct from capturing intent. Use for \"place the order\", \"I'm headed to the store\", \"give me a shopping list\", \"I'm walking Central Market\", \"send it to my cart\", \"go ahead and order\". Detects the fulfillment mode and runs the right branch: Kroger online cart flush, Kroger in-store API-ordered walk, mapped-store walk, or map-and-walk. The only path that writes the cart or transitions list items to received."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` and `grocery-cart` skills before continuing.

# Shop groceries — the flush (shop-groceries)

Read `read_grocery_list` and `read_user_profile()` in parallel (preferences field drives branch detection). Then detect which branch to run:

| Signal | Branch |
|---|---|
| `primary = "kroger"` and no store named for this trip | **Kroger online** — `place_order` flush |
| `primary = "kroger"` and I named a specific Kroger store, or I say "in-store" / "walking the Kroger" | **Kroger in-store** — API aisle ordering |
| `primary` is a store slug, or I named a non-Kroger store | **In-store walk** — layout/notes aisle ordering |
| Walking a store we've never mapped and I want to record it | **Map + walk** — concurrent map-and-shop |

> For details, read `references/kroger-online.md`.

> For details, read `references/kroger-instore.md`.

> For details, read `references/instore-walk.md`.

> For details, read `references/map-store.md`.
