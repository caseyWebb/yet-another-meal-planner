## MODIFIED Requirements

### Requirement: Recipes explorer supports keyword and hybrid semantic search

The Recipes explorer (the typed `GET /admin/api/data/recipes` read and the Data area's Recipes screen over it) SHALL support a **Keyword** mode and a **Hybrid** mode, selected by the operator via a segmented toggle, over the same cross-tier recipe listing the existing recipe view assembles (title, slug, projection status). Keyword mode SHALL match a query's tokens against the recipe's indexed metadata (at least title, slug, protein, cuisine, course, tags, `ingredients_key`); a recipe matching all query tokens SHALL be included, one matching none SHALL be excluded, and matches SHALL NOT report a relevance score. Hybrid mode SHALL additionally rank by semantic similarity: the query SHALL be embedded once (a single Workers AI call reusing the Worker's existing query-embedding helper) and blended with the keyword coverage into a single relevance score per hit, using the recipe's stored `recipe_derived.embedding` — no per-request re-embedding of any recipe. Each hybrid hit SHALL carry its blended relevance score and a flag indicating whether it was surfaced via the semantic term without a full keyword match ("surfaced semantically"). A recipe with no stored embedding yet (not yet reconciled) SHALL be excluded from Hybrid mode's semantic ranking but SHALL remain findable via Keyword mode. An empty query SHALL return the full corpus unranked in either mode. The search query, mode, page, and page size SHALL be expressed in the screen's URL (query parameters) so every search state is deep-linkable, and each search SHALL be served by the parameterized read (search and pagination are not client-side over a prefetched corpus). The blend weights and the semantic-surfaced relevance floor are tunable constants and are NOT part of this contract.

#### Scenario: Keyword mode matches all query tokens

- **WHEN** the operator searches "miso salmon" in Keyword mode
- **THEN** only recipes whose indexed metadata contains both tokens are returned, with no relevance score

#### Scenario: Hybrid mode returns a relevance score

- **WHEN** the operator searches a query in Hybrid mode
- **THEN** each returned recipe carries a relevance score blending keyword coverage and cosine similarity to the embedded query

#### Scenario: A semantically-surfaced recipe is flagged

- **WHEN** a Hybrid-mode hit clears the relevance floor via semantic similarity without matching the query's literal keywords
- **THEN** that hit is flagged as surfaced semantically, distinguishing it from a literal keyword match

#### Scenario: An unembedded recipe is excluded only from Hybrid ranking

- **WHEN** a recipe's `recipe_derived` embedding has not yet been reconciled
- **THEN** it is absent from Hybrid mode's results but still findable in Keyword mode

#### Scenario: Hybrid mode makes exactly one embed call per search

- **WHEN** the operator runs a Hybrid search
- **THEN** the Worker makes exactly one Workers AI call to embed the query, and no recipe is re-embedded

#### Scenario: Empty query returns the unranked corpus

- **WHEN** the search box is empty
- **THEN** the explorer returns every recipe in the corpus/index, in either mode, without a relevance score

#### Scenario: A search state is deep-linkable

- **WHEN** the operator opens a URL carrying a query, mode, page, and page size
- **THEN** the Recipes screen renders exactly that search state from the parameterized read
