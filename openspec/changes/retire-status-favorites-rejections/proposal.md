## Why

The per-tenant recipe `status` lifecycle (`active`/`draft`/`rejected`/`archived`) is an **opt-in** model: a recipe is effective `draft` — invisible to the default `list_recipes` — until a member sets it `active`. That existed only because dump-and-reason loaded the whole *active* set into context, so a member needed a small curated set. Semantic retrieval (`recipe_semantic_search`) makes that crutch obsolete: you retrieve relevant recipes from the whole corpus rather than dumping a curated set. With retrieval shipped, the opt-in lifecycle is dead weight, and the deferred semantic-meal-plan work (5.1 draft-retirement, the `rating` column drop) can land as one coherent simplification.

This collapses the overlay to what it actually expresses: a member's **favorites and rejections**. The whole shared corpus becomes everyone's candidate set by default; the overlay records only the two deviations from neutral.

## What Changes

- **BREAKING — opt-in → opt-out visibility flip.** A recipe with no overlay row is now **neutral (available)** instead of effective `draft`. `list_recipes` default becomes "the whole corpus minus my rejects" rather than "my active set." This is the one irreversible behavior change.
- **BREAKING — retire `status`.** Drop the `active`/`draft`/`rejected`/`archived` lifecycle from the per-tenant overlay. `rejected` becomes a `reject` mark; `active`/`draft` rows are deleted (neutral = no row).
- **BREAKING — drop `rating`.** The overlay `rating` column (inert since the favorite cutover backfilled `rating >= 4 ⇒ favorite`) is removed.
- **Drop `archived` entirely** — no group-retire mechanism. It is already vestigial (the build strips all frontmatter status and no longer hard-fails on cooking-log history). To retire a recipe, delete the file; retrospective degrades gracefully (an orphaned cooking-log slug counts toward cadence and falls into `"unknown"` protein/cuisine, never an error).
- **Overlay becomes `{ favorite | reject }`** — mutually exclusive, per-tenant, a row exists iff favorited or rejected. `reject` is enforced as a **hard gate** in `filterRecipes` and `recipe_semantic_search` so a rejected recipe never surfaces.
- **Imports land in the corpus directly** — `create_recipe` stops stamping `status: draft`; an imported recipe is immediately available (this also dissolves the build-lag knot that made 5.1 hard — there is no `active` to set on a not-yet-indexed slug).
- **Ready-to-eat gets the same collapse** — `add_draft_ready_to_eat` / `update_ready_to_eat` lose `draft`/`active`/`rating` and gain `favorite` + `reject`, mirroring recipes.
- **Tooling** — replace `set_recipe_status` with a per-tenant `toggle_reject` (kept distinct from the group-wide `reject_discovery` URL suppression); keep `toggle_favorite`.
- **Onboarding** — `configure-grocery-profile` loses the "activate ~12–18 starter recipes" step; cold-start personalization comes from the taste/diet profile + retrieval.
- **Rotation** ("recipes I make regularly") is covered by favorites + a `diet_principles` line the planner already reasons over — **no new schema** (advanced rotation tooling is explicitly out of scope).

## Capabilities

### New Capabilities
<!-- none — this is a simplification of existing capabilities -->

### Modified Capabilities
- `data-write-tools`: `set_recipe_status` → `toggle_reject`; the overlay write model is `favorite`+`reject` (no `status`, no `rating`); ready-to-eat disposition collapses to `favorite`+`reject`.
- `data-read-tools`: `list_recipes` default = corpus minus the caller's rejects (no `active` gate); the overlay merge surfaces `favorite`/`reject`, never `status`/`rating`.
- `recipe-discovery`: `create_recipe` no longer defaults `status: draft`; an imported recipe lands as an available corpus recipe.
- `recipe-import`: imported recipes are available immediately (no draft limbo, no separate later activation/disposition step).
- `menu-generation`: the candidate set is the corpus minus rejects; there is no `draft` de-prioritization or "drafts sit until dispositioned" behavior.
- `guided-onboarding`: drop the starter-corpus activation step; a new member's whole group corpus is available by default.
- `data-validation`: drop the recipe `status` controlled-vocabulary check (`active`/`draft`/`rejected`/`archived`) and the ready-to-eat `status`/`rating` checks; lingering values are tolerated and ignored rather than validated.

(`cooking-history` needs no spec change: dropping `archived` relies on deletion being unconstrained and retrospective resolving an orphaned cooking-log slug to `"unknown"` — both already the verified behavior.)

## Impact

- **D1 migration** — drop `overlay.rating`; collapse `overlay.status` to a `reject` flag (delete `active`/`draft` rows, keep `rejected` as `reject`); same for `ready_to_eat` (drop `rating`, `status` → `reject`). Mostly subtraction; the irreversible part is the visibility-default flip.
- **Worker** — `src/overlay.ts`, `src/profile-db.ts` (overlay + ready-to-eat read/write), `src/recipes.ts` (`filterRecipes` reject gate + default), `src/tools.ts` (`list_recipes` / `recipe_semantic_search` reject gate), `src/write-tools.ts` (`toggle_reject`, ready-to-eat collapse), `src/discovery.ts` (`create_recipe` no draft default), `src/validate.ts` + `scripts/build-indexes.mjs` (drop the status enum check).
- **Persona** (`AGENT_INSTRUCTIONS.md` → regenerated plugin) — `import-recipe`, `menu-plan`, `add-recipe-feedback`, `add-ready-to-eat-feedback`, `configure-grocery-profile`, and the rotation guidance.
- **Docs** — `docs/TOOLS.md`, `docs/SCHEMAS.md`, `docs/ARCHITECTURE.md`.
- **Out of scope** — making retrieval the default planner (retiring dump-and-reason); semantic dedup; any advanced rotation / "my list" tooling; a group-wide corpus-recipe retire.
