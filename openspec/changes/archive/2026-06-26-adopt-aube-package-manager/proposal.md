## Why

The repo runs Node tooling through npm with no install caching: every CI job (and the reusable data-repo workflows) does a cold `npm ci`, and local/devcontainer installs are equally uncached. Adopting **aube** — jdx's Node package manager, the same author as the `mise` we already use — gives faster, content-addressable installs with strong supply-chain defaults, drops in over the existing `package-lock.json` (no lockfile migration), and lets us turn on the dependency caching that is currently absent everywhere. aube's `aubr` shim (`aube run`) replaces `npm run` for scripts.

## What Changes

- Add **aube** to the toolchain via `mise.toml` (`[tools]`), alongside the existing pinned `node`. mise installs the `aube`/`aubr`/`aubx` binaries.
- Replace the **script runner** convention: `npm run <script>` → `aubr <script>`. `package.json` scripts stay as the single source of truth (no conversion to mise tasks).
- Replace **install verbs**: local/devcontainer `npm install` → `aube install`; CI `npm ci` → **`aube ci`** (lockfile-strict clean install). `package-lock.json` is kept and read/written in place.
- Add an **`aube.allowBuilds` allowlist** to `package.json` so dependency lifecycle scripts (e.g. esbuild/workerd binary postinstalls) run non-interactively under aube's lifecycle-script jail. Exact package set verified via `aube ignored-builds` before implementation.
- Commit a **7-day supply-chain cooldown** on both sides: aube `minimumReleaseAge = 10080` (committed config, not the implicit 24h default) and Dependabot `cooldown.default-days: 7`, kept numerically identical.
- **CI scope** — convert `ci.yml` and the reusable `data-*.yml` workflows from `actions/setup-node` + npm to `jdx/mise-action` + aube, and **enable caching that does not exist today**: mise-action's automatic tool cache (node + aube binaries) plus an `actions/cache` of aube's content-addressable store (`~/.local/share/aube/store`) keyed on `package-lock.json`. `data-build-plugin.yml` stays dependency-free (node only, no install, no store cache).
- Update `devcontainer.json` `postCreateCommand` to `mise install && aube install` (eager install at create time).
- Update docs/comments that reference `npm run`/`npm ci` (`README.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, `docs/SELF_HOSTING.md`, `CLAUDE.md`, `AGENT_INSTRUCTIONS.md`, the `mise.toml` comment) to the aube equivalents.

## Capabilities

### New Capabilities
- `package-manager`: The repo's package-manager toolchain — aube installed via mise; the install/run verb conventions (`aube install`, `aube ci`, `aubr`); the `package-lock.json`-in-place contract; the dependency lifecycle-script allowlist; the committed aube supply-chain cooldown; and the CI runner setup (mise-action + aube) with tool-cache and store-cache enabled.

### Modified Capabilities
- `dependency-automation`: Dependabot gains an aligned supply-chain **cooldown** requirement (7-day minimum release age on npm version updates), mirroring the committed aube `minimumReleaseAge`. The existing npm-ecosystem, grouping, and SHA-pinning requirements are unchanged; `package-lock.json` remains the lockfile so the npm ecosystem config still applies.

## Impact

- **Toolchain**: `mise.toml` (+aube), `.devcontainer/devcontainer.json`.
- **Package manifest**: `package.json` (`aube.allowBuilds`), new committed `.npmrc` (`minimum-release-age=10080`). `package-lock.json` retained unchanged in shape.
- **CI / workflows**: `.github/workflows/ci.yml`, `data-deploy.yml`, `data-build-indexes.yml`, `data-build-site.yml` (mise-action + aube + caching); `data-build-plugin.yml` (mise-action, node-only). `.github/dependabot.yml` (cooldown).
- **Docs**: `README.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, `docs/SELF_HOSTING.md`, `CLAUDE.md`, `AGENT_INSTRUCTIONS.md`.
- **Known residual** (not a blocker): Dependabot `cooldown` does not apply to *security* updates, while aube's `minimumReleaseAge` applies to every install — a same-day security release could fail `aube ci` until it ages in. Rare and self-healing; documented in design, no config debt.
- **No runtime/Worker impact**: this is dev/build tooling only; the deployed Worker and its behavior are unchanged.
