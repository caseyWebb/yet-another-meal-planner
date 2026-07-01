# package-manager Specification

## Purpose
TBD - created by archiving change adopt-aube-package-manager. Update Purpose after archive.
## Requirements
### Requirement: aube is the repo's package manager, installed via mise
The repository SHALL use **aube** as its Node package manager, installed through `mise` as an entry in `mise.toml` `[tools]` alongside the pinned `node`. Because the repo is an aube workspace monorepo whose packages cross-depend via the `workspace:*` protocol (which npm cannot resolve), **`aube-lock.yaml`** (aube's native, pnpm-flavored lockfile) SHALL be the committed lockfile, read and written in place by aube, and **`pnpm-workspace.yaml`** SHALL declare the `packages/*` workspaces; the repo SHALL NOT commit an npm `package-lock.json`.

#### Scenario: Toolchain provides aube
- **WHEN** a contributor runs `mise install` in a fresh clone
- **THEN** `mise.toml` SHALL install both the pinned `node` and `aube`, making the `aube`, `aubr`, and `aubx` binaries available on the path

#### Scenario: aube's native lockfile is the committed lockfile
- **WHEN** aube installs or updates dependencies
- **THEN** it SHALL read and write `aube-lock.yaml` (with `pnpm-workspace.yaml` declaring the workspaces)
- **THEN** no npm `package-lock.json` SHALL be committed

### Requirement: Project-local binaries are on PATH via mise
`mise.toml` SHALL prepend the project's `node_modules/.bin` to `PATH` (via `[env]._.path`) so locally-installed binaries (e.g. `openspec`) run as bare commands in the project and resolve to the `package.json`-pinned version rather than any global install.

#### Scenario: A pinned local binary wins over a global one
- **WHEN** a contributor runs a binary provided by a dev dependency (e.g. `openspec`) from within the project under mise
- **THEN** it SHALL resolve to `node_modules/.bin/<bin>` (the pinned version), not a globally-installed copy

### Requirement: Install and run verb conventions
The repository SHALL standardize on aube verbs in place of npm: `aubr <script>` (`aube run`) for `package.json` scripts, `aube install` for local and devcontainer installs, and `aube ci` for CI installs. `package.json` scripts SHALL remain the single source of truth and SHALL NOT be reimplemented as mise tasks.

#### Scenario: Scripts run via aubr
- **WHEN** documentation or tooling invokes a `package.json` script
- **THEN** it SHALL use `aubr <script>` rather than `npm run <script>`

#### Scenario: CI uses the lockfile-strict install
- **WHEN** a CI workflow installs dependencies
- **THEN** it SHALL run `aube ci`, which removes `node_modules`, asserts the lockfile matches `package.json`, and performs a clean install
- **THEN** a lockfile/`package.json` mismatch SHALL fail the job

#### Scenario: Local and devcontainer install
- **WHEN** a contributor sets up locally or the devcontainer runs its `postCreateCommand`
- **THEN** it SHALL run `aube install` (the devcontainer running `mise install && aube install`)

### Requirement: Dependency lifecycle build decisions are recorded in package.json
The repository SHALL record explicit build-review decisions for every build-gated dependency under `aube.allowBuilds` in `package.json` — `true` for dependencies whose lifecycle (build) scripts the toolchain needs, `false` for the rest — so installs complete non-interactively and without unreviewed-build warnings. (aube's default is to *skip* unreviewed builds with a warning, not to block, so CI never hangs; recording every decision keeps installs clean and the security posture auditable.) Currently `esbuild` and `workerd` are allowed (the wrangler dev/deploy bundler + runtime); `@fission-ai/openspec`, `@mongodb-js/zstd`, `core-js-pure`, `node-liblzma`, and `sharp` are denied (unused by the repo's scripts — verified: typecheck/test/test:tooling and `wrangler deploy --dry-run` all pass with them unbuilt).

#### Scenario: Installs are clean and non-interactive
- **WHEN** `aube ci` or `aube install` runs (locally or in CI)
- **THEN** every build-gated dependency SHALL be covered by an `aube.allowBuilds` decision
- **THEN** the install SHALL complete without prompting and without unreviewed-build warnings

#### Scenario: Root lifecycle scripts are unaffected
- **WHEN** the package defines a root lifecycle script (e.g. `prepare`)
- **THEN** it SHALL run under `aube install` without an allowlist entry, preserving any prepare-based setup convention

### Requirement: Committed supply-chain cooldown
The repository SHALL commit aube's release cooling window rather than rely on the implicit default, setting `minimum-release-age=10080` (7 days, in minutes) in a committed `.npmrc`. This value SHALL be kept numerically aligned with the Dependabot cooldown.

#### Scenario: Newly published versions are held
- **WHEN** aube resolves a dependency whose newest version was published less than 7 days ago
- **THEN** aube SHALL fall back to the newest version at least 7 days old rather than installing the day-zero release

### Requirement: CI runs on mise with tool and dependency caching
CI workflows that install dependencies (`ci.yml`, `data-deploy.yml`) SHALL set up the toolchain via `jdx/mise-action` and install via `aube ci`, with caching enabled at two tiers: the mise tool cache (node + aube binaries, provided by `jdx/mise-action`) and an `actions/cache` of aube's content-addressable store (`~/.local/share/aube/store`) keyed on the hash of `aube-lock.yaml`. The dependency-free `data-build-plugin.yml` workflow SHALL set up node via mise only and SHALL NOT install dependencies or cache the aube store. New action references SHALL be SHA-pinned with a version comment.

#### Scenario: Dependency cache is restored on a warm run
- **WHEN** an installing CI job runs with an unchanged `aube-lock.yaml` from a prior run
- **THEN** the `actions/cache` step SHALL restore `~/.local/share/aube/store`
- **THEN** `aube ci` SHALL rebuild `node_modules` by re-linking the cached tarballs rather than re-downloading them

#### Scenario: Cache key tracks the lockfile
- **WHEN** `aube-lock.yaml` changes
- **THEN** the store cache key SHALL change (it is keyed on `hashFiles('aube-lock.yaml')`), falling back to the `aube-store-<os>-` restore-key for partial reuse

#### Scenario: Plugin build stays dependency-free
- **WHEN** `data-build-plugin.yml` runs
- **THEN** it SHALL provision node via mise and run the plugin builder with no dependency install and no aube store cache

#### Scenario: New actions are SHA-pinned
- **WHEN** a workflow references `jdx/mise-action` or `actions/cache`
- **THEN** the `uses:` ref SHALL be a 40-character commit SHA with a trailing `# vN.M.P` comment

