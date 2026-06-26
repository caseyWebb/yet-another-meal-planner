## Why

The semantic-meal-plan flow tries to *pull* recipes that use up soon-to-spoil perishables, but the only lever today is prompt engineering: the agent hand-crafts a `vibe` whose prose names the at-risk items ("uses up the bok choy and leftover salmon") and hopes the description-embedding similarity reflects actual ingredient overlap. That's an indirect, weak proxy — the ranking signal is vibe-prose↔description cosine, not whether the recipe's ingredients actually hit the caller's perishables. The index already carries alias-normalized `ingredients_key` and `perishable_ingredients` per recipe (the latter exists specifically so perishable overlap "lines up with pantry matching"), so the direct signal is already in hand at rank time and simply isn't wired into the ranker.

## What Changes

- Add an optional per-spec `boost_ingredients: string[]` field to `recipe_semantic_search` specs: normalized item names the caller wants the ranker to bias toward (the at-risk perishables / on-hand items the agent already judged worth using up).
- Add a fourth, bounded re-rank term: a **two-tier set-overlap boost** between a spec's `boost_ingredients` and each candidate's `ingredients_key ∪ perishable_ingredients`. A match on the recipe's `perishable_ingredients` (the waste-prevention win) is weighted higher than a match on `ingredients_key` alone. The boost is small relative to cosine — it nudges, never overrides, and can never admit a recipe the facet gate rejected nor exclude a non-matching one.
- Return a `pantry_overlap` field per result row (which boost items the recipe hit) so the agent can *explain* a surfaced pick rather than reading an opaque score bump.
- Boost items are normalized through the same alias table the index uses, so synonym collapse happens via curated aliases — **no per-ingredient embeddings** (explicitly out of scope; the LLM already handles near-neighbor synonyms when choosing boost items and when composing).
- Rewrite the semantic-meal-plan step-2 working note in `AGENT_INSTRUCTIONS.md`: pass at-risk items as `boost_ingredients` on the use-it-up spec instead of smuggling them into the vibe prose.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `semantic-recipe-search`: adds a requirement for a perishable-weighted pantry-overlap re-rank term driven by an optional per-spec `boost_ingredients` field, and a `pantry_overlap` field on the returned rows.

## Impact

- **Code**: `src/semantic-search.ts` (carry `ingredients_key`/`perishable_ingredients` on `SearchCandidate`; add the overlap term + `pantryWeight`/tier weights to `rankCandidates`/`RankParams`/`resolveRankParams`; add `pantry_overlap` to `ScoredRecipe`). `src/tools.ts` (`boost_ingredients` in `searchSpecShape`; populate the two arrays from `frontmatter`; alias-normalize boost items before matching).
- **Docs**: `docs/TOOLS.md` (the new spec param, the `pantry_overlap` return field, and the negative guarantees). No `docs/SCHEMAS.md` change — no data-file/D1 shape moves; the ranker reads existing index columns.
- **Persona**: `AGENT_INSTRUCTIONS.md` semantic-meal-plan step 2 (and rebuilt `plugin/` via `aubr build:plugin`).
- **Tests**: `test/semantic-search.test.ts` — overlap math, perishable-vs-key tiering, saturation cap, empty/no-overlap and no-alias paths.
- **No** migration, no embedding/reconcile change, no new external dependency.
