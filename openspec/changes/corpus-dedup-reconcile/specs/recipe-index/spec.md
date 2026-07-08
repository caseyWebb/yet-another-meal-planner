## MODIFIED Requirements

### Requirement: The Worker reconcile projects the index into D1

The Worker's scheduled reconcile (`src/recipe-projection.ts`) SHALL project the validated recipe set into the D1 `recipes` table by replacing its contents wholesale in one transaction (`DELETE` then batched `INSERT`), so a removed recipe loses its row and the table is a deterministic function of the R2 `recipes/*.md` corpus **merged with the classify pass's derived facets and the current ingredient identity resolver**. For each facet column the projection SHALL write the **effective** value (see *The index materializes effective facets*), reading the derived facets from the classify-pass-owned sibling table, and SHALL resolve the effective `ingredients_key`/`perishable_ingredients` through the shared resolver (see *Projection-time ingredient identity resolution*). It SHALL NOT publish the index to KV. Projection is eventual (cron-driven): a fresh database is populated by the first reconcile pass over the R2 corpus and the classify pass's derived facets.

A recipe whose frontmatter carries a non-empty string `duplicate_of` (the merge tombstone written through the operator-confirmed dedup flow — see the `recipe-dedup` capability) SHALL be **deliberately excluded** from the projected index: no `recipes` row, and no `reconcile_errors` row (a tombstone is a curation decision, not a defect). The projection summary SHALL count excluded tombstones so the exclusion stays observable. Because the excluded slug leaves `recipes`, its derived rows converge through the existing orphan prunes with no tombstone-specific machinery; removing the marker restores the recipe's row on the next projection.

#### Scenario: A reconcile rebuilds the D1 table

- **WHEN** the reconcile runs after a recipe change
- **THEN** the `recipes` table is replaced to match the current R2 `recipes/*.md` and the derived facets, with no KV `index:recipes` write

#### Scenario: First reconcile populates a fresh database

- **WHEN** an operator deploys and the first scheduled reconcile runs
- **THEN** it populates the D1 `recipes` table from the R2 corpus and the available derived facets, so `search_recipes` returns results

#### Scenario: A duplicate_of tombstone projects no row and no error

- **WHEN** the reconcile encounters a valid recipe file whose frontmatter carries `duplicate_of: <survivor-slug>`
- **THEN** it writes no `recipes` row and no `reconcile_errors` row for it, counts it in the projection summary, and the recipe disappears from list/search/menu-generation on this tick

#### Scenario: Removing the tombstone restores the recipe

- **WHEN** a previously-marked recipe's `duplicate_of` field is removed
- **THEN** the next projection writes its `recipes` row again and downstream derivation (description, embedding, facets) reconverges on the following passes
