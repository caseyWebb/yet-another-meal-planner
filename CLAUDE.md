# CLAUDE.md — working in this repo with Claude Code

This repo is the **grocery-agent itself** — its persona/skills (generated from `AGENT_INSTRUCTIONS.md`) and the `grocery-mcp` Cloudflare Worker, plus the build tooling that produces both. The agent *runs* in **Claude.ai**, not Claude Code, but it's *built* here; this file is read as repo-development context. The real guides live in three docs — read the relevant one rather than working from this file alone:

- **[CONTRIBUTING.md](CONTRIBUTING.md)** — how to work in the repo: toolchain, Worker dev, deployment, data tooling, the tool/skill surface ownership boundary, the OpenSpec workflow, conventions. **Start here.**
- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — how the system is built: the determinism boundary, multi-tenant identity, the data model, the Kroger matching pipeline.
- **[AGENT_INSTRUCTIONS.md](AGENT_INSTRUCTIONS.md)** — the agent's persona and conversational flows (the thing that runs in Claude.ai). Not auto-loaded into a dev session — intentional.

Reference docs: [`docs/SCHEMAS.md`](docs/SCHEMAS.md) (file formats) · [`docs/TOOLS.md`](docs/TOOLS.md) (tool contract) · [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) (operator setup).

## Rules a coding agent must not miss

- **`AGENT_INSTRUCTIONS.md` is the source of the agent persona; the `plugin/` bundle is generated** (`aubr build:plugin`). Edit `AGENT_INSTRUCTIONS.md` and rebuild — **never hand-edit `plugin/`**.
- **`docs/TOOLS.md` is the tool contract and `docs/SCHEMAS.md` the data-file contract** — when a tool's params/returns or a file's shape changes, update the matching doc in the *same* pass. No drift. An architectural shift updates `docs/ARCHITECTURE.md`.
- **There is no data at the root of this repo.** Data lives in a separate private data repo; `users/<username>/` is the tenant prefix. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- **Deployment auto-kicks from `main`; it runs in the private data repo, not here.** This public repo holds no Actions secrets. When Worker-relevant paths (`src/**`, `wrangler.jsonc`, `package.json`/lockfile) land on `main`, `ci.yml`'s `trigger-deploy` job dispatches the data repo's `deploy.yml` **automatically** — gated on green CI (`test` + `no-open-changes`). Doc/test/openspec-only pushes skip it. So a normal merge needs **no manual deploy step**. Manual fallback only (force a deploy after a doc-only change, or re-run a failed one): `gh workflow run deploy.yml --repo caseyWebb/groceries-agent-data` (operator substitutes their data repo). D1 schema migrations (`migrations/d1/*.sql`) are applied by the deploy itself. See [`CONTRIBUTING.md`](CONTRIBUTING.md#deployment).
- **Tools return structured errors, not throws** (`src/errors.ts`). Don't commit secrets — the repo is public.
