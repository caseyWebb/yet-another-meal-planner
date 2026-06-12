# ingredient-matching Specification

## Purpose

Defines the deterministic ingredient-to-Kroger-SKU matching pipeline (`match_ingredient_to_kroger_sku`) and the `compare_unit_price` comparison tool. Covers the resolve-only contract (confident / ambiguous / unavailable result shapes), tri-state brand-preference confidence from `preferences.toml` `[brands]`, scoring-not-filtering of brand and dietary signals, alias-driven normalization, cache lookup with revalidation and no TTL, the deterministic tiebreaker, and the rule that the matcher never substitutes. Builds on the kroger-integration `kroger_search` helper.

## Requirements

### Requirement: Resolve-only matching pipeline

The system SHALL provide `match_ingredient_to_kroger_sku(ingredient, context)` running the deterministic 7-step pipeline from `ARCHITECTURE.md`. It SHALL be **resolve-only**: it returns a result but SHALL NOT write the SKU cache (that is deferred to the Change 06 batched commit). It SHALL return exactly one of three shapes — a confident match, an `ambiguous` result with narrowed candidates, or an `unavailable` result.

#### Scenario: Confident match returned

- **WHEN** the pipeline resolves an ingredient via a cache hit or a defined brand preference
- **THEN** it returns `{ resolved: true, sku, brand, size, price: { regular, promo }, on_sale, reason }` without writing the cache

#### Scenario: Ambiguous result returned

- **WHEN** deterministic narrowing leaves no confident pick
- **THEN** it returns `{ resolved: false, ambiguous: true, candidates: [...], reason }` for the LLM to resolve

#### Scenario: Unavailable result returned

- **WHEN** no candidate is fulfillable via curbside or delivery at the resolved location
- **THEN** it returns `{ resolved: false, reason: "unavailable" }` and does not substitute

### Requirement: Tri-state brand-preference confidence

The system SHALL determine confidence from `preferences.toml` `[brands]`, treating a key's presence as the signal: key absent → ambiguous (ask); key `[]` → "don't care", auto-pick the cheapest acceptable candidate **from the top identity-relevance tier**; non-empty list → ranked preference where list order is rank and the first available brand wins. A cache hit SHALL also count as confident. A non-empty preference list whose brands are all unavailable SHALL fall back to ambiguous.

#### Scenario: Empty list auto-picks cheapest

- **WHEN** the ingredient's `[brands]` key is `[]`
- **THEN** the pipeline auto-picks the cheapest acceptable candidate among the top identity-relevance tier without asking

#### Scenario: Absent key asks

- **WHEN** the ingredient has no `[brands]` key and no cache hit
- **THEN** the pipeline returns `ambiguous` with candidates rather than guessing

#### Scenario: Ranked list honored by order

- **WHEN** the ingredient's `[brands]` key is a non-empty ranked list and a listed brand is available
- **THEN** the highest-ranked available brand is chosen

### Requirement: Scoring not hard filtering

The system SHALL apply brand and dietary **preferences** as scoring signals, not eliminating filters, so that a missing preferred brand cannot empty the candidate set. There SHALL be two near-hard constraints, distinct from those soft preferences: (1) curbside/delivery availability — a candidate not fulfillable that way is not a valid pick; and (2) identity relevance — a confident pick SHALL come only from the top relevance tier (see "Identity-relevance near-hard constraint"). The near-hard constraints govern *which product*; the soft preferences govern *which brand/size/price among matches*.

#### Scenario: Missing preferred brand does not empty results

- **WHEN** the preferred brand is unavailable but other acceptable candidates exist
- **THEN** the candidate set is non-empty and the pipeline routes to `ambiguous` rather than returning no match

#### Scenario: Preference softness does not override identity

- **WHEN** a cheaper candidate would win on price but does not match the queried ingredient (zero relevance) while a relevant candidate exists
- **THEN** the relevant candidate is preferred — price softness applies only within the top relevance tier, not across it

### Requirement: Identity-relevance near-hard constraint

The system SHALL score each fulfillable candidate on **identity relevance** to the queried ingredient: the number of the normalized query's whitespace-separated content-tokens that appear (case-insensitive substring) in the candidate's `description` and `categories`. Identity relevance SHALL be a near-hard constraint distinct from the soft brand/dietary preferences. A **confident** resolution (a `[brands] = []` "don't care" auto-pick or a brand-match pick) SHALL be restricted to candidates whose relevance equals the **maximum relevance present in the fulfillable pool**; price and brand tiebreaking SHALL run only within that top tier. The `ambiguous` result SHALL order candidates by relevance first, then the existing dietary → on-sale → price signals, so the best identity matches surface within the candidate cap. If the maximum relevance in the fulfillable pool is zero (no candidate shares any query token), the matcher SHALL NOT pick confidently and SHALL return the fulfillable pool as `ambiguous` rather than hard-failing.

#### Scenario: Don't-care resolves to the matching variety, not the cheapest unrelated item

