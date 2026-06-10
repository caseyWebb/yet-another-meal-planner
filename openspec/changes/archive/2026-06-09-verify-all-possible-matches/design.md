## Context

`verifyParsedIngredients` (worker/src/pantry-verify.ts) buckets each parsed recipe ingredient against the pantry: exact normalized match → `in_pantry`; else a fuzzy candidate → `possible_matches`; else `not_in_pantry` (+ substitution check). The fuzzy step is:

```js
const candidate = pantry.find((p) => isFuzzyCandidate(ing.name, p.key));
if (candidate) { result.possible_matches.push({ recipe_calls_for: ing.name, candidate_pantry_item: candidate.name }); continue; }
```

`isFuzzyCandidate` is true when one normalized name contains the other, or they share a token of length ≥ 3. `.find` returns the first such pantry item in array order and discards the rest. The aggregator already supports multiple candidates per ingredient (it keys `possible_matches` by `recipe_calls_for|candidate_pantry_item`).

The matcher (`match_ingredient_to_kroger_sku`) already returns the full candidate set for the LLM to choose from (`ambiguous`, ranked, capped at `MAX_CANDIDATES = 5`). This change brings `verify_pantry` in line with that model.

## Goals / Non-Goals

**Goals:**
- Surface every plausible pantry candidate per ingredient; let the agent decide.
- Put the likeliest candidate first.
- No false-misses (the dropped candidates were exactly that).

**Non-Goals:**
- Changing `isFuzzyCandidate`'s sensitivity (token ≥ 3 / containment) — surfacing *more* candidates for the LLM to reject is the design; tightening the heuristic would re-introduce false-misses.
- Auto-deciding among candidates — that stays with the agent.
- Capping the candidate list (pantry is small; revisit only if noisy).

## Decisions

### D1: `.find` → `.filter` (return all)

Collect all pantry items satisfying `isFuzzyCandidate` and push one `possible_matches` entry each. Direct fix for the reported drop; consistent with the matcher's candidate-set return and with the spec's "no false-misses."

### D2: Rank containment before token-overlap

Order an ingredient's candidates so containment matches (`recipeKey.includes(pantryKey) || pantryKey.includes(recipeKey)`) precede token-overlap-only matches. For "jasmine rice": `rice` (contained in "jasmine rice") ranks above `rice vinegar` (shares only the "rice" token). The agent still confirms/rejects each, but the strongest candidate leads — mirroring the matcher's relevance ordering. Ranking is stable within a tier (pantry order).

### D3: No per-ingredient cap

The matcher caps at 5 because Kroger search can return many products; the pantry is a small, human-curated list, so a cap would risk dropping the right candidate for marginal noise reduction. Return all. Revisit if a real pantry proves noisy.

## Risks / Trade-offs

- **More candidates = more for the agent to weigh** → intended; the agent is the decider, and ranking surfaces the best first. A handful of extra candidate pairs is cheap.
- **A weak token-overlap candidate (e.g. `rice vinegar` for `jasmine rice`) still appears** → acceptable and by design: it's a *candidate* the agent rejects, not an assumed match. Hiding it would be the false-miss we're fixing in the other direction.

## Migration Plan

1. `pantry-verify.ts`: replace the `.find` fuzzy step with a `.filter` + containment-first sort; push all candidates.
2. Tests: jasmine-rice fixture (pantry `rice` + `rice vinegar`) → both in `possible_matches`, `rice` first; existing single-candidate scenarios still pass.
3. `docs/TOOLS.md` verify returns note.
4. Additive (more array entries); CD deploys on push to `worker/**`. Rollback = revert.

## Open Questions

- Should containment candidates that are *also* near-exact (e.g. recipe "rice", pantry "rice") ever short-circuit to `in_pantry`? No — exact normalized match already handles true equality; "rice" vs "jasmine rice" is genuinely a judgment call that belongs with the agent. Out of scope.
