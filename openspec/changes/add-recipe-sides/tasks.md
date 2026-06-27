## 1. Shared side-resolution mechanics (corpus tier)

- [ ] 1.1 In `AGENT_INSTRUCTIONS.md`, add a "Resolving sides for a main" mechanics block to the `<!-- persona: corpus -->` tier, defining the cheapest-first ladder once: `pairs_with` → corpus retrieval (`recipe_semantic_search` over `side_search_terms` with `facets:{course:"side"}`, or `list_recipes({course:"side"})`) → propose/confirm/import → open-world trivial side. Write it against the tools as they stand today.
- [ ] 1.2 State in that block that `pairs_with` is recorded on confirmation of a corpus side (via `update_recipe`), that open-world sides are never recorded, and that an imported side is `course: [side]` and carries no `side_search_terms` (one-level recursion bound).

## 2. recipe-sides flow

- [ ] 2.1 Add a `recipe-sides` flow under "Common flows" in `AGENT_INSTRUCTIONS.md` with skill marker `needs: corpus, discovery` and a description that matches free-form side questions ("good sides for X", "what should I serve with Y") and distinguishes it from a menu request.
- [ ] 2.2 Specify the two entry modes (corpus main → use its `side_search_terms` + `pairs_with`; bare concept → reason the side profile from world knowledge), including the in-session use of a just-imported main's `side_search_terms`.
- [ ] 2.3 Specify the propose→confirm gate for speculative import (propose a few, confirm at the which-sides granularity, then import each on sight) and that the flow is decoupled from planning (no meal-plan, no cart writes).
- [ ] 2.4 Specify that `recipe-sides` is the primary author of `pairs_with`.

## 3. Wire the existing flows to the shared block

- [ ] 3.1 Append a light, single side-pairing offer to the `import-recipe` flow that fires only for a `main` import and hands off to `recipe-sides`.
- [ ] 3.2 Reduce the side-pairing ladder in the `meal-plan` flow to a reference to the shared mechanics, keeping its plan-placement and to-buy logic; reflect that its `pairs_with` writes are opportunistic backfill.
- [ ] 3.3 Reduce the side-composition ladder in the `semantic-meal-plan` flow to a reference to the shared mechanics, with the same backfill framing.

## 4. Docs

- [ ] 4.1 Update the `pairs_with` description in `docs/SCHEMAS.md` to name `recipe-sides` as the primary author and the planners as backfill.
- [ ] 4.2 Confirm `docs/TOOLS.md` needs no contract change (no new tools, no param changes); add a cross-reference to `recipe-sides` only if a tool description's "when" framing warrants it.

## 5. Build & validate

- [ ] 5.1 Run `aubr build:plugin` (with `$GROCERY_MCP_URL` set) and confirm the generated `plugin/grocery-agent/skills/recipe-sides/` skill and the regenerated corpus tier are correct; never hand-edit `plugin/`.
- [ ] 5.2 Run `aubr typecheck` and `aubr test:tooling`; confirm the plugin-build validation passes (`needs` resolve, descriptions unique/slug-shaped).
- [ ] 5.3 Run `openspec validate "add-recipe-sides"` and reconcile any drift between the duplicated-ladder removal and the spec deltas.
