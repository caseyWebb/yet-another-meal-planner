---
update-when: the toolchain, Worker dev or deploy workflow, repo layout, or contribution conventions change
---

# Contributing

How to work **on** the grocery-agent itself — its persona/skills (generated from [`AGENT_INSTRUCTIONS.md`](AGENT_INSTRUCTIONS.md)) **and** the `grocery-mcp` Worker, both built in this repo. For how the system is *built* (the technical model), read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first — this guide assumes it.

## Repo map

There is **no data in this repo** — the data lives in a separate private data repo (see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md)). This repo is the agent's source — Worker code, the persona/skills source, and build tooling:

| Path | What it is |
| --- | --- |
| `src/`, `test/`, `wrangler.jsonc` | the repo root **is** the Cloudflare Worker (TypeScript) hosting the `grocery-mcp` MCP server + OAuth provider |
| `scripts/` | index + static-site + plugin build tooling (`build-indexes.mjs`, `build-site.mjs`, `build-plugin.mjs`, `site-assets/`), run by data repos via reusable CI |
| `docs/` | [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) (the technical model) · [`SCHEMAS.md`](docs/SCHEMAS.md) (file formats) · [`TOOLS.md`](docs/TOOLS.md) (the tool contract) · [`SELF_HOSTING.md`](docs/SELF_HOSTING.md) (operator setup) |
| `AGENT_INSTRUCTIONS.md` | the agent persona; build source for the `plugin/` bundle |
| `openspec/` | the change/spec workflow — `changes/archive/` is the build history, `specs/` is the living contract |
| `.github/workflows/` | `ci.yml` (the only push-triggered workflow) + reusable `data-*` workflows operators call |

## Toolchain

Build tooling is managed with **mise** (`mise.toml`) — Node and **aube** (the package manager; mise installs `aube`/`aubr`/`aubx`). Don't install globally. `aubr` is `aube run` (use it in place of `npm run`); `aube ci` is the lockfile-strict install used in CI. `package-lock.json` stays the lockfile — aube reads/writes it in place.

```bash
mise install                # Node + aube (pinned in mise.toml)
aube install                # deps (reads package-lock.json in place)
```

**Supply-chain cooldown.** `.npmrc` sets `minimum-release-age=10080` (7 days): aube won't install a dependency version published less than 7 days ago, falling back to the newest one old enough. It's kept numerically aligned with the Dependabot `cooldown` (`default-days: 7`) so Dependabot only proposes versions aube will install. **Residual:** Dependabot fast-tracks *security* updates (cooldown doesn't apply to them), but aube's window applies to every install — so a same-day security bump can make `aube ci` fail in CI until the version ages in. It's rare and self-healing: re-run CI once the release crosses 7 days (don't disable the window in CI — that re-opens the day-zero risk it guards against).

