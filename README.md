# grocery-agent

A personal grocery agent you talk to like a friend who knows your kitchen. It plans the week's
dinners from a shared recipe corpus, keeps track of what's in your pantry, and fills your Kroger
cart — or walks you through any store, aisle by aisle. The agent *runs* inside Claude.ai; this
repo is what *builds* it.

> **There is no data in this repo.** It holds the agent's source — a Cloudflare Worker (the
> `grocery-mcp` server), the persona it runs on, and the build tooling. Every operator's recipes,
> profile, and state live in a *separate private data repo* plus Cloudflare D1. See
> [Self-hosting](#self-hosting).

## What it does

- **Plans your week.** Proposes a menu from your recipe corpus, weighted by your taste, the
  season, the weather, what you've cooked recently, what's on sale, and what's about to spoil in
  your fridge — then builds the grocery list.
- **Tracks your kitchen.** Pantry, staples, and equipment, with a nudge about perishables before
  they turn and storage tips when fresh produce comes in.
- **Fills your Kroger cart.** Resolves each ingredient to a specific SKU and writes your cart,
  asking only when a choice is genuinely ambiguous ("which olive oil?") — and remembering your
  answer so it asks less over time.
- **Or walks you through any store.** The same buy list, grouped aisle-by-aisle for an in-store
  trip and read out hands-free, one aisle at a time — Kroger or otherwise.
- **Finds new recipes.** Surfaces candidates from your trusted recipe blogs (RSS) and forwarded
  newsletters, scored against your taste; you import the keepers in one step.
- **Shares with a small friend group.** Recipes and store maps are shared across the group; your
  favorites, notes, pantry, preferences, and cart stay private to you.

## What it feels like

```
you ›  make me a menu for the week — feeling a bit lazy, and I've got salmon to use up

     ›  reads your profile, pantry, what's on sale, and the last month of dinners…
        Here's an easy week, with the salmon up front:
          Mon  Sheet-pan salmon & green beans      (uses the salmon)
          Tue  Leftovers
          Wed  Black bean tacos                     (pantry-heavy, 20 min)
          Thu  Chicken katsu curry                  ← two others favorited this
          Fri  Margherita pizza                     (mozzarella's on sale this week)
        New this week from your feeds: a miso-butter pasta — want it in?

you ›  swap Friday for the pasta, then order it

     ›  Done. Cart's resolved — one thing to pick: 3 brands of white miso match.
        … you choose … cart written. Check out in the Kroger app.
```

State lives in your data, not the chat — each conversation starts fresh and the agent reads what
it needs through its tools.

## How it works

The whole design turns on one split: **the LLM does the fuzzy work; everything deterministic is
plain code.** Claude handles conversation, menu reasoning, and the genuinely-fuzzy judgment calls;
a stateless Cloudflare Worker owns everything that should be exact — file I/O, recipe filtering,
Kroger SKU matching, cart writes, validation.

```
  You, in Claude.ai (web + mobile)
        │   the grocery-agent plugin — workflow skills + the grocery-mcp connector
        │   MCP over HTTPS, OAuth 2.1 · connect once with an operator-issued invite code
        ▼
  Cloudflare Worker · grocery-mcp
        │   OAuth provider + multi-tenant gate + coarse, opinionated domain tools
        │   (pantry · recipes · Kroger matching · cart) — the locus of determinism
        ├──────────►  GitHub data repo (private)  — authored recipe & guidance markdown
        ├──────────►  Cloudflare D1               — profile, session state, indexes, caches
        └──────────►  Kroger Developer API        — product search, prices, cart writes
```

Two patterns recur and explain most of the design:

- **Coarse, opinionated tools.** A tool wraps a whole pipeline — `match_ingredient_to_kroger_sku`
  runs the full ingredient→SKU match internally — so the model can't bypass the cache, validation,
  or matching. Raw building blocks aren't exposed, and tools return *structured errors, not throws*.
- **Capture → retrieve → narrow.** LLM-derived knowledge (recipe facets, embeddings, the sale
  flyer) is captured once into persistent data, retrieved deterministically, and narrowed by the
  model with live context — so the hot path stays fast and the model is reserved for real novelty.

**Multi-tenancy is a D1 column.** One self-hosted Worker serves a friend group; an invite code
resolves to a tenant *before* any tool runs, and every per-tenant table is isolated by its `tenant`
column. Recipes and store maps are deliberately shared; everything personal is not.

The full picture — the determinism boundary, the data model, the Kroger matching pipeline, and the
background crons — is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## This repo

| Path | What it is |
| --- | --- |
| `src/`, `test/`, `wrangler.jsonc` | the Cloudflare Worker — the `grocery-mcp` MCP server + OAuth provider |
| `scripts/` | build tooling — recipe indexes, the static cookbook, the plugin bundle |
| `AGENT_INSTRUCTIONS.md` | the agent persona + conversational flows; the source `plugin/` is generated from |
| `plugin/` | the **generated** plugin bundle (skills + connector) — never hand-edited |
| `docs/` | the deep docs (see [Documentation](#documentation)) |
| `migrations/d1/` | D1 schema migrations, applied by `wrangler d1 migrations apply` |
| `openspec/` | the change/spec workflow — `changes/archive/` is the history, `specs/` the living contract |
| `.github/workflows/` | CI plus the reusable workflows operators' data repos call |

**Built with** Cloudflare Workers (TypeScript on `workerd`) · D1 + KV · a GitHub App for repo I/O ·
the Kroger Developer API · pure-JS parsers (`js-yaml`, JSON-LD via `HTMLRewriter`, RSS via
`fast-xml-parser`). No database server, no scheduler, no stateful runtime.

## Quickstart (development)

The toolchain is pinned with [mise](https://mise.jdx.dev); **aube** is the package manager (`aubr`
= `aube run`). Don't install anything globally — `package-lock.json` stays the lockfile.

```bash
mise install          # Node 22 + aube, pinned in mise.toml
aube install          # dependencies (reads package-lock.json in place)

aubr dev              # wrangler dev — a local Worker; point MCP Inspector at the local URL
aubr typecheck        # tsc --noEmit
aubr test             # vitest — Worker unit tests (test/*.test.ts)
aubr test:tooling     # node --test — build-tooling tests (tests/*.test.mjs)
aubr build:plugin     # AGENT_INSTRUCTIONS.md → plugin/ (needs $GROCERY_MCP_URL set)
```

Local dev secrets (a GitHub App key + Kroger credentials) go in a gitignored `.dev.vars` — see
[`.dev.vars.example`](.dev.vars.example). The full developer guide — Worker dev, the D1 workflow,
deployment, and conventions — is [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Self-hosting

One self-hosted Worker serves a small friend group, and **you don't fork this repo to run it.**
You create a private **data repo** from a template — that repo is your control plane: it holds your
config and thin caller workflows that reference this repo's reusable CI. A GitHub App gives the
Worker access to your recipes, a Kroger developer app handles search and cart, and Cloudflare hosts
the Worker, D1, and KV (comfortably free-tier at personal scale). Friends connect their own
Claude.ai with an invite code you mint — no GitHub or Kroger developer account needed on their end.

The complete walkthrough is [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md).

## Documentation

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — toolchain, Worker dev, deployment, conventions. **Start here to hack on it.**
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the determinism boundary, multi-tenancy, the data model, the Kroger matching pipeline, the crons.
- [`docs/TOOLS.md`](docs/TOOLS.md) — the MCP tool contract (params, returns, guarantees).
- [`docs/SCHEMAS.md`](docs/SCHEMAS.md) — recipe-file and D1 formats.
- [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) — operator setup, end to end.
- [`AGENT_INSTRUCTIONS.md`](AGENT_INSTRUCTIONS.md) — the persona and the conversational flows.

## What this is — and isn't

A personal automation experiment aimed at a real friction point — the time and willpower grocery
planning takes — tuned to one person's tastes, freezer, and grocer, and shareable with a few
friends. **Not a product, not a startup.** The architecture is deliberately minimal: Claude
provides the reasoning, the Worker provides a domain interface, GitHub holds the recipe corpus and
its history, and D1 holds the operational data. The recipe files are plain, version-controlled
markdown — inspectable by a human and able to outlive the agent if anyone ever stops using it.
