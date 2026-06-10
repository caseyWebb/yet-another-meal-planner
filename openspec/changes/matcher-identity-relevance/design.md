## Context

`matchIngredient` (worker/src/matching.ts) runs: `search(normalized)` → filter to `isFulfillable` → score by tri-state brand / best-effort dietary / price → pick (confident) or narrow (`ambiguous`). The query term reaches Kroger unmodified — `normalizeIngredient` only lowercases, strips a leading quantity, and applies `aliases.toml` (empty), so `"Anaheim peppers"` → `"anaheim peppers"`.

Live probe at location 76104 (`03500520`), `limit: 15`:

```
search("anaheim peppers") → rank 12: 0000000004677 Fresh Anaheim Peppers (curb+del) — present but buried
search("poblano peppers") → rank 13: 0000000004705 Fresh Poblano Peppers
search("serrano peppers") → rank 13: 0000000004709 Fresh Green Serrano Peppers
search("anaheim")         → rank  1: 0000000004677 — single, perfect
productById("0000000004677") → returns it, curb+del
```

The correct PLU is always in the pool. The matcher loses it because, after the fulfillment filter, ranking is brand/dietary/**price** only — no signal for "is this candidate the queried ingredient." The same cheap fulfillable Mexican-aisle items recur across all three "X peppers" searches and always out-price the $2–3 produce PLU, which is why every variety surfaced the "same generic candidates." With a `[brands] = []` entry, `commodityPick` would *confidently* return one of those cheap mismatches.

Note: Kroger's own relevance order is not enough — it ranked 4677 at position 12 despite the exact-name match. Computing our own description-token relevance (4677 matches 2/2 tokens → rank 1) is what recovers it.

## Goals / Non-Goals

**Goals:**
- A confident resolution means "this *is* the ingredient, and the best price/brand *within* it" — never "cheapest fulfillable thing in the aisle."
- Distinct produce varieties resolve to their distinct PLUs.
- No confident-wrong picks; graceful degradation to ambiguous when identity is uncertain.

**Non-Goals:**
- Semantic synonymy (chiles↔peppers). When the user's term shares no tokens with Kroger's product naming, the matcher SHALL degrade to ambiguous — bridging that is `aliases.toml` + the LLM-confirm `possible_matches` path.
- Narrowing-retry (re-searching a shorter/head term) — parked; Design-A recovers the PLU from the existing full-phrase pool.
- Produce-PLU preference (favoring raw `0000000004677`-style PLUs) — parked; largely subsumed by relevance.
- Any change to return shapes, the Kroger client, or the tool contract.

## Decisions

### D1: Identity is a near-hard axis, distinct from soft preferences

The matcher conflated two axes: **identity** (is this candidate the ingredient?) and **preference** (which brand/size/price among matches?). The existing rule "scoring not hard filters; a missing preferred brand can't empty the set" is correct **for preference**. Identity is different — a refried bean is not an anaheim pepper, so it should be *ineligible*, not merely lower-ranked. Identity joins `isFulfillable` as the second near-hard constraint; brand/dietary stay soft. This reframing (not "harden preferences into filters") keeps the stated philosophy coherent.

**Alternative considered — trust Kroger's relevance order:** rejected; Kroger ranked the exact-name PLU at position 12, so its order doesn't surface it.

### D2: Relevance = query content-token coverage over description + categories

`relevance(c)` = number of the query's whitespace-separated content-tokens that appear (case-insensitive substring) in `c.description + " " + c.categories.join(" ")`. Reuses the same tokenization spirit as the Change 09 `list_recipes` query. Validated against the data: for `"anaheim peppers"` {anaheim, peppers}, 4677 scores 2, refried beans / soda score 0.

**Why token-coverage, not token-AND:** strict AND on description would over-filter legitimately sparse names (e.g. "long-grain white rice" vs a product literally "White Rice"). Coverage-count + a *relative* top-tier gate (D3) isolates the best match without demanding every token.

### D3: Strict gate — confident picks only from the max-relevance tier

A confident resolution (cache-miss path: `[brands] = []` → `commodityPick`, or a brand match → `tiebreak`) may only choose among candidates whose relevance equals the **maximum relevance present in the fulfillable pool**. Price/brand tiebreaking runs *within* that tier. This is the correctness-critical decision (chosen over "any positive relevance," which would let a generic "peppers"-only match out-price the exact variety): "confident" now guarantees identity.

### D4: `ambiguous` surfaces by relevance first

`ambiguous()` sorts by `relevance` desc, then the existing `dietaryScore` → on-sale → effective-price. The true variety PLU lands in the top-`MAX_CANDIDATES` (5) instead of being out-priced by unrelated goods.

### D5: Safe fallback — empty relevant set never hard-fails

If the maximum relevance in the fulfillable pool is 0 (no candidate shares any token — the chiles↔peppers case), the matcher SHALL NOT pick confidently; it returns the ungated fulfillable pool as `ambiguous` (low-confidence reason). Worst case equals today's behavior, but a confident-wrong pick becomes impossible.

## Risks / Trade-offs

- **Sparse/empty product descriptions** → a genuine match with an empty description scores 0 and could be gated out. Mitigation: produce PLUs do carry descriptions; the D5 fallback prevents hard failure; relevance reads categories too.
- **Generic single-token queries** (`"peppers"`) → all peppers score 1, tie at top tier, price decides among them — which is correct (the user asked generically).
- **Token substring false-positives** ("pepper" vs "peppers", "oil" inside "broil") → low risk after the fulfillment filter; acceptable since the gate is *relative* (top tier), not absolute. Revisit with word-boundary matching only if observed.
- **Behavior shift for existing `[]` entries** → some previously-confident picks change (correctly) to the variety or to ambiguous. Intended; covered by tests.

## Migration Plan

1. Add relevance scoring + thread query tokens into `ambiguous`/`commodityPick`/`tiebreak`/confident path in `matching.ts`.
2. Add unit tests using the live pepper fixtures (anaheim → 4677 confident over the cheap pool; chiles → ungated ambiguous).
3. Sync the matcher prose in `docs/TOOLS.md` / `docs/PROJECT.md` if the 7-step description needs the relevance step.
4. CD deploys on push to `worker/**`. Backward-compatible: shapes unchanged; only which candidate wins changes.
5. Rollback: revert the scoring change; no data/contract migration.

## Open Questions

- Should `relevance` weight the *distinguishing* token (variety) above the *category* token, or is max-tier coverage sufficient? Current decision: coverage + top-tier is enough for the observed cases; revisit only if a variety loses to a category-only match within the top tier.
