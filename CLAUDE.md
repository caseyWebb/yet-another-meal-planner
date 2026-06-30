---
update-when: the build/deploy workflow, common commands, doc-ownership boundaries, or coding-agent conventions for this repo change
---

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This repo is the **grocery-agent itself**: the `grocery-mcp` Cloudflare Worker (`src/`), the agent persona/skills source (`AGENT_INSTRUCTIONS.md`), and the build tooling (`scripts/`) that produces the plugin bundle, the admin panel, and the Obsidian authoring vault. The agent *runs* in Claude.ai; it is *built* here. The plugin bundle is **not committed here** — the operator's deploy builds it with their connector URL and publishes it to their public data-repo marketplace. **There is no data in this repo** — each operator's authored corpus (recipes + guidance markdown) lives in a Cloudflare **R2 bucket**, and their profile/state in Cloudflare D1/KV (tenant identity is a D1 column, not a repo subtree). The recipe index and the cookbook are derived by the Worker (a scheduled reconcile + a `/cookbook` route), not a CI build.

Read the deep docs rather than reverse-engineering from code:
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — toolchain, Worker dev, deployment, data tooling, the tool/skill ownership boundary, OpenSpec workflow, conventions. **Start here.**
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — the determinism boundary, multi-tenant identity, data model, the Kroger matching pipeline, the cron jobs.
- **[docs/TOOLS.md](docs/TOOLS.md)** — the MCP tool contract. **[docs/SCHEMAS.md](docs/SCHEMAS.md)** — file/D1 formats. **[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)** — operator setup. **[AGENT_INSTRUCTIONS.md](AGENT_INSTRUCTIONS.md)** — the persona (not auto-loaded into dev sessions — intentional).

## Toolchain & commands

Build tooling is managed with **mise** (`mise.toml` pins Node 22 + **aube**, the package manager). Don't install globally. `aubr` = `aube run` (use it instead of `npm run`); `aube ci` is the lockfile-strict CI install. `package-lock.json` stays the lockfile.

```bash
mise install                 # Node + aube (pinned in mise.toml)
aube install                 # deps (reads package-lock.json in place)

aubr dev                     # wrangler dev — local Worker; point MCP Inspector at the local URL
aubr typecheck               # tsc --noEmit
aubr test                    # vitest run — Worker unit tests (test/*.test.ts)
aubr test:tooling            # node --test — build-tooling tests (tests/*.test.mjs, fixture-based)
aubr build:plugin            # local throwaway/inspect build → dist/ (the deploy publishes the real bundle to the data-repo marketplace)
aubr build:admin             # esbuild the islands + Tailwind-compile the Basecoat stylesheet → admin/dist/ (see src/admin/CLAUDE.md)
aubr build:vault             # vault-template/ + src/vocab.js → vault/ — the Obsidian authoring vault
```

