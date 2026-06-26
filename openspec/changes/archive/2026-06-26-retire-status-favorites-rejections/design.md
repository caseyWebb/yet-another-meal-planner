## Context

The per-tenant recipe overlay shipped (via `d1-profile`, then the favorite cutover) as `overlay(tenant, recipe, favorite, status)` with an inert legacy `rating` column. `status` is a four-value lifecycle (`active`/`draft`/`rejected`/`archived`), and a recipe with no overlay row reads as effective `draft` (`DEFAULT_STATUS`), which `list_recipes` hides by default. The parallel per-tenant ready-to-eat catalog carries the identical `status` (`active`/`draft`/`rejected`) + `rating`.

`status` does four jobs: (1) an **opt-in gate** — `active` vs effective-`draft` is "which recipes a member has chosen into their rotation"; (2) **import limbo** — new imports land `draft` until dispositioned; (3) **rejection**; (4) **archival** (`archived` — a manual, history-preserving retire). The semantic-meal-plan change made (1) obsolete (retrieval surfaces from the whole corpus instead of dumping a curated active set), which is why retiring `draft` (task 5.1) and dropping `rating` were deferred — they only make sense once retrieval exists. It now does.

Grounding the current state (verified in code): `archived` is **already vestigial** — the build strips all frontmatter `status` before projecting to D1 (`SUBJECTIVE_FIELDS`) and no longer reads the cooking log, so a hand-`archived` recipe lands in the index as a normal, effective-`draft` recipe. And a recipe with cooking-log history can be deleted freely (the old "build hard-fails on a dangling log slug" constraint is gone); retrospective resolves a missing slug to `"unknown"` (`e.protein ?? "unknown"`) while still counting it toward cadence.

## Goals / Non-Goals

**Goals:**
- Collapse the per-tenant overlay to exactly the two marks it expresses: `favorite` (loved) and `reject` (hidden-from-me), with neutral = no row.
- Flip recipe visibility from **opt-in** (invisible until activated) to **opt-out** (the whole corpus is available; reject to hide).
- Drop the inert `rating` and retire the `status` lifecycle and `archived`.
- Apply the same collapse to the ready-to-eat catalog for consistency.
- Land the deferred 5.1 + rating-drop in one coherent move.

**Non-Goals:**
- Making retrieval the default planner / retiring dump-and-reason (`list_recipes` may keep dumping the whole non-rejected corpus). That coupling is real but separable; this change accepts the dump.
- Semantic dedup, a group-wide corpus-recipe retire, and any advanced rotation / "my curated list" tooling.

## Decisions

### Decision: Opt-in → opt-out is the core change (not a refactor)

A recipe with no overlay row becomes **neutral (available)**, not effective-`draft`. `list_recipes` default = "corpus minus my rejects." The opt-in curated-active-set affordance is removed.

- **Why over keeping a lightweight `active`:** the active set existed to keep the *dumped* set small; retrieval ranks the whole corpus instead, so a per-member opt-in list is a maintenance chore that goes stale. "Recipes I make regularly" is recovered, more honestly, from **revealed preference** — favorites + the freshness/`last_cooked` rotation + a `diet_principles` line ("I like to make X regularly") the planner already reasons over. YAGNI on an explicit rotation list.
- **Consequence:** this is the one **irreversible** behavior in the change. Everything else is subtraction.

### Decision: Overlay = two mutually-exclusive marks, keeping the shipped `favorite` column

`overlay(tenant, recipe, favorite, reject)` — both booleans; a row exists iff favorited or rejected; favoriting clears a reject and vice-versa (enforced in the tools as an invariant).

- **Why over a single `disposition` enum (`'favorite' | 'reject'`):** the two are queried by *different* consumers — the taste re-rank scans `WHERE favorite`, the visibility gate scans `WHERE NOT reject` — so two columns read cleaner than `disposition = …` on both paths, and it leaves the already-shipped `favorite` column and `toggle_favorite` untouched (the change becomes `status → reject` + drop `rating`). The enum is marginally tidier conceptually but buys nothing.

### Decision: `reject` is a hard gate, enforced once

Rejection excludes a recipe from `filterRecipes` (so `list_recipes` and the production flow) **and** from `recipe_semantic_search` candidates — a rejected recipe never surfaces for that member. Implemented as a single shared predicate so the two paths can't drift.

- **Distinct from `reject_discovery`:** that suppresses a *discovery URL* group-wide *before* import; this per-tenant `reject` acts on a *corpus slug* for one member. Same word, different surface — keep them separate. (Naming of the new tool is an open question: `toggle_reject` vs `hide`/`unhide`.)

