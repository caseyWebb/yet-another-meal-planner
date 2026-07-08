# recipe-facet-derivation Specification

## Purpose
TBD - created by archiving change derive-recipe-facets. Update Purpose after archive.
## Requirements
### Requirement: A whole-corpus classify pass derives recipe facets on the cron

The Worker SHALL run a scheduled **classify pass** that derives recipe facets from the recipe body, generalizing the discovery sweep's classifier (`src/discovery-classify.ts`) over the **entire** R2 corpus rather than only new discovery candidates. The pass SHALL run in the `scheduled()` handler, SHALL read recipe bodies directly from the R2 corpus (a binding call, not an external subrequest), SHALL classify on the small Workers AI model with the shared contract validator as the backstop and a corrective retry, and SHALL bound the work per tick by **both** a recipe-count cap and a wall-clock time budget (deferring the remainder to later ticks), so a large backlog cannot overrun the scheduled invocation's resource budget and starve the jobs that run after the classify pass in the same tick. It SHALL write a `health:job` record for the run, like the other scheduled jobs.

#### Scenario: The pass classifies the whole corpus, not just discoveries

- **WHEN** the classify pass runs and a corpus recipe has no derived facets yet
- **THEN** it classifies that recipe from its body and stores the derived facets in D1, the same classifier the discovery sweep uses

#### Scenario: Work is bounded per tick on both budgets

- **WHEN** more recipes need classification than the per-tick count cap allows, or classifying them would exceed the per-tick wall-clock budget
- **THEN** the pass classifies within the count cap and the wall-clock budget this tick — whichever it reaches first — and defers the rest to later ticks, recording a pending count (and a `timed_out` flag when the time budget stopped it) in its health summary

#### Scenario: The classifier is shared, not duplicated

- **WHEN** the discovery sweep and the whole-corpus pass each classify a recipe
- **THEN** both invoke the same extracted classifier module (one prompt, one model, one contract-validated retry loop), so the two paths cannot diverge

### Requirement: Descriptive facets are derived; the hard gates and identity stay authored

Recipe facets SHALL be placed by their authoring story. **Tier A** facets — `ingredients_key`, `ingredients_full`, `perishable_ingredients`, `side_search_terms`, and `meal_preppable` — SHALL be **derived only**: produced by the classify pass into D1 and absent from authored frontmatter, with no human-corrector path. **Tier B** facets — `protein`, `cuisine`, `course`, `season`, `tags` — SHALL be **derived by default with an optional authored override** (see the override requirement). **Tier C** — `dietary` and `requires_equipment` (the hard gates) plus the identity fields (`title`, `source`) — SHALL remain authored frontmatter, unchanged by this capability. The two hard gates are deliberately retained as authored because a misclassified `dietary` risks allergen exposure and a misclassified `requires_equipment` silently hides a makeable recipe.

#### Scenario: A Tier A facet is derived, never authored

- **WHEN** a recipe is classified
- **THEN** `ingredients_key`, `ingredients_full`, `perishable_ingredients`, `side_search_terms`, and `meal_preppable` are written to D1 by the classify pass and are not required, validated, or read from authored frontmatter

#### Scenario: The hard gates stay authored

- **WHEN** a recipe is written or reconciled
- **THEN** `dietary` and `requires_equipment` remain authored frontmatter fields owned by the author, and the classify pass does not overwrite them

### Requirement: Tier B facets resolve to the authored override or the derived value

For a Tier B facet, the **effective** value SHALL be the authored frontmatter value when one is present, and the classifier's derived value otherwise (`effective = authored ?? classified`). `tags` SHALL be the **exception**: its effective value SHALL be the **union** of the authored and classified tags (deduplicated), so an editorial tag a human adds never discards the classifier's tags. An authored Tier B override SHALL still be validated against its controlled vocabulary where one exists (`protein`, `cuisine`, `season`) — an off-vocabulary override SHALL be rejected at write time exactly as today.

#### Scenario: An authored override wins over the classifier

- **WHEN** a recipe carries an authored `cuisine: thai` and the classifier derives `cuisine: chinese`
- **THEN** the effective `cuisine` is `thai` (the authored override wins) and the classifier's value is not used

#### Scenario: An absent Tier B facet falls back to the classifier

- **WHEN** a recipe omits `protein` in frontmatter
- **THEN** the effective `protein` is the classifier's derived value

#### Scenario: Tags union, not replace

- **WHEN** a recipe carries an authored `tags: [thanksgiving]` and the classifier derives `tags: [roast, make-ahead]`
- **THEN** the effective `tags` is the union `[thanksgiving, roast, make-ahead]`, not just the authored tag

#### Scenario: An off-vocabulary override is rejected

- **WHEN** a recipe is written with an authored override `protein: poltry`
- **THEN** the write is rejected with a structured `validation_failed` error, the same controlled-vocabulary gate that applies today

