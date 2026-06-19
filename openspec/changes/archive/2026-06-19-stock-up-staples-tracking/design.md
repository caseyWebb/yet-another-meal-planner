## Context

The system currently has no concept of "items the user doesn't want to run out of." `AGENT_INSTRUCTIONS.md` references "staples and spices that silently run out" as a judgment call during meal planning, but there is no data backing it. Two flows are affected:

1. **Pantry update** — when the user reports depletion ("I'm out of olive oil"), the agent updates pantry but has no way to decide whether to prompt a restock. Currently it treats all depletions the same.
2. **Meal plan / shopping list** — the restocking callout is supposed to surface low staples, but the agent guesses which items qualify. This is inconsistent.

`stockup.toml` already exists for a related but distinct purpose: bulk-buy at a good price, often proteins/grains for the freezer. Staples are orthogonal — the concern is availability, not price.

## Goals / Non-Goals

**Goals:**
- Provide a backing data structure for "things I don't want to run out of"
- Drive pantry-depletion prompts: prompt for restock only when the depleted item is a staple
- Drive meal-plan restocking callout from real data rather than model judgment
- Prompt perishable-staple staleness checks during shopping/meal-plan flows
- Be additive — absent `staples.toml` degrades to current behavior (no prompting)

**Non-Goals:**
- Price thresholds or sale-watching (that is stockup's job)
- Automatic additions to the grocery list without user confirmation
- Inferring staples from purchase history or pantry contents
- Quantity thresholds or min-stock levels (agent uses judgment on freeform pantry quantity)

## Decisions

### New file `staples.toml` rather than a flag on `pantry.toml`

Alternatives considered:
- **Flag on `pantry.toml` items** (`keep_stocked: true`) — rejected because a staple that's completely empty won't appear in `pantry.toml` at all. The file represents current inventory; absent items simply don't exist. A depleted staple would be invisible to the very check designed to catch it.
- **Extend `stockup.toml`** with `always_keep: true` — rejected because stockup has a `freezer_capacity_estimate` top-level field and price-mechanics schema that are meaningless for shelf-stable staples. Two use cases, one file, diverging mental model.
- **New `staples.toml`** — chosen. Independent file, simple schema, survives zero-on-hand state, no conflict with stockup semantics.

### `perishable` is a flag on the staple item, not inferred from pantry category

`pantry.toml` has a `category` enum (`pantry | fridge | freezer | spices`). Fridge items could proxy for "perishable," but:
- A staple might never be in pantry (that's the point — it ran out)
- The same item can shift category (eggs: fridge; bulk eggs a member preserves: pantry)
- The staleness check is about the *staple*, not the current storage location

Explicit `perishable: true` on the staple item is clearer and survives pantry absence.

### Staleness threshold is a default constant (7 days), not per-item configurable

A per-item `stale_after_days` field adds complexity without evidence it's needed. Start with a shared default; if users find eggs and milk need different thresholds we can add it in a follow-on. The agent already exercises judgment over the nudge ("you haven't updated eggs in 10 days — do you need some?") so exact thresholds are soft.

### Restock prompt at depletion is a question, not an auto-add

The design explicitly does not auto-add staples to the grocery list on depletion. The user decides. The tool fires the signal; the agent asks. This matches the existing `pantry_low` source intent and keeps the user in control.

### Two tools: `read_staples` and `update_staples`

`update_staples` is **add-only with dedup by normalized name**, plus explicit remove-by-name, mirroring the pattern of `update_stockup` and `update_discovery_sources`. A full-overwrite tool would require reading first and is harder to reason about in multi-tenant contexts.

## Risks / Trade-offs

- **Empty staples list** — a new user with no staples list gets the old (no-prompting) behavior, which is fine. The onboarding seeding step mitigates cold-start.
- **Overlap with stockup** — an item like rice can legitimately appear in both files. That's expected and fine; the flows are independent. Document this in SCHEMAS.md to avoid confusion.
- **Perishable staleness false positives** — if a user updates pantry infrequently, many perishable staples could surface as "stale" at once. The agent should batch these into one natural-language nudge rather than a per-item interrogation.
- **"Low" is freeform** — pantry quantities are strings ("half a bottle", "a few cloves"). The agent judges. This is consistent with the rest of the system's no-portion-math stance and avoids adding a new numeric threshold field.
