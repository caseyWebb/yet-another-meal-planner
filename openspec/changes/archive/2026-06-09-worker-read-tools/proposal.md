## Why

Everything before this change was data and CI. This is the first executable component: the Cloudflare Worker that hosts the custom MCP server. It establishes three things every later change inherits — how the Worker reads repo data, how MCP is served and deployed, and the tool-definition and error conventions — while delivering a usable read-only slice (browse recipes, pantry, and config from an MCP client). Kroger integration (Change 05), write tools (Change 06), and the Claude.ai connection (Change 07) all build directly on the skeleton stood up here.

## What Changes

- Bootstrap a TypeScript Cloudflare Worker in `worker/` with its own dependency tree, hosting an MCP server over **Streamable HTTP** via `createMcpHandler()` — stateless, **no Durable Objects**.
- Add an authenticated **GitHub client wrapper** (fine-grained PAT as a Worker secret, scoped `contents:read+write` for Change 06 reuse) with basic retry/backoff and structured errors. Reads `main` HEAD; no KV cache in v1.
- Implement the six **repo-data-backed read tools**: `list_recipes`, `read_recipe`, `read_pantry`, `read_preferences`, `read_taste`, `read_diet_principles`. These read only the GitHub repo (indexes + flat files) — no external services.
- Pin `list_recipes` filter semantics: AND across array filters; `status: "all"` opts out of the `active` default; `exclude_cooked_within_days` is a caller-supplied param; `not_cooked_since` passes never-cooked recipes.
- Scope `read_pantry` to `category` + `prepared_only`; `stale_only` returns a structured `unsupported` error until `ingredients.toml` exists (Change 12).
- Establish a **structured-error convention** (every tool returns `{ error, message, ... }`, never raw throws) that all later tools inherit.
- Parse on the Workers runtime with `js-yaml` + a manual frontmatter split and `smol-toml` — **no `gray-matter`** (Node `Buffer` assumptions).
- Ship **CD from day one**: `.github/workflows/deploy-worker.yml` deploys on push to `worker/**`. First deploy is a one-time manual `wrangler deploy` + `wrangler secret put`; CD owns every deploy after.
- Deploy **authless** for this change (read-only on a public repo leaks nothing; tested via MCP Inspector). Securing the Claude.ai↔Worker leg (Cloudflare Access) is explicitly deferred but **must land by Change 06**, before write/cart tools are exposed.
- **NOT in scope:** any Kroger tool (including `ready_to_eat_available`, which needs Kroger availability — Change 05), any write tool (Change 06), OAuth / Cloudflare Access (by Change 06), and KV caching.

## Capabilities

### New Capabilities
- `mcp-server`: The Worker MCP runtime — Streamable-HTTP transport via `createMcpHandler`, the authenticated GitHub data-access client, the workerd-safe parsing approach, the structured-error convention, the authless-now/secure-by-Change-06 posture, and deployment (manual bootstrap + `deploy-worker.yml` CD).
- `data-read-tools`: The six repo-data-backed read tools and their contracts — return shapes, `list_recipes` filter semantics, `read_pantry` partial-filter scope, and per-tool error cases. Consumes `_indexes/recipes.json` from the `data-indexing` capability.

### Modified Capabilities
<!-- None. `build-automation` is scoped to validation + index regeneration; the Worker's deploy CD lives with the Worker (mcp-server), not as a modification there. No existing spec's requirements change. -->

## Impact

- **New code:** `worker/` (full TypeScript Worker: MCP handler, GitHub client, tool implementations, parsing helpers), `worker/wrangler.{toml,jsonc}`, `worker/package.json`, `worker/tsconfig.json`, `worker/README.md`.
- **New CI:** `.github/workflows/deploy-worker.yml` (deploys on push to `worker/**`).
- **New dependencies (worker only):** MCP SDK + `createMcpHandler`, `js-yaml`, `smol-toml`. Pinned versions (MCP spec churns).
- **Secrets:** a fine-grained GitHub PAT set via `wrangler secret put` (Cloudflare-side, never in repo); a Cloudflare API token in GitHub Actions secrets for CD. Repo is public — secret hygiene is load-bearing.
- **Prerequisites (not code):** a Cloudflare account, a `workers.dev` subdomain, and the scoped Cloudflare API token.
- **Docs:** `docs/TOOLS.md` already reconciled to these decisions (filter rename, `read_recipe` shape, `read_pantry` `stale_only` deferral); kept in sync going forward.
- **Downstream:** unblocks Change 05 (Kroger tools reuse the GitHub client + error convention), Change 06 (write tools + the same PAT), Change 07 (Claude.ai points at the secured Worker).
