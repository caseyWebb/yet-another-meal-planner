## ADDED Requirements

### Requirement: Display name is not a matcher input

The matcher SHALL NOT read a node's `display_name` from any source. Ingredient resolution, Kroger search-phrase selection, and identity-relevance scoring SHALL continue to use only the canonical id, its reconstructed `search_term` (bare base as fallback), and the query's whitespace-separated content-tokens. A change to any node's `display_name` SHALL NOT change a match result, a candidate ranking, a `sku_cache` key, or a `brand_prefs` key. The `display_name` is a presentation attribute only; it rides alongside identity and never feeds the resolve-only matching pipeline.

#### Scenario: Changing a display name does not change matching

- **WHEN** a node's `display_name` is edited and the same ingredient is matched again with otherwise-unchanged data
- **THEN** the matcher returns the same SKU and the same candidate ranking, and searches Kroger with the same `search_term`-derived phrase as before

#### Scenario: Identity-relevance ignores the display name

- **WHEN** identity-relevance is scored for a candidate
- **THEN** the score is computed from the normalized query's content-tokens against the candidate's `description`/`categories` only, with the node's `display_name` playing no part
