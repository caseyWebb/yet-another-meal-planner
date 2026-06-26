## 1. Verify aube specifics (do first)

- [x] 1.1 Add `aube` to `mise.toml` `[tools]`, run `mise install`, confirm `aube`/`aubr`/`aubx` are on the path — used the `github:endevco/aube` backend (registry shorthand absent on current mise; ubi deprecated + installs only one binary). github backend extracts the full tarball incl. `aubr`/`aubx` symlinks. Pinned `1.25.1` to match the `node` pin.
- [x] 1.2 Ran `aube install`; gated set is 7 pkgs (`@fission-ai/openspec`, `@mongodb-js/zstd`, `core-js-pure`, `esbuild`, `node-liblzma`, `sharp`, `workerd`). Empirically: typecheck/test/test:tooling AND `wrangler deploy --dry-run` all pass with ZERO builds approved (wrangler vendors its own esbuild; default jail = skip-with-warning, non-blocking). Minimal allow = `esbuild`+`workerd` (for `aubr dev`/deploy); other 5 set `false`.
- [x] 1.3 Confirmed `aube install` reads/writes `package-lock.json` in place — byte-for-byte unchanged, no `aube.lock`/`pnpm-lock.yaml` created.

## 2. Toolchain & manifest (local dev)

- [x] 2.1 Committed the `mise.toml` `[tools]` aube entry (`github:endevco/aube` = `1.25.1`) + explanatory comment; updated the `npm run build:plugin` comment to `aubr build:plugin`.
- [x] 2.2 Added `aube.allowBuilds` to `package.json`: `esbuild`/`workerd` = `true`, the other 5 reviewed `false`. Verified install is warning-free and test gate green.
- [x] 2.3 Added committed `.npmrc` with `minimum-release-age=10080`; verified `aube config get minimumReleaseAge` → `10080`.
- [x] 2.4 Updated `.devcontainer/devcontainer.json` `postCreateCommand` to `mise install && mise exec -- aube install`.
- [x] 2.5 Verified: `aube ci` clean install non-interactive (0 build warnings, lockfile unchanged); `aubr typecheck`/`test`/`test:tooling` all green.

## 3. CI conversion + caching

- [x] 3.1 `ci.yml` (`test` job): replaced `actions/setup-node` + `npm ci` with `jdx/mise-action@e6a8b39 # v4.2.0` (+ `github_token`) + `actions/cache@2c8a9bd # v6.0.0` on `~/.local/share/aube/store` + `aube ci`.
- [x] 3.2 `ci.yml`: changed the three test steps to `aubr typecheck`/`aubr test`/`aubr test:tooling`; left the `node scripts/build-plugin.mjs` drift check as-is (node on PATH via mise).
- [x] 3.3 `data-deploy.yml`: swapped to mise-action + store-cache + `aube ci`; `aubr typecheck`/`aubr test`. Added job-level `MISE_GLOBAL_CONFIG_FILE: _code/mise.toml` so node/aube resolve from the data-repo root (where `node _code/scripts/*` and the merge step run). wrangler-action unchanged (uses _code's wrangler; npm still on PATH via mise if it needs it).
- [x] 3.4 `data-build-indexes.yml`: same swap + `MISE_GLOBAL_CONFIG_FILE`.
- [x] 3.5 `data-build-site.yml`: same swap + `MISE_GLOBAL_CONFIG_FILE`.
- [x] 3.6 `data-build-plugin.yml`: `actions/setup-node` → `jdx/mise-action` with `install_args: node` (node only). Code is checked out at root here, so no `_code` indirection; no store cache, no `aube ci`.
- [x] 3.7 SHA-pinned `jdx/mise-action@e6a8b39 # v4.2.0` and `actions/cache@2c8a9bd # v6.0.0` with version comments. All 7 workflow files parse (yq).
- [x] 3.8 PR [#79](https://github.com/caseyWebb/groceries-agent/pull/79): `test` job green on a clean runner (mise installed `github:endevco/aube@1.25.1`, `aube ci`, 565+104 tests pass). Cold run populated the store cache; the archive-commit push triggers a warm run to confirm restore. NOTE: `ci.yml` is validated directly; the reusable `data-*.yml` workflows run only in an operator data repo — flagged for a follow-up dispatch there.

## 4. Dependabot cooldown

- [x] 4.1 Added `cooldown: { default-days: 7 }` to the npm update entry in `.github/dependabot.yml`, numerically aligned with `.npmrc` `minimum-release-age=10080`.

## 5. Docs

- [x] 5.1 Updated `CONTRIBUTING.md` (Toolchain + Worker + data-tooling + plugin sections) to `aube install`/`aubr …`; also documented the cooldown.
- [x] 5.2 Updated `CLAUDE.md` `npm run build:plugin` → `aubr build:plugin`.
- [x] 5.3 Updated `README.md`, `docs/ARCHITECTURE.md`, `docs/SELF_HOSTING.md`, `AGENT_INSTRUCTIONS.md`, and `scripts/build-plugin.mjs` comments to aube verbs.
- [x] 5.4 Added the security-update/cooldown residual note to `CONTRIBUTING.md` Toolchain section.

## 6. Final verification

- [x] 6.1 `rg` for npm verbs returns only intentional matches: CONTRIBUTING.md:22 (explains the npm→aubr mapping). Pre-existing drift noted out of scope: `openspec/specs/build-automation/spec.md` references a `prepare`/`npm install` hook that no longer exists in `package.json` (recipe data moved to the data repo) — not introduced or broken by this change.
- [x] 6.2 Ran the full local ci.yml-equivalent: clean `aube ci`, `aubr typecheck`, `aubr test` (565 pass), `aubr test:tooling` (104 pass), plugin-drift guard ✓. (Pushing a PR for the true cold/warm-cache run is task 3.8, not done locally.)

## 7. Extra (user request during apply)

- [x] 7.1 Added `[env]._.path = ["node_modules/.bin"]` to `mise.toml` so locally-installed bins (e.g. `openspec`) run as bare commands here; verified `openspec` now resolves to `node_modules/.bin/openspec` (pinned 1.4.1) instead of the global Homebrew copy.
