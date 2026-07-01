# Deploy handoff — Phase 0 monorepo move (`packages/worker`)

Phase 0 relocated the Worker from the repo root into `packages/worker/`. This note records what that means for the deploy control plane in `caseyWebb/groceries-agent-data`.

## TL;DR — no data-repo change is required

The actual deploy logic is a **reusable workflow in THIS repo** (`.github/workflows/data-deploy.yml`), which the data repo's thin `deploy.yml` invokes via `uses: … /data-deploy.yml@main` with **inputs only** (`code_ref`, `config_path`, `worker_host`) and secrets. None of those inputs reference the internal `_code/` layout, so the move is transparent to the caller.

This change already updated `data-deploy.yml` for the new layout:
- `_code/wrangler.jsonc` → `_code/packages/worker/wrangler.jsonc` (merge + pin steps).
- `_code/scripts/*.mjs` → `_code/packages/worker/scripts/*.mjs` (merge-wrangler-config, build-plugin, stamp-readme-badge).
- The three `wrangler-action` steps (R2 ensure, **deploy**, D1 migrations apply) and the Kroger-secrets step now run in `workingDirectory: _code/packages/worker` (so `wrangler` finds `wrangler.jsonc` + `migrations/d1/` + the `./admin/dist` ASSETS path).
- The aube steps (`aube ci`, `aubr typecheck`, `aubr test`, `aubr build:admin`) stay at `_code` root — they use the workspace-root proxy scripts, which delegate to `@grocery-agent/worker`.
- `MISE_GLOBAL_CONFIG_FILE` still points at `_code/mise.toml` (mise.toml stayed at the repo root) and `hashFiles('_code/package-lock.json')` is unchanged (the lockfile stays at root).

## What the operator should verify (once)

1. **The data repo's `deploy.yml` is a thin caller** (just `uses:` + `with:` + `secrets:`). If — and only if — it hardcodes any internal path from this repo (it should not), update that path to `packages/worker/…`. The default template caller does not.
2. **`config_path`** still points at the operator's OWN `wrangler.jsonc` in the data repo (default `wrangler.jsonc`) — unaffected by this move.
3. First deploy after this lands: confirm `wrangler deploy` runs from `_code/packages/worker` and the plugin publish + KV/D1 id pin-back still commit to the data repo as before.

## Note on the lockfile

`package-lock.json` was regenerated when the workspace was introduced (the worker's `@grocery-agent/contract` workspace dependency had to be linked). Re-resolution bumped a few transitive/minor versions within the 7-day `minimum-release-age` cooldown; all tests remained green.
