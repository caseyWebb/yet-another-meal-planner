## MODIFIED Requirements

### Requirement: Index regeneration GitHub Action

The system SHALL provide `.github/workflows/build-indexes.yml` that triggers on push to `recipes/**`, runs validation, regenerates `_indexes/recipes.json`, commits it back to the branch, and publishes the index to `DATA_KV`. The reusable workflow SHALL declare `CLOUDFLARE_API_TOKEN` as an optional secret so the thin data-repo caller can pass it via `secrets: inherit`. The data-repo thin caller SHALL use `secrets: inherit`. The workflow SHALL request `contents: write` permission. It SHALL NOT trigger on ready-to-eat changes or regenerate a ready-to-eat index — ready-to-eat is per-tenant state read directly from `users/<username>/ready_to_eat.toml`, not an indexed shared catalog.

#### Scenario: Push regenerates, commits, and publishes to KV

- **WHEN** a push modifies a file under `recipes/**`
- **THEN** the Action validates the corpus, regenerates the recipe index file, commits any changes back to the branch, and publishes the index to `DATA_KV`

#### Scenario: Validation failure fails the Action

- **WHEN** a pushed change fails a hard-fail validation rule
- **THEN** the Action fails and does not commit regenerated indexes or publish to KV

#### Scenario: KV publish uses namespace id from wrangler.jsonc

- **WHEN** the build-indexes Action publishes to KV
- **THEN** it reads the `DATA_KV` namespace id from the data repo's `wrangler.jsonc` without requiring any separately-configured input or secret
