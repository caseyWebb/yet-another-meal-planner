---
name: grocery-cart
description: "Internal shared rules for the grocery agent, loaded by reference from the workflow skills (via their prerequisite line). Not invoked on its own."
---

## The grocery list and the cart

Capture buy-intent onto the **grocery list** continuously, as it comes up; **flush it once**, at order time. The flush has **two forms**, picked by my fulfillment mode (`preferences.toml [stores].primary`) — **don't assume Kroger**:

- **Kroger online** (`primary: kroger`) — flush to the Kroger cart with `place_order` (the place-grocery-order flow).
- **In-store walk** (`primary` is a store slug from `stores/`) — turn the list into an aisle-ordered shopping list for that store and walk it (the store-walk flow). Naming a store for one trip ("I'm going to the West 7th Tom Thumb") picks the walk for that trip only.

**Capture is identical either way** — the grocery list is SKU-free and store-agnostic; only the flush differs. Flush only when I say to (order / go shopping) — if I just mention I'm out of something, add it to the list for next time, don't flush. When something runs low or out, *ask* before putting it on the list (the prompt is the point — don't auto-add). Household / non-food items belong on the list too.

**Persist multi-write turns in one commit.** When resolving a single turn produces more than one repo write — several grocery items at once, a menu's recipes-plus-grocery-items, a receive's removes-plus-pantry-restock — persist them with **one** `commit_changes` (one `*_ops`/`*_updates` field per file), not a sequence of granular calls, and **never fire parallel writes at the same file** (they full-file-overwrite each other and silently drop items). The granular `add_to_grocery_list` / `update_grocery_list` / `remove_from_grocery_list` tools are for a single one-off edit; any batch goes through `commit_changes` `grocery_list_ops`.

The Kroger cart is **write-only** — you can add to it, but not remove or check out. So never tell me something was taken out of the cart; report what should change and tell me to fix it in the Kroger app.

**Substitutions are never automatic.** Inventory subs (recipe wants salmon, I've got trout) come up during the pantry pass; sale subs (salmon's on the menu, trout's on sale) come up with the proposal. When a tool says an item is `unavailable`, offer `propose_substitutions` and let me pick.

## Putting groceries away — storage tips

When fresh perishables newly enter my kitchen — whether I just picked up an order (the `received` restock) or hauled produce back from the farmers market (an `update_pantry` add) — offer me a couple of storage tips so less of it goes bad. The advice is curated, not improvised: it lives in the shared `storage_guidance/` tree.

- Call `list_storage_guidance()` to see the available classes, then map what I just bought to the right class(es) with your **own** knowledge of the items (cilantro → `tender-herbs`, yellow onions → `alliums`, a clamshell of strawberries → `berries-grapes`). There's no lookup table — just pick the slugs that fit, plus `_ethylene` when I bought things that shouldn't be stored together.
- `read_storage_guidance([...])` the ones you picked and surface **2–3 relevant, non-obvious tips** — the things actually worth saying for *this* haul, not a recital. Skip the obvious ("keep milk cold").
- **Only ever give vetted advice.** If something I bought has no matching class file, say nothing about it — don't invent a tip. If a tip is written with a hedge ("some cooks rinse berries in vinegar — results vary"), relay it *with* the hedge; never assert folklore as settled fact.
- Don't nag. If you gave a tip recently, or it's a staple I clearly already know how to store, let it go — a light, occasional touch, not a lecture every trip.
