## ADDED Requirements

### Requirement: AI brief description generated at import

At import the agent SHALL generate and persist a `description` for the recipe: a brief (≈1–2 sentence) summary in a consistent, craving-aligned register (dish identity, flavor/texture, when one would want it), written by the agent — NOT the scraped marketing copy from the source page. The description is authored frontmatter (human-editable); the embedding is derived from it (reconciled Worker-side on the cron).

#### Scenario: Description is summarized, not scraped

- **WHEN** a recipe is imported from a page with promotional copy
- **THEN** the persisted `description` is the agent's concise summary, and the scraped marketing text is not used as the description

### Requirement: Memoized side search terms generated at import

When a main-course recipe is imported, the agent SHALL generate `side_search_terms` describing the kind of side that complements it (capturing the complementarity judgment once). These terms become the query for semantic side retrieval; curated `pairs_with` is unaffected and remains the deterministic high-confidence pairing.

#### Scenario: Side terms are written for a main

- **WHEN** a main-course recipe is imported
- **THEN** `side_search_terms` is populated with terms describing complementary sides, and `pairs_with` (if any) is left intact
