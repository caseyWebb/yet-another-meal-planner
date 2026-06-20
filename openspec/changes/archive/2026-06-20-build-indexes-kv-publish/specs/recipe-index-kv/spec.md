## ADDED Requirements

### Requirement: Recipe index is stored in and served from KV

The system SHALL maintain a `DATA_KV` KV namespace that holds the recipe index under the key `"index:recipes"`. The Worker SHALL read the recipe index exclusively from `DATA_KV` — not from the GitHub data repo — on every tool invocation that requires it (`list_recipes`, `retrospective`, the `read_recipe` slug-validation path, and the discovery idempotency check). A missing or empty `index:recipes` key SHALL surface as `index_unavailable`, identical to the error returned today when `_indexes/recipes.json` is absent from the repo.

#### Scenario: list_recipes reads from KV

- **WHEN** `list_recipes` is called
- **THEN** the Worker fetches the index from `DATA_KV.get("index:recipes")` and applies filters without making any GitHub API call for the index

#### Scenario: Missing KV key surfaces as index_unavailable

- **WHEN** `DATA_KV` has no `"index:recipes"` key (e.g. before first build-indexes publish)
- **THEN** the tool returns a structured `index_unavailable` error, not an unhandled exception

#### Scenario: retrospective reads from KV

- **WHEN** `retrospective` is called
- **THEN** the recipe index is loaded from `DATA_KV`, not from `_indexes/recipes.json` in the data repo

#### Scenario: Discovery idempotency check reads from KV

- **WHEN** `parse_recipe` or `create_recipe` checks whether a source URL is already indexed
- **THEN** the source-URL lookup reads the index from `DATA_KV`

### Requirement: DATA_KV binding follows zero-config provisioning

`DATA_KV` SHALL be declared as an id-less KV binding in the code repo's `wrangler.jsonc` so that `wrangler deploy` auto-provisions the namespace for any operator and the deploy pin-back step writes the assigned id into the operator's `wrangler.jsonc`. An operator SHALL NOT manually create this namespace or configure its id unless they choose to (e.g. via the CF dashboard).

#### Scenario: First deploy provisions DATA_KV

- **WHEN** an operator deploys with no `DATA_KV` id in their `wrangler.jsonc`
- **THEN** `wrangler deploy` creates the namespace and the pin-back step commits its id to the operator's `wrangler.jsonc`

#### Scenario: Repeat deploy reuses the pinned namespace

- **WHEN** the operator redeploys after the first deploy
- **THEN** the Worker binds the same `DATA_KV` namespace (no new namespace created, no KV state orphaned)

### Requirement: Deploy workflow populates KV immediately after deploy

The deploy workflow (`data-deploy.yml`) SHALL run `build-indexes --publish` after a successful `wrangler deploy` so that `DATA_KV` contains a current index immediately — closing the bootstrap gap between the Worker binding the namespace and the first recipe-push triggering the build-indexes workflow.

#### Scenario: Fresh deploy leaves DATA_KV populated

- **WHEN** an operator runs the deploy workflow for the first time
- **THEN** `DATA_KV` contains the `"index:recipes"` key by the time the deploy job completes, and `list_recipes` returns results without requiring a recipe push first
