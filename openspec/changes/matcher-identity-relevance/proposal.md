## Why

`match_ingredient_to_kroger_sku` can confidently resolve an ingredient to a product that **isn't that ingredient at all**. Live evidence (preferred location 76104): searching `"anaheim peppers"`, `"poblano peppers"`, and `"serrano peppers"` each returns the correct produce PLU in the result pool (4677 / 4705 / 4709, all curbside-available) — but the matcher buries them and surfaces the same cheap Mexican-aisle packaged goods (refried beans, soda, salsas) for every variety. The normalization is not at fault (the variety term reaches Kroger intact); the matcher simply has **no notion of whether a candidate matches the queried ingredient**. After the fulfillment filter it ranks purely by brand/dietary/price, so "cheapest fulfillable" wins regardless of identity.

This is a correctness hole, not just poor surfacing: with a `[brands]` "don't care" (`[]`) entry, `commodityPick` would *confidently* resolve `anaheim peppers` to the cheapest fulfillable item — refried beans or soda. The design rule "scoring, not hard filters; a missing preferred brand can't empty the set" was about **preference**; it was wrongly applied to **identity**.

## What Changes

- **Introduce an identity-relevance axis** to the matcher: each candidate is scored by how many of the query's content-tokens appear in its `description` + `categories`. Identity becomes a **second near-hard constraint alongside fulfillment** — distinct from the (still-soft) brand/dietary preferences.
- **Confident picks are gated to the top relevance tier** (strict): a confident resolution (cache-miss path — `[brands] = []` or a brand match) may only choose among the highest-relevance candidates. So `anaheim_peppers = []` resolves to PLU 4677, never to soda.
- **`ambiguous` surfaces by relevance first**, then the existing dietary → on-sale → price order, so the true variety PLU appears in the top-5 candidates instead of being out-priced by unrelated goods.
- **Safe fallback preserves "never hard-fail":** if no candidate has positive relevance, the matcher returns ungated `ambiguous` (low-confidence), never a confident pick. Worst case ≈ today's behavior, but it can never confidently pick wrong.
- **No API, return-shape, or tool-contract changes** — the fix is scoring logic inside `worker/src/matching.ts`. `KrogerCandidate` already carries `description` + `categories`.

**Non-Goals:** semantic synonymy (`"fresh green chiles"` → Kroger's "...Serrano Peppers", where "chiles" matches no description) stays with `aliases.toml` + the LLM-confirm `possible_matches` path, not the matcher. Narrowing-retry on the search term and produce-PLU tiebreaking are parked as future options.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `ingredient-matching`: add an identity-relevance near-hard constraint and a strict top-tier gate on confident picks; amend the "one near-hard constraint" wording (now two: fulfillment + identity); constrain the tri-state `[]` "don't care" auto-pick to identity-relevant candidates.

## Impact

- **Code:** `worker/src/matching.ts` (relevance scoring + the gate in `ambiguous`/`commodityPick`/`tiebreak`/the confident path); `worker/test/matching.test.ts` (fixtures from the live pepper data).
- **Docs:** `docs/TOOLS.md` / `docs/PROJECT.md` matcher description if the 7-step prose needs the relevance step noted.
- **Behavior:** more confident-correct resolutions for distinct produce varieties; some previously-confident (wrong) `[]` picks now correctly resolve to the variety or downgrade to ambiguous.
