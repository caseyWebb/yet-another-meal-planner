# ingredient-matching Specification

## Purpose

Defines the deterministic ingredient-to-Kroger-SKU matching pipeline (`match_ingredient_to_kroger_sku`) and the `compare_unit_price` comparison tool. Covers the resolve-only contract (confident / ambiguous / unavailable result shapes), tri-state brand-preference confidence from `preferences.toml` `[brands]`, scoring-not-filtering of brand and dietary signals, alias-driven normalization (D1 `aliases` table), D1 `sku_cache` lookup with revalidation and no TTL, the deterministic tiebreaker, and the rule that the matcher never substitutes. Builds on the kroger-integration `kroger_search` helper.
## Requirements
### Requirement: Resolve-only matching pipeline

The system SHALL provide the deterministic 7-step matching pipeline from `docs/ARCHITECTURE.md` as an internal operation (`matchIngredient`) consumed by the order flow (`place_order`'s resolution) and the order-review surfaces — it is **not** a model-advertised MCP tool. It SHALL be **resolve-only**: it returns a result but SHALL NOT write the D1 `sku_cache` table (that write is deferred to the order path via `place_order`). It SHALL return exactly one of three shapes — a confident match, an `ambiguous` result with narrowed candidates, or an `unavailable` result.

#### Scenario: Confident match returned

- **WHEN** the pipeline resolves an ingredient via a cache hit or a defined brand preference
- **THEN** it returns `{ resolved: true, sku, brand, size, price: { regular, promo }, on_sale, reason }` without writing the cache

#### Scenario: Ambiguous result returned

- **WHEN** deterministic narrowing leaves no confident pick
- **THEN** it returns `{ resolved: false, ambiguous: true, candidates: [...], reason }` for the consuming surface (the order checkpoint / review widget) to resolve

#### Scenario: Unavailable result returned

- **WHEN** no candidate is fulfillable via curbside or delivery at the resolved location
- **THEN** it returns `{ resolved: false, reason: "unavailable" }` and does not substitute

#### Scenario: The matcher is not a model tool

- **WHEN** a member connector's tool list is enumerated
- **THEN** `match_ingredient_to_kroger_sku` does not appear; ingredient resolution reaches the model only through `place_order`'s checkpoint reporting and the review widget's app ops

### Requirement: Tri-state brand-preference confidence

The system SHALL consume each canonical ingredient family's native `{ tiers, any_brand }` preference object without flattening it. After curbside/delivery availability and top identity-relevance gating, an absent family SHALL return `ambiguous`; otherwise the matcher SHALL inspect tiers in order and choose from the first tier having an available case-insensitive exact brand match. Brands within that tier SHALL be equally ranked and the quantity-aware deterministic price core SHALL choose the cheapest acceptable product among them. When every tier is exhausted, `any_brand:true` SHALL choose the cheapest acceptable product from the top identity-relevance pool, while `any_brand:false` SHALL return `ambiguous`. A revalidated cache hit SHALL remain confident. A result reason SHALL identify the winning tier or any-brand fallback.

#### Scenario: Equal brands in the first available tier compete on price
- **WHEN** a family stores `{ tiers:[["Brand A","Brand B"],["Brand C"]], any_brand:false }` and A and B are available in the top identity-relevance pool
- **THEN** the cheaper acceptable A-or-B product wins, stored peer order does not rank them, and Brand C is not considered

#### Scenario: Exhausted top tier falls through
- **WHEN** every brand in tier 1 is unavailable and a tier-2 brand is fulfillable
- **THEN** the matcher confidently chooses the cheapest acceptable tier-2 product and reports `brand tier 2`

#### Scenario: Any-brand is a terminal fallback after tiers
- **WHEN** all stored tiers are exhausted and the family has `any_brand:true`
- **THEN** the matcher confidently chooses the cheapest acceptable product from the top identity-relevance pool

#### Scenario: Exhausted ladder without any-brand asks
- **WHEN** all stored tiers are exhausted and the family has `any_brand:false`
- **THEN** the matcher returns the complete ranked ambiguous candidates rather than guessing or reporting unavailable

#### Scenario: Absent family asks
- **WHEN** the canonical ingredient has no brand family and no revalidated cache hit
- **THEN** the matcher returns `ambiguous` with candidates rather than guessing

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

The system SHALL, on a cache hit in the D1 `sku_cache` table (keyed by `(ingredient, location_id)`), short-circuit search and narrowing but revalidate the cached SKU with one targeted lookup for current price and curbside/delivery availability before returning it. An available SKU SHALL be returned with fresh price; an unavailable one SHALL trigger re-resolution. The cache SHALL NOT use a TTL. The tool SHALL accept a `bypass_cache` parameter that forces re-resolution.

#### Scenario: Cache hit revalidated before use

- **WHEN** a cached SKU is found for the normalized ingredient in the D1 `sku_cache` table
- **THEN** the system revalidates its current price and curbside/delivery availability, returns it with fresh price if available, and re-resolves if not

#### Scenario: bypass_cache forces re-resolution

- **WHEN** the caller passes `bypass_cache: true`
- **THEN** the pipeline ignores any cache hit and runs full search and narrowing

### Requirement: Alias-driven normalization

The system SHALL normalize the ingredient by stripping a leading quantity/unit, lowercasing, and resolving the cleaned surface form to a **canonical id** through the shared alias front-door (variant → id) and the identity registry's representative pointer, where a canonical id is a base plus zero or more product qualifiers (`base` or `base::qualifier…`; see the `ingredient-normalization` capability). The quantity strip SHALL remove a leading quantity only when a measurement unit follows, so a **product qualifier** that reads like a fraction (e.g. `80/20`) is NOT discarded as a quantity. A surface form with no alias entry SHALL resolve to the cleaned term unchanged (no regression) and be enqueued for the capture job. The matcher SHALL search Kroger using the canonical id's reconstructed `search_term` when one exists (so `ground-beef::fat-80-20` searches "80/20 ground beef"), and the bare base otherwise. `sku_cache` and `brand_prefs` SHALL key on the canonical id. Normalization SHALL NOT aggressively strip qualifiers beyond the deterministic quantity strip; product-versus-preparation qualifier judgment belongs to the capture job, not the hot path.

#### Scenario: Alias resolves a variant to its canonical id

- **WHEN** an ingredient string matches a `variant` entry in the shared alias table
- **THEN** it is normalized to that canonical id (through the representative pointer) before cache lookup and search

#### Scenario: A product qualifier is preserved, not stripped as a quantity

- **WHEN** `match_ingredient_to_kroger_sku("80/20 ground beef")` normalizes the term
- **THEN** the `80/20` is not stripped as a leading quantity, and the term resolves toward `ground-beef::fat-80-20` (searching "80/20 ground beef") rather than collapsing to bare "ground beef"

#### Scenario: An unmapped term still resolves and is captured

- **WHEN** an ingredient has no alias entry
- **THEN** the matcher normalizes to the quantity-stripped term and proceeds (as today), and the surface form is enqueued so a later capture tick can place it

#### Scenario: A learned SKU mapping and a brand preference are written under the canonical id

- **WHEN** `place_order` caches a mapping for a grocery line named "2 lb ground beef", or `update_preferences` sets a brand preference keyed "2 lb Ground Beef"
- **THEN** the write keys on the canonical id the matcher reads by — `sku_cache.ingredient` = "ground beef" and the `brand_prefs.term` = `brandKey("ground beef")` = "ground_beef" — so the entry is found on the next resolution rather than fragmenting under the raw surface form

### Requirement: compare_unit_price deterministic comparison

The system SHALL provide the deterministic price-per-unit comparison core (`compareUnitPrice`) as an internal operation — it drives the matcher's tiebreaker, the substitution/order-review ranking, and any surface presenting comparable candidates; it is **not** a model-advertised MCP tool, so no LLM performs the arithmetic anywhere. It SHALL parse, convert, and divide internally, rank only within a single dimension (volume, weight, or count), and place cross-dimension or unparseable items in `incomparable`. A size SHALL be treated as unparseable — and routed to `incomparable` — whenever its computed base-unit quantity is not a finite positive number (zero, negative, or non-finite), including via a zero/`Infinity` multi-pack multiplier, a divide-by-zero fraction (`"1/0"`), or a `quantity_override` of `0`; such a size SHALL NOT yield a zero or non-finite `unit_price` that could sort as `cheapest`. A `price` string that is ambiguous to parse (more than one decimal point, or a decimal comma) SHALL parse to no value rather than a silently mis-scaled number. It SHALL accept optional `quantity_override`/`unit_override` for residue the parser could not handle.

#### Scenario: Ranked within a dimension

- **WHEN** the core receives same-dimension items with parseable sizes
- **THEN** it returns them ranked by ascending unit price with a `cheapest` id

#### Scenario: Cross-dimension and unparseable excluded

- **WHEN** items span different dimensions or carry unparseable size strings
- **THEN** those items are returned in `incomparable` rather than mis-ranked

#### Scenario: Degenerate size routes to incomparable, never cheapest

- **WHEN** an item's size yields a zero, negative, or non-finite base-unit quantity (e.g. `"0 x 1 oz"`, `"1/0 gal"`, or a `quantity_override` of `0`)
- **THEN** the item is returned in `incomparable` and is never selected as `cheapest`

#### Scenario: Ambiguous price string is not silently mis-parsed

- **WHEN** an item's `price` is an ambiguous string such as `"1.234,56"` or `"1.2.3"`
- **THEN** it parses to no value (the item is not ranked on a mis-scaled price) rather than producing a 1000×-wrong figure

### Requirement: Deterministic tiebreaker

The system SHALL break ties among top-scoring candidates deterministically: prefer on-sale (`promo > 0`) over regular, then best price-per-unit via the unit-price core. For "don't care" (`[]`) commodities it SHALL pick the smallest package covering the `quantity_hint`, then cheapest absolute.

#### Scenario: On-sale preferred

- **WHEN** two equally-scored candidates differ only in sale state
- **THEN** the on-sale candidate is chosen

#### Scenario: Commodity sizing

- **WHEN** resolving a `[]` commodity with a `quantity_hint`
- **THEN** the smallest package covering the hint is chosen, breaking ties by cheapest absolute price

### Requirement: Display name is not a matcher input

The matcher SHALL NOT read a node's `display_name` from any source. Ingredient resolution, Kroger search-phrase selection, and identity-relevance scoring SHALL continue to use only the canonical id, its reconstructed `search_term` (bare base as fallback), and the query's whitespace-separated content-tokens. A change to any node's `display_name` SHALL NOT change a match result, a candidate ranking, a `sku_cache` key, or a `brand_prefs` key. The `display_name` is a presentation attribute only; it rides alongside identity and never feeds the resolve-only matching pipeline.

#### Scenario: Changing a display name does not change matching

- **WHEN** a node's `display_name` is edited and the same ingredient is matched again with otherwise-unchanged data
- **THEN** the matcher returns the same SKU and the same candidate ranking, and searches Kroger with the same `search_term`-derived phrase as before

#### Scenario: Identity-relevance ignores the display name

- **WHEN** identity-relevance is scored for a candidate
- **THEN** the score is computed from the normalized query's content-tokens against the candidate's `description`/`categories` only, with the node's `display_name` playing no part

### Requirement: Broader search uses a bounded factual identity ladder

For an unavailable preview line, the system SHALL provide a read-only broader search whose de-duplicated phrase ladder is: representative-resolved direct outward `general` ancestors before direct outward `containment` ancestors (membership, substitution, abstract targets, siblings, and transitive traversal excluded); then the exact bare-base identity for a qualified canonical id when distinct; then the requested survivor's stored `search_term` only when distinct from prior phrases. The operation SHALL issue at most three Kroger searches, stop at the first rung with fulfillable products, cap results at twelve, and SHALL NOT write `sku_cache`, aliases, preferences, grocery rows, or graph edges.

#### Scenario: Direct general ancestor supplies broader candidates
- **WHEN** an unavailable qualified identity has a direct general ancestor whose search returns fulfillable products
- **THEN** the operation returns that rung's candidates and does not search later base or search-term rungs

#### Scenario: Unsafe graph relations are excluded
- **WHEN** the requested identity has membership siblings, substitution edges, or only transitive ancestors
- **THEN** those nodes are not searched and the operation never presents them as a deterministic broader identity

#### Scenario: No safe rung returns no broader result
- **WHEN** the ladder is empty or every bounded search has no fulfillable result
- **THEN** the operation returns an empty broader result and leaves manual catalog search available without inventing a substitution

### Requirement: Broader candidates disclose deterministic divergence

Every broader candidate SHALL carry structured divergence naming the requested label, searched label and rung, traversed factual relation when present, requested constraint tokens absent from the product description/categories, and candidate description terms used for display. Selecting the candidate SHALL stage a forced SKU against the original line but SHALL NOT assert synonymy, change canonical identity, or save its brand as the requested family's preference.

#### Scenario: Product omits a requested constraint
- **WHEN** a whole-bean request broadens to Coffee and a candidate describes ground coffee without the words whole bean
- **THEN** the result says it searched a broader identity, names ground from the product, and says whole bean is not mentioned

### Requirement: Manual catalog search is bounded and non-learning

The system SHALL provide current-location free-text Kroger catalog search for a review line or client impulse key. It SHALL accept a trimmed 2–80 character query, issue one search, filter to curbside/delivery-fulfillable products, cap at twenty, and return query-ranked product facts including explicit fulfillment modality. It SHALL NOT consult brand preferences, capture the query as ingredient identity, write the SKU cache, or claim a result matches the original line.

#### Scenario: Manual search returns modality facts without writing
- **WHEN** a member searches `decaf espresso` during review
- **THEN** the operation returns at most twenty fulfillable catalog candidates with curbside/delivery facts and leaves every D1 table unchanged

