# CLAUDE.md — Developing in this repo

This file is for Claude Code (and humans) **working on** the grocery-agent backend. It is *not* the agent's persona.

> **The grocery-agent operational instructions — persona, conversational flows, behavior rules — live in [`AGENT_INSTRUCTIONS.md`](AGENT_INSTRUCTIONS.md).** That file is the canonical source pasted into the Claude.ai "Grocery Agent" project. Edit it when changing how the *agent* behaves; edit this file when changing how the *repo* is built. They are different audiences.

## What this repo is

A personal grocery agent that runs in **Claude.ai** (not Claude Code). The repo is the agent's backend and database:

- **`worker/`** — a Cloudflare Worker (TypeScript) exposing the `grocery-mcp` MCP server. This is the domain tool surface (pantry, recipes, Kroger, substitutions, cart). Deployed to `grocery-mcp.<subdomain>.workers.dev`.
- **Flat-file data** at the root — the agent's state, all human-inspectable: `pantry.toml`, `grocery_list.toml`, `stockup.toml`, `preferences.toml`, `substitutions.toml`, `aliases.toml`, `flyer_terms.toml`, `ingredients.toml`, `feeds.toml`, `recipes/*.md`, `ready_to_eat/*.toml`, `skus/`, plus narratives `taste.md` / `diet_principles.md`.
- **`_indexes/`** — generated JSON indexes (recipes, components, ready_to_eat) built from the flat files.
- **`docs/`** — `PROJECT.md` (architecture), `SCHEMAS.md` (file formats), `TOOLS.md` (the tool contract — keep in sync with `worker/` code).
- **`openspec/`** — the change/spec workflow (see below).
- **`ROADMAP.md`** — the sequence of OpenSpec changes building the system.

### Three-store data model (don't conflate these)

- `pantry.toml` — **observation**: what's physically in the kitchen.
- `stockup.toml` — **conditional intent**: buy IF it drops below a threshold.
- `grocery_list.toml` — **committed intent**: buy on the next order (ingredient-level, SKU-free).

The repo is freely mutable; the Kroger cart is append-only. Capture intent into `grocery_list.toml` continuously; flush to the cart once, at order time, via `place_order`. Details in `docs/PROJECT.md`.

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

- **Deployment is CD**: pushing to `worker/**` triggers `.github/workflows/deploy-worker.yml`. The first deploy was manual (`wrangler deploy` + `wrangler secret put` for the GitHub PAT / Kroger creds); CD owns every deploy after. Worker secrets (PAT, Kroger tokens, KV) are set via `wrangler secret put` straight to Cloudflare — never in the repo or in Actions.
- **Local dev/secrets**: the PAT lives in `worker/.dev.vars` for local runs (gitignored). See `worker/README.md` for the one-time setup and the Kroger `/oauth/init` flow.
- **Structured errors, not throws**: tools return `{ error: "...", message }` shapes the agent can reason over. Follow the existing convention in `worker/src/errors.ts`.
- **`docs/TOOLS.md` is the contract** — when a tool's params/returns change, update `docs/TOOLS.md` in the same pass. No drift.

## Working on data tooling (root)

```bash
npm run build:indexes   # scripts/build-indexes.mjs → _indexes/*.json + validation
npm run build:site      # scripts/build-site.mjs
npm run build           # both
npm test                # node --test (root tests/)
```

- **Validation** runs in `build-indexes.mjs` (TOML parses, frontmatter well-formed, references resolve, status enums). The Worker reimplements a *structural* subset in TS for pre-commit validation (it can't run the Node validator on `workerd`).
- **Git hooks**: `npm install` runs `prepare`, which sets `core.hooksPath` to `scripts/githooks` (pre-commit validation).
- **Actions**: `build-indexes.yml` regenerates indexes on push to data dirs (`[skip ci]` to avoid loops); `build-site.yml` builds the site; `deploy-worker.yml` deploys the Worker.

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
