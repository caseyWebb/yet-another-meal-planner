## MODIFIED Requirements

### Requirement: Recipes explorer list shows facets, projection status, and relevance

The Recipes list SHALL be paginated with an **operator-configurable page size**, defaulting to **50**, and SHALL show, per recipe: the title, slug, a projection-status badge (indexed/skipped/pending/orphaned, per the existing status derivation), and facet chips for at least protein, cuisine, and total time when present. In Hybrid mode with a non-empty query, each row SHALL additionally show a relevance indicator proportional to its score. Selecting a row SHALL open that recipe's detail view.

#### Scenario: List row shows facets and status

- **WHEN** the Recipes list renders a row for an indexed recipe with a protein and cuisine facet
- **THEN** the row shows the recipe's title, slug, projection-status badge, and its protein/cuisine/time facet chips

#### Scenario: Hybrid results show a relevance indicator

- **WHEN** the operator runs a non-empty Hybrid search
- **THEN** each result row shows a relevance indicator sized to its score

#### Scenario: Page size defaults to 50

- **WHEN** the operator opens the Recipes list with no page-size preference set
- **THEN** the list paginates at 50 recipes per page

#### Scenario: Operator changes the page size

- **WHEN** the operator selects a different page size
- **THEN** the list re-paginates at the chosen size and the current filter/search state is preserved