The **operator admin panel** (`/admin`) is a **Hono** app under [`src/admin/`](src/admin/) — server-rendered pages (`hono/jsx`) that call the Worker's `src/` functions directly, plus interactive **islands** (`hono/jsx/dom`) that hit the typed `/admin/api/*` routes via `hc`. Its modeling standards ("make impossible states impossible" via discriminated unions, the `Loadable` remote-data union, `assertNever` exhaustiveness) live in [`src/admin/CLAUDE.md`](src/admin/CLAUDE.md). The islands (esbuild) + the stylesheet (Tailwind, compiling the **Basecoat** design system + the panel's utilities) are built to `admin/dist/` — a **gitignored build artifact** (the esbuild bundles embed environment-specific paths, so they're not committed), produced fresh by CI, the deploy, and local `wrangler dev`.

The **authoring vault** (`vault/`) is the corpus-authoring surface: a preconfigured Obsidian vault whose Metadata Menu dropdowns are generated from `src/vocab.js`. It scaffolds the **authored** fields only — the gates + identity (`title`/`source`/`time_total`/`dietary`/`requires_equipment`/`pairs_with`) plus the **optional Tier B override** dropdowns (`protein`/`cuisine`/`season`/`tags`, plus the open `course` set), constrained to vocab. The descriptive facets are otherwise **derived on the cron** (`recipe-facet-derivation`): `ingredients_key`/`perishable_ingredients`/`side_search_terms`/`meal_preppable` (and `description`) are not vault controls — leave a Tier B dropdown blank to let the classifier derive it, or fill it to pin an override. Generated from `vault-template/` by `scripts/build-vault.mjs` (`--check` drift gate in CI) — never hand-edit `vault/`. The pinned community-plugin binaries are vendored on demand (`build:vault --fetch-plugins`, sha256-verified from `vault-template/plugin-pins.json`), not committed.

- **Single Worker test:** `aubr test test/kroger.test.ts`, or filter by name with `aubr test -- -t "match ingredient"`.
- **`*.live.test.ts`** (`kroger.live`, `discovery.live`) hit real external APIs and need creds; the default `vitest run` covers the rest.
- **Local dev secrets** live in `.dev.vars` (gitignored; see `.dev.vars.example`): Kroger creds (the corpus is local R2, simulated by `wrangler dev` — no GitHub App).
- **Local D1:** `wrangler dev` binds a *local* SQLite. Seed it with `npx wrangler d1 migrations apply DB --local` (applies `migrations/d1/*.sql`); inspect with `npx wrangler d1 execute DB --local --command "…"`.
- **The recipe index is projected by the Worker reconcile, not CI:** `src/recipe-projection.ts` reads the R2 corpus, validates it, and rebuilds the D1 `recipes` table each cron tick. The one-time git→R2 corpus copy and ongoing bulk edits use `rclone` (R2 is S3-compatible) — see [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).
- **Web sessions:** the bare commands above (`aubr`, `openspec`, `wrangler`, …) work because `mise.toml` activates the toolchain — but only in an interactive shell via `mise activate` in `~/.bashrc`. Claude Code's Bash tool runs a non-interactive shell that never sources it, so the `.claude/hooks/session-start.sh` hook restores `node_modules` *and* writes `mise exec` wrapper shims into `~/.local/bin` to keep these on PATH. Don't remove that block, and prefer `mise exec -- <cmd>` if you ever invoke a repo CLI that lacks a shim.

## Architecture in one breath

**The LLM does the fuzzy work; everything deterministic is plain code inside the Worker's tools.** Three components: Claude.ai (reasoning + conversation) → a stateless Cloudflare Worker (OAuth 2.1 provider + `grocery-mcp` server, the locus of determinism and the multi-tenant gate) → a Cloudflare **R2 bucket** (authored recipe + guidance markdown, read/written via `src/corpus-store.ts`) + D1 (all operational/relational data + derived projections) + KV (ephemeral infra only). No GitHub App or data repo on the data path; no Durable Objects, no Workflows — the `agents` SDK is present only for its stateless MCP transport.

Two patterns recur and explain most design decisions:
- **Coarse, opinionated tools.** Tools wrap whole multi-step pipelines (e.g. `match_ingredient_to_kroger_sku` runs the full 7-step ingredient→SKU match internally). Raw building blocks (`kroger_raw_search`, `github_raw_write`) are deliberately **not** exposed so the LLM can't bypass the cache/validation/matching. Tools return **structured errors, not throws** (`src/errors.ts`).
- **Capture → retrieve → narrow.** LLM-derived knowledge is captured once into persistent data (e.g. recipe facets classified at import), retrieved deterministically (D1 index + `list_recipes` filtering, or cosine over `recipe_derived`), and the LLM narrows with live context (menu-gen). Two crons run this on a schedule with no user attached: the **flyer warm** (`src/flyer-warm.ts`) and the **recipe-derived reconcile** (`src/recipe-embeddings.ts`), both in the one `scheduled()` handler.

**Multi-tenancy is a D1 column.** One self-hosted Worker serves a friend group; identity is an operator-issued invite code → access token → `tenantId`, resolved *before* any tool runs. Every per-tenant D1 table is isolated by its `tenant` column. The one deliberately cross-tenant cache is the Kroger flyer (keyed by `locationId` — store-wide sale prices are public-derived, not tenant-private).

## Rules a coding agent must not miss

- **`AGENT_INSTRUCTIONS.md` is the persona source; the plugin bundle is GENERATED from it** by `scripts/build-plugin.mjs` — never hand-edit a generated bundle. It is **not committed in this repo**: the operator's deploy builds it with their connector URL and publishes it to their public data-repo marketplace (see `docs/SELF_HOSTING.md`). `aubr build:plugin` is a local throwaway/inspection build (→ `dist/`); `--check` validates the source without writing.
- **Keep the contract docs in lockstep, same pass:** a tool param/return change updates `docs/TOOLS.md`; a data-file/D1 shape change updates `docs/SCHEMAS.md`; an architectural shift updates `docs/ARCHITECTURE.md`. No drift.
- **Docs describe current state, not history.** `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, and everything in `docs/` are not historical ledgers — write what is true today, not what changed. No "no longer", no "is now", no "used to"; just state how it works. OpenSpec change archives (`openspec/changes/archive/`) and git history are sufficient to track how it got here. Narrating the past in living docs only confuses new contributors and users.
- **Tools never touch `env.DB` directly — go through `src/db.ts`** (prepared-statement helpers that map every D1 failure to a structured `storage_error`, keeping tools throw-free). A schema change is a new `migrations/d1/NNNN_name.sql` file applied by `wrangler d1 migrations apply`; the deploy applies it `--remote`.
- **Tool vs skill ownership boundary** (see CONTRIBUTING.md): a *tool description* owns what the tool does, its params/returns, and its guarantees (incl. negative ones) plus the data-model field semantics it reads/writes; a *skill* owns *when* in a flow to call it and how to act on the result. Test: could a skill-less agent use the tool safely from its description alone?
- **Deploy auto-kicks from `main` and runs in the data repo, not here.** This public repo holds no Actions secrets. When Worker- or plugin-relevant paths (`src/**`, `wrangler.jsonc`, `package.json`/lockfile, `AGENT_INSTRUCTIONS.md`, `scripts/build-plugin.mjs`) land on `main`, `ci.yml`'s `trigger-deploy` job dispatches the data repo's `deploy.yml` — gated on green CI (`test` + `no-open-changes`). The deploy redeploys the Worker **then publishes the plugin** to the data-repo marketplace, so a persona-only change reaches members' skills (Worker-first, structural). Doc/test/openspec-only pushes skip it; a normal merge needs **no manual deploy step**. Manual fallback: `gh workflow run deploy.yml --repo caseyWebb/groceries-agent-data`. The deploy **merges** wrangler configs via an **allowlist** (`scripts/merge-wrangler-config.mjs`) — a new binding type must be added to the merge explicitly or it is silently dropped from the deployed config.
- **Don't commit secrets — the repo is public.** Only code lives here; the authored corpus is in R2 and all personal data is in D1.
- **Opening a PR uses the template.** Every PR is prefilled from `.github/pull_request_template.md` — fill the **What & why** and check **every** consideration (each box = "I considered this"; the not-applicable case is in the wording, so all are checkable). The `pr-checklist` workflow fails on a missing `<!-- pr-checklist:v1 -->` sentinel or any unchecked `- [ ]`, so an unfilled template blocks the PR — including ones you open. See [CONTRIBUTING.md](CONTRIBUTING.md#opening-a-pull-request).

## OpenSpec workflow

This repo is developed as a sequence of OpenSpec changes. `openspec/changes/archive/` is the history; `openspec/specs/` is the living contract. Skills: `/opsx:explore`, `/opsx:propose`, `/opsx:apply`, `/opsx:archive`. Use `openspec list` and `openspec validate "<name>"`. Specs use `### Requirement:` + `#### Scenario:` (SHALL / WHEN-THEN; scenarios need exactly four `#`).

## Conventions

Match the surrounding code's idiom, naming, and comment density. Config/structured files use **TOML**; prose (recipes, instruction docs) stays **markdown**; recipe frontmatter is **YAML**. Pure-JS parsers only (`js-yaml`, JSON-LD via `HTMLRewriter`, RSS via `fast-xml-parser`) — no Node-internals deps; the code runs on `workerd`.
