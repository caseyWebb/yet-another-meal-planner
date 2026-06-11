# CLAUDE.md — Developing in this repo

This file is for Claude Code (and humans) **working on** the grocery-agent backend. It is *not* the agent's persona.

> **The grocery-agent operational instructions — persona, conversational flows, behavior rules — live in [`AGENT_INSTRUCTIONS.md`](AGENT_INSTRUCTIONS.md).** That file is the canonical source from which the **grocery-agent plugin** is generated (`scripts/build-plugin.mjs` → `npm run build:plugin`) and installed in Claude.ai via the marketplace — edit `AGENT_INSTRUCTIONS.md` and rebuild, never hand-edit the generated bundle under `plugin/`. Edit it when changing how the *agent* behaves; edit this file when changing how the *repo* is built. They are different audiences.

## What this repo is

A personal grocery agent that runs in **Claude.ai** (not Claude Code). This is the **code-only** repo — the agent's backend and build tooling. **The agent's data lives in a separate private data repo** (the multi-tenant split — see [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) and the `multi-tenant-friend-group` OpenSpec change). This repo holds:

- **`src/` + `test/` + `wrangler.jsonc`** — the repo root **is** the Cloudflare Worker (TypeScript) exposing the `grocery-mcp` MCP server: the domain tool surface (pantry, recipes, Kroger, substitutions, cart), deployed to `grocery-mcp.<subdomain>.workers.dev`. It reads/writes the data repo via a GitHub App installation token; "which tenant" is a `users/<username>/` path prefix in that repo. The Worker is also an OAuth 2.1 provider — members connect Claude.ai via an operator-issued invite code (`src/authorize.ts`).
- **`scripts/`** — index + static-site build tooling (`build-indexes.mjs`, `build-site.mjs`, `site-assets/`). Data repos run these against their own content via the reusable CI workflows in `.github/workflows/data-build-*.yml` (`--root <dir>`).
- **`docs/`** — `PROJECT.md` (architecture), `SCHEMAS.md` (file formats), `TOOLS.md` (the tool contract — keep in sync with the `src/` code), `SELF_HOSTING.md` (operator setup).
- **`openspec/`** — the change/spec workflow (see below).
- **`ROADMAP.md`** — the sequence of OpenSpec changes building the system.

There is **no data at the root of this repo.** The data repo (created from `groceries-agent-data-template`) holds shared content at its root (`recipes/`, `aliases.toml`, `substitutions.toml`, `skus/`, `ready_to_eat/`, `storage_guidance/`, `feeds.toml`, `discoveries_inbox.toml`, `discovery_sources.toml`, `_indexes/`) and per-tenant state under `users/<username>/`. `storage_guidance/` is curated, hand-maintained config (edit-when-directed; no write tool) — opinionated put-away advice keyed by storage class, surfaced by the agent when new perishables arrive. **Discovery sources are shared/top-level** (not per-tenant): `feeds.toml` (RSS, curated config), `discoveries_inbox.toml` (forwarded-newsletter candidates — agent/`email()`-writable side-effect file), and `discovery_sources.toml` (inbound-email allowlist — curated config, but widenable by anyone via `update_discovery_sources` since they're already trusted with the MCP).

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

The data-repo template is vendored as a git submodule at `docs/data-template/` (reference only — build/test never touch it). After a fresh clone, run `git submodule update --init` to populate it; `git submodule update --remote && git add docs/data-template` bumps the pinned ref to the template's latest.

## Working on the Worker (`src/`)

The Worker is the root package. One `package.json` carries both the Worker deps and the `scripts/` build-tooling deps; `npm test` runs the Worker (vitest), `npm run test:tooling` runs the `scripts/` tests (`node --test`).

```bash
npm run dev          # wrangler dev — local Worker; point MCP Inspector at the local URL
npm test             # vitest run — Worker unit tests (test/*.test.ts)
npm run test:tooling # node --test — build-indexes/build-site tests (tests/*.test.mjs)
npm run typecheck    # tsc --noEmit
npm run deploy       # wrangler deploy — normally NOT run by hand (see below)
```

- **Deployment is operator-run from the private data repo**, not from this (public) repo. This repo holds the Worker source + a *reusable* `data-deploy.yml` (`workflow_call`); each operator's data repo has a thin `deploy.yml` caller (`uses: …@main`) that overlays their own `wrangler.jsonc` and runs `typecheck` + `test` + `wrangler deploy`. The public repo holds **no Actions secrets** (the data repo is the single control plane); push/PR here only runs `ci.yml` (typecheck + both test suites). Repo access is via a **GitHub App** (D3), not a PAT: the App private key is a Cloudflare secret (`wrangler secret put GITHUB_APP_PRIVATE_KEY`); the App id, installation id, and data-repo coords are non-secret `wrangler.jsonc` vars (the operator's copy lives in their data repo). Kroger creds + KV are likewise secret-put / bound to Cloudflare — never in the repo or in Actions.
- **Trigger the deploy after pushing worker changes.** There is deliberately **no** auto-deploy on push (a push trigger would need a data-repo-writable token in this *public* repo — a blast-radius regression we rejected). Instead, when you push changes to `main` that affect the Worker (`src/**`, `wrangler.jsonc`, `package.json`/lockfile), **also kick the deploy** in the operator's private data repo using the operator's already-authenticated local `gh` (no stored cross-repo secret):
  ```bash
  gh workflow run deploy.yml --repo caseyWebb/groceries-agent-data   # operator substitutes their data repo
  gh run watch  --repo caseyWebb/groceries-agent-data                # optional: follow it to green
  ```
  It deploys `@main`, so run it *after* the push has landed. Doc/test/openspec-only pushes don't need it. (`npm run deploy` is a local escape hatch, but the data-repo workflow is the source of truth — it gates on typecheck + tests first.)
- **Local dev/secrets**: `GITHUB_APP_PRIVATE_KEY` + Kroger creds live in `.dev.vars` for local runs (gitignored; see `.dev.vars.example`). See `docs/SELF_HOSTING.md` for the one-time operator setup and the Kroger `/oauth/init?tenant=<id>` flow.
- **Structured errors, not throws**: tools return `{ error: "...", message }` shapes the agent can reason over. Follow the existing convention in `src/errors.ts`.
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
- **No git hooks** in this repo anymore (data moved out). Push/PR CI (`ci.yml`) runs `typecheck` + both test suites — no secrets, no deploy.
- **Actions**: this public repo hosts **reusable** (`on: workflow_call`) workflows that operators' private data repos call (`uses: caseyWebb/groceries-agent/...@main`), billed to the data-repo owner: `data-deploy.yml` (deploy the Worker, overlaying the operator's `wrangler.jsonc`), `data-onboard.yml` / `data-revoke.yml` (KV-only member provisioning — namespace addressed by `tenant_kv_id` input, so no `wrangler.jsonc` needed), and `data-build-indexes.yml` / `data-build-site.yml` (rebuild indexes/site). A live, versioned reference of the thin data-repo callers (and the full data-repo layout) is vendored as a submodule at `docs/data-template/` — `git submodule update --init` to populate, `git submodule update --remote` to bump the pinned ref. Onboard/revoke run in the **private** data repo so the invite codes they print never hit a public log. `ci.yml` is the only push-triggered workflow here. Tests/fixtures live in `tests/`.

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
- Don't commit secrets. The repo is public — anything needed to run that's gitignored gets documented in `README.md` / `.dev.vars.example`.
