# Tasks — gate-meal-suggestions-to-mains

Ordered gate-first (the immediate fix for `fresh-pasta`/`homemade-pasta-dough`), then the
vocabulary + re-convergence (the pipeline fix for `spinach-fresh-pasta`), then docs and the
post-deploy acceptance check. **No spike tasks** — every open question is settled in design.md
(D1–D8) against the code and the production spikes. All work is Worker-side; no member/admin
UI or route change (response shapes are unchanged), so no `run_worker_first` entry and no
Playwright surface change.

## 1. The shared meal-candidate predicate (D2, D3)

- [ ] 1.1 Add an exported `isMealCourse(course: unknown): boolean` to
  `packages/worker/src/recipes.ts` (beside `filterRecipes`, whose course normalization it
  mirrors): normalize scalar/array/missing to a lowercased trimmed string array; return true
  when the array is **empty** (fail-open — not yet classified) or **includes `"main"`**.
  Do NOT change `filterRecipes`' explicit `course` filter (its exact fail-closed containment is
  the `data-read-tools` contract).
- [ ] 1.2 Unit tests (`test/recipes.test.ts` or the module's existing suite): the matrix —
  `["main"]` true, `["main","side"]` true, `["side"]` false, `["component"]` false,
  `["baked_good"]` false, `[]` true, missing/null true, scalar `"main"` true, scalar `"side"`
  false, case/whitespace tolerated.

## 2. propose_meal_plan pool gate (D1, D4, D5)

- [ ] 2.1 `packages/worker/src/meal-plan-proposal-tool.ts` `buildPool`: after computing the
  effective facet set (vibe facets + slot pins), when it carries **no explicit `course`**,
  filter the `filterRecipes` survivors through `isMealCourse`. An explicit `facets.course`
  (from the vibe) suppresses the default entirely (that slot gates by containment as today).
  Locks and `slots[].recipe` pins are untouched (they resolve outside `buildPool`).
- [ ] 2.2 Unit tests (`test/meal-plan-proposal*.test.ts`): a non-main (course `["side"]` /
  `["component"]`) never appears in any slot's main or `alternates`/`alt_similar`/
  `alt_different`; an empty-course recipe still pools (fail-open); a vibe with
  `facets: { course: "breakfast" }` pools breakfast recipes and applies no main-gate; a `lock`
  and a `slots[].recipe` pin of a non-main still fill their slots; a vibe whose entire pool is
  gated away returns the existing explicit empty slot (reason present, empty alternates) while
  the rest of the week proposes; seed determinism is unchanged for an all-mains corpus
  (bit-identical weeks before/after the change when no candidate is gated).

## 3. Cookbook rows gate (D1)

- [ ] 3.1 `packages/worker/src/cookbook-rows.ts` `readPickedForYou`: skip candidates failing
  `isMealCourse(entry.course)` in the assembly loop (beside the favorite/reject/avoid skips).
- [ ] 3.2 `readTrending`: skip qualified rows failing `isMealCourse` (beside the min-signal and
  reject guards).
- [ ] 3.3 Unit tests (`test/cookbook-rows.test.ts`): a non-main near the favorites centroid is
  absent from picked-for-you; an empty-course recipe remains eligible; a twice-cooked non-main
  is absent from trending while a twice-cooked main still trends; ordering/count semantics
  otherwise unchanged.

## 4. Classifier vocabulary: `component` (D6)

- [ ] 4.1 `packages/worker/src/discovery-classify.ts` `SYSTEM_PROMPT` course line: add
  `component` to the example list and a rule sentence — a sub-recipe/building block (fresh
  pasta dough, stock, spice blend, a base sauce used inside other dishes), not plated as its
  own course; components are not mains, so `side_search_terms` is `[]` for them.
- [ ] 4.2 Add one few-shot exemplar to `FEW_SHOT`: a plain fresh pasta dough (flour, eggs;
  knead/rest/roll) → `course: ["component"]`, `protein: null`, `side_search_terms: []`,
  `meal_preppable: true`, season `[]` — the convergence target for the production defect rows.
- [ ] 4.3 `packages/worker/src/vocab.js` `COURSE_SUGGESTIONS`: add `"component"` (suggestion
  list only — do NOT wire course into `validateRecipeContract`). Run `aubr build:vault` so the
  regenerated dropdown matches (CI's `build-vault --check` drift gate).
- [ ] 4.4 Tests: extend the classifier suite (`test/discovery-classify*.test.ts` or equivalent)
  to pin that the prompt names `component` and the exemplar set contains the dough exemplar;
  extend any vocab/vault fixture test that enumerates `COURSE_SUGGESTIONS`.

## 5. Re-convergence migration (D7)

- [ ] 5.1 New `packages/worker/migrations/d1/0042_component_course_reclassify.sql` (next free
  number at implementation time), modeled on `0040_ingredients_full.sql`'s gate-clear block:
  a header comment explaining the intentional whole-corpus reclassification for the
  component-aware course prompt, then `UPDATE recipe_facets SET body_hash = NULL;` — no schema
  change, no facet values touched (no empty-course window; authored overrides survive at merge).
- [ ] 5.2 Verify locally: `npx wrangler d1 migrations apply DB --local`, then confirm the
  classify pass re-derives (bounded per tick) and the projection keeps serving the previous
  facet values for not-yet-reclassified recipes.

## 6. Docs lockstep + acceptance (same pass)

- [ ] 6.1 `docs/TOOLS.md`: `propose_meal_plan` gains the default main-gate guarantee (pool +
  alternates gated; vibe `facets.course` overrides; locks/pins exempt; fail-open for
  unclassified) — and the tool's registered description in `meal-plan-proposal-tool.ts` says
  the same (the tool-description-owns-guarantees boundary). `search_recipes`' course notes and
  `read_recipe`'s open-vocab example lists mention `component` among the conventional values.
- [ ] 6.2 `docs/SCHEMAS.md`: wherever the open `course` conventional values are enumerated, add
  `component`; note the meal-candidate semantics beside the `recipes.course` column if course
  semantics are described there. `docs/ARCHITECTURE.md`: no structural shift — touch only if it
  enumerates course values.
- [ ] 6.3 Sweep `AGENT_INSTRUCTIONS.md` for course-convention claims (e.g. lists of course
  values, side-sourcing guidance) and align — current state only, no history narration.
- [ ] 6.4 Post-deploy acceptance (read-only, against production): immediately after deploy,
  `fresh-pasta` and `homemade-pasta-dough` appear in no propose pool/alternates and no
  picked-for-you/trending response; after convergence (~3 h at 6/tick on the 5-minute cron),
  `SELECT slug, course FROM recipe_facets WHERE slug IN ('fresh-pasta','homemade-pasta-dough','spinach-fresh-pasta')`
  shows no `main` in any of the three (expected `["component"]`), and `spinach-fresh-pasta` has
  left every gated surface. If the model still emits `main` for `spinach-fresh-pasta`, the
  corrective is an authored `course` override via the vault (D7) — never a D1 hand-edit.
