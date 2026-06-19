## Why

When a user says "I'm out of olive oil," the agent updates the pantry — but has no way to know whether to ask "want me to add it to the list?" The current model treats all depletions equally, so either it asks every time (annoying) or never (misses critical items). There's no backing data for the AGENT_INSTRUCTIONS concept of "staples and spices that silently run out."

## What Changes

- **New `staples.toml` per-tenant data file** — a curated opt-in list of items the user doesn't want to run out of. Each item has a `name` (required) and optional `perishable: true` flag.
- **New `update_staples` write tool** — add/remove items from the staples list (add-only with dedup; remove by name). Agent-writable and seeded at onboarding.
- **New `read_staples` read tool** — returns the caller's staples list.
- **Pantry update flow change** — when a remove/depletion is recorded, cross-reference against staples: if the item is a staple, prompt "want me to add it to the shopping list?" If not a staple, just record it silently.
- **Meal plan / shopping list flow change** — at the restocking callout step, check all staples against pantry: missing or low items surface as a prompted restock list (replacing the current model-judgment heuristic).
- **Perishable staleness prompt** — for staples with `perishable: true`, if `last_verified_at` in the pantry is older than a staleness threshold (default 7 days, or absent entirely), surface a "do you still have X?" nudge during the shopping/meal-plan flow.
- **Onboarding addition** — new optional staples-seeding step captures the user's "don't run out of these" list.

## Capabilities

### New Capabilities
- `staples-tracking`: Per-tenant curated list of must-have items. Drives pantry-depletion prompting, shopping-list restock callout, and perishable staleness checks.

### Modified Capabilities
- `data-write-tools`: adds `update_staples` tool (writes `users/<username>/staples.toml`)
- `data-read-tools`: adds `read_staples` tool
- `guided-onboarding`: adds optional staples-seeding step
- `menu-generation`: shopping list restock callout now backed by staples data rather than pure model judgment

## Impact

- **`AGENT_INSTRUCTIONS.md`** — pantry update flow and meal-plan flow updated; onboarding gains a staples step; plugin rebuild regenerates `plugin/`
- **Worker (`src/`)** — two new tools: `read_staples` and `update_staples`
- **`docs/TOOLS.md`** — entries for `read_staples` and `update_staples`
- **`docs/SCHEMAS.md`** — new `staples.toml` schema section
- **No changes to existing data files** — purely additive; absent `staples.toml` degrades gracefully (no staples = no prompting, existing behavior)
