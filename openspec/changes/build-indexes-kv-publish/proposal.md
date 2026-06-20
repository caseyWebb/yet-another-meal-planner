## Why

The recipe index (`_indexes/recipes.json`) is a pure build artifact read on nearly every tool call, yet it is currently fetched from GitHub via the App API — adding 100–300 ms of latency and counting against the rate limit on every invocation. KV reads are ~1 ms with no rate ceiling, making it the right home for derived, frequently-read, never-user-edited data.

## What Changes

- **New `DATA_KV` KV namespace** added to the Worker (auto-provisioned like the existing three; id-less in the template, pinned on first deploy).
- **`build-indexes` CI step** additionally publishes the recipe index to `DATA_KV` after committing it; the reusable workflow gains `secrets: inherit` so `CLOUDFLARE_API_TOKEN` (already a data-repo secret) is available. The namespace ID is read from the data repo's `wrangler.jsonc` — no new operator input.
- **Worker recipe-index reads** switch from `gh.getFile("_indexes/recipes.json")` to `env.DATA_KV.get("index:recipes")` across all three call sites (`list_recipes`, `retrospective`, discovery idempotency).
- **`_indexes/recipes.json`** is kept committed (no removal) — it retains git-diff value showing what changed per recipe push, and serves as a human-readable audit trail. The Worker ignores it at runtime.
- **Bootstrap gap closed** by running `build-indexes --publish` as a step inside the deploy workflow, so the index is in KV immediately after first deploy.
- **No fallback to GitHub** — KV is the contract; a missing index surfaces as `index_unavailable` (same as today when the file is absent).

## Capabilities

### New Capabilities

- `recipe-index-kv`: Publishing the recipe index to KV at build time and reading it from KV at runtime.

### Modified Capabilities

- `data-indexing`: Build step now publishes to KV in addition to writing the JSON file.
- `build-automation`: `data-build-indexes.yml` reusable workflow gains a KV-publish step; the thin data-repo caller gains `secrets: inherit`.
- `operator-provisioning`: `DATA_KV` auto-provisioned alongside the existing three namespaces; template `wrangler.jsonc` gains the id-less binding.

## Impact

- **`src/tools.ts`**, **`src/cooking-tools.ts`**, **`src/discovery-tools.ts`** — recipe index read path changes from GitHub to KV.
- **`src/env.ts`** — new `DATA_KV: KVNamespace` binding.
- **`wrangler.jsonc`** (code repo) — new id-less `DATA_KV` binding.
- **`.github/workflows/data-build-indexes.yml`** (code repo) — new KV-publish step.
- **`groceries-agent-data-template`** — `build-indexes.yml` caller gains `secrets: inherit`; `wrangler.jsonc` gains id-less `DATA_KV` binding.
- **`groceries-agent-data`** (operator) — `build-indexes.yml` caller gains `secrets: inherit`; `wrangler.jsonc` gains `DATA_KV` binding (id populated on next deploy or manually via CF dashboard).
- No API surface changes; no tool schema changes; no breaking changes to any consumer.
