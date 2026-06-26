## Context

This repo manages Node tooling with npm. `mise.toml` pins `node`; `package.json` holds thin scripts (`vitest run`, `wrangler dev`, `node scripts/*.mjs`); CI (`ci.yml`) and the reusable data-repo workflows (`data-*.yml`) run `npm ci` + `npm run …` on `actions/setup-node`. **No workflow enables any caching** — `setup-node` is used without its `cache:` input, so every job does a cold full install.

**aube** is jdx's Node package manager (same author as the `mise` already in use, so the integration is first-class). It reads/writes `package-lock.json` in place (no lockfile migration), uses a pnpm-style content-addressable global store, and ships three multicall binaries: `aube` (the manager), `aubr` = `aube run`, `aubx` = `aube dlx`. It has strong supply-chain defaults: a dependency lifecycle-script jail (allowlist-gated) and a `minimumReleaseAge` cooling window (default 1440 min / 24h).

This change is dev/build tooling only — the deployed Worker is untouched.

## Goals / Non-Goals

**Goals:**
- Make aube the repo's package manager via mise, keeping `package-lock.json` as the lockfile.
- Convention: `aubr <script>` for scripts, `aube install` locally, `aube ci` in CI.
- Enable dependency caching that does not exist today, on both CI tracks.
- Commit a 7-day supply-chain cooldown, kept numerically identical between aube and Dependabot.
- Keep the change drop-in and reversible.

**Non-Goals:**
- Converting `package.json` scripts into mise tasks (separate decision; aube is drop-in as scripts).
- Migrating away from `package-lock.json` to `aube.lock`/`pnpm-lock.yaml` (kept in place; Dependabot npm ecosystem stays valid).
- Any change to Worker runtime behavior, deploy mechanics, or the determinism boundary.

## Decisions

### D1 — aube via mise `[tools]`, scripts stay in `package.json` (Option A)
Add `aube` to `mise.toml` `[tools]`; mise exposes `aube`/`aubr`/`aubx`. Keep `package.json` scripts as the single source of truth and run them with `aubr`.
- **Why:** Smallest diff; `package.json` is already the contract CLAUDE.md points to; aube's whole pitch is drop-in.
- **Alternative — mise tasks (Option B):** lift each script into `[tasks]`. Rejected here: larger churn, two task systems mid-migration, and it doesn't depend on aube — it's a separate "adopt mise tasks" decision.

### D2 — `aube ci` in CI, `aube install` locally
CI runners run `aube ci` (wipes `node_modules`, asserts lockfile matches `package.json`, clean install) — the `npm ci` analogue. Local/devcontainer use `aube install`.
- **Why:** `aube ci` gives the lockfile-strict determinism CI wants and is the command designed for the warm-cache path.

### D3 — Lifecycle jail handled by committed `package.json` config
Add `aube.allowBuilds` to `package.json` so dependency postinstall builds run non-interactively (works in CI with no flags). Deny-rules beat allow-rules; bare names / version pins / wildcards supported; legacy `pnpm.onlyBuiltDependencies` is also honored.
```jsonc
"aube": { "allowBuilds": { "esbuild": true, "workerd": true } }
```
- **Resolved during apply:** `aube install` gates 7 packages (`@fission-ai/openspec`, `@mongodb-js/zstd`, `core-js-pure`, `esbuild`, `node-liblzma`, `sharp`, `workerd`). Empirically *none* are needed for the test gate or even `wrangler deploy --dry-run` (wrangler vendors its own esbuild), and aube's default for unreviewed builds is **skip-with-warning, not block** — so CI never hangs. Final config records all 7: `esbuild`/`workerd` = `true` (for the `aubr dev`/deploy path), the other 5 = `false` (reviewed, unused) to keep installs warning-free.
- Root lifecycle scripts (e.g. a `prepare` hook) are **not** jailed — they still run under `aube install`, so any prepare-based hook-install convention is unaffected.

### D6 — aube install backend: `github:endevco/aube` (not the registry shorthand, not `ubi:`)
The bare `aube` registry shorthand is absent on the current mise; `ubi:` is deprecated *and* installs only the single `aube` binary (no `aubr`/`aubx`). The `github:` backend extracts the full release tarball, which ships `aube` + `aubr`→`aube` + `aubx`→`aube` (multicall symlinks), so all three resolve via mise. Pinned `1.25.1` to match the exact `node` pin. CI passes `github_token` to `jdx/mise-action` so the backend's GitHub API calls don't hit the anonymous rate limit.

