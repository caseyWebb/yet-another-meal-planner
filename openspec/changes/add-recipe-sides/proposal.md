## Why

Finding a side that completes a plate is a real, recurring user need — both right after importing a main ("what goes with this?") and as a free-form question ("good sides for grilled swordfish?"). Today that logic exists only as a sub-step *inside* a week-long meal plan: the side-resolution ladder is written out separately in classic menu-gen and in the experimental semantic planner, and `pairs_with` (the plating edge) is grown only incidentally, as a side effect of accepting a side onto a plan. There is no flow for **corpus-building** sides decoupled from planning, and no skill description that a "good sides for X" question can match. This change gives sides a home.

## What Changes

- **New `recipe-sides` flow/skill** — a standalone entry point for "sides for X", with two entry modes: X is a corpus main (use its `side_search_terms` + `pairs_with`) or X is a bare dish concept not in the corpus (reason the side profile from world knowledge, then run the ladder). It is corpus-building, **decoupled from planning** — it never touches the meal plan or the cart.
- **Side-resolution becomes shared corpus-tier mechanics** — the cheapest-first ladder (`pairs_with` → corpus retrieval → propose/confirm/import → open-world trivial) is factored into the corpus persona tier once, the way the import mechanics already are, and referenced by `recipe-sides`, classic menu-gen, and the semantic planner instead of being re-specified in each.
- **`recipe-sides` is the primary author of `pairs_with`** — asserting "these sides plate with this main" is exactly what this flow does, so it records the edge via `update_recipe`. Meal-plan flows **backfill** the edge opportunistically but are no longer the primary driver.
- **Propose → confirm gate for speculative import** — when the corpus has no or few matching sides, the flow *proposes* a few sides to search for and asks before going to the web. The "yes" is at *which sides*, not per-recipe; once chosen, each is imported on sight via the existing import mechanics. This is the deliberate exception to "import on sight without asking", because these are agent-proposed, speculative additions to the shared corpus, not a recipe the user handed over.
- **One level of recursion** — chosen sides are imported via the standard import mechanics, classified `course: [side]`. Sides carry no `side_search_terms`, so importing a side never triggers another round of side-search; the recursion is bounded by construction.
- **`import-recipe` hands off** — after a successful import of a `main`, the import flow ends with a one-line offer to line up sides, handing off to `recipe-sides`.

## Capabilities

### New Capabilities
- `recipe-sides`: the standalone sides flow — its two entry modes, the shared cheapest-first side-resolution ladder, the propose→confirm→import gate for speculative side import, the one-level recursion bound, `recipe-sides` as primary `pairs_with` author, and the `import-recipe` handoff offer.

### Modified Capabilities
- `menu-generation`: the existing side-pairing requirements ("Plate-rounding with side pairings", "Side pairing bootstrap when the edge is empty") now defer to the shared side-resolution mechanics, and meal-plan's role in `pairs_with` becomes opportunistic backfill rather than primary authorship.
- `experimental-meal-planning`: the semantic planner's side composition defers to the same shared mechanics and the same `pairs_with` authorship split.

## Impact

- **Persona source / generated plugin:** `AGENT_INSTRUCTIONS.md` — a new corpus-tier "Resolving sides for a main" mechanics block, a new `recipe-sides` flow under Common flows (`needs: corpus, discovery`), a one-line handoff offer appended to the `import-recipe` flow, and the dedup of the duplicated ladders in `meal-plan` and `semantic-meal-plan` to reference the shared block. `aubr build:plugin` regenerates `plugin/` (never hand-edited).
- **Tools:** no new tools and no contract changes — `recipe-sides` composes existing ones (`recipe_semantic_search` / `list_recipes` for retrieval as they stand today, `parse_recipe` + `create_recipe` for import, `update_recipe` for the `pairs_with` edge, `read_recipe`). The unified-search-tool graduation is a separate, in-flight change; this flow inherits the rename when it lands.
- **Docs:** `docs/TOOLS.md` / `docs/SCHEMAS.md` need no shape changes (`pairs_with` and `side_search_terms` already documented); a note that `recipe-sides` is the primary `pairs_with` author belongs in the `pairs_with` SCHEMAS description.
- **No data-model migration** — built entirely on the existing `pairs_with`, `side_search_terms`, and `course` fields.
