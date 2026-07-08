# Proposal — gate-meal-suggestions-to-mains

## Why

GitHub issue #218: **Fresh Pasta is suggested as a meal.** The cookbook app's suggestion rows
and `propose_meal_plan` surface component/sub-recipes (fresh pasta dough) as dinner mains,
because no meal-suggestion surface gates on the `course` facet — the facet exists, is
classified for the whole corpus, and `filterRecipes` can already gate on it
(`packages/worker/src/recipes.ts`), but nothing sets it by default:

- `propose_meal_plan`'s per-vibe pool (`buildPool`, `packages/worker/src/meal-plan-proposal-tool.ts`)
  filters only on the vibe's own facets — no course gate, so a dough with a plausible embedding
  fills a dinner slot.
- The cookbook browse rows (`packages/worker/src/cookbook-rows.ts`) — picked-for-you ranks the
  whole embedded index against the favorites centroid, and trending ranks anything cooked twice —
  neither looks at `course`.

Production grounding (read-only D1 spikes, 2026-07-08, detailed in design.md) confirmed the
defect and shaped the fix:

- **`fresh-pasta` is classified `["side"]`** and **`homemade-pasta-dough` `["baked_good"]`** —
  a course-contains-`main` gate excludes both immediately at deploy, no data change needed.
- **`spinach-fresh-pasta` is classified `["main"]`** despite being a dough (ingredients:
  spinach, flour, eggs, salt; `side_search_terms` suggests "a simple tomato sauce"). The gate
  alone cannot catch it: the classifier's course prompt (`discovery-classify.ts` `SYSTEM_PROMPT`)
  offers no bucket for a sub-recipe, so the model shoehorns doughs into `main`/`side`/
  `baked_good` inconsistently. The vocabulary needs a **`component`** value, and the corpus must
  **re-converge through the pipeline** (the established gate-clear migration lever, per
  `recipe-facet-derivation` and the 0040 precedent — never manual data edits).
- The gate excludes 49 of 205 recipes (24% are not mains) — a real, correctly-sized exclusion,
  not a corpus wipe-out. **Zero** recipes have an empty/missing effective course today, so the
  fail-open-for-unclassified decision (design D3) has no immediate rows either way.

## What Changes

- **A shared course gate predicate** (fail-open): a recipe is a *meal candidate* when its
  effective `course` is empty (not yet classified — never silently hide an unclassified recipe)
  or includes `main`. One helper, consumed by every gated surface so the semantics cannot drift.
- **`propose_meal_plan` pool gate**: `buildPool` applies the predicate to each vibe's facet-gate
  survivors **by default** — suppressed when the vibe's stored facets pin an explicit `course`
  (the existing `night_vibes.facets.course` escape hatch, e.g. a breakfast-for-dinner vibe).
  Caller `lock`s and `slots[].recipe` pins remain exempt (an explicit caller choice is honored);
  alternates/`alt_similar`/`alt_different` are gated by construction (drawn from the gated pool).
  A pool emptied by the gate surfaces as the existing explicit empty slot, never dropped.
- **Cookbook rows gate**: `readPickedForYou` applies the predicate during candidate assembly;
  `readTrending` applies it to qualified rows (a component someone cooked twice is real cooking
  history, but not a *meal suggestion*).
- **`search_recipes` stays ungated** — it is an explicit-query tool with an optional `course`
  facet; a caller asking for sides/sauces/components must keep getting them. Same for the
  cookbook keyword search and `list_new_for_me` (an inventory/news surface, not a meal
  suggestion — a new dessert is legitimately newsworthy). Deliberate non-changes, spec'd as such
  in design.md.
- **Classifier vocabulary gains `component`**: the course line of the classify prompt names
  `component` (a sub-recipe/building block — doughs, stocks, spice blends, base sauces — not
  plated as its own course), with a few-shot exemplar anchoring a pasta dough →
  `["component"]` + `side_search_terms: []`. `COURSE_SUGGESTIONS` in `src/vocab.js` gains
  `component` so the vault's override dropdown offers it (course stays open-vocab —
  no contract-validator change).
- **Re-convergence migration**: a new `migrations/d1/NNNN` clears the classify gate
  (`UPDATE recipe_facets SET body_hash = NULL`, the 0040 `ingredients_full` precedent), so the
  bounded classify pass re-derives the corpus organically (205 recipes ÷ 6/tick on the 5-minute
  cron ≈ 3 hours, quota-permitting). Authored Tier-B overrides survive by construction (the
  projection-time merge).
- **Acceptance fixture** (verified against production after deploy): `fresh-pasta` and
  `homemade-pasta-dough` stop surfacing in propose pools and picked-for-you at deploy (gate);
  `spinach-fresh-pasta` stops after its reclassification flips it off `main` (pipeline
  convergence, no hand-edit).

## Capabilities

### Modified Capabilities

- **`meal-plan-proposal`** — a new requirement: the per-vibe candidate pool is course-gated to
  mains by default (fail-open for empty course; vibe-facet `course` suppresses the default;
  locks/pins exempt; alternates gated by construction; gate-emptied pool → explicit empty slot).
- **`member-app-differentiators`** — the trending and picked-for-you requirements gain the
  default main-course gate with its fail-open semantics.
- **`recipe-facet-derivation`** — a new requirement: the open course vocabulary names
  `component` for sub-recipes, the classifier is anchored to emit it, and the change ships the
  gate-clear migration so the existing corpus re-converges organically through the bounded
  classify pass.

## Impact

- **One D1 migration** (gate-clear only — no schema change, no data values touched).
- **Worker** (`packages/worker/src/`): `recipes.ts` (the shared predicate),
  `meal-plan-proposal-tool.ts` (`buildPool` default gate), `cookbook-rows.ts` (both reads),
  `discovery-classify.ts` (prompt course line + one exemplar), `vocab.js`
  (`COURSE_SUGGESTIONS` + `component`).
- **Vault**: `aubr build:vault` regenerates the course dropdown options from `vocab.js`
  (CI's `--check` drift gate enforces it).
- **Docs (lockstep)**: `docs/TOOLS.md` (`propose_meal_plan` gains the main-gate guarantee;
  the open course example lists mention `component`), `docs/SCHEMAS.md` (course conventional
  values, if enumerated), `AGENT_INSTRUCTIONS.md` swept for stale course-convention claims.
- **Tests**: unit tests for the predicate (fail-open matrix), the `buildPool` gate + vibe-course
  escape + lock/pin exemption + gate-emptied-pool slot, both cookbook reads, and the classifier
  prompt/exemplar assertions. Member `/api` response shapes are unchanged (same lite rows) —
  no new routes, no `run_worker_first` entry, no app/admin UI change.
- **No behavior change** for `search_recipes`, `read_recipe`, the cookbook keyword search,
  `list_new_for_me`, or any write path.
