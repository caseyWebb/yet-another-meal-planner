## 1. Relevance scoring core

- [x] 1.1 Add a `relevanceScore(c, queryTokens)` helper in `worker/src/matching.ts`: count how many query content-tokens appear (case-insensitive substring) in `c.description + " " + c.categories.join(" ")` (plus `relevanceTokens()` for the split)
- [x] 1.2 In `matchIngredient`, tokenize the `normalized` query once (whitespace split, drop empties) and thread the tokens to the scoring/selection steps

## 2. Apply the identity gate

- [x] 2.1 After the `isFulfillable` filter, compute `maxRelevance` over the fulfillable pool and derive the `topTier` (candidates whose relevance === maxRelevance); when `maxRelevance === 0`, topTier is empty → fallback applies
- [x] 2.2 Restrict confident picks to the top tier: the `[brands] = []` path (`commodityPick`) and the ranked-brand path (`brandRank`/`tiebreak`) operate over `topTier`, not the full fulfillable pool
- [x] 2.3 Sort `ambiguous()` candidates by `relevance` first, then the existing dietary → on-sale → effective-price order (extended its comparator; tokens threaded in)
- [x] 2.4 Safe fallback: when `maxRelevance === 0`, return ungated `ambiguous` with a low-confidence reason (`no candidate clearly matches "<ingredient>"; choose … or refine`) and never a confident pick
- [x] 2.5 Confirm the absent-`[brands]`-key path still returns `ambiguous` (now relevance-sorted) and the all-brands-unavailable path still falls back to `ambiguous`

## 3. Tests

- [x] 3.1 Add fixtures to `worker/test/matching.test.ts` modeling the live pepper pool (Fresh Anaheim Peppers PLU + cheaper unrelated fulfillable items: refried beans, soda, salsa)
- [x] 3.2 Test: `"anaheim peppers"` with `[brands]=[]` confidently picks the Anaheim PLU over cheaper zero-relevance items (top-tier gate)
- [x] 3.3 Test: `ambiguous` surfaces the matching PLU ahead of cheaper unrelated candidates (relevance-first ordering)
- [x] 3.4 Test: zero token overlap with a `[]` don't-care entry returns ungated `ambiguous`, never confident (the "chiles vs Serrano Peppers" safety net)
- [x] 3.5 Test: generic single-token query (`"peppers"`) ties all peppers at the top tier and price decides among them (no regression); plus a direct `relevanceScore` unit test
- [x] 3.6 Run `npm test` + `npm run typecheck` in `worker/`; green — 151 passed / 4 skipped, matcher suite 20 tests (existing synthetic fixtures given realistic descriptions; assertions unchanged)

## 4. Contract/doc sync

- [x] 4.1 `docs/PROJECT.md` (step 4 of the 7-step pipeline) and `docs/TOOLS.md` (`match_ingredient_to_kroger_sku`) note the identity-relevance near-hard constraint and the top-tier confident gate

## 5. Verify end-to-end (optional live)

- [ ] 5.1 After deploy (CD on push to `worker/**`), spot-check `match_ingredient_to_kroger_sku("anaheim peppers")` against the live API and confirm PLU 0000000004677 now surfaces/resolves
