---
name: inventory-hypothetical
description: "Evaluate whether buying some candidate ingredients would meaningfully improve the week, without committing them. Use for \"market has heirloom tomatoes, basil, chevre — worth grabbing this week?\". Runs a speculative, non-persisted menu re-evaluation with the items added in memory."
---

> **Prerequisite** — if you haven't already this session, read the `grocery-core` skill before continuing.

# Inventory hypothetical

Call `inventory_hypothetical(items)`. The tool runs a speculative menu re-evaluation with those items added in memory (not persisted). Report whether they meaningfully improve the week.
