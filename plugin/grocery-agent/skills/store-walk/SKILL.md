---
name: store-walk
description: "Build an aisle-ordered shopping list for an in-person trip and walk it hands-free. Use for \"I'm headed to the store\", \"give me a shopping list for Tom Thumb\", \"I'm walking Central Market\", or whenever the fulfillment mode is a store rather than Kroger online. The in-store sibling of place-grocery-order — it flushes the SAME grocery list to a walking list instead of the Kroger cart, voice-first, and ends by restocking the pantry (the received behavior)."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` and `grocery-cart` skills before continuing.

# In-store walk — the second flush (store-walk)

This is the **in-store flush** — the walking sibling of `place_order`. It reads the same grocery list and orders it the way I actually move through a specific store. Like `cook`, it's hands-free / voice-first: keep turns short, **one aisle at a time**.

1. **Resolve the store.** If I named one for this trip ("the West 7th Tom Thumb"), use it — that overrides my standing preference for this trip only; **don't rewrite `primary`**. Otherwise `read_preferences()` and use `[stores].primary` when it's a store slug. Use `list_stores()` to match a name to a slug or see what's mapped. If `primary` is `kroger` and I didn't name a store, this is really the online flush — hand off to place-grocery-order instead.

2. **Batch the reads** (one batch, not sequential): `read_grocery_list`, `read_store(slug)`, `read_store_notes(slug)`. Surface the relevant notes up front — hours, parking, where-they-stock-X.

3. **Build the aisle-ordered list — graceful degradation.** First filter the list to the store's `domain` (a `grocery` store's walk excludes `home-improvement`-tagged items, and vice versa). Then order items by how I'll walk the store:
   - **No layout (rung 0):** group by department from your **own** world knowledge (produce, dairy, meat, frozen, …) — a sensible department list, never a refusal.
   - **Section tags / aisle map (rungs 1–2):** order by the store's `[[aisles]]` — **the order IS the walk path** — placing each item into the aisle whose `sections` fit it. That placement is your judgment over the store's **own** sign vocabulary (the storage-guidance posture — no manifest, no global enum).
   - **item_locations (rung 3):** an exact `item_location` hit **wins** over category inference — place that item at its recorded aisle/detail.
   - Carry the **buy amount and recipe attribution** on each line (the same need-aggregation `place_order` surfaces) so I grab enough.
   - Flag any listed item in the store's `doesnt_carry` up front ("heads up — this store's marked as not carrying harissa") — a hint, never a gate.
   - **Don't invent stock or stores.** Only say an item *isn't* carried when it's actually in `doesnt_carry` — never *speculate* that a store won't have something. And **never name a specific other store** as an alternative: cross-store routing isn't built (v1) and you have no data on what's nearby — naming "Whole Foods on West 7th" is a fabrication. If an item genuinely isn't carried, offer to record it in `doesnt_carry` and leave where-to-get-it-instead to me; at most a generic "you may need to grab that elsewhere," never a made-up store. (Same norm as storage-guidance: silence over invention.)

4. **First visit to an unmapped store — offer to map it (never push).** If the store has no layout, *offer* to record the walkthrough as we go ("want me to remember this store's layout while we shop?"). On a yes, read the aisle signs into the layout (`add_store` for a brand-new store, then `update_store` `set_aisles` as we pass each aisle). On a no, proceed with the degraded list — mapping is pure upside that accrues through use, never a precondition.

5. **Walk it, one aisle at a time.** Pace me aisle by aisle; I advance with "got it" / "next". Handle **"can't find it"** by disambiguating gently **before any write**:
   - **Sold out** — transient, no layout change.
   - **Moved** (I found it in a different aisle) — *offer* to save the corrected `item_location` (`update_store` `add_item_location`). This "can't find it → oh, aisle 9" moment is the capture trigger.
   - **Not carried** — *offer* to add it to `doesnt_carry` (`update_store` `add_doesnt_carry`) and note it for the trip; don't auto-split the order, and **don't invent which other store carries it** (cross-store routing is a deferred follow-on, not data you have).
   Only write on my confirmation — never silently.

6. **Complete → received (the same restock as a Kroger pickup).** When I'm done, picked items go straight `active → received` — **no `in_cart`/`ordered` stage**. Persist it in **one** `commit_changes`: remove the picked items via `grocery_list_ops` and — **for `grocery`-kind items only** — restock the pantry via `pantry_operations`; `household`/`other` never touch the pantry. Then, for the fresh perishables just received, offer a couple of storage tips following the **Putting groceries away** guidance — exactly as a Kroger pickup does.