The data-repo template lives in its own independent repo, [`groceries-agent-data-template`](https://github.com/caseyWebb/groceries-agent-data-template) — it is no longer vendored here. Build and test never touch it.

## Working on the Worker (`src/`)

The Worker is the root package. One `package.json` carries both the Worker deps and the `scripts/` build-tooling deps.

```bash
aubr dev             # wrangler dev — local Worker; point MCP Inspector at the local URL
aubr test            # vitest run — Worker unit tests (test/*.test.ts)
aubr test:tooling    # node --test — build-indexes/build-site/build-plugin tests (tests/*.test.mjs)
aubr typecheck       # tsc --noEmit
aubr deploy          # wrangler deploy — normally NOT run by hand (see Deployment)
```

- **Structured errors, not throws.** Tools return `{ error: "...", message }` shapes the agent can reason over. Follow the existing convention in `src/errors.ts`.
- **`docs/TOOLS.md` is the contract.** When a tool's params/returns change, update `docs/TOOLS.md` in the same pass — no drift. Likewise `docs/SCHEMAS.md` when a data file's shape changes.
- **Local dev/secrets** live in `.dev.vars` (gitignored; see `.dev.vars.example`): `GITHUB_APP_PRIVATE_KEY` + Kroger creds. See [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) for the one-time operator setup and the Kroger `/oauth/init?tenant=<id>` flow.
- **D1 (domain data) goes through `src/db.ts`, never `env.DB`.** `db(env)` exposes `first` / `all` / `run` / `batch` (+ `prepare` for batch); it maps every D1 failure to a structured `storage_error` `ToolError`, so tools stay throw-free. `wrangler dev` binds a **local** SQLite D1 — seed it with `npx wrangler d1 migrations apply DB --local` (applies `migrations/d1/*.sql`; `wrangler d1 execute DB --local --command "…"` inspects it). The deploy applies the same migrations with `--remote`.

### Deployment

**Deployment is operator-run from the private data repo, not from this (public) repo.** This repo holds the Worker source + a *reusable* `data-deploy.yml`; each operator's data repo has a thin `deploy.yml` caller (`uses: …@main`) that **merges** their `wrangler.jsonc` with the code repo's and runs `typecheck` + `test` + `wrangler deploy`. Push/PR here runs `ci.yml` (typecheck + both test suites).

**wrangler config has a code-vs-operator ownership split.** `data-deploy.yml` merges the two configs (`scripts/merge-wrangler-config.mjs`): **code-level** keys (`main`, `compatibility_date`, `compatibility_flags`, `triggers`, `observability`) come from *this repo's* `wrangler.jsonc`, so a new code-level setting (e.g. a cron trigger) propagates to every operator on their next deploy — put such changes here. The **binding set** likewise comes from code so a new binding propagates: `kv_namespaces`/`d1_databases` carry their bindings from code while taking each id from the operator (code ids stripped), and `ai` (no id, no secret — Workers AI is account-scoped) propagates verbatim. **A new binding type must be added to the merge explicitly** — the merge is an allowlist, not a passthrough, so an unhandled binding is silently dropped from the deployed config (this is exactly how the `ai` binding first shipped undeployed). **Operator-owned** keys (`vars`, `kv_namespaces` ids, `name`, `routes`) come from the operator's config; the code repo's `vars`/KV-ids are the maintainer's and are *stripped* by the merge so they never reach another operator. (Before the merge, the deploy `cp`-replaced the config, so code-level changes silently never deployed — the cause of an early flyer-cron miss.)

**Auto-deploy on merge to main.** When Worker-relevant paths change (`src/**`, `wrangler.jsonc`, `package.json`, `package-lock.json`), `ci.yml`'s `trigger-deploy` job fires `gh workflow run deploy.yml --repo caseyWebb/groceries-agent-data` automatically — but only after the `test` and `no-open-changes` jobs pass. This requires a fine-grained PAT with `actions: write` on the data repo stored as `DATA_REPO_ACTIONS_TOKEN` in this repo's secrets. Doc/test/openspec-only pushes skip the trigger. Self-hosters manage their own deploy trigger.

To kick a deploy manually (e.g. after a doc-only push that still needs a redeploy, or to re-run a failed deploy):

```bash
gh workflow run deploy.yml --repo caseyWebb/groceries-agent-data
gh run watch  --repo caseyWebb/groceries-agent-data                # optional: follow to green
```

(`aubr deploy` is a local escape hatch, but the data-repo workflow is the source of truth — it gates on typecheck + tests first.)

## Working on data tooling (`scripts/`)

The scripts build indexes/site for a **data repo**, not this one (no data lives here). Point them at a data checkout with `--root`:

```bash
node scripts/build-indexes.mjs --root /path/to/data-repo   # validate recipes + project the recipe index into D1
node scripts/build-site.mjs    --root /path/to/data-repo --out site
node scripts/build-indexes.mjs --check                     # validate only, no write
aubr test:tooling                                          # node --test (tests/, fixture-based)
```

**Validation.** `build-indexes.mjs` validates **recipes only** (frontmatter well-formed, controlled vocab, references resolve) and projects the recipe index into D1 — recipe `.md` is the only file it validates. Everything else is validated at **Worker write time** in `src/validate.ts`: `validateFile` for recipe markdown, and `validateStoreInput` / `validateDiscoveryCandidate` for the D1 corpus writes (store registry, discovery candidates).

**Reusable Actions.** This public repo hosts `on: workflow_call` workflows that operators' private data repos call (`uses: caseyWebb/groceries-agent/...@main`): `data-deploy.yml`, `data-onboard.yml` / `data-revoke.yml` (member provisioning), `data-build-indexes.yml` / `data-build-site.yml`, and `data-build-plugin.yml` (mint a self-hoster's plugin bundle with their own connector URL baked in). Onboard/revoke run in the **private** data repo so the invite codes they print never hit a public log. The [`groceries-agent-data-template`](https://github.com/caseyWebb/groceries-agent-data-template) repo's `.github/workflows/` is the live reference for the thin data-repo callers.

**D1 Migrations.** A D1 schema change is a `migrations/d1/NNNN_name.sql` file: declarative table shape, applied by the Cloudflare-native `wrangler d1 migrations apply DB` (`--local` to seed your dev SQLite, `--remote` on deploy — the deploy step runs this) and tracked in D1's own `d1_migrations` table (created automatically). Just write the SQL.

## Building the plugin (`AGENT_INSTRUCTIONS.md` → `plugin/`)

After editing `AGENT_INSTRUCTIONS.md` (or a `src/` tool description the skills quote), regenerate the committed bundle:

```bash
aubr build:plugin   # → plugin/grocery-agent/ (connector URL from $GROCERY_MCP_URL)
```

The build bakes the **connector URL** into `plugin/grocery-agent/.mcp.json` and **refuses to write the placeholder URL into the committed bundle** (that would break every install) — so the real URL has to be on hand. Either:

- set it once in the gitignored `mise.local.toml` (`GROCERY_MCP_URL = "https://<your-worker-host>/mcp"`) and run under `mise` so the env var loads, **or**
- pass it explicitly: `node scripts/build-plugin.mjs --out plugin/grocery-agent --mcp-url https://<your-worker-host>/mcp`.

If `aubr build:plugin` aborts with *"REFUSING to write the placeholder connector URL"*, that guard fired because neither was set. For a throwaway build where the URL doesn't matter (inspecting output, never committed), `node scripts/build-plugin.mjs` writes to `dist/grocery-agent-plugin/` with the placeholder; `--check` parses + validates without writing. The bundle is **generated** — never hand-edit `plugin/`.

## Tool & skill surfaces — what goes where

The plugin ships **both** the generated skills (from `AGENT_INSTRUCTIONS.md`) and the MCP tool descriptions (`src/`), and both reach the agent at runtime. Keep each fact in exactly one home:

- **Ownership boundary.** A *tool description* owns what the tool does, its params/enums/returns, its guarantees — **including negative ones** ("never auto-applies", "rejects `last_cooked`", "returns facts, not freshness verdicts") — and the **data-model field semantics it reads/writes** (`requires_equipment`, `perishable_ingredients`, `standalone`, `pairs_with`, status enums, which read throws `not_found` when empty). A *skill* owns *when* in a flow to call it, sequencing, how to act on the result, and what to confirm with the user. The test: *could a different agent, with no skills loaded, use this tool correctly and safely from its description alone?* A guarantee that reads like policy still stays in the tool; its matching choreography stays in the skill — complementary halves, not duplicates.
- **Channel-trigger principle.** A capability gets an entry point on a channel **iff a real trigger exists for that channel.** Tools: a granular tool iff a single-edit trigger exists; a `commit_changes` field iff it's part of a multi-write flow (e.g. `grocery_list_ops`). Skills: `user-invocable` iff a real user trigger exists; otherwise it's a library skill loaded only by reference (`user-invocable: false`).
- **Don't-gut-the-skill guardrail.** When de-duplicating, you MAY strip a pure contract/guarantee sentence from a skill, but NEVER its prerequisite-loading line or an orchestration step — those are the two jobs a tool can't do.

## Opening a pull request

Every PR is prefilled from [`.github/pull_request_template.md`](.github/pull_request_template.md): a short **What & why** plus a **considerations checklist** drawn from the rules above (docs in lockstep, the tool/skill boundary, D1 via `src/db.ts`, the `merge-wrangler-config.mjs` allowlist, migrations, `plugin/` regen, OpenSpec sync, no-secrets). Each item is a *consideration* — checking it means "I weighed this," and the not-applicable case is folded into the wording, so every box is honestly checkable on every PR. **Fill the What & why and check every box.** This applies to PRs the repo's own agent opens too — leaving the template unfilled blocks the PR.

The `pr-checklist` workflow ([`.github/workflows/pr-checklist.yml`](.github/workflows/pr-checklist.yml)) re-runs on each PR-body edit (separate from `ci.yml`, so checking a box doesn't re-run the test suites) and fails if the `<!-- pr-checklist:v1 -->` sentinel is missing or any box is unchecked; Dependabot and other bot PRs are exempt. The workflow only *produces* the check — **it blocks merge only once `pr-checklist` is added to `main`'s branch protection as a required status check** (a one-time repo setting, not a file in the tree).

## OpenSpec change workflow

This repo was built as a sequence of OpenSpec changes (`openspec/changes/archive/` is the history); further work continues the same workflow. Each change carries `proposal.md`, `design.md`, `specs/` deltas, and `tasks.md`.

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
