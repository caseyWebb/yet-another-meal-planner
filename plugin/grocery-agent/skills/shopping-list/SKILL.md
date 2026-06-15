---
name: shopping-list
description: "Show my current shopping list, grouped for how I'll actually shop — by department when no store or layout is known, by aisle when I'm walking a store we've mapped. Use for \"what's on my list?\", \"give me a shopping list\", \"I'm headed to the store\", \"I'm walking Central Market\", \"shopping list for Tom Thumb\". Filters to a named store's category (a Lowe's run shows only the home-improvement items). Display-first; if the store's mapped, offers a hands-free voice walk that ends by restocking the pantry."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` and `grocery-cart` skills before continuing.

# Shopping list — the second flush (shopping-list)

This is the **display front door** for shopping — the in-store sibling of `place_order`, read-only until I commit to walking. It reads the same grocery list and presents it the way I'll actually move through the store, then (only for a mapped store) offers to walk it hands-free.

1. **Resolve the store and its domain.** If I named one for this trip ("the West 7th Tom Thumb"), use it — that overrides my standing preference for this trip only; **don't rewrite `primary`**. Otherwise `read_preferences()` and use `[stores].primary` when it's a store slug. `list_stores()` matches a name to a slug and gives each store's `domain`. For a store I name that isn't registered, classify its category from your **own** knowledge (Lowe's → `home-improvement`, a nursery → `garden`) — you don't need a record to know a hardware store isn't grocery. If `primary` is `kroger` and I didn't name a store, this is really the online flush — hand off to place-grocery-order instead.

2. **Filter to the store's domain.** Show only the items for this trip's category — a `grocery` run excludes `home-improvement`-tagged items; a Lowe's run shows **only** those. (Item `domain` is set when it's captured; default `grocery`.)

3. **Ready-to-eat adds — restock, plus on-sale discovery on a Kroger trip (configured catalog).** Before grouping, if I've set up a ready-to-eat catalog, offer heat-and-eat items to add to the trip — never unilaterally:
   - **Restock favorites** (any grocery trip). Cross-reference `retrospective`'s `ready_to_eat_favorites` against pantry on-hand — a favorite that's low/out is a *suggest* ("you're low on the frozen lasagna you keep grabbing — want it on the list?").
   - **On-sale discovery** (Kroger store only — it needs flyer data). If this trip is a Kroger store, scan `kroger_flyer` for on-sale heat-and-eat items not already in my catalog and draft 1–2 via `add_draft_ready_to_eat` (`source: "kroger-flyer"`). For a non-Kroger store there's no flyer — skip discovery.
   On my yes, add the item to the grocery list so it falls into the grouping below. Skip entirely for an empty catalog.

4. **Group it — department vs aisle (graceful degradation).**
   - **No store, or a store with no map:** group by **department** from your **own** world knowledge (produce, dairy, meat, frozen, … — or the right departments for the category: lumber, plumbing, paint, garden). A sensible grouped list, never a refusal.
   - **A mapped store:** `read_store_notes(slug)` and order by its `layout`-tagged notes — **aisle order (by aisle number) is the walk path** — placing each item into the aisle whose sections fit it (your judgment over the store's **own** sign vocabulary, the storage-guidance posture — no manifest). A `location`-tagged note **wins** over inference for that item. Surface any `stock` note ("marked as not carrying harissa") up front — a hint, never a gate — plus the freeform notes (hours, parking) from the same read.
   - Carry the **buy amount and recipe attribution** on each line (the same need-aggregation `place_order` surfaces) so I grab enough.
   - **Cold last (cold chain).** Sequence frozen items, then refrigerated (dairy, meat), to be grabbed **last** so they don't sit warm while I shop — identify them from your **own** knowledge (ice cream / anything frozen → frozen; milk, butter, raw meat, yogurt → refrigerated). Most layouts already put frozen near checkout, so the aisle order handles it; if frozen falls mid-store, pull the cold items into a final "grab these on your way out" group and say so.
   - **Don't invent stock or stores.** Only say an item *isn't* carried when a `stock` note actually says so — never *speculate*. And **never name a specific other store** as an alternative: cross-store routing isn't built and you have no data on what's nearby. At most a generic "you may need to grab that elsewhere." (Same norm as storage-guidance: silence over invention.)

5. **No store named — ask, don't probe.** If I didn't name a store and `primary` isn't one, just ask whether I'm shopping somewhere specific ("Shopping a particular store, or want the list as-is? If it's one we've mapped, I'll order it by aisle"). If I name one, resolve it and `read_store_notes(slug)` to see if it's mapped — don't read every registered store's notes guessing where I'm headed. No specific store → the department list stands.

6. **Show the whole list, then offer the walk — only if mapped.** Display the entire grouped list in one go. **If** the store has layout notes, offer hands-free voice step-by-step mode ("want me to walk you through it?"). With **no** map, leave the department list and **don't** offer voice (there's nothing to pace against) — but if it's an unmapped store I'm actually walking, *offer to map it* (the map-grocery-store flow).

7. **The voice walk (mapped store).** Like `cook`, hands-free / voice-first: pace me **one aisle at a time**, I advance with "got it" / "next". Handle **"can't find it"** by disambiguating gently **before any write**:
   - **Sold out** — transient, no note.
   - **Moved** (I found it in a different aisle) — *offer* to save a corrected `location` note (`add_store_note` with `tags:["location"]`). This "can't find it → oh, aisle 9" moment is the capture trigger.
   - **Not carried** — *offer* a `stock` note (`add_store_note` with `tags:["stock"]`) and note it for the trip; don't auto-split the order, and **don't invent which other store carries it**.
   Only write on my confirmation — never silently.

8. **Complete → received (the same restock as a Kroger pickup).** Before wrapping up, sweep the list for anything we never ticked off — "you've still got harissa and flour on the list; did we pass those, or want to double back?" — so I don't check out missing something. Then, when I'm done, picked items go straight `active → received` — **no `in_cart`/`ordered` stage**. Persist it in **one** `commit_changes`: remove the picked items via `grocery_list_ops` and — **for `grocery`-kind items only** — restock the pantry via `pantry_operations`; `household`/`other` never touch the pantry. Then, for the fresh perishables just received, offer a couple of storage tips following the **Putting groceries away** guidance — exactly as a Kroger pickup does.
