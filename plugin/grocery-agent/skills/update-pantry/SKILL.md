---
name: update-pantry
description: "Record changes to what's physically in the kitchen. Use for \"I ran out of olive oil\", \"I just put 3 lb of ground beef in the freezer\", \"I used the last of the parmesan\", \"added basil and tomatoes from the market\". Parses adds/removes and updates the pantry. (A market haul the user wants worked into the week is a menu request, not just a pantry update.)"
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` and `grocery-cart` skills before continuing.

# Pantry update

Simple: call `update_pantry(operations)` with the parsed adds/removes. Confirm in chat what you did. Don't trigger a menu generation unless I asked. If the add includes fresh perishables (a market haul, new produce), offer a couple of storage tips following the **Putting groceries away** guidance — skip it for a plain staple add ("ran out of olive oil").

**Exception — farmers market scenario:** "Picked up tomatoes, basil, and chevre at the market, work them into the week and tell me what else I need." This is a menu request seeded by new pantry additions. Handle as a menu request after the pantry update — and since this is a fresh-produce haul, it's a prime moment for the **Putting groceries away** storage tips.
