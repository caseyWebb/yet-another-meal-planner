## Context

`recipe_semantic_search` ranks facet-survivors by `cosine(vibe, description)` plus two small boosts (favorite affinity, cook-freshness) — see `src/semantic-search.ts`. The semantic-meal-plan flow wants to pull recipes that use up soon-to-spoil perishables, but today it does so indirectly: the agent writes the at-risk items into the spec's `vibe` prose and relies on description-embedding similarity to reflect ingredient overlap. The signal is weak and confounded with everything else the vibe says.

The direct signal already exists in the index. Every recipe row carries alias-normalized `ingredients_key` (top 5–7 ingredients) and `perishable_ingredients` (waste-prone items, derived at import). `normalizePerishables` runs both through the same `normalizeIngredient(item, aliases)` the pantry matcher uses, *"so cross-recipe perishable overlap lines up with pantry matching."* At rank time the survivor's full `frontmatter` is in hand (`src/tools.ts`), but the candidate-build copies only title/description/protein/cuisine/time_total and drops the ingredient arrays.

## Goals / Non-Goals

**Goals:**
- Make pantry/perishable overlap a *direct, deterministic* re-rank signal instead of a prompt-engineering proxy.
- Weight perishable-list hits above key-list hits (the waste-prevention win).
- Keep the boost in the existing "nudge, never override" register — bounded, saturating, can't admit a gated-out recipe or exclude a non-matching one.
- Make the signal legible: report which boost items each row hit.
- Keep the fuzzy "what's at risk" judgment with the LLM; the tool only does exact set math.

**Non-Goals:**
- Per-ingredient embeddings / a second vector index. Synonym recall is handled by the curated alias table plus the LLM's own equivalence judgment when it picks boost items and composes.
- Server-side "at-risk" inference (reading `added_at`/`last_verified_at`/leftover age). That's fuzzy judgment the agent already does in the step-2 freshness prompt; the tool receives the decided items.
- Any change to embeddings, the reconcile, migrations, or `docs/SCHEMAS.md` data shapes.

## Decisions

**Items ride on the spec, not inferred server-side.** Add `boost_ingredients: string[]` to `searchSpecShape`. The agent already decides which items are at-risk; passing them structurally replaces the "name them in the vibe" hack with the same information the ranker can score directly. *Per-spec* (not a global tool param) is deliberate: the agent biases the use-it-up spec toward the fridge while leaving the wildcard/novelty spec unbiased — exactly the control the multi-spec design exists for. *Alternative considered:* the tool reads the caller's pantry itself and computes at-risk. Rejected — it drags fuzzy age-judgment across the determinism boundary and re-derives what the agent already knows.

**Two-tier per-item overlap, keyed on the recipe's classification.** For each `boost_ingredient` (alias-normalized), score it against the candidate:

```
per-item weight = item ∈ recipe.perishable_ingredients ? W_PERISH
                : item ∈ recipe.ingredients_key        ? W_KEY      // W_KEY < W_PERISH
                : 0
overlap   = Σ per-item weight   (an item in both lists counts at the perishable tier; dedupe by item)
boost     = pantryWeight · min(overlap, OVERLAP_CAP) / OVERLAP_CAP
score     = cosine + favoriteWeight·favAffinity + freshnessBoost + boost
```

Tiering on the *recipe's* `perishable_ingredients` (not on whether the boost item is "a perishable") is what encodes "this recipe will actually consume your at-risk item as a waste-prone ingredient." *Alternative considered:* flat overlap over `ingredients_key ∪ perishable_ingredients`. Rejected — it can't express that burning down the bok choy beats merely listing it.

**Saturating, peer-magnitude boost.** `pantryWeight` defaults in the 0.1–0.15 band, peer to `favoriteWeight` (0.15) and `noveltyBoost` (0.1), and the overlap saturates at `OVERLAP_CAP` so a recipe matching five items can't swamp cosine. Tunable per-tenant via `resolveRankParams` (a `rotation`-sibling pref), defaulting when unset — same pattern as the existing weights. Starting point: `W_PERISH = 1.0`, `W_KEY = 0.4`, `OVERLAP_CAP = 2` perishable-equivalents, `pantryWeight = 0.12`. These are re-rank tuning constants, adjustable without a contract change.

**Report overlap per row.** Add `pantry_overlap: string[]` to `ScoredRecipe` (the matched boost items, normalized form). Lets the agent say "surfaced because it uses your bok choy" instead of explaining an opaque score bump; empty array when no overlap or no `boost_ingredients`. The existing `score`/`similarity` fields already expose the blend for debugging.

**Normalization at the boundary.** `boost_ingredients` are normalized through the same alias table at the tool wrapper (the index arrays are already normalized at import), so both sides of the set-overlap share one vocabulary. The pure ranker receives already-normalized arrays and does plain set membership — keeping `semantic-search.ts` I/O-free and unit-testable, consistent with how the wrapper already resolves embeddings/favorites/prefs.

## Risks / Trade-offs

- **Alias coverage gaps** (recipe says `scallions`, pantry says `green onions`, no alias) → a real overlap is missed. *Mitigation:* the LLM already treats equivalents as on-hand when choosing `boost_ingredients` and when composing (step 3), so it can pass the corpus-canonical form; missed overlap only forgoes a *nudge*, never excludes a recipe. If gaps prove material, a future change adds the alias entries (or, last resort, ingredient embeddings) — explicitly deferred, not precluded.
- **`ingredients_key` is only top 5–7** → a recipe that uses an at-risk item outside its top ingredients won't hit on the key list. *Mitigation:* the waste case is exactly what `perishable_ingredients` captures, and that list is matched at the higher tier; the key tier is a bonus, not the primary path.
- **Over-tuned weights could let overlap drown the vibe.** *Mitigation:* saturation cap + peer-magnitude default keep it a nudge; per-tenant override exists; a spec scenario asserts an off-vibe high-overlap recipe does not outrank on-vibe candidates.

## Migration Plan

Pure additive: `boost_ingredients` is optional (absent → today's behavior exactly) and `pantry_overlap` is a new always-present field (empty when unused). No migration, no reconcile/embedding change, no data-shape change. Deploy is the normal `src/**` path that auto-kicks from `main`. Rollback is reverting the code; no persisted state is affected. `AGENT_INSTRUCTIONS.md` is updated in the same change and `plugin/` rebuilt via `aubr build:plugin`.

## Open Questions

- Final default constants (`W_PERISH`, `W_KEY`, `OVERLAP_CAP`, `pantryWeight`) are starting points to confirm against real corpus behavior during apply; they are tuning values, not contract.
