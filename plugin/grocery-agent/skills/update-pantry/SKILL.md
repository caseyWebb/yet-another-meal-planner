---
name: update-pantry
description: "Record changes to what's physically in the kitchen. Use for \"I ran out of olive oil\", \"I just put 3 lb of ground beef in the freezer\", \"I used the last of the parmesan\", \"added basil and tomatoes from the market\". Parses adds/removes and updates the pantry. (A market haul the user wants worked into the week is a menu request, not just a pantry update.)"
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` and `grocery-cart` skills before continuing.

# Pantry update

**Read the pantry first so an add merges instead of duplicating.** Before applying adds, call `read_pantry()` (skip if it's already loaded this session) and match each incoming item against what's already there using your own judgment about names — "green onions" you already have *is* the "scallions" I just bought, "ground beef" is the "80/20 beef" entry. When an add matches an existing entry, update that entry (bump quantity / refresh `last_verified_at`) rather than creating a second row; only create a new entry when nothing on hand is the same item. Removes match the same way.

Then call `update_pantry(operations)` with the parsed adds/removes. Confirm in chat what you did. Don't trigger a menu generation unless I asked. If the add includes fresh perishables (a market haul, new produce), offer a couple of storage tips following the **Putting groceries away** guidance — skip it for a plain staple add ("ran out of olive oil").

**Depletion and staples cross-reference.** When an update includes a depletion (a `remove` op or a user saying they're out of something), call `read_user_profile()` **lazily** (only once this session, only when at least one item was depleted) and read `.staples` (a bare array). For each depleted item that appears in the staples array, ask: "Want me to add [item] to the shopping list?" Do **not** prompt for items not in the staples array — just record the depletion silently. If the `staples` array is empty or absent, skip the cross-reference without surfacing any error.

**Heat-and-eat items count twice.** When an add includes convenience meals (a freezer-load of frozen dinners, breakfast burritos), those are both pantry stock *and* ready-to-eat options. Record the stock with `update_pantry` as usual, then — for any that aren't already in my ready-to-eat catalog (`ready_to_eat_available`) — *offer* to add them via `add_draft_ready_to_eat({ meal, name })` (they land suggestible immediately — no activation) so they're available later. Offer, don't auto-add; use the **same name** in both places so the favorites↔on-hand restock check lines up. (If it's already cataloged, just record the stock — no duplicate.)

**Exception — farmers market scenario:** "Picked up tomatoes, basil, and chevre at the market, work them into the week and tell me what else I need." This is a menu request seeded by new pantry additions. Handle as a menu request after the pantry update — and since this is a fresh-produce haul, it's a prime moment for the **Putting groceries away** storage tips.