### Requirement: The classify pass is change-gated and override-aware

The classify pass SHALL regenerate a recipe's derived facets only when its inputs change, via a change-detection hash covering the recipe **body** and the authored Tier B overrides the classifier conditions on — so a steady corpus performs no classification work. The classifier SHALL **condition its output on present authored overrides**, so a Tier A facet that depends on a Tier B facet stays consistent with an override: in particular, `side_search_terms` (Tier A) SHALL be non-empty if and only if the **effective** `course` includes `main`, even when `course` is supplied as an authored override that differs from what the model would classify.

#### Scenario: A steady corpus does no classification work

- **WHEN** the classify pass runs and no recipe's body or relevant override has changed
- **THEN** no recipe is reclassified

#### Scenario: An override edit re-triggers classification

- **WHEN** an author changes a recipe's `course` override without editing the body
- **THEN** the change-detection hash changes and the recipe is reclassified, so `side_search_terms` is re-derived consistent with the new effective `course`

#### Scenario: side_search_terms tracks the effective course

- **WHEN** the model would classify a dish as `course: [side]` but the recipe carries an authored override `course: [main]`
- **THEN** the derived `side_search_terms` is non-empty (the main-course rule applies to the effective course)

### Requirement: Derived facets are materialized into the recipe index

The effective facets SHALL be materialized into the D1 `recipes` index (see `recipe-index`) so that every existing reader — `filterRecipes`, the cookbook, the retrospective, the describe pass, semantic search — reads the effective facet from the `recipes` columns **unchanged**, with no read-time join and no reader code change.

#### Scenario: Readers are unchanged

- **WHEN** `search_recipes`, the cookbook, or the retrospective reads a recipe's `protein` or `course`
- **THEN** it reads the materialized effective value from the `recipes` table exactly as before, unaware whether the value was authored or derived

### Requirement: Derived facets are seeded synchronously at import

`create_recipe` SHALL seed a new recipe's derived facets synchronously at import (as it already seeds the `description`), so an agent-imported recipe is fully classified before the next classify tick and is not index-lagged. The scheduled classify pass SHALL remain the authority and SHALL refresh the seed on a later body change. A seed failure SHALL NOT fail the already-persisted import (best-effort, like the description seed) — the classify pass backfills.

#### Scenario: An agent import is not facet-lagged

- **WHEN** `create_recipe` writes a new recipe
- **THEN** it seeds the derived facets synchronously, so the next index projection materializes them without waiting a classify tick

#### Scenario: A direct corpus edit is faceted eventually

- **WHEN** a recipe body is authored directly in the Obsidian/R2 corpus (no `create_recipe` call)
- **THEN** the recipe is unfaceted until the next classify tick derives its facets, and this eventual-consistency lag is not an error

#### Scenario: A seed failure does not fail the import

- **WHEN** the synchronous classify seed errors during `create_recipe`
- **THEN** the recipe is still persisted and the scheduled classify pass backfills its facets on a later tick

### Requirement: Discovery imports derive facets, not freeze them

When the discovery sweep auto-imports a recipe, it SHALL NOT write the classifier's descriptive facets into the authored R2 frontmatter (which would make them permanent authored Tier B overrides the whole-corpus classify pass could never refresh, and Tier A legacy values). It SHALL write only the gates + identity to the authored file and SHALL seed the derived facets into `recipe_facets` from the classification it already produced (no re-classification), so a discovered recipe follows the same derived-facet model as a `create_recipe` import.

#### Scenario: A discovered recipe's facets are derived, not authored

- **WHEN** the discovery sweep imports a candidate it has classified
- **THEN** the authored recipe file carries only the gates + identity, the descriptive facets (`protein`/`cuisine`/`course`/`season`/`tags`/`ingredients_key`/`perishable_ingredients`/`side_search_terms`/`meal_preppable`) are absent from it, and those facets are seeded into `recipe_facets` instead

#### Scenario: The whole-corpus classifier can later refresh a discovered recipe's facets

- **WHEN** the whole-corpus classifier improves and a discovered recipe's body is reclassified
- **THEN** its derived facets update, because they were not frozen as authored overrides in frontmatter

### Requirement: Derived ingredient facets are alias-normalized

The classify pass SHALL normalize the derived `ingredients_key` and `perishable_ingredients` to **full canonical ids** through the shared resolver (the same `normalizeIngredientList` the write path and the discovery path apply, resolving each surface form to its canonical node via the `representative` pointer), so a derived ingredient name lines up across recipes for cross-recipe overlap and pantry matching regardless of surface form — while distinct varieties stay distinct (no base-equality collapse). A term the resolver has not yet placed SHALL normalize to its cleaned form (unchanged behavior) and be enqueued for the capture job, so the overlap sharpens as the identity layer grows. The values stored in `recipe_facets` are the classify-time snapshot; the index projection re-resolves them through the current resolver on every rebuild (see `recipe-index`), so a resolver improvement reaches the projected index — and every reader of it — without reclassifying the recipe.

