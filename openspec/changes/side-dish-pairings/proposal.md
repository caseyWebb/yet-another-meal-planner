## Why

Meal planning proposes mains but ignores sides, so the menus it builds aren't rounded plates — a grilled-protein night arrives with no starch or vegetable beside it. We want the planner to round out the plate, and to **learn** good pairings over time rather than demand an upfront curated pairing table for the whole corpus.

## What Changes

- **New objective recipe frontmatter field `pairs_with: [slugs]`** — a *plating* edge (these are eaten together on one plate), semantically distinct from the existing *production* edges `uses_components` / `produces_components`. It holds **recipe slugs only**, so a side is a real corpus recipe and reuses the existing `verify_pantry_for_recipe` → `import_recipe` / `create_recipe` → draft-disposition machinery and the full ingredient → pantry → grocery-list flow. Defaults to empty; no new write tool is needed (it is objective shared content, so `update_recipe` already persists it).
- **New optional objective recipe frontmatter field `standalone` (boolean)** — the "rounded one-pot / inclusive dish" gate. **Optional and unset by default; never backfilled.** When `standalone: true`, the planner does not prompt for a side. When unset, the agent infers at plan time whether the dish is already a rounded plate and *offers to persist* its verdict (the same learn-and-offer pattern used for aliases).
- **Build validation** for both fields: `pairs_with` slugs must resolve to real recipes (validated exactly as `uses_components` / `produces_components` references are today); `standalone` must be a boolean when present. Both default without warning when absent.
- **`pairs_with` is a growing memory, not a hand-curated table.** It starts empty and accretes. The **bootstrap flow** is how an edge is born: when a non-`standalone` main has an empty `pairs_with`, the agent searches (existing corpus sides first, then the RSS discovery pool, then web import) for a suitable side, proposes 1–2, and on acceptance imports it as a draft recipe **and** records the `pairs_with` edge. Next time that main comes up the memory is already there.
- **Meal-plan flow integration:** a side-rounding step slots in *after* mains are tentatively chosen but *before* the parallel context-gathering batch — so the pricing/availability batch sees the side's ingredients too. Chosen sides fold into the pantry walk; new `pairs_with` edges and side drafts are captured alongside the planned rows at commit time.
- **Scope guard:** savory plate-rounding sides only (starch / veg / salad / bread). The field stays generic (bare slugs) so it can grow, but drinks / wine / dessert pairings are **explicitly deferred** to a later change so the planner doesn't suggest dessert every night.
- **Docs:** update `docs/SCHEMAS.md` (recipe frontmatter) and the meal-plan behavior text in `AGENT_INSTRUCTIONS.md` (the canonical source the plugin is generated from — never hand-edit the generated `plugin/` bundle).

## Capabilities

### New Capabilities
<!-- None — this extends existing capabilities. -->

### Modified Capabilities
- `menu-generation`: adds the side-rounding step (surface `pairs_with`, infer/offer the `standalone` gate, bootstrap a side when the edge is empty) and folds chosen sides into the pantry pre-pass, pricing batch, and capture. A chosen side is a recipe, so it captures as its own `[[planned]]` row — no change to the `meal-planning` meal-plan mechanics.
- `shared-corpus`: adds `pairs_with` and `standalone` to the enumerated set of objective recipe content fields carried at the data-repo root.
- `data-validation`: adds the `pairs_with` slug-resolution check and the `standalone` boolean check to the index build, both warn-free when absent.

## Impact

- **Schema/docs:** `docs/SCHEMAS.md` recipe-frontmatter section; `AGENT_INSTRUCTIONS.md` meal-plan flow (regenerate the plugin via `scripts/build-plugin.mjs`).
- **Build tooling:** `scripts/build-indexes.mjs` — validate `pairs_with` slug resolution (mirroring the existing `uses_components` / `produces_components` validation ~L171–181) and the `standalone` boolean; carry both new objective fields through into `_indexes/recipes.json` (the existing "objective frontmatter" passthrough already covers this — verify, don't special-case).
- **Worker:** no new tool. `update_recipe` already writes arbitrary objective frontmatter (`splitRecipeUpdate` peels only `rating`/`status` to the overlay), so recording a `pairs_with` edge is a plain objective edit. Confirm the Worker's structural write-time validation subset doesn't reject the new keys.
- **No data migration:** existing recipes keep empty `pairs_with` and unset `standalone`; the corpus rounds out lazily as the user plans.
- **Out of scope (deferred):** drink/wine/dessert pairings; any reverse `paired_by` index in `_indexes/`.
