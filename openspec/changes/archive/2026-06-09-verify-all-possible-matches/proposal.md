## Why

`verify_pantry_for_recipe` surfaces only the **first** fuzzy pantry candidate per recipe ingredient and silently drops the rest. The matching loop uses `pantry.find(...)` ([pantry-verify.ts:123](worker/src/pantry-verify.ts:123)), so for "jasmine rice" it returned just "rice vinegar" (shared token "rice") even though a better candidate — plain `rice` or `jasmine rice` — may also be in the pantry. The agent never saw the alternatives, so it couldn't pick the right one.

This violates the system's core model — **coarse deterministic search, narrowed/decided by the LLM** — which the matcher already honors (`match_ingredient_to_kroger_sku` returns the full candidate set, capped at 5). `verify_pantry`'s `possible_matches` is the lone deviation, and dropping the other plausible candidates is exactly the "false-miss" the pantry-verification spec says matching must not do.

## What Changes

- **Return all fuzzy candidates.** `pantry.find` → `pantry.filter`: every plausible pantry item for a recipe ingredient becomes its own `possible_matches` entry (`{ recipe_calls_for, candidate_pantry_item }`), for the agent to confirm or reject. The aggregate already keys by `recipe|candidate`, so multiple-per-ingredient flows through `verify_pantry_for_candidates` unchanged.
- **Rank stronger candidates first.** Within an ingredient's candidates, substring-containment matches (e.g. `jasmine rice` ⊃ `rice`) come before token-overlap-only matches (`rice vinegar`), so the agent sees the likeliest match at the top — same spirit as the matcher's ranked candidates.
- **No per-ingredient cap.** The pantry is small; completeness matters more than truncation here. (Revisit only if a real pantry makes this noisy.)
- **Spec + docs clarified** that `possible_matches` lists every plausible candidate, not just one.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `pantry-verification`: `possible_matches` SHALL contain **all** fuzzy candidates per ingredient (ranked containment-first), not only the first found.

## Impact

- **Code:** `worker/src/pantry-verify.ts` (`.find` → `.filter` + ranking), `worker/test/pantry-verify.test.ts`.
- **Docs:** `docs/TOOLS.md` (`verify_pantry_*` returns — `possible_matches` lists all candidates).
- **Behavior:** the agent now decides among the full candidate set (the intended coarse-search → LLM-narrow flow); no return-shape change (more entries in an existing array).
