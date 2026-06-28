## Context

Recipe facets live in authored R2 frontmatter today, but most are not authored in any meaningful sense: they are AI-classified once — by the frontier model in chat at `create_recipe`, or by the discovery sweep's `src/discovery-classify.ts` (mistral-small-3.1-24b, contract-validated with a corrective retry) — and frozen into the file. The system already states the rule this violates (`derived-recipe-metadata`): *a field lives in frontmatter iff a human is its author or corrector of record; a purely-derived field lives in D1.* `description` already moved to `recipe_derived` under that rule.

Three facts shape the design:

1. **The classifier already exists and already produces 10 of the 11 target fields** (`CLASSIFIED_FIELDS` in `discovery-classify.ts`): `protein, cuisine, course, time_total, ingredients_key, dietary, season, tags, perishable_ingredients, requires_equipment, side_search_terms`. Only `meal_preppable` is missing (it does not exist in the codebase — it is a doc example with no consumer). The classifier validates against the same shared `recipe-contract.js` the write path uses.
2. **The describe pass is deliberately body-free.** `src/recipe-embeddings.ts` reads facets from the D1 `recipes` index (`LOAD_FACETS_SQL`), never the body, and is `content_hash`-gated to ~0 steady-state work. Classification, by contrast, *requires* the body.
3. **The two hard gates carry real consequences.** `dietary` (a wrong "gluten-free" → allergen exposure) and `requires_equipment` (a wrong tag silently hides a makeable recipe) are the only facets whose misclassification is more than a mis-sort.

The guiding principle: **humans author the gates and the identity; the AI derives the descriptive facets.**

## Goals / Non-Goals

**Goals:**
- Generalize the existing discovery classifier into a whole-corpus, body-driven, cron-gated classify pass, reused (not reimplemented) by both the new pass and the discovery sweep.
- Move the descriptive facets out of authored frontmatter into cron-derived D1, materialized into the `recipes` index so every existing reader is unchanged.
- Preserve a human-override path for the Tier B facets, and full human authorship for the Tier C gates.
- Migrate the existing corpus by strip-on-agreement, so surviving frontmatter facets are exactly the human corrections.
- Keep agent imports index-lag-free (synchronous seed, as `description` already does).

**Non-Goals:**
- Moving `dietary` or `requires_equipment` off authored frontmatter (deliberately retained — the hard gates).
- Changing the discovery sweep's classify/import *behavior* beyond consuming the extracted shared module.
- Changing any recipe reader (`filterRecipes`, cookbook, retrospective, semantic search, the describe pass) — the merge is materialized into `recipes`, so reads are untouched.
- Replacing brute-force facet storage with Vectorize or a read-time JOIN architecture.

## Decisions

### D1 — Three-tier field placement
- **Tier A (pure derive, removed from frontmatter):** `ingredients_key`, `perishable_ingredients`, `side_search_terms`, `meal_preppable`. No human-corrector path; the classifier is authoritative. These already had no real authoring story (`perishable_ingredients`/`side_search_terms` are documented as derived/memoized; `ingredients_key` is mechanically extracted + alias-normalized; `meal_preppable` is new).
- **Tier B (optional override):** `protein`, `cuisine`, `course`, `season`, `tags`. Absent in frontmatter → classifier fills; present → authored value wins. Soft signals where the classifier is good but a human may occasionally know better.
- **Tier C (authored, required, unchanged):** `dietary`, `requires_equipment` + identity (`title`, `source`) + `time_total` + authored numerics.
- *Alternative — move everything (incl. the gates):* rejected. The safety asymmetry is real, and the discovery sweep's existing trust in auto-classified `dietary`/`requires_equipment` is acceptable only because discovery imports are uncurated; an authored recipe is curated, so its gates keep human authority.

### D2 — Reuse the discovery classifier; extract a shared module
Extract the model call + prompt + contract-validated corrective-retry loop from `discovery-classify.ts` into a shared classifier consumed by both the discovery sweep and the new whole-corpus pass. Add `meal_preppable` to `CLASSIFIED_FIELDS`.
- *Alternative — a second classifier for the corpus path:* rejected; it would re-introduce the divergence this change exists to remove.

