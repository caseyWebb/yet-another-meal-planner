## REMOVED Requirements

### Requirement: Ready-to-eat adds before order resolution (configured catalog)

**Reason**: The ready-to-eat surface is removed wholesale. Both passes lose their inputs: `retrospective` no longer returns `ready_to_eat_favorites`, and `add_draft_ready_to_eat` no longer exists — so there is no restock cross-reference and no on-sale RTE drafting at order time.
**Migration**: None — the place-order flow proceeds straight to resolving and previewing the grocery list. A member who wants a heat-and-eat item on an order adds it like any other grocery item. Any RTE-flavored `flyer_terms` rows remain valid generic scan terms; operators may prune them via the admin Config editor.
