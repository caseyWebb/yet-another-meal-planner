## Why

The Worker (Change 04+) needs to filter ~200 recipes in a single read instead of fetching every file, and the corpus needs a guardrail so malformed frontmatter or broken component references never reach `main`. Both come from one content-agnostic build pass that can be written and proven now, against an empty corpus, before any real recipes exist.

## What Changes

- Add `scripts/build-indexes.mjs`: walks `recipes/*.md` and `ready_to_eat/*.toml`, validates them, and emits `_indexes/recipes.json`, `_indexes/components.json`, and `_indexes/ready_to_eat.json`.
- Define stable, slug-keyed index shapes the Worker can depend on, with deterministic (sorted, normalized) output so an unchanged corpus produces byte-identical files and no churn commits.
- Add a validation gate with a hard-fail / warn taxonomy: structural problems block; missing optional frontmatter only warns.
- Add a local `pre-commit` hook (validation-only, never mutates the tree), installed via npm `prepare` → `core.hooksPath`.
- Add `.github/workflows/build-indexes.yml`: regenerates indexes and validates on push to `recipes/**` / `ready_to_eat/**`, committing results back with `[skip ci]`.
- Add the JS toolchain: `mise.toml` (Node 22 LTS), `package.json` with `gray-matter` + `smol-toml`, and an npm build script.
- Add `tests/fixtures/` with 2-3 dummy recipes (one draft, one component pair) as permanent regression assets, keeping `recipes/` empty for Change 03.
- Document validation failure modes in `README.md`.

## Capabilities

### New Capabilities
- `data-indexing`: deterministic generation of the three `_indexes/*.json` artifacts from `recipes/` and `ready_to_eat/`, including index shapes, slug derivation, and stable output.
- `data-validation`: the validation rule set and its hard-fail / warn taxonomy applied to recipe frontmatter and data TOMLs.
- `build-automation`: where and when validation and index regeneration run — the pre-commit hook and the GitHub Action — including the CI-loop guard.

### Modified Capabilities
<!-- None. repo-structure (Change 01) is unaffected; this adds generated artifacts and tooling on top of it. -->

## Impact

- **New tooling**: `mise.toml`, `package.json`, `package-lock.json`, `node_modules/` (gitignored).
- **New code**: `scripts/build-indexes.mjs`, `scripts/githooks/pre-commit`, `.github/workflows/build-indexes.yml`, `tests/fixtures/`.
- **Generated artifacts**: `_indexes/recipes.json`, `_indexes/components.json`, `_indexes/ready_to_eat.json` (committed by the Action).
- **Dependencies**: `gray-matter`, `smol-toml` (runtime); Node 22 LTS via mise.
- **CI**: Action needs `contents: write` to push regenerated indexes; `[skip ci]` prevents re-trigger loops.
- **Docs**: `README.md` gains a validation-failure-modes section.
- **Downstream**: unblocks `list_recipes` / `suggest_sequencing` in Changes 04 and 08, which read these indexes.
