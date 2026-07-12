## MODIFIED Requirements

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

## ADDED Requirements

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
