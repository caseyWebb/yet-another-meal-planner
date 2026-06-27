---
update-when: the toolchain, Worker dev or deploy workflow, repo layout, or contribution conventions change
---

# Contributing

How to work **on** the grocery-agent itself — its persona/skills (generated from [`AGENT_INSTRUCTIONS.md`](AGENT_INSTRUCTIONS.md)) **and** the `grocery-mcp` Worker, both built in this repo. For how the system is *built* (the technical model), read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first — this guide assumes it.

## Repo map

There is **no data in this repo** — the data lives in a separate (public) data repo (see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md)). This repo is the agent's source — Worker code, the persona/skills source, and build tooling:

| Path | What it is |
| --- | --- |
| `src/`, `test/`, `wrangler.jsonc` | the repo root **is** the Cloudflare Worker (TypeScript) hosting the `grocery-mcp` MCP server + OAuth provider |
| `scripts/` | build tooling: `build-plugin.mjs` (the plugin bundle), `build-admin.mjs` (the admin SPA), `build-vault.mjs` (the Obsidian authoring vault, from `vault-template/` + `src/vocab.js`), `merge-wrangler-config.mjs` (the deploy config merge). The recipe index + cookbook are derived by the Worker, not built here; the corpus is copied/edited via `rclone` (see [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md)). |
| `vault-template/`, `vault/` | the authoring vault's authored **source** and its **generated** output (the corpus-authoring Obsidian vault; `vault/` is committed like `plugin/`, never hand-edited) |
| `docs/` | [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) (the technical model) · [`SCHEMAS.md`](docs/SCHEMAS.md) (file formats) · [`TOOLS.md`](docs/TOOLS.md) (the tool contract) · [`SELF_HOSTING.md`](docs/SELF_HOSTING.md) (operator setup) |
| `AGENT_INSTRUCTIONS.md` | the agent persona; the build source for the plugin bundle (generated, **not committed here** — the deploy publishes it to the operator's data-repo marketplace) |
| `openspec/` | the change/spec workflow — `changes/archive/` is the build history, `specs/` is the living contract |
| `.github/workflows/` | `ci.yml` (the only push-triggered workflow) + the reusable `data-deploy.yml` operators call |

## Toolchain

Build tooling is managed with **mise** (`mise.toml`) — Node and **aube** (the package manager; mise installs `aube`/`aubr`/`aubx`). Don't install globally. `aubr` is `aube run` (use it in place of `npm run`); `aube ci` is the lockfile-strict install used in CI. `package-lock.json` stays the lockfile — aube reads/writes it in place.

```bash
mise install                # Node + aube (pinned in mise.toml)
aube install                # deps (reads package-lock.json in place)
```

**Supply-chain cooldown.** `.npmrc` sets `minimum-release-age=10080` (7 days): aube won't install a dependency version published less than 7 days ago, falling back to the newest one old enough. It's kept numerically aligned with the Dependabot `cooldown` (`default-days: 7`) so Dependabot only proposes versions aube will install. **Residual:** Dependabot fast-tracks *security* updates (cooldown doesn't apply to them), but aube's window applies to every install — so a same-day security bump can make `aube ci` fail in CI until the version ages in. It's rare and self-healing: re-run CI once the release crosses 7 days (don't disable the window in CI — that re-opens the day-zero risk it guards against).

The data-repo template lives in its own independent repo, [`groceries-agent-data-template`](https://github.com/caseyWebb/groceries-agent-data-template) — it is not vendored here. Build and test never touch it.

## Working on the Worker (`src/`)

The Worker is the root package. One `package.json` carries both the Worker deps and the `scripts/` build-tooling deps.

```bash
aubr dev             # wrangler dev — local Worker; point MCP Inspector at the local URL
aubr test            # vitest run — Worker unit tests (test/*.test.ts)
aubr test:tooling    # node --test — build-plugin / merge-config / readme-badge tests (tests/*.test.mjs)
aubr typecheck       # tsc --noEmit
aubr deploy          # wrangler deploy — normally NOT run by hand (see Deployment)
```

- **Structured errors, not throws.** Tools return `{ error: "...", message }` shapes the agent can reason over. Follow the existing convention in `src/errors.ts`.
- **`docs/TOOLS.md` is the contract.** When a tool's params/returns change, update `docs/TOOLS.md` in the same pass — no drift. Likewise `docs/SCHEMAS.md` when a data file's shape changes.
- **Local dev/secrets** live in `.dev.vars` (gitignored; see `.dev.vars.example`): Kroger creds. The authored corpus is the local R2 `CORPUS` bucket (`wrangler dev` simulates it — no GitHub App). See [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) for the one-time operator setup and the Kroger `/oauth/init?tenant=<id>` flow.
- **D1 (domain data) goes through `src/db.ts`, never `env.DB`.** `db(env)` exposes `first` / `all` / `run` / `batch` (+ `prepare` for batch); it maps every D1 failure to a structured `storage_error` `ToolError`, so tools stay throw-free. `wrangler dev` binds a **local** SQLite D1 — seed it with `npx wrangler d1 migrations apply DB --local` (applies `migrations/d1/*.sql`; `wrangler d1 execute DB --local --command "…"` inspects it). The deploy applies the same migrations with `--remote`.

### Deployment

**Deployment is operator-run from the data repo, not from this (public) repo.** This repo holds the Worker source + a *reusable* `data-deploy.yml`; each operator's data repo has a thin `deploy.yml` caller (`uses: …@main`) that **merges** their `wrangler.jsonc` with the code repo's, runs `typecheck` + `test` + `wrangler deploy`, then builds the plugin (their connector URL baked in) and **publishes it to their data-repo marketplace** — the build is the deploy's Worker-first tail. Push/PR here runs `ci.yml` (typecheck + both test suites). The data repo is **public** (it is the marketplace) and carries nothing secret.

**wrangler config has a code-vs-operator ownership split.** `data-deploy.yml` merges the two configs (`scripts/merge-wrangler-config.mjs`): **code-level** keys (`main`, `compatibility_date`, `compatibility_flags`, `triggers`, `observability`) come from *this repo's* `wrangler.jsonc`, so a new code-level setting (e.g. a cron trigger) propagates to every operator on their next deploy — put such changes here. The **binding set** likewise comes from code so a new binding propagates: `kv_namespaces`/`d1_databases` carry their bindings from code while taking each id from the operator (code ids stripped), and `ai` (no id, no secret — Workers AI is account-scoped) propagates verbatim. **A new binding type must be added to the merge explicitly** — the merge is an allowlist, not a passthrough, so an unhandled binding is silently dropped from the deployed config. **Operator-owned** keys (`vars`, `kv_namespaces` ids, `name`, `routes`) come from the operator's config; the code repo's `vars`/KV-ids are the maintainer's and are *stripped* by the merge so they never reach another operator.

**Auto-deploy on merge to main.** When Worker- or plugin-relevant paths change (`src/**`, `wrangler.jsonc`, `package.json`, `package-lock.json`, `AGENT_INSTRUCTIONS.md`, `scripts/build-plugin.mjs`), `ci.yml`'s `trigger-deploy` job fires `gh workflow run deploy.yml --repo caseyWebb/groceries-agent-data` automatically — but only after the `test` and `no-open-changes` jobs pass. The deploy redeploys the Worker then republishes the plugin, so a persona-only change reaches members' skills (Worker-first). This requires a fine-grained PAT with `actions: write` on the data repo stored as `DATA_REPO_ACTIONS_TOKEN` in this repo's secrets. Doc/test/openspec-only pushes skip the trigger. Self-hosters manage their own deploy trigger.

To kick a deploy manually (e.g. after a doc-only push that still needs a redeploy, or to re-run a failed deploy):

```bash
gh workflow run deploy.yml --repo caseyWebb/groceries-agent-data
gh run watch  --repo caseyWebb/groceries-agent-data                # optional: follow to green
```

(`aubr deploy` is a local escape hatch, but the data-repo workflow is the source of truth — it gates on typecheck + tests first.)

## The corpus + the index (no CI data build)

The authored corpus (`recipes/*.md` + `guidance/**/*.md`) lives in the operator's R2 `CORPUS` bucket, read/written through `src/corpus-store.ts`. There is **no CI index/site build**: the recipe index is projected by the Worker's scheduled reconcile, and the cookbook is served by the Worker. The corpus is copied/edited with `rclone` (R2 is S3-compatible) — the one-time seed and the bulk-edit round-trip are documented in [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md):

```bash
rclone sync r2:grocery-corpus ./data     # pull the corpus to a local folder
# …edit recipes/ + guidance/ markdown…
rclone sync ./data r2:grocery-corpus      # push it back
aubr test:tooling                         # node --test (tests/, fixture-based) — the repo's tooling tests
```

**Index projection (`src/recipe-projection.ts`).** The cron reconcile reads the whole R2 corpus, validates every recipe (the shared `src/recipe-contract.js` required-field/vocab contract + the `## Ingredients`/`## Instructions` body sections + duplicate-slug guard + cross-corpus `pairs_with` resolution), and rebuilds the D1 `recipes` table. An invalid recipe is **skipped** (not indexed) and recorded to the `reconcile_errors` table — surfaced via `/health`, the `read_reconcile_errors` tool, and an ntfy push. It runs in `scheduled()` before the recipe-derived (description/embedding) reconcile.

**Validation.** One validator: `src/validate.ts` (`validateFile`) gates agent writes at the Worker, and the shared `src/recipe-contract.js` is reused by the reconcile for the whole-corpus pass. `validateStoreInput` / `validateDiscoveryCandidate` cover the D1 corpus writes (store registry, discovery candidates).

**Reusable Actions.** This public repo hosts the `on: workflow_call` workflow operators' data repos call (`uses: caseyWebb/groceries-agent/...@main`): `data-deploy.yml`, which deploys the Worker and then **builds the plugin with the operator's connector URL and publishes it to their data-repo marketplace** (the build is the deploy's Worker-first tail). Member provisioning is **not a workflow** — it's the Cloudflare Access-gated `/admin` panel (`src/admin.ts`), so no invite code is printed into a CI log (which, with the corpus in R2 and member data in D1, is what lets the data repo be public). The [`groceries-agent-data-template`](https://github.com/caseyWebb/groceries-agent-data-template) repo's `.github/workflows/` is the live reference for the thin data-repo caller.

**D1 Migrations.** A D1 schema change is a `migrations/d1/NNNN_name.sql` file: declarative table shape, applied by the Cloudflare-native `wrangler d1 migrations apply DB` (`--local` to seed your dev SQLite, `--remote` on deploy — the deploy step runs this) and tracked in D1's own `d1_migrations` table (created automatically). Just write the SQL.

## Building the plugin (`AGENT_INSTRUCTIONS.md` → the bundle)

`AGENT_INSTRUCTIONS.md` is the single source; `scripts/build-plugin.mjs` generates the plugin bundle (library + workflow skills, `plugin.json`, `.mcp.json`) from it. **The bundle is not committed in this repo** — each operator's deploy builds it with *their* connector URL and publishes it to their public data-repo marketplace (see [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)). So after editing `AGENT_INSTRUCTIONS.md` (or a `src/` tool description the skills quote), you don't commit a bundle — you keep the source valid and the next deploy republishes.

To inspect the output locally or validate the source:

```bash
aubr build:plugin                        # throwaway build → dist/grocery-agent-plugin/ (placeholder URL; for inspection)
node scripts/build-plugin.mjs --check    # parse + validate only, no write (what CI runs)
```

The build bakes the **connector URL** into `.mcp.json` (claude.ai doesn't honor a plugin `userConfig` variable, so the URL is fixed at build time). The deploy passes the operator's `--mcp-url` and a `--version` (the data repo's commit count — monotonic per operator, which is what claude.ai's strictly-greater auto-update gate needs); a local build without `--mcp-url` uses a placeholder and warns. The bundle is **generated** — never hand-edit it; edit `AGENT_INSTRUCTIONS.md`.

## Building the authoring vault (`vault-template/` + `src/vocab.js` → `vault/`)

The Obsidian authoring vault is generated like the plugin. After editing `vault-template/` **or `src/vocab.js`** (the dropdown options come from the vocab), regenerate the committed vault:

```bash
aubr build:vault           # → vault/ (config + pinned plugin manifests)
aubr build:vault -- --check   # validate-only: fail on drift vs vault-template/ + src/vocab.js (the CI gate)
```

`vault/` is committed and **generated — never hand-edit it**; edit `vault-template/` (or the vocab) and rebuild. The drift gate is **offline**: the Metadata Menu `recipe` fileClass dropdowns are derived from `src/vocab.js`, so a vocab change that isn't rebuilt fails CI's `build-vault --check` — the same discipline as the plugin/admin builds, and what keeps the editing-time constraint in lockstep with the server validator. The three pinned community plugins (Metadata Menu / Templater / Remotely Save) are **not** committed as binaries: `node scripts/build-vault.mjs --fetch-plugins` downloads them from the versions pinned in `vault-template/plugin-pins.json`, verifies each sha256, and lays them into `vault/` to produce the openable distributable. Bumping a plugin means updating the pin (version + embedded manifest + asset sha256), then `aubr build:vault` + commit.

## Tool & skill surfaces — what goes where

The plugin ships **both** the generated skills (from `AGENT_INSTRUCTIONS.md`) and the MCP tool descriptions (`src/`), and both reach the agent at runtime. Keep each fact in exactly one home:

- **Ownership boundary.** A *tool description* owns what the tool does, its params/enums/returns, its guarantees — **including negative ones** ("never auto-applies", "rejects `last_cooked`", "returns facts, not freshness verdicts") — and the **data-model field semantics it reads/writes** (`requires_equipment`, `perishable_ingredients`, `standalone`, `pairs_with`, status enums, which read throws `not_found` when empty). A *skill* owns *when* in a flow to call it, sequencing, how to act on the result, and what to confirm with the user. The test: *could a different agent, with no skills loaded, use this tool correctly and safely from its description alone?* A guarantee that reads like policy still stays in the tool; its matching choreography stays in the skill — complementary halves, not duplicates.
- **Channel-trigger principle.** A capability gets an entry point on a channel **iff a real trigger exists for that channel.** Tools: a granular tool iff a single-edit trigger exists; a `commit_changes` field iff it's part of a multi-write flow (e.g. `grocery_list_ops`). Skills: `user-invocable` iff a real user trigger exists; otherwise it's a library skill loaded only by reference (`user-invocable: false`).
- **Don't-gut-the-skill guardrail.** When de-duplicating, you MAY strip a pure contract/guarantee sentence from a skill, but NEVER its prerequisite-loading line or an orchestration step — those are the two jobs a tool can't do.

## Opening a pull request

Every PR is prefilled from [`.github/pull_request_template.md`](.github/pull_request_template.md): a short **What & why** plus a **considerations checklist** drawn from the rules above (docs in lockstep, the tool/skill boundary, D1 via `src/db.ts`, the `merge-wrangler-config.mjs` allowlist, migrations, `plugin/` regen, OpenSpec sync, no-secrets). Each item is a *consideration* — checking it means "I weighed this," and the not-applicable case is folded into the wording, so every box is honestly checkable on every PR. **Fill the What & why and check every box.** This applies to PRs the repo's own agent opens too — leaving the template unfilled blocks the PR.

The `pr-checklist` workflow ([`.github/workflows/pr-checklist.yml`](.github/workflows/pr-checklist.yml)) re-runs on each PR-body edit (separate from `ci.yml`, so checking a box doesn't re-run the test suites) and fails if the `<!-- pr-checklist:v1 -->` sentinel is missing or any box is unchecked; Dependabot and other bot PRs are exempt. The workflow only *produces* the check — **it blocks merge only once `pr-checklist` is added to `main`'s branch protection as a required status check** (a one-time repo setting, not a file in the tree).

## OpenSpec change workflow

This repo is developed as a sequence of OpenSpec changes (`openspec/changes/archive/` is the history). Each change carries `proposal.md`, `design.md`, `specs/` deltas, and `tasks.md`.

```bash
openspec list                       # active changes
openspec status --change "<name>"   # artifact + task progress
openspec validate "<name>"          # validate artifacts
```

- Skills: `/opsx:explore` (think), `/opsx:propose` (create a change + artifacts), `/opsx:apply` (implement tasks), `/opsx:archive` (finalize).
- Layout: active changes in `openspec/changes/<name>/`; archived in `openspec/changes/archive/`; capability specs in `openspec/specs/<capability>/spec.md`.
- Specs use `### Requirement:` + `#### Scenario:` (SHALL / WHEN-THEN). Scenarios need exactly four `#`.

## Conventions

- Match the surrounding code's idiom, naming, and comment density.
- Config/structured files use **TOML**; prose files (recipes, taste, diet_principles, the instruction docs) stay **markdown**; recipe frontmatter is **YAML** (Obsidian renders it).
- **Don't commit secrets.** The repo is public — anything needed to run that's gitignored gets documented in `README.md` / `.dev.vars.example`.
- Keep the docs honest: a tool change updates `docs/TOOLS.md`; a schema change updates `docs/SCHEMAS.md`; an architectural shift updates `docs/ARCHITECTURE.md`. The contract is the docs *and* the code — don't let them drift.
