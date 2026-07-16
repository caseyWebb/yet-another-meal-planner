## REMOVED Requirements

### Requirement: Ready-to-eat adds before grouping (configured catalog)

**Reason**: The ready-to-eat surface is removed wholesale. Both passes lose their inputs: `retrospective` no longer returns `ready_to_eat_favorites`, and `add_draft_ready_to_eat` no longer exists — so there is no restock cross-reference and no Kroger-trip on-sale RTE drafting before grouping.
**Migration**: None — the in-store flow proceeds straight to grouping the shopping list. A member who wants a heat-and-eat item on a trip adds it to the grocery list like any other item.