#### Scenario: Derived perishables of a synonym share one canonical node

- **WHEN** the classify pass derives `perishable_ingredients` for two recipes that each use fresh cilantro under different wording (e.g. "cilantro" and "fresh coriander leaves")
- **THEN** both record the same canonical entry (synonym-merged), so the two recipes' use of that perishable can be compared directly, whereas two distinct varieties (e.g. cheddar vs mozzarella) record distinct entries and do not falsely overlap

#### Scenario: An unplaced term still normalizes and is captured

- **WHEN** the classify pass derives an ingredient the resolver has not yet placed
- **THEN** it records the cleaned term (as today) and enqueues the surface form, so a later capture tick can merge it into its canonical node

#### Scenario: A resolver improvement reaches the index without reclassification

- **WHEN** a stored derived ingredient value gains a resolution after the recipe was classified (a new alias is written or its node merges into a survivor)
- **THEN** the recipe's facet gate hash is unchanged and no classifier call is spent, and the next index projection writes the surviving canonical id into the `recipes` row

### Requirement: meal_preppable is a derived boolean facet

`meal_preppable` SHALL be a derived boolean facet produced by the classify pass (good freezer/batch candidate), placed in Tier A (derived only, absent from authored frontmatter and the required-field contract).

#### Scenario: meal_preppable is classified, not authored

- **WHEN** the classify pass classifies a recipe
- **THEN** it derives a boolean `meal_preppable` into D1, and no `meal_preppable` is required or read from authored frontmatter

### Requirement: One-time strip-on-agreement migration of the existing corpus

The change SHALL migrate the existing corpus by **strip-on-agreement**, driven by an agreement evaluation that runs the generalized classifier over the current authored corpus (the existing authored facets serve as ground-truth labels) and reports per-field agreement. **Tier A** frontmatter facets SHALL be stripped unconditionally (the classifier is authoritative). For each **Tier B** facet, the authored frontmatter value SHALL be stripped where the classifier agrees with it and **kept as an authored override** where they disagree — so the frontmatter that survives the migration is exactly the set of human corrections. The corpus SHALL be snapshotted before the strip as the rollback artifact for the lossy frontmatter rewrite.

#### Scenario: Agreement strips, disagreement is preserved as an override

- **WHEN** the migration processes a recipe whose authored `cuisine` matches the classifier but whose authored `protein` differs
- **THEN** the `cuisine` frontmatter is stripped (derived henceforth) and the `protein` frontmatter is kept as an authored override

#### Scenario: Tier A is stripped unconditionally

- **WHEN** the migration processes any recipe
- **THEN** its `ingredients_key`, `perishable_ingredients`, and `side_search_terms` frontmatter are removed regardless of agreement, because they are derived-only

#### Scenario: The agreement eval precedes the strip

- **WHEN** the migration is prepared
- **THEN** the agreement eval first reports per-field agreement over the authored corpus, and a corpus snapshot is taken before any frontmatter is rewritten

### Requirement: A transient classify failure does not advance the gate

