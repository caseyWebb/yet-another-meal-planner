## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Scoring not hard filtering

The system SHALL apply brand and dietary **preferences** as scoring signals, not eliminating filters, so that a missing preferred brand cannot empty the candidate set. There SHALL be two near-hard constraints, distinct from those soft preferences: (1) curbside/delivery availability — a candidate not fulfillable that way is not a valid pick; and (2) identity relevance — a confident pick SHALL come only from the top relevance tier (see "Identity-relevance near-hard constraint"). The near-hard constraints govern *which product*; the soft preferences govern *which brand/size/price among matches*.

#### Scenario: Missing preferred brand does not empty results

- **WHEN** the preferred brand is unavailable but other acceptable candidates exist
- **THEN** the candidate set is non-empty and the pipeline routes to `ambiguous` rather than returning no match

#### Scenario: Preference softness does not override identity

- **WHEN** a cheaper candidate would win on price but does not match the queried ingredient (zero relevance) while a relevant candidate exists
- **THEN** the relevant candidate is preferred — price softness applies only within the top relevance tier, not across it

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
