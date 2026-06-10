# CLAUDE.md — Developing in this repo

This file is for Claude Code (and humans) **working on** the grocery-agent backend. It is *not* the agent's persona.

> **The grocery-agent operational instructions — persona, conversational flows, behavior rules — live in [`AGENT_INSTRUCTIONS.md`](AGENT_INSTRUCTIONS.md).** That file is the canonical source pasted into the Claude.ai "Grocery Agent" project. Edit it when changing how the *agent* behaves; edit this file when changing how the *repo* is built. They are different audiences.

## What this repo is

A personal grocery agent that runs in **Claude.ai** (not Claude Code). This is the **code-only** repo — the agent's backend and build tooling. **The agent's data lives in a separate private data repo** (the multi-tenant split — see [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) and the `multi-tenant-friend-group` OpenSpec change). This repo holds:

- **`worker/`** — a Cloudflare Worker (TypeScript) exposing the `grocery-mcp` MCP server. The domain tool surface (pantry, recipes, Kroger, substitutions, cart). Deployed to `grocery-mcp.<subdomain>.workers.dev`. It reads/writes the data repo via a GitHub App installation token; "which tenant" is a `users/<username>/` path prefix in that repo.
- **`scripts/`** — index + static-site build tooling (`build-indexes.mjs`, `build-site.mjs`, `site-assets/`, `migrate/`). Data repos run these against their own content via the reusable CI workflows in `.github/workflows/data-build-*.yml` (`--root <dir>`).
- **`docs/`** — `PROJECT.md` (architecture), `SCHEMAS.md` (file formats), `TOOLS.md` (the tool contract — keep in sync with `worker/` code), `SELF_HOSTING.md` (operator setup), `MIGRATION.md` (single-repo → data-repo).
- **`openspec/`** — the change/spec workflow (see below).
- **`ROADMAP.md`** — the sequence of OpenSpec changes building the system.

There is **no data at the root of this repo.** The data repo (created from `groceries-agent-data-template`) holds shared content at its root (`recipes/`, `aliases.toml`, `substitutions.toml`, `skus/`, `ready_to_eat/`, `_indexes/`) and per-tenant state under `users/<username>/`.

### Data model — three categories + the three-store intent model

Recipe data splits three ways (multi-tenant split): **content** (objective frontmatter + body, shared at the data-repo root), **overlay** (`rating`/`status`, per-tenant in `users/<username>/overlay.toml`), and **notes** (attributed, per-tenant). `last_cooked` is derived per-tenant from `cooking_log.toml`, not stored. The shared `_indexes/recipes.json` carries objective fields only; the Worker merges each caller's overlay + cooking-log `last_cooked` at read time.

Within a tenant's `users/<username>/`, the intent model (don't conflate these):

- `pantry.toml` — **observation**: what's physically in the kitchen.
- `stockup.toml` — **conditional intent**: buy IF it drops below a threshold.
- `grocery_list.toml` — **committed buy intent**: buy on the next order (ingredient-level, SKU-free).
- `meal_plan.toml` — **committed cook intent**: recipes agreed to cook next (transient; cleared as cooked or abandoned).
- `cooking_log.toml` — **realized history**: an append-only log of meals actually cooked (the spine `retrospective` reads; `last_cooked` is derived from it).

The data repo is freely mutable; the Kroger cart is append-only. Capture intent into `grocery_list.toml` continuously; flush to the cart once, at order time, via `place_order`. Details in `docs/PROJECT.md`.

## Toolchain

Build tooling is managed with **mise** (`mise.toml`) — Node, etc. Don't install globally.

## Working on the Worker (`worker/`)

The Worker has its own dependency tree, separate from the root index/site tooling.

```bash
cd worker
npm run dev        # wrangler dev — local Worker; point MCP Inspector at the local URL
npm test           # vitest run — unit tests (worker/test/*.test.ts)
npm run typecheck  # tsc --noEmit
npm run deploy      # wrangler deploy — normally NOT run by hand (see below)
```

- **Deployment is CD**: pushing to `worker/**` triggers `.github/workflows/deploy-worker.yml` (runs `typecheck` + `test`, then `wrangler deploy`). Repo access is via a **GitHub App** (D3), not a PAT: the App private key is a Cloudflare secret (`wrangler secret put GITHUB_APP_PRIVATE_KEY`); the App id, installation id, and data-repo coords are non-secret `wrangler.jsonc` vars. Kroger creds + KV are likewise secret-put / bound to Cloudflare — never in the repo or in Actions.
- **Local dev/secrets**: `GITHUB_APP_PRIVATE_KEY` + Kroger creds live in `worker/.dev.vars` for local runs (gitignored; see `worker/.dev.vars.example`). See `docs/SELF_HOSTING.md` for the one-time operator setup and the Kroger `/oauth/init?tenant=<id>` flow.
- **Structured errors, not throws**: tools return `{ error: "...", message }` shapes the agent can reason over. Follow the existing convention in `worker/src/errors.ts`.
- **`docs/TOOLS.md` is the contract** — when a tool's params/returns change, update `docs/TOOLS.md` in the same pass. No drift.

## Working on data tooling (root)

The scripts build indexes/site for a **data repo**, not this one (no data lives here). Point them at a data checkout with `--root`:

```bash
node scripts/build-indexes.mjs --root /path/to/data-repo   # → <root>/_indexes/*.json + validation
node scripts/build-site.mjs    --root /path/to/data-repo --out site
node scripts/build-indexes.mjs --check                     # validate only, no write
npm test                                                   # node --test (root tests/, fixture-based)
```

- **Validation** runs in `build-indexes.mjs` (TOML parses, frontmatter well-formed, references resolve, status enum *optional* now — it's per-tenant overlay). The Worker reimplements a *structural* subset in TS for write-time validation (it can't run the Node validator on `workerd`).
- **No git hooks** in this repo anymore (data moved out). The Worker's CI (`deploy-worker.yml`) runs `typecheck` + `test` before deploying.
- **Actions**: `deploy-worker.yml` deploys the Worker on push to `worker/**`. `data-build-indexes.yml` + `data-build-site.yml` are **reusable** (`on: workflow_call`) — a data repo's thin caller workflows invoke them (`uses: caseyWebb/groceries-agent/...@main`) to build its own indexes/site, billed to the data-repo owner. Tests/fixtures live in `tests/`.

## OpenSpec change workflow

This repo is built as a sequence of OpenSpec changes (see `ROADMAP.md`). Each change carries `proposal.md`, `design.md`, `specs/` deltas, and `tasks.md`.

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
- Config/structured files use TOML; prose files (recipes, taste, diet_principles, the instruction docs) stay markdown; recipe frontmatter is YAML (Obsidian renders it).
- Don't commit secrets. The repo is public — anything needed to run that's gitignored gets documented in `worker/README.md`.