- **WHEN** `match_ingredient_to_kroger_sku("anaheim peppers")` runs with `[brands].anaheim_peppers = []` and the fulfillable pool contains "Fresh Anaheim Peppers" (PLU) alongside cheaper unrelated fulfillable items (refried beans, soda) that share no query token
- **THEN** the confident pick is the "Fresh Anaheim Peppers" candidate (top relevance tier), not the cheaper unrelated item

#### Scenario: Ambiguous surfaces the true variety despite a higher price

- **WHEN** the matcher returns `ambiguous` for `"poblano peppers"` and the matching "Fresh Poblano Peppers" PLU is more expensive than unrelated fulfillable candidates
- **THEN** the matching PLU appears among the surfaced candidates because relevance is ranked before price

#### Scenario: No token overlap degrades to ambiguous, never confident-wrong

- **WHEN** `match_ingredient_to_kroger_sku` runs for an ingredient with a `[brands] = []` "don't care" entry, and no fulfillable candidate's description or categories contain any query token (the maximum relevance in the pool is zero — e.g. the user's term and Kroger's product naming share no words, as with "chiles" vs. "...Serrano Peppers")
- **THEN** the matcher returns `ambiguous` with the fulfillable pool rather than confidently auto-picking a zero-relevance candidate

### Requirement: Best-effort dietary scoring

The system SHALL treat dietary preferences as a best-effort soft score over available product fields (name, brand, description, categories) and SHALL NOT treat dietary as a deterministic gate, because the public product response exposes no dietary attributes.

#### Scenario: Organic nudged, not guaranteed

- **WHEN** a dietary hint like "organic" is present and a candidate's name contains it
- **THEN** that candidate scores higher, but a non-matching candidate is not eliminated solely for lacking the hint

### Requirement: Matcher never substitutes

The system SHALL match only the given ingredient. When nothing is fulfillable it SHALL return `unavailable`; it SHALL NOT read or apply `substitutions.toml`. Substitution SHALL remain the sole responsibility of `propose_substitutions` under user confirmation.

#### Scenario: Unavailable instead of silent swap

- **WHEN** the requested ingredient has no available SKU and a substitution rule exists for it
- **THEN** the matcher returns `unavailable` and does not swap in the substitute

### Requirement: Cache lookup with revalidation and no TTL

The system SHALL, on a cache hit in `skus/kroger.toml`, short-circuit search and narrowing but revalidate the cached SKU with one targeted lookup for current price and curbside/delivery availability before returning it. An available SKU SHALL be returned with fresh price; an unavailable one SHALL trigger re-resolution. The cache SHALL NOT use a TTL. The tool SHALL accept a `bypass_cache` parameter that forces re-resolution.

#### Scenario: Cache hit revalidated before use

- **WHEN** a cached SKU is found for the normalized ingredient
- **THEN** the system revalidates its current price and curbside/delivery availability, returns it with fresh price if available, and re-resolves if not

#### Scenario: bypass_cache forces re-resolution

- **WHEN** the caller passes `bypass_cache: true`
- **THEN** the pipeline ignores any cache hit and runs full search and narrowing

### Requirement: Alias-driven normalization

The system SHALL normalize the ingredient by stripping quantity/units, lowercasing, and applying `aliases.toml` as the curated source of truth for variant collapse. It SHALL NOT aggressively strip qualifiers beyond what `aliases.toml` defines.

#### Scenario: Alias collapses a variant

- **WHEN** an ingredient string matches an `aliases.toml` entry
- **THEN** it is normalized to the canonical term before cache lookup and search

### Requirement: compare_unit_price deterministic comparison

The system SHALL provide `compare_unit_price(items)` performing deterministic price-per-unit comparison from raw `price` and `size` strings. It SHALL parse, convert, and divide internally so the LLM never performs arithmetic. It SHALL rank only within a single dimension (volume, weight, or count) and SHALL place cross-dimension or unparseable items in `incomparable`. It SHALL accept optional `quantity_override`/`unit_override` for residue the parser could not handle. The same core SHALL drive the matcher's tiebreaker.

#### Scenario: Ranked within a dimension

- **WHEN** `compare_unit_price` receives same-dimension items with parseable sizes
- **THEN** it returns them ranked by ascending unit price with a `cheapest` id

#### Scenario: Cross-dimension and unparseable excluded

- **WHEN** items span different dimensions or carry unparseable size strings
- **THEN** those items are returned in `incomparable` rather than mis-ranked

### Requirement: Deterministic tiebreaker

The system SHALL break ties among top-scoring candidates deterministically: prefer on-sale (`promo > 0`) over regular, then best price-per-unit via the unit-price core. For "don't care" (`[]`) commodities it SHALL pick the smallest package covering the `quantity_hint`, then cheapest absolute.

#### Scenario: On-sale preferred

- **WHEN** two equally-scored candidates differ only in sale state
- **THEN** the on-sale candidate is chosen

#### Scenario: Commodity sizing

- **WHEN** resolving a `[]` commodity with a `quantity_hint`
- **THEN** the smallest package covering the hint is chosen, breaking ties by cheapest absolute price
