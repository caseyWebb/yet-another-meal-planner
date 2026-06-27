## ADDED Requirements

### Requirement: Similar-recipes section on the recipe page

The recipe-body page `/cookbook/<slug>` SHALL render a "Similar Recipes" section listing up to a bounded number of other recipes nearest to the viewed recipe by cosine similarity over the stored recipe embeddings (`recipe_derived.embedding`). The neighbors SHALL be computed at request time from the persisted vectors, ordered by descending similarity and tie-broken deterministically by slug. The viewed recipe SHALL NOT appear in its own neighbor list. The maximum number of neighbors shown is a tunable constant and is NOT part of this contract.

#### Scenario: Nearest recipes are listed

- **WHEN** a recipe that has a stored embedding is viewed and other embedded recipes clear the similarity floor
- **THEN** a "Similar Recipes" section lists those recipes, the most similar first, reusing the recipe-list row UI (title, facet chips, blurb)

#### Scenario: The viewed recipe is excluded

- **WHEN** the neighbor list for a recipe is computed
- **THEN** the recipe itself is never included among its own similar recipes

#### Scenario: Deterministic ordering on ties

- **WHEN** two neighbor recipes have equal cosine similarity to the viewed recipe
- **THEN** they are ordered by slug, identically on every request

### Requirement: Minimum-similarity floor and graceful omission

Neighbors whose cosine similarity to the viewed recipe is below a minimum floor SHALL be excluded. When no recipe clears the floor — including when the viewed recipe has no stored embedding yet (just imported, not yet reconciled), or when no other recipe is embedded — the section SHALL be omitted entirely, with no heading and no empty-state placeholder, and the page SHALL render exactly as it would without this feature. Computing similar recipes SHALL be best-effort: a failure to load or parse the stored embeddings SHALL omit the section rather than fail the page, so the recipe body still renders. The similarity floor is a tunable constant and is NOT part of this contract.

#### Scenario: Below-floor neighbors are dropped

- **WHEN** every other recipe's similarity to the viewed recipe is below the floor
- **THEN** no neighbors are listed and no "Similar Recipes" section is rendered

#### Scenario: Unembedded viewed recipe omits the section

- **WHEN** the viewed recipe has no stored embedding yet
- **THEN** the page renders without a "Similar Recipes" section and without error

#### Scenario: Embedding load failure does not break the page

- **WHEN** the stored embeddings cannot be loaded or parsed while rendering a recipe page
- **THEN** the recipe body still renders and the "Similar Recipes" section is simply omitted

### Requirement: No Workers AI at request time

The "Similar Recipes" section SHALL be computed from stored vectors only — a read of the persisted `recipe_derived` embeddings plus cosine arithmetic — and SHALL NOT invoke Workers AI or perform any per-request embedding on the cookbook surface. The vectors are produced solely by the existing recipe-derived reconcile cron; rendering a recipe page SHALL add no AI compute.

#### Scenario: Rendering makes no AI call

- **WHEN** a `/cookbook/<slug>` page is rendered with its Similar Recipes section
- **THEN** no Workers AI / embedding call is made for that request; only the stored vectors are read

### Requirement: Anonymous, identical-for-every-visitor neighbors

Because the cookbook is an open, cross-tenant surface with no caller identity, the neighbor ranking SHALL use cosine similarity alone, with none of the per-tenant favorite, freshness, or pantry-overlap boosts applied by the agent-facing `search_recipes` tool. Every visitor SHALL see the same similar recipes for the same recipe.

#### Scenario: Same neighbors for every visitor

- **WHEN** two different visitors view the same recipe page
- **THEN** they see the same Similar Recipes, independent of any tenant's favorites, cooking history, or pantry

### Requirement: Strict no-script CSP preserved

The "Similar Recipes" section SHALL be server-rendered as static links requiring no client script, and the recipe-body page `/cookbook/<slug>` SHALL retain its strict no-script `Content-Security-Policy` (`default-src 'none'`, no `script-src`). Neighbor titles and metadata SHALL be rendered as escaped text and SHALL NOT be injected as raw HTML.

#### Scenario: Body page stays script-free

- **WHEN** `/cookbook/<slug>` is rendered with the Similar Recipes section
- **THEN** its `Content-Security-Policy` contains no `script-src` allowance and the page contains no `<script>`

#### Scenario: Neighbor content is rendered inert

- **WHEN** a neighbor recipe's title or blurb contains markup such as an inline `<script>`
- **THEN** the value is rendered escaped / as text, never as executable or injected HTML