### Decision: Drop `archived` — delete + graceful orphans, no group-retire

No mechanism replaces `archived`. To retire a recipe, delete the file.

- **Why over resurrecting `archived` as a shared build-excluded flag:** it's currently dead, deletion is now unconstrained, and retrospective already degrades an orphaned cooking-log slug to `"unknown"` (counted toward cadence, dropped from the `underused` list which iterates the live index). Group-wide "this recipe turned out bad" is rare; duplicates are the deferred semantic-dedup's job. A new shared-retire mechanism is YAGNI.

### Decision: Imports land available (no draft); `create_recipe` stops stamping `status`

An imported recipe is a normal corpus recipe immediately — for everyone, by the opt-out default.

- **Why:** this is the disposition collapse the experimental skill already *claims*. It also dissolves the build-lag knot that made 5.1 hard: there is no per-tenant `active` to set on a slug that isn't in D1 until the post-push build runs. (The embedding-reconcile lag is unaffected — a just-imported recipe is still "not yet ranked" by semantic search until embedded, which is already handled.)

### Decision: Ready-to-eat gets `favorite` + `reject` too

`add_draft_ready_to_eat` / `update_ready_to_eat` lose `draft`/`active`/`rating`; an RTE item gains `favorite` + `reject` mirroring recipes.

- **Why explicit favorite, given RTE favorites are also frequency-derived:** retrospective already ranks `ready_to_eat_favorites` by grab-frequency from the cooking log, so an RTE favorite is partly redundant — but symmetry with the recipe model (one disposition shape, one set of verbs) is worth more than shaving one column, and an explicit favorite lets a member mark an RTE item they like before the frequency signal accrues. The frequency-derived favorites coexist as a separate, emergent signal.

## Risks / Trade-offs

- **The opt-in→opt-out flip is irreversible.** → Accept it deliberately; it is the point of the change. A rollback can re-add columns but cannot restore the "curated active set" semantics for members who relied on them (none do yet at current scale).
- **`list_recipes` now dumps the whole corpus minus rejects, including fresh aggressive imports** (no `draft` de-prioritization to thin the dump). → Acceptable while the corpus is friend-group scale; it is a concrete nudge toward making retrieval the default planner (the deferred 6.3), not a blocker.
- **`reject` must gate every surfacing path or a "hidden" recipe leaks.** → One shared predicate consumed by `filterRecipes` and `recipe_semantic_search`; unit-test the gate on both.
- **Migration drops data** (the `active`/`draft` distinction; `rating` values). → `rating` is already inert; the `active`/`draft`→neutral collapse is the intended semantics, not loss. Keep the migration as pure subtraction so it is easy to reason about.
- **Two "reject"s could confuse.** → Tool naming + docs make the per-tenant (slug) vs group-wide (URL) distinction explicit.

## Migration Plan

1. **D1 migration (subtraction):** drop `overlay.rating`; collapse `overlay.status` → a `reject` flag (delete `active`/`draft` rows; `rejected` → `reject = 1`); same for `ready_to_eat` (drop `rating`, `status` → `reject`).
2. **Worker:** overlay + ready-to-eat read/write model (`favorite`/`reject`); `filterRecipes` reject gate + neutral default; `recipe_semantic_search` reject gate; `set_recipe_status` → `toggle_reject`; ready-to-eat tool collapse; `create_recipe` stops defaulting `status: draft`.
3. **Validator/build:** drop the recipe `status` controlled-vocabulary check; keep stripping any lingering frontmatter `status` (harmless).
4. **Persona + plugin rebuild:** `import-recipe`, `menu-plan`, `add-recipe-feedback`, `add-ready-to-eat-feedback`, `configure-grocery-profile`, rotation guidance.
5. **Docs:** TOOLS / SCHEMAS / ARCHITECTURE.

**Rollback:** revert the Worker + persona; re-add the dropped columns by migration (values in dropped columns are not recovered). The visibility-default flip is the only part that cannot be cleanly un-shipped, by design.

## Open Questions

- **Tool naming:** `toggle_reject` vs `hide`/`unhide` for the per-tenant reject (to keep it visually distinct from the group-wide `reject_discovery`).
- **Frontmatter `status` on existing recipe files:** leave it (the build already strips/ignores it) or run a one-time cleanup pass to remove `status:` lines? Lean: leave; optional cosmetic cleanup.
- **Is `reject` ever a group signal?** Favorites surface a group count; rejections are currently private. Keep private unless a "N members hid this" signal proves useful later.
