## ADDED Requirements

### Requirement: Index build publishes to DATA_KV

After writing `_indexes/recipes.json`, the build script SHALL publish the recipe index to `DATA_KV` under the key `"index:recipes"` when a Cloudflare API token and the `DATA_KV` namespace id are available. The namespace id SHALL be read from the data repo's `wrangler.jsonc` (the `DATA_KV` binding's `id` field) so no additional operator input is required. If the namespace id is absent (e.g. before first deploy has pinned it back), the publish step SHALL warn and skip rather than fail the build.

#### Scenario: Successful publish after index write

- **WHEN** `build-indexes.mjs` runs with `CLOUDFLARE_API_TOKEN` available and `DATA_KV` id present in `wrangler.jsonc`
- **THEN** `DATA_KV["index:recipes"]` is set to the JSON string of the recipe index immediately after `_indexes/recipes.json` is written

#### Scenario: Publish skipped when namespace id absent

- **WHEN** `build-indexes.mjs` runs but `DATA_KV` has no `id` in `wrangler.jsonc` (pre-first-deploy)
- **THEN** the script prints a warning, skips the KV publish, writes `_indexes/recipes.json` as normal, and exits 0

#### Scenario: KV publish is a no-op in check mode

- **WHEN** `build-indexes.mjs` is run with `--check`
- **THEN** no KV write occurs (validation only, no side effects)
