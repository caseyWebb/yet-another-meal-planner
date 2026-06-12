# grocery-agent

A personal grocery agent. It plans your meals, keeps track of what's in your kitchen, and fills a Kroger cart — all through conversation. You talk to it like a friend who knows your kitchen, not a service you issue commands to. It runs inside **Claude.ai** (web + mobile) and is self-hostable for a small friend group.

> **Status:** working end-to-end and in personal use — a release candidate, not a packaged product. Single-maintainer project; self-hosting works but assumes you're comfortable with Cloudflare, GitHub Actions, and a Kroger Developer account.

This repository is the **grocery-agent itself**: the `grocery-mcp` MCP server and the agent's persona/skills (generated from [`AGENT_INSTRUCTIONS.md`](AGENT_INSTRUCTIONS.md)). The **data** — recipes, pantry, preferences — lives in a separate private **data repo** per deployment.

## What it does

- **Plans meals conversationally** — open-ended ("make me a menu for the week") or recipe-seeded ("I want salmon and rice tonight"), sized to how often you actually cook, around what you already have.
- **Tracks your pantry** so it can shop the gaps — and asks before things go stale ("basil's 9 days old — still good?").
- **Builds the grocery list as intent**, then flushes it **once** to your Kroger cart when you say to — or hands you an aisle-ordered walking list if you're shopping in person.
- **Matches ingredients to real Kroger SKUs** with price/availability, learns your brand preferences, and asks less over time.
- **Learns your taste** — ratings, notes, and a taste profile shape future suggestions. A shared recipe corpus, but your ratings and notes are yours.
- **Surfaces deals and discoveries** — what's on sale from your stockup list, and a couple of new recipes/ready-to-eat options each week from blogs and newsletters you trust.
- **Remembers what you cooked** — an append-only cooking log it can reflect on ("how have I been eating this month?").

## How you use it

You message it in a normal Claude.ai chat. There's no schedule and no command syntax — it reacts to what you say. A typical week:

> **You:** I'm running low, make me a menu for 3 dinners this week.
> **Agent:** *(checks your pantry, flyer, and taste)* Before I plan — you've still got the basil from 9 days ago, still good? And here's a 3-dinner plan: sheet-pan chicken (uses the lemons you have), a tofu stir-fry, and Tuesday's leftovers stretched into fried rice. Salmon's on sale if you'd rather swap the tofu. Want me to build the list?
> **You:** Swap in the salmon. And add coffee, I'm almost out.
> **Agent:** Done — grocery list has the salmon, the produce gaps, and coffee. Say the word when you want it in your cart.
>
> *…later…*
>
> **You:** Place the order.
> **Agent:** *(resolves the list against Kroger, flags one ambiguous item, writes the cart)* In your cart. One thing — there were two "coffee" matches, I picked the one you bought last time. Review in the Kroger app before checkout; the API can add but can't remove.
>
> *…after cooking…*
>
> **You:** Made the chili last night, it was great — 4 stars.
> **Agent:** Logged it and rated it 4. That clears it off your meal plan.

Smaller things just work too: *"I ran out of olive oil"*, *"what's on sale from my stockup list?"*, *"rate the Serious Eats one 4 stars"*, *"I'm headed to the store — give me a list for Tom Thumb."*

## How it works

Three components, one clean split: **the LLM does the fuzzy work; everything deterministic is code.**

- **Claude.ai** — the conversational surface and reasoning. Each chat starts fresh; state lives in the data repo, not in chat history.
- **The Worker** (this repo, `src/`) — a Cloudflare Worker hosting the MCP server: opinionated domain tools (Kroger matching, pantry verification, substitutions, atomic git commits) plus an **OAuth 2.1 provider** members connect their Claude.ai to via an operator-issued invite code.
- **The data repo** (`<you>/groceries-agent-data`, private) — shared `recipes/` + reference data at the root, one `users/<username>/` subtree per member (pantry, preferences, ratings, notes). Git history is the audit log.

The full technical picture — the determinism boundary, multi-tenant identity, the data model, the Kroger matching pipeline — is in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## This repo

| Path | What it holds |
| --- | --- |
| `src/`, `test/`, `wrangler.jsonc` | the Cloudflare Worker (MCP server + OAuth provider) |
| `scripts/` | index + static-site + plugin build tooling, run by data repos via reusable CI |
| `.github/workflows/` | `ci` (typecheck + tests) + reusable `data-*` workflows operators call |
| `AGENT_INSTRUCTIONS.md` | the agent persona; source for the `plugin/` bundle installed in Claude.ai |
| `docs/` | [ARCHITECTURE](docs/ARCHITECTURE.md) (how it's built) · [SCHEMAS](docs/SCHEMAS.md) (file formats) · [TOOLS](docs/TOOLS.md) (tool contract) · [SELF_HOSTING](docs/SELF_HOSTING.md) (operator setup) |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | how to work in this repo |

The data repo is created from the [`groceries-agent-data-template`](https://github.com/caseyWebb/groceries-agent-data-template), also vendored here as a submodule at `docs/data-template/` for reference.

## Self-hosting

Self-host for yourself or a friend group **without forking this repo and without running anything locally** — your private **data repo is the control plane**, driving everything from GitHub Actions:

1. **Create a data repo** from the template (private); add your `wrangler.jsonc` vars and the one `CLOUDFLARE_API_TOKEN` Actions secret. Its thin caller workflows `uses:` the reusable workflows here — no fork to maintain.
2. **Register** a GitHub App (data-repo access) and a Kroger Developer app.
3. **Deploy** the Worker via the data repo's *Deploy Worker* Action.
4. **Onboard** yourself and friends with the *Onboard member* Action — it mints an invite code; their `users/<username>/` subtree is created on first use.

Full step-by-step: **[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)**.

## Developing

The Worker is the root package (one `package.json` for the Worker + `scripts/`):

```sh
mise install                  # Node (pinned in mise.toml)
git submodule update --init   # populate docs/data-template/ (reference only)
npm install
npm run typecheck             # tsc --noEmit
npm test                      # vitest — Worker tests (test/*.test.ts)
npm run test:tooling          # node --test — build tooling tests (tests/*.test.mjs)
npm run dev                   # wrangler dev — local Worker for MCP Inspector
```

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for conventions, deployment, and the OpenSpec change workflow.
