---
update-when: the build/deploy workflow, common commands, doc-ownership boundaries, or coding-agent conventions for this repo change
---

# AGENTS.md

This repo is **yamp itself**: the `yamp` Cloudflare Worker, the member web app (`packages/app`, served at `/`), the operator admin panel (`packages/admin-app`, served at `/admin`), shared UI (`packages/ui`), the agent persona/skills source (`AGENT_INSTRUCTIONS.md`), and build tooling (`scripts/`). The agent runs in an external assistant; it is built here.

The plugin bundle is generated and is **not committed here**. The operator deploy builds it with the connector URL and publishes it to the public data-repo marketplace. There is no authored data in this repo: each operator's recipe/guidance corpus lives in Cloudflare R2, with profile/state in D1/KV. The recipe index and cookbook are derived by the Worker.

Start with the docs instead of reverse-engineering:

- [CONTRIBUTING.md](CONTRIBUTING.md) - toolchain, Worker dev, deployment, data tooling, OpenSpec workflow, conventions.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - determinism boundary, multi-tenant identity, data model, Kroger matching pipeline, cron jobs.
- [docs/TOOLS.md](docs/TOOLS.md) - MCP tool contract.
- [docs/SCHEMAS.md](docs/SCHEMAS.md) - file and D1 formats.
- [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) - operator setup.
- [AGENT_INSTRUCTIONS.md](AGENT_INSTRUCTIONS.md) - member-facing agent persona source; not auto-loaded into dev sessions.

## Working Mode

Unless otherwise specified, use orchestrator mode: the main thread is the arbiter and maintainer of context, delegating execution to subagents. The exception is active discovery, exploration, and design discussion with the user, where the main thread stays in the conversation.

For a sequence of OpenSpec changes, stagger the pipeline: one agent may plan change N+1 in an isolated worktree while another implements change N and the main thread shepherds change N-1 through review, PR, and merge. Planning can parallelize freely; implementation stays serial when changes touch shared surfaces such as `scheduled()` wiring, the same spec file, or `docs/`.

The main thread is the principal architect in the loop. It reads each proposal/design/spec delta and ratifies or requests changes before implementation proceeds. Implementation-level correctness belongs to the adversarial code-review pass, whose findings the main thread triages.

Planning resolves its own unknowns. When `CLOUDFLARE_API_TOKEN` is present, questions real data can answer should be settled by background spikes during planning, before a plan is applied. Finished proposal/design/tasks artifacts should answer the questions an implementer would otherwise resolve unilaterally.

Production data converges through shipped pipeline changes, never manual surgery. A production data defect should be fixed by a reconcile, audit pass, or guard that heals existing data organically, with observed rows used as acceptance fixtures.

## Toolchain And Commands

Build tooling is managed with **mise** (`mise.toml` pins Node 22 and **aube**). Do not install globally. `aubr` means `aube run`; use it instead of `npm run`. `aube ci` is the lockfile-strict CI install. `aube-lock.yaml` is the lockfile and `pnpm-workspace.yaml` defines the `packages/*` workspaces. Do not reintroduce `package-lock.json`.

```bash
mise install
aube install

aubr dev
aubr typecheck
aubr test
aubr test:tooling
aubr test:admin
aubr test:app
aubr build:plugin
aubr build:admin
aubr build:app
aubr build:vault
aubr dev:app
aubr dev:admin
```

Single Worker test: `aubr test test/kroger.test.ts`, or filter with `aubr test -- -t "match ingredient"`. `*.live.test.ts` files hit real external APIs and need credentials; default `vitest run` covers the rest.

Local dev secrets live in `.dev.vars` (gitignored; see `.dev.vars.example`). Local D1 is the `wrangler dev` SQLite binding; seed it with `npx wrangler d1 migrations apply DB --local` and inspect it with `npx wrangler d1 execute DB --local --command "..."`.

