## ADDED Requirements

### Requirement: A transient classify failure does not advance the gate

The classify pass SHALL distinguish a **transient** failure (an `env.AI` / storage hiccup, including Workers AI quota exhaustion — error 4006) from a **permanent** failure (a contract `validation_failed` the retry budget couldn't fix). On a **transient** failure it SHALL NOT advance the recipe's `body_hash` gate and SHALL NOT write an empty `recipe_facets` row — so the recipe **retries on a later tick** and, meanwhile, the projection keeps merging the **authored frontmatter** rather than blank facets. Only a **permanent** contract failure SHALL park the recipe (advance the gate with empty facets) so it is not re-spent every tick. On a quota (4006) failure the pass SHALL stop the tick early (the remaining recipes would fail identically) and report `quota_exhausted` in its health summary.

#### Scenario: A transient failure leaves the recipe un-gated to retry

- **WHEN** a recipe's classification fails with a transient `env.AI` error (e.g. quota exhausted)
- **THEN** the gate is not advanced and no empty `recipe_facets` row is written, so the recipe is reclassified on a later tick and the projection keeps using its authored frontmatter facets meanwhile

#### Scenario: A permanent contract failure parks the recipe

- **WHEN** a recipe's classification cannot pass the recipe contract within the retry budget
- **THEN** the pass parks it — advancing the gate with empty facets — so the unclassifiable recipe is not re-spent on every tick

#### Scenario: Quota exhaustion stops the tick and is flagged

- **WHEN** a classify call returns Workers AI's 4006 daily-allocation error
- **THEN** the pass stops the tick (it does not keep spending requests that will fail the same way) and reports `quota_exhausted` in its health summary, which surfaces as the `/health` AI quota signal