The classify pass SHALL distinguish a **transient** failure (an `env.AI` / storage hiccup, including Workers AI quota exhaustion — error 4006) from a **permanent** failure (a contract `validation_failed` the retry budget couldn't fix). On a **transient** failure it SHALL NOT advance the recipe's `body_hash` gate and SHALL NOT write an empty `recipe_facets` row — so the recipe **retries on a later tick** and, meanwhile, the projection keeps merging the **authored frontmatter** rather than blank facets. Only a **permanent** contract failure SHALL park the recipe (advance the gate with empty facets) so it is not re-spent every tick. On a quota (4006) failure the pass SHALL stop the tick early (the remaining recipes would fail identically) and report `quota_exhausted` in its health summary.

#### Scenario: A transient failure leaves the recipe un-gated to retry

- **WHEN** a recipe's classification fails with a transient `env.AI` error (e.g. quota exhausted)
- **THEN** the gate is not advanced and no empty `recipe_facets` row is written, so the recipe is reclassified on a later tick and the projection keeps using its authored frontmatter facets meanwhile

#### Scenario: A permanent contract failure parks the recipe

- **WHEN** a recipe's classification cannot pass the recipe contract within the retry budget
- **THEN** the pass parks it — advancing the gate with empty facets — so the unclassifiable recipe is not re-spent on every tick

#### Scenario: Quota exhaustion stops the tick and is flagged

- **WHEN** a classify call returns Workers AI's 4006 daily-allocation error
- **THEN** the pass stops the tick (it does not keep spending requests that will fail the same way) and reports `quota_exhausted` in its health summary, which surfaces as the `/health` AI quota signal

### Requirement: The full ingredient list is a derived Tier A facet

The classify pass SHALL derive `ingredients_full` — the recipe's **complete** ingredient list as plain ingredient names (no amounts, no prep clauses, no optional-markers; a disjunctive line records its primary) — from the body's ingredient section, as an additional output field on the **same** classify call that derives `ingredients_key` (no additional model call per recipe). `ingredients_full` SHALL be normalized and captured exactly as the existing derived ingredient facets: alias-normalized to full canonical ids through the shared resolver at classify time, novel terms enqueued for the capture job, stored on `recipe_facets` as the classify-time snapshot, projected into `recipes`, and re-resolved through the current resolver at each index projection. The import-time seeding paths SHALL carry the field so a newly created or discovery-imported recipe is fully derived before the next cron tick. The migration adding the columns SHALL clear the classify gate so the existing corpus reclassifies organically over the bounded scheduled ticks — no manual backfill; consumers (the to-buy derivation) SHALL treat a not-yet-derived recipe as an explicit reported gap, never as an empty ingredient list.

#### Scenario: The full list is complete where the key list is selective

- **WHEN** a recipe whose body lists twelve ingredients is classified
- **THEN** `ingredients_full` carries all twelve as normalized names while `ingredients_key` still carries only the 5–7 defining ones, and both use the same canonical ids for the ingredients they share

#### Scenario: Names are canonical and amount-free

- **WHEN** the body lists "2 lbs boneless chicken thighs, cut into strips" and "¼ cup fresh cilantro, chopped (optional)"
- **THEN** `ingredients_full` records the canonical ids for chicken thighs and cilantro — no quantities, prep clauses, or optionality markers

#### Scenario: The existing corpus converges through the pipeline

- **WHEN** the migration lands on a corpus of already-classified recipes
- **THEN** the classify gate is cleared and the bounded classify pass re-derives the corpus over subsequent ticks, with each not-yet-reclassified recipe reported as underived by consumers in the interim — no hand-run backfill and no silent empties

#### Scenario: A body edit re-derives the list

- **WHEN** an authored recipe body's ingredient section changes
- **THEN** the facet gate hash changes and the next classify tick re-derives `ingredients_full` (with `ingredients_key` and the other derived facets), so downstream derivations follow the edit

### Requirement: Component sub-recipes classify as `component`, not a meal course

The classifier's open `course` vocabulary SHALL name **`component`** — a sub-recipe or building block (a fresh pasta dough, a stock, a spice blend, a base sauce made to be used inside other dishes) that is not plated as its own course — in the classify prompt's course guidance, anchored by a few-shot exemplar (a plain pasta dough → `course: ["component"]` with `side_search_terms: []`), so the model stops scattering sub-recipes across `main`/`side`/`baked_good`. A component is not a main, so its derived `side_search_terms` SHALL be empty (the existing effective-course rule). The vault's `course` override dropdown suggestions (`COURSE_SUGGESTIONS` in `src/vocab.js`) SHALL offer `component`; `course` SHALL remain open-vocabulary (shape-validated only — no contract-validator change). The change SHALL ship a D1 migration that clears the classify gate (`body_hash`) so the existing corpus **re-converges organically** through the bounded scheduled classify pass — stored facet values remain in place until each recipe's re-classification overwrites them (no empty-facet window), authored Tier-B overrides survive by construction (the projection-time merge), and no production row is hand-edited.

#### Scenario: A pasta dough classifies as a component

- **WHEN** the classify pass processes a sub-recipe body (e.g. a fresh pasta dough: flour, eggs; instructions to knead, rest, and roll)
- **THEN** the derived `course` is `["component"]` and the derived `side_search_terms` is `[]`

#### Scenario: The existing corpus converges through the pipeline

- **WHEN** the migration lands on the already-classified production corpus (including the observed defect rows: `fresh-pasta` classified `["side"]`, `homemade-pasta-dough` `["baked_good"]`, `spinach-fresh-pasta` `["main"]`)
- **THEN** the classify gate is cleared and the bounded pass re-derives every recipe over subsequent ticks with the component-aware prompt, each recipe keeping its previous derived facets until its re-classification lands — no manual backfill, no hand-edited rows, no empty-course window

#### Scenario: An authored course override still wins

- **WHEN** a recipe carries an authored `course` override and is re-classified after the gate-clear
- **THEN** the projected effective `course` is the authored override, exactly as before — the re-convergence cannot clobber a human correction

#### Scenario: The vault offers component as an override option

- **WHEN** the authoring vault's `course` dropdown is generated from `src/vocab.js`
- **THEN** `component` is among the offered suggestions while the field stays open (an off-list course value still passes validation)

