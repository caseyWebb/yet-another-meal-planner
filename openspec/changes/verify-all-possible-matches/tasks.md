## 1. Return all fuzzy candidates (code)

- [x] 1.1 In `worker/src/pantry-verify.ts`, replace the `pantry.find((p) => isFuzzyCandidate(...))` fuzzy step with `pantry.filter(...)`; push one `possible_matches` entry per candidate (kept the `continue` so a fuzzy-matched ingredient does not also fall through to `not_in_pantry`)
- [x] 1.2 Added a containment-first ordering (`containmentRank`): candidates where one name contains the other rank before token-overlap-only candidates (stable `.sort` preserves pantry order within a tier)
- [x] 1.3 `npm run typecheck` in `worker/` clean

## 2. Tests

- [x] 2.1 Jasmine-rice case: pantry `["rice vinegar", "rice"]`, recipe `jasmine rice` → `possible_matches` has both, `rice` (containment) ordered before `rice vinegar` (token-overlap), proving ranking ≠ pantry order
- [x] 2.2 Multiple token-overlap candidates all surfaced (`chicken stock` → `chicken broth` + `beef stock`; no silent drop of the non-first)
- [x] 2.3 Existing scenarios still pass (`long-grain white rice`→`rice` single candidate; `onion powder` not auto-matched; exact `in_pantry`)
- [x] 2.4 Aggregation (`aggregateVerifications`) keys `possible_matches` by `recipe|candidate`, so multiple candidates per ingredient carry through with `for_recipes` attribution (existing aggregate tests cover the shape)
- [x] 2.5 `npm test` in `worker/` green — 162 passed / 4 skipped, pantry-verify suite 11 tests

## 3. Docs sync

- [x] 3.1 `docs/TOOLS.md` `verify_pantry_*` returns + notes: `possible_matches` lists **all** plausible pantry candidates per ingredient, containment-first (coarse search → LLM narrows)

## 4. Verify (optional live)

- [ ] 4.1 After deploy, a recipe needing `jasmine rice` against a pantry with `rice` + `rice vinegar` surfaces both as `possible_matches`
