# Kroger In-Store — API aisle ordering

This branch runs when I'm walking a Kroger store in person. The Kroger Products API returns `aisleLocation` for each item, so the walk is ordered by aisle number automatically — no pre-mapped layout required.

#### 1. Resolve the Kroger store

Check whether a Kroger store is registered for this trip:
- `list_stores()` and look for a store with `chain: "kroger"` matching the location I named or my `primary` preference.
- If found, use its `slug` and read its `location_id` (the Kroger `locationId` used to bypass the Locations API).
- **If not registered (first visit to this Kroger):** ask me for a short label — "What do you want to call this Kroger? (e.g. 'West 7th', 'Hulen')" — then:
  - Derive a kebab slug: `kroger-<label-in-kebab>` (e.g. `kroger-west-7th`).
  - Call `kroger_prices` on any one list item with the store ZIP/label to resolve the Kroger `locationId`.
  - `add_store(slug, name="Kroger", label, chain="kroger", domain="grocery", location_id=<resolved>)`.
  - This is **one-time friction** — subsequent walks resolve by slug with no API lookup needed.

#### 2. Load items and fetch aisle locations

Call `kroger_prices` for each active grocery list item in parallel, passing `location_id` (the store's registered Kroger `locationId`; omit to fall back to the profile preferred location). Each returned product carries `aisleLocation: { number, description, side? } | null` and a top-level `inStore: boolean`.

Surface **`inStore: false` items up front** before starting the walk: "These items aren't available in-store at this Kroger — pickup/delivery only. Remove them from the in-store list, or keep them for a separate order?" Never silently drop them.

#### 3. Group by aisle and walk

Order items by `aisleLocation.number` (ascending); items with `null` aisle go at the end as **"location unknown"**. Apply cold-chain sequencing on top: if frozen/refrigerated aisles fall mid-store, pull those items into a final "grab these on your way out" group and say so.

Hands-free / voice-first, **one aisle at a time**, I advance with "got it" / "next". At each aisle, announce the aisle number and description, then the items to grab there. As we reach an aisle, if something there has **purchasing** guidance (which canned tomatoes, which olive oil), weave the non-obvious tip in following the **Picking what to buy** guidance — at the shelf, where I'm choosing.

Handle **"can't find it"** by disambiguating gently before any write:
- **Sold out** — transient, no note.
- **Moved** (I found it in a different aisle) — silently write a corrected `location` note (see §4 below).
- **Not carried** — *offer* a `stock` note (`add_store_note` with `tags:["stock"]`) and note it for the trip.

#### 4. Silent idempotent location note seeding

After `read_store_notes(slug)`, for each item resolved to a specific aisle, silently write:

```
add_store_note(slug, "Aisle <N>: <item name>", tags: ["location"])
```

**Only if** no existing `location`-tagged note already mentions the item name (case-insensitive substring match). This runs silently — no confirmation prompt, no narration. The notes accumulate across trips, so the walk gets faster over time even without a full pre-map.

#### 5. Complete → received

Before wrapping up, sweep the list for anything we never ticked off — "you've still got harissa and flour on the list; did we pass those, or want to double back?" Then, when done, picked items go straight `active → received` — **no `in_cart`/`ordered` stage**. Persist it with the granular tools: remove the picked items with `remove_from_grocery_list` (one per item, awaited — they share the list blob) and — **for `grocery`-kind items only** — restock the pantry in one `update_pantry({ operations: [...] })`; `household`/`other` never touch the pantry. Then offer a couple of storage tips for fresh perishables just received, following the **Putting groceries away** guidance.