### D3 — A new body-driven classify pass, gated and bounded
Add a classify pass to the `scheduled()` handler that reads R2 bodies directly (a binding — off the 50-external-subrequest budget, on the internal `env.AI`/D1 bucket like the describe pass), classifies changed recipes, and writes raw classified facets to D1. It is **change-gated** and **bounded per tick** (like the describe/embed caps), so steady-state ≈ 0 work and a cold corpus backfills over several ticks.
- **The gate is `classify_hash = hash(body + the authored Tier-B facets the classifier conditions on)`** — not body alone. This mirrors the describe `content_hash` (which hashes its inputs) and means an override edit that changes a classifier input re-triggers classification, keeping dependent derived fields consistent (see D6).

### D4 — Storage: a `recipe_facets` sibling table
Classified facets land in a new slug-keyed sibling of `recipes`, alongside `recipe_derived`/`taste_derived`, so the projection's wholesale `DELETE`+`INSERT` of `recipes` never clobbers them.
- *Alternative — fold into `recipe_derived`:* tempting (same producer-class, one table) but rejected as the default: the classify pass has a **different producer and cadence** than the describe pass (body-gated vs facet-gated, and describe *consumes* classify's output) — exactly the "different producer + cadence ⇒ separate sibling" reasoning that already justifies `recipe_derived` being separate from `recipes`. A separate `recipe_facets` keeps each pass's rebuild independent. (Left as a confirmable open question for apply.)

### D5 — Materialize effective facets into `recipes` at projection time
The projection reads frontmatter + `recipe_facets` and writes the **effective** value into each `recipes` facet column:
- Tier A → classified value (no authored source exists).
- Tier B → `authored ?? classified` (authored override wins).
- `tags` → `classified ∪ authored` (union, not replace — D7).
Every reader keeps reading `recipes` columns; no read-time JOIN, no reader churn.
- *Alternative — read-time JOIN of `recipes` ⨝ `recipe_facets`:* rejected for now; materialization keeps reads unchanged. (The semantic-search doc's "materialize/promote only when measured" stance applies — revisit only if the projection merge is measured to be heavy.)

### D6 — The classify pass is override-aware
The pass reads the authored frontmatter (it is reading R2 anyway) and **conditions its output on present Tier-B overrides**. This (a) avoids wasting model effort re-deriving an overridden field and, critically, (b) keeps a Tier-A field that *depends* on a Tier-B field consistent with an override — e.g. `side_search_terms` (Tier A) must be non-empty iff the **effective** `course` includes `main`, so an authored `course: [main]` override must drive the side-term derivation even if the model would have classified the dish as a side.

### D7 — `tags` uses union semantics
For every other Tier-B field an authored value *replaces* the classified one (a recipe has one `cuisine`). `tags` is open and editorial — a human may add `"thanksgiving"` or `"mom's recipe"` the model would never produce — so wholesale replace would wipe the classified set. Effective `tags = classified ∪ authored` (dedup, order-stable).

### D8 — Pipeline order within the one `scheduled()` tick
`classify → recipe-index projection → recipe-derived (describe → embed) → discovery sweep`. The projection must run after classify to merge fresh facets; describe runs after the projection because it reads facets from `recipes`; discovery runs last (unchanged). The classify pass writes its own `health:job` record (`recipe-classify`), like the other jobs.

### D9 — Contract shrinks to gates + identity
In `recipe-contract.js`: Tier A leaves the required set; Tier B becomes optional-but-validated-against-vocab-when-present (an authored off-vocab `protein`/`cuisine`/`season` override still hard-fails); Tier C stays required. The `course` → `side_search_terms` conditional moves to **classifier-output** validation (already enforced there via `validateRecipeContract`). The shared-source-of-truth requirement is preserved — the same module validates authored overrides and classifier output.

### D10 — `meal_preppable` is implemented new (Tier A)
Added to the classifier as a boolean ("good freezer/batch candidate"). It currently has **no consumer** — see Open Questions on whether to wire one (meal-plan batch/freezer reasoning) or land it as captured-but-unused derived metadata.

## Risks / Trade-offs

- **Whole-corpus cascade on first run / on a classifier-prompt change.** A classifier change → facets change → describe `content_hash` flips → re-describe → re-embed, corpus-wide. → Mitigation: bounded-per-tick across all three passes (existing caps), change-gated so it is a one-time burst not steady-state; the cascade is also the feature (consistency without per-file edits).
- **Classifier accuracy on Tier B over the authored corpus.** → Mitigation: the agreement eval (Migration) measures per-field rates before committing; disagreements are *kept as authored overrides*, so a low-agreement field degrades gracefully into "mostly authored" rather than silently mis-indexing.
- **A misclassified Tier A field has no human-correction surface.** → Mitigation: the two scary fields are kept in Tier C by design; for the rest, correction is "improve the body/prompt," the operator data explorer for inspection, or promote a chronically-wrong field back to Tier B. Recorded as an accepted trade-off of pure derivation.
- **Override desync** (an authored `course` vs a derived `side_search_terms`). → Mitigation: D6 (override-aware gate + conditioning).
- **Index latency for body-only authoring.** A direct Obsidian/R2 edit is un-faceted until the next classify tick. → Mitigation: eventual-consistency is the existing model; `create_recipe` seeds `recipe_facets` synchronously so agent imports are lag-free.
- **Two writers to the index** (projection + classify). → Mitigation: D4/D5 — classify owns `recipe_facets`; only the projection writes `recipes`, merging.

## Migration Plan

1. **Agreement eval (first task, a spike).** Run the generalized classifier over the current authored corpus; the existing frontmatter facets are free ground-truth labels. Emit per-field agreement rates (and the disagreement set per field). This both validates "trust Tier B as default" and produces the strip plan.
2. **Schema.** Add the `migrations/d1/NNNN_recipe_facets.sql` table (D4).
3. **Strip-on-agreement corpus rewrite (one-time, via `rclone`/script over R2).** Tier A: strip unconditionally. Tier B: strip where classifier == authored; keep where they disagree (the kept value becomes the authored override). Snapshot the corpus before the rewrite (git/rclone copy) as the rollback artifact for the lossy strip.
4. **Ship the classify pass + projection merge + contract change + tool/vault changes.** First reconcile backfills `recipe_facets` for the whole corpus (bounded per tick); the projection begins materializing effective facets; describe/embed re-run only where facets actually changed.
5. **Verify** against the eval: `recipes` effective facets match (authored-override-wins) expectations; `/health` shows the new job; the cookbook/search/retrospective read identically.

**Rollback:** redeploy the prior Worker (the new table is inert to it). The only non-code-reversible step is the frontmatter strip — covered by the pre-strip corpus snapshot.

## Open Questions

- **`meal_preppable` consumer:** wire it into meal-plan/freezer reasoning now, or land it as captured-but-unused derived metadata (and let a later change consume it)?
- **`recipe_facets` sibling vs fold into `recipe_derived`** (D4): confirm the separate-sibling default at apply time, or fold if the extra table proves not to earn its keep.
- **`time_total`:** keep authored (current Tier C, a number a human reads off the recipe) or fold into Tier A for uniformity (the classifier already produces it)?
- **Agreement threshold** for declaring a Tier-B field "trusted as default" — ~~set numerically after the eval~~ **RESOLVED.** The eval ran over the live corpus (151 recipes, `scripts/eval-facet-agreement/run.mjs`). Exact-match agreement (classifier vs authored): **cuisine 88%, course 79%, protein 76%, season 75%** — all solid majorities; `tags` 3% (an artifact of exact-set-equality + union semantics — tags stays authored, by design). Decision: **keep all five Tier B fields as derived-default; no field is escalated back to authored-required.** The migration is **regression-proof for Tier B** — agreements are byte-identical, and the 12–25% disagreements are preserved verbatim as authored overrides, so no facet is worse than today. Strip outcome: `protein` 115/36, `cuisine` 133/18, `course` 119/32, `season` 114/37 (strip/keep); all of Tier A (`ingredients_key`/`perishable_ingredients`/`side_search_terms` on all 151, `meal_preppable` on 74) becomes derived.
