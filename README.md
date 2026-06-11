# grocery-agent

A personal grocery agent. It plans meals, tracks pantry inventory, and populates a
Kroger cart through conversation — you talk to it like a knowledgeable friend who
knows your kitchen, not a service you issue commands to. It runs inside **Claude.ai**
(web + mobile) and is self-hostable for a small friend group.

This repository is the **code**: the `grocery-mcp` MCP server and the agent's
persona ([`AGENT_INSTRUCTIONS.md`](AGENT_INSTRUCTIONS.md)). The **data** — recipes,
pantry, preferences — lives in a separate private **data repo** per deployment.

## How it works

Three components:

- **Claude.ai** — the conversational surface and reasoning. Each chat starts fresh;
  state lives in the data repo, not in chat history.
- **The Worker** (this repo, root `src/`) — a Cloudflare Worker hosting the MCP
  server: opinionated domain tools (Kroger matching, pantry verification,
  substitutions, atomic commits) plus an **OAuth 2.1 provider** that members connect
  their Claude.ai to via an operator-issued invite code. The deterministic logic.
- **The data repo** (`<you>/groceries-agent-data`, private) — shared `recipes/` +
  reference data at the root, and one `users/<username>/` subtree per member
  (pantry, preferences, ratings, notes). Git history is the audit log.

The fuzzy work (understanding requests, proposing menus) is the LLM's; everything
deterministic (matching, filtering, file I/O, commits) is the Worker's.

## This repo

| Path | What it holds |
| --- | --- |
| `src/`, `test/`, `wrangler.jsonc` | the Cloudflare Worker (MCP server + OAuth provider) |
| `scripts/` | index + static-site build tooling, run by data repos via reusable CI |
| `.github/workflows/` | `deploy-worker` (CD), reusable `data-build-*`, operator `onboard`/`revoke` |
| `AGENT_INSTRUCTIONS.md` | the agent persona, pasted into each member's Claude.ai Project |
| `docs/` | [PROJECT](docs/PROJECT.md) (architecture), [SCHEMAS](docs/SCHEMAS.md), [TOOLS](docs/TOOLS.md), [SELF_HOSTING](docs/SELF_HOSTING.md) |
| `CLAUDE.md` | development guide for working in this repo |
| `ROADMAP.md` | the sequence of OpenSpec changes building the system |

The data repo is created from the [`groceries-agent-data-template`](https://github.com/caseyWebb/groceries-agent-data-template), which is also vendored here as a submodule at `docs/data-template/` for reference.

## Self-hosting

Self-host for yourself or a friend group **without running anything locally** — fork
this repo and drive it from GitHub Actions:

1. **Fork** this repo, enable Actions, set the `CLOUDFLARE_API_TOKEN` secret and your
   `wrangler.jsonc` vars (via the web editor).
2. **Create a data repo** from the template; register a GitHub App + Kroger app.
3. **Deploy** the Worker (push, or run the *Deploy Worker* Action).
4. **Onboard** yourself and friends with the *Onboard member* Action — it mints an
   invite code; their `users/<username>/` subtree is created on first use.

Full step-by-step: **[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)**.

## Developing

The Worker is the root package (one `package.json` for the Worker + `scripts/`):

```sh
mise install         # Node 22 (pinned in mise.toml)
git submodule update --init   # populate docs/data-template/ (reference only; --remote to bump)
npm install
npm run typecheck    # tsc --noEmit
npm test             # vitest — Worker tests (test/*.test.ts)
npm run test:tooling # node --test — build tooling tests (tests/*.test.mjs)
npm run dev          # wrangler dev — local Worker for MCP Inspector
```

See [CLAUDE.md](CLAUDE.md) for conventions and the OpenSpec change workflow.
