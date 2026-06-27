# In-Store Walk — layout/notes aisle ordering

This branch runs when `primary` is a store slug (non-Kroger), or I name a specific non-Kroger store for this trip. It's the **display front door** for in-store shopping — read-only until I commit to walking.

#### 1. Resolve the store and its domain

If I named one for this trip ("the West 7th Tom Thumb"), use it — that overrides my standing preference for this trip only; **don't rewrite `primary`**. Otherwise use `preferences.stores.primary`. `list_stores()` matches a name to a slug and gives each store's `domain`. For a store I name that isn't registered, classify its category from your **own** knowledge (Lowe's → `home-improvement`, a nursery → `garden`) — you don't need a record to know a hardware store isn't grocery.

#### 2. Filter to the store's domain

Show only the items for this trip's category — a `grocery` run excludes `home-improvement`-tagged items; a Lowe's run shows **only** those. (Item `domain` is set when it's captured; default `grocery`.)

#### 3. Ready-to-eat adds (configured catalog)

Before grouping, if I've set up a ready-to-eat catalog, offer heat-and-eat items to add to the trip — never unilaterally:
- **Restock favorites** (any grocery trip). Cross-reference `retrospective`'s `ready_to_eat_favorites` against pantry on-hand — a favorite that's low/out is a *suggest* ("you're low on the frozen lasagna you keep grabbing — want it on the list?").
- **On-sale discovery** (Kroger store only — it needs flyer data). For a non-Kroger store there's no flyer — skip discovery.

On my yes, add the item to the grocery list so it falls into the grouping below. Skip entirely for an empty catalog.

#### 4. Group it — department vs aisle (graceful degradation)

- **No store, or a store with no map:** group by **department** from your **own** world knowledge (produce, dairy, meat, frozen, … — or the right departments for the category: lumber, plumbing, paint, garden). A sensible grouped list, never a refusal.
- **A mapped store:** `read_store_notes(slug)` and order by its `layout`-tagged notes — **aisle order (by aisle number) is the walk path** — placing each item into the aisle whose sections fit it (your judgment over the store's **own** sign vocabulary, the storage-guidance posture — no manifest). A `location`-tagged note **wins** over inference for that item. Surface any `stock` note ("marked as not carrying harissa") up front — a hint, never a gate — plus the freeform notes (hours, parking) from the same read.
- Carry the **buy amount and recipe attribution** on each line so I grab enough.
- **Cold last (cold chain).** Sequence frozen items, then refrigerated (dairy, meat), to be grabbed **last** so they don't sit warm while I shop. Most layouts already put frozen near checkout, so the aisle order handles it; if frozen falls mid-store, pull the cold items into a final "grab these on your way out" group and say so.
- **Don't invent stock or stores.** Only say an item *isn't* carried when a `stock` note actually says so — never *speculate*. And **never name a specific other store** as an alternative. At most a generic "you may need to grab that elsewhere."

#### 5. No store named — ask, don't probe

If I didn't name a store and `primary` isn't one, just ask whether I'm shopping somewhere specific. If I name one, resolve it and `read_store_notes(slug)` to see if it's mapped — don't read every registered store's notes guessing where I'm headed. No specific store → the department list stands.

#### 6. Show the whole list, then offer the walk — only if mapped

Display the entire grouped list in one go. On an **unmapped** department list (no voice walk to pace against), fold any **Picking what to buy** tips in with the list here; on a **mapped** store, save them for the shelf on the walk (step 7) instead — don't say them twice. **If** the store has layout notes, offer hands-free voice step-by-step mode ("want me to walk you through it?"). With **no** map, leave the department list and **don't** offer voice (there's nothing to pace against) — but if it's an unmapped store I'm actually walking, *offer to map it* (the map + walk branch of this skill).

#### 7. The voice walk (mapped store)

**Brief me before we go hands-free — voice mode has a hard limitation, and saying so up front prevents it derailing.** Claude voice mode **can't call tools** (no MCP, no skills) and runs on a smaller model, but it **does carry over this conversation's context**. So set expectations explicitly before I switch: *"Switch to voice mode and walk the aisles — I'll keep the running list and track corrections (moved items, out-of-stocks) in our conversation as you go, but nothing gets **saved** until you come back out of voice mode. When you're done, exit voice mode and I'll write up the store notes then."* During the voice walk, just track corrections conversationally — **don't claim** a note was saved, and don't try to call `add_store_note` (it won't work in voice). The moment I'm back in normal mode, replay what we gathered and write the confirmed notes. Saying this plainly matters: without the framing, voice mode tends to **invent reasons it can't help** (it can't see *why* it lacks tools) instead of simply tracking along.

Like `cook`, hands-free / voice-first: pace me **one aisle at a time**, I advance with "got it" / "next". Handle **"can't find it"** by disambiguating gently **before any write**:
- **Sold out** — transient, no note.
- **Moved** (I found it in a different aisle) — *offer* to save a corrected `location` note (`add_store_note` with `tags:["location"]`). This "can't find it → oh, aisle 9" moment is the capture trigger.
- **Not carried** — *offer* a `stock` note (`add_store_note` with `tags:["stock"]`) and note it for the trip; don't auto-split the order, and **don't invent which other store carries it**.
Only write on my confirmation — never silently. And as we reach an item that has **purchasing** guidance, weave its non-obvious buying tip in at that aisle (the **Picking what to buy** guidance) — a light touch, silent when nothing matches.

#### 8. Complete → received

Before wrapping up, sweep the list for anything we never ticked off — "you've still got harissa and flour on the list; did we pass those, or want to double back?" — so I don't check out missing something. Then, when I'm done, picked items go straight `active → received` — **no `in_cart`/`ordered` stage**. Persist it with the granular tools: remove the picked items with `remove_from_grocery_list` (one per item, awaited — they share the list blob) and — **for `grocery`-kind items only** — restock the pantry in one `update_pantry({ operations: [...] })`; `household`/`other` never touch the pantry. Then, for the fresh perishables just received, offer a couple of storage tips following the **Putting groceries away** guidance.