### D7 — `MISE_GLOBAL_CONFIG_FILE` for the `_code`-checkout workflows
`data-deploy.yml`, `data-build-indexes.yml`, `data-build-site.yml` check the code repo into `_code/`, but their build steps run `node _code/scripts/*.mjs --root .` from the **data-repo root** (where there's no mise config, and `--root .` must stay the data repo). mise resolves tools by walking *up* from cwd, so a root-cwd `node` wouldn't find `_code/mise.toml`. Setting job-level `env.MISE_GLOBAL_CONFIG_FILE: ${{ github.workspace }}/_code/mise.toml` makes node/aube resolve from any cwd (verified locally). `data-build-plugin.yml` checks out the code at the root, so it needs none of this — just `jdx/mise-action` with `install_args: node`.

### D8 — Project-local bins on PATH (added during apply at user request)
`mise.toml` `[env]._.path = ["node_modules/.bin"]` prepends the project's local bin dir so dev-dependency binaries (e.g. `openspec`) run as bare commands and pick up the `package.json`-pinned version over any global install.

### D4 — Supply-chain cooldown: 7 days, committed, aligned both sides
- aube: commit `minimum-release-age=10080` in a repo `.npmrc` (10080 min = 7 days) rather than relying on the implicit 24h default — makes the value reviewable and travels with the repo.
- Dependabot: `cooldown.default-days: 7` on the npm update entry.
- **Why identical:** both tools "skip to the newest version old enough" rather than blocking, so a shared threshold means Dependabot only ever proposes versions aube will install. 7d (over the 24h default) is a meaningfully better supply-chain guard and a weekly schedule ages past it anyway.

### D5 — CI: mise-action + two-tier caching
Swap `actions/setup-node` + npm for `jdx/mise-action` + aube on `ci.yml`, `data-deploy.yml`, `data-build-indexes.yml`, `data-build-site.yml`. Two distinct caches:
- **Tool cache** (node + aube binaries): automatic via `jdx/mise-action` (keyed on `mise.toml`). Free with the swap.
- **Dependency cache** (aube content store): net-new `actions/cache` of `~/.local/share/aube/store` keyed on `hashFiles('package-lock.json')` with an `aube-store-${{ runner.os }}-` restore-key. `aube ci` rebuilds a clean `node_modules` by re-linking already-hashed tarballs.
```yaml
- uses: jdx/mise-action@<sha>
- uses: actions/cache@<sha>
  with:
    path: ~/.local/share/aube/store
    key: aube-store-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    restore-keys: aube-store-${{ runner.os }}-
- run: aube ci
```
`data-build-plugin.yml` stays special: the plugin builder imports only Node built-ins, so it needs node only — mise-action (tool cache) and **no** install / no store cache / no `aube ci`.
- **Pinning:** new actions (`jdx/mise-action`, `actions/cache`) are SHA-pinned with a `# vN.M.P` comment per the `dependency-automation` SHA-pinning requirement.

## Risks / Trade-offs

- **`allowBuilds` set is unverified** → Run `aube ignored-builds` before implementing; an incomplete allowlist surfaces as a failed/blocked build in the first CI run, not a silent miss.
- **Security-update / cooldown residual** → Dependabot `cooldown` excludes security updates, but aube's `minimumReleaseAge` applies to every install. A same-day security release could fail `aube ci` until it ages in. Mitigation: accept it (rare, self-healing — re-run CI once the version ages in). Do **not** set `AUBE_MINIMUM_RELEASE_AGE=0` in CI; that re-opens the day-zero risk the window guards against.
- **aube is a young tool in the critical CI path** → Mitigated by lockfile compatibility (revert is just restoring `npm ci`/`npm run` and dropping the aube config — no lockfile churn) and by jdx/mise shared authorship.
- **Two package managers during a partial rollout** → Avoided by taking local-dev + CI together so one manager is used everywhere on landing.

## Migration Plan

1. Land toolchain + manifest (`mise.toml`, `.npmrc`, `package.json` allowBuilds, devcontainer) and verify `aube install` + `aubr test` locally.
2. Convert CI workflows + caching; confirm green on a PR (cold then warm cache).
3. Update Dependabot cooldown and docs.
4. **Rollback:** restore `npm ci`/`npm run` in workflows, drop `aube` from `mise.toml`, remove `.npmrc`/`allowBuilds`/dependabot cooldown. `package-lock.json` is untouched throughout, so rollback needs no dependency reinstall.

## Open Questions

- ~~Exact `aube.allowBuilds` package set~~ — **resolved** (see D3): 7 gated, `esbuild`/`workerd` allowed, 5 denied.
- The reusable `data-*.yml` workflows can't be exercised from this code repo (they run in an operator's data repo with secrets). They pass `yq` parse + local reasoning, but a real dispatch in a data repo is the only full validation — flagged as a follow-up (task 3.8).
