## MODIFIED Requirements

### Requirement: Recipes carry an AI-written brief description

Each recipe SHALL carry a **mandatory, non-empty** `description` frontmatter field: a
brief (≈1–2 sentence) summary written by the agent at import in a consistent,
craving-aligned register, describing the dish's identity, flavor/texture, and when one
would want it. The `description` SHALL NOT be the scraped marketing copy from the source
site. It is human-editable (it lives in authored markdown frontmatter); the derived
embedding is rebuilt from whatever the description currently says. Because `description`
is a required field (the `recipe-metadata-contract` capability), a recipe with **no**
description SHALL NOT be writable or buildable — so the only recipe excluded from semantic
ranking is one whose embedding has not **yet** been reconciled (a transient
just-imported state), not a permanent description-less recipe.

#### Scenario: Description is generated at import, not scraped

- **WHEN** a recipe is imported and the source page carries SEO marketing copy
- **THEN** the persisted `description` is the agent's own concise summary, not the source marketing text

#### Scenario: A description-less recipe cannot be persisted

- **WHEN** a recipe write or build presents a recipe with an empty or absent `description`
- **THEN** it is rejected as non-compliant (no permanent description-less, facet-only recipe exists in the corpus)

#### Scenario: Only the pre-reconcile state is excluded from ranking

- **WHEN** a recipe has been imported with a valid `description` but its embedding has not yet been reconciled by the cron
- **THEN** it is transiently excluded from semantic ranking (still returned by facet filters) until the next reconcile fills its embedding