The operator admin panel (`/admin`) is a React 19 SPA under `packages/admin-app/`, served by Worker-first `/admin*` dispatch. Its Worker routes live under `src/admin/`; its modeling standards live in `src/admin/CLAUDE.md`.

The member web app (`/`) is a React 19 SPA under `packages/app/`, using Vite, TanStack Router/Query, `vite-plugin-pwa`, and shared `packages/ui` primitives. It signs in with invite-code-backed sessions and talks to typed `/api` Hono sub-apps.

The authoring vault is generated from `vault-template/` by `scripts/build-vault.mjs`; never hand-edit generated `vault/` output.

## Architecture

The LLM does fuzzy work; deterministic behavior is plain code inside Worker tools. The system is Claude.ai or another assistant for reasoning, a stateless Cloudflare Worker for OAuth/MCP/deterministic orchestration, R2 for authored recipe/guidance markdown, D1 for relational and derived state, and KV for ephemeral infrastructure.

Two patterns recur:

- Coarse, opinionated tools wrap whole multi-step pipelines. Raw building blocks are deliberately not exposed.
- Capture -> retrieve -> narrow. LLM-derived knowledge is captured once into persistent data, retrieved deterministically, and narrowed with live context.

Multi-tenancy is a D1 column. Identity is an operator-issued invite code resolving to `tenantId` before any tool runs. Every per-tenant D1 table is isolated by `tenant`. The only deliberately cross-tenant cache is the Kroger flyer keyed by `locationId`.

## Rules Agents Must Not Miss

- `AGENT_INSTRUCTIONS.md` is the persona source. The plugin bundle is generated by `scripts/build-plugin.mjs`; never hand-edit generated plugin output.
- Do not wing UI designs. Route admin-panel design changes through the companion Claude Design project, then translate the exported bundle onto the local shared UI components.
- Admin-panel changes ship with Playwright coverage under `admin/visual/` and should run `aubr test:admin`.
- A new Worker-owned HTTP route ships with its `run_worker_first` entry in `wrangler.jsonc`.
- Keep contract docs in lockstep: tool param/return changes update `docs/TOOLS.md`; data-file/D1 shape changes update `docs/SCHEMAS.md`; architecture changes update `docs/ARCHITECTURE.md`.
- Living docs describe current state, not history. Do not narrate "used to" or "now" in `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, `CLAUDE.md`, or `docs/`.
- Tools never touch `env.DB` directly; go through `packages/worker/src/db.ts`.
- D1 schema changes ship a new `packages/worker/migrations/d1/NNNN_name.sql`.
- Tool descriptions own what the tool does, params/returns, and guarantees. Skills own when to call tools and how to act on results.
- Deploy auto-kicks from `main` and runs in the data repo. This public repo holds no Actions secrets.
- The deploy merges wrangler configs via an allowlist in `scripts/merge-wrangler-config.mjs`; new binding types must be added explicitly.
- Do not commit secrets. The repo is public.
- PR commits must be authored by the actual user for CLA Bot acceptance. Keep assistant attribution as a co-author trailer when needed.
- Opening a PR uses `.github/pull_request_template.md`; fill the required sections and check every consideration.

## OpenSpec Workflow

This repo is developed as a sequence of OpenSpec changes. `openspec/changes/archive/` is history; `openspec/specs/` is the living contract. Use `openspec list` and `openspec validate "<name>"`. Specs use `### Requirement:` and `#### Scenario:` with SHALL / WHEN-THEN language.

Shared skills exist for OpenSpec explore/propose/apply/archive and code review. In Claude they are slash commands or skills; in Codex they are available through the repo's `.codex/skills` symlink.

## Conventions

Match surrounding code idiom, naming, and comment density. Config/structured files use TOML; prose stays Markdown; recipe frontmatter is YAML. Use pure-JS parsers only (`js-yaml`, JSON-LD via `HTMLRewriter`, RSS via `fast-xml-parser`); the code runs on `workerd`, so avoid Node-internals dependencies.
