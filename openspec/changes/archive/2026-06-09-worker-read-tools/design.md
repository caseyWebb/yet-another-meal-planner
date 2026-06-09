## Context

The grocery agent is flat files in git plus glue. This change builds the first piece of glue: a Cloudflare Worker hosting a custom MCP server. Per PROJECT.md, the Worker is the "locus of determinism" — coarse, opinionated tools that read the repo and return structured JSON, with no LLM in the loop on the server side.

Current state: Changes 01–03 produced the repo skeleton, the index-build Action, and a 63-recipe corpus. `_indexes/recipes.json` exists and is slug-keyed; `pantry.toml` / `preferences.toml` are presently mostly comments; `taste.md` / `diet_principles.md` are stubs. The repo is **public** (decided during exploration), which collapses the read-side auth story.

Constraints:
- Workers run on `workerd`, not Node — library choices must avoid Node-only APIs (`Buffer`, `fs`).
- The MCP spec and SDK churn; versions must be pinned.
- Single user, personal scale (a handful of reads per session), 5,000 req/hr authenticated GitHub budget.
- This change is read-only; it must not introduce any write or external-service surface.

## Goals / Non-Goals

**Goals:**
- A deployed Worker serving an MCP endpoint over Streamable HTTP, invocable from MCP Inspector.
- Six repo-data read tools returning structured JSON with well-defined filter semantics and error cases.
- A reusable GitHub data-access client (auth, retry, structured errors) that Changes 05/06 build on.
- A reusable structured-error convention inherited by every later tool.
- CD: a push to `worker/**` redeploys the Worker.

**Non-Goals:**
- Any Kroger tool, including `ready_to_eat_available` (Change 05).
- Any write tool or git-commit path (Change 06).
- OAuth / Cloudflare Access securing the Claude.ai↔Worker leg (must land by Change 06; not built here).
- KV caching, Durable Objects, per-session state.
- Computing pantry staleness (needs `ingredients.toml`, Change 12).

## Decisions

### D1 — Transport: `createMcpHandler()` over Streamable HTTP

The Cloudflare Agents SDK offers three paths: `createMcpHandler()` (stateless, no Durable Objects), `McpAgent` (per-session state via Durable Objects), and a raw `StreamableHTTPServerTransport`. The six read tools are pure functions of repo state with no session memory, so `createMcpHandler()` is the fit — least code, no Durable-Objects free-tier question. SSE is deprecated in favor of Streamable HTTP. *Alternative considered:* `McpAgent` — rejected as overkill; we'd carry Durable Objects for state we don't have.

*Verified at build time:* `createMcpHandler` is exported from `agents/mcp` (`agents@0.15.x`) with signature `(server: McpServer, options?) => (request, env, ctx) => Promise<Response>`, default route `/mcp`. The `agents` SDK's own internals (`mimetext`, `node:diagnostics_channel` in its observability/email surface) require the **`nodejs_compat`** compatibility flag — so the Worker enables it. This does not contradict D3: our parsing code stays workerd-native; the flag is for the SDK, not our libraries.

### D2 — GitHub access: one authenticated client, PAT as Worker secret

A single GitHub client wrapper handles all repo reads, reused by Changes 05/06. It authenticates with a fine-grained PAT (scoped to this repo, `contents:read+write` so Change 06 reuses it) set via `wrangler secret put GITHUB_TOKEN`. *Why authenticated even though the repo is public:* unauthenticated GitHub is 60 req/hr (and `raw.githubusercontent.com` is anon-rate-limited); authenticated is 5,000/hr; and writes (Change 06) need a token regardless, so reads piggyback. `list_recipes` reads `_indexes/recipes.json` in one call and filters in-worker; the other tools read flat files at `main` HEAD. *Alternatives considered:* tokenless reads (viable now that the repo is public, rejected — 60/hr is fragile and we build the wrapper anyway); GitHub App (better rate limits, rejected as heavier than a single-user PAT needs); KV cache (deferred — add only if latency is felt).

### D3 — Parsing: `js-yaml` + manual frontmatter split, `smol-toml`; no `gray-matter`

`gray-matter` assumes Node `Buffer` and is risky on `workerd`. Instead: split recipe frontmatter on the leading `---` fence by hand and parse the YAML block with `js-yaml` (pure JS, workerd-safe); parse TOML with `smol-toml` (already a repo dependency). This keeps the Worker's dependency surface thin and runtime-portable. *Alternative considered:* `gray-matter` with `nodejs_compat` — rejected to avoid a compat shim for a few lines of glue.

### D4 — Structured errors, never throws

Every tool returns a structured result the agent can reason over — `{ error: "<code>", message: "<human-readable>", ...context }` — rather than throwing or surfacing a raw 5xx. Enumerated codes for this change: `not_found` (unknown recipe slug), `index_unavailable` (missing/malformed `_indexes/recipes.json`), `upstream_unavailable` (GitHub unreachable or rate-limited), `malformed_data` (TOML/frontmatter fails to parse), `unsupported` (a filter not implementable yet, e.g. `stale_only`). This convention is set here and inherited by all later tools. *Why:* the LLM orchestrates tools; a structured error lets it explain or recover, where a thrown 500 just dead-ends the conversation.

### D5 — `list_recipes` filter semantics

- Array filters (`tags`, `dietary`, `season`) match **ALL** listed values (AND / narrowing). Easy to widen to OR later if it proves annoying; this is an agent-facing API, and multiple calls trivially express OR.
- `status` defaults to `active`; `status: "all"` opts out of status filtering. (`draft`, `rejected`, `archived` selectable explicitly.)
- `exclude_cooked_within_days` is a caller-supplied numeric param — not a hardcoded window, not a `preferences.toml` lookup. The caller owns the window.
- `not_cooked_since` (date) **passes** recipes with `last_cooked: null` — never-cooked ⊃ not-cooked-since-X (infinity).

### D6 — `read_pantry` partial scope; defer `stale_only`

`category` and `prepared_only` are deterministic from pantry data and ship now. `stale_only` requires shelf-life thresholds from `ingredients.toml`, which doesn't exist until Change 12, so it returns `{ error: "unsupported", message: "..." }` rather than guessing. Same deferral shape as moving `ready_to_eat_available` to Change 05 — a filter that depends on later data is honestly unsupported, not silently wrong.

### D7 — Deploy authless now; CD from day one

Deploy authless for this change: read-only tools over public data leak nothing, and MCP Inspector connects to authless servers. CD ships immediately via `.github/workflows/deploy-worker.yml` triggered on push to `worker/**`, using a Cloudflare API token stored in GitHub Actions secrets. The Worker's own secrets (PAT now, Kroger tokens later) are set once via `wrangler secret put` straight to Cloudflare and persist across deploys — they are never in the repo or in Actions. The first deploy is a manual `wrangler deploy` (to create the Worker and set the secret); CD owns every deploy after. *Why CD now:* explicit user requirement; deferring it means hand-deploying through Changes 05–06 where it matters more.

## Risks / Trade-offs

- **Authless Worker is publicly callable** → Acceptable only while read-only over a public repo (nothing to steal, no quota to burn). Mitigation: the spec and roadmap both hard-gate Cloudflare Access to land **by Change 06**, before any write/cart tool is exposed; this change adds no such tool.
- **MCP SDK / spec churn breaks the transport** → Pin SDK and `createMcpHandler` versions in `worker/package.json`; the Worker is small enough to adapt cheaply if a breaking change lands.
- **Index lags source after a future write** → `list_recipes` trusts `_indexes/recipes.json` (regenerated by CI), so a recipe added but not yet re-indexed lists late, though `read_recipe(slug)` reads it directly. Out of scope for read-only Change 04; noted as a known seam for Change 06.
- **`js-yaml` / hand-split frontmatter mis-parses an odd recipe** → Surfaced as a `malformed_data` structured error, not a crash; the corpus already passes the build-indexes validator, so well-formed input is the norm.
- **Public repo leaks low-sensitivity personal data** (eating habits, `preferred_location` geography) → Accepted by the user; secret hygiene (D2/D7) keeps the genuinely sensitive material out of the repo.

## Migration Plan

1. Provision prerequisites (one-time, walked through interactively): Cloudflare account, `workers.dev` subdomain, scoped Cloudflare API token → GitHub Actions secret.
2. Scaffold `worker/`, implement the GitHub client, the six tools, parsing, and the MCP handler.
3. First deploy by hand: `wrangler deploy`, then `wrangler secret put GITHUB_TOKEN`.
4. Add `deploy-worker.yml`; confirm a push to `worker/**` redeploys.
5. Smoke-test via MCP Inspector: `list_recipes({ status: "active" })` returns the corpus.

Rollback: the Worker is stateless and read-only; reverting the `worker/**` change and redeploying (or rolling back via Wrangler) fully restores prior state. No data migration, nothing to undo in the repo.

## Open Questions

- Exact Cloudflare API token scope for CD (Workers Scripts: Edit, plus account/zone scoping) — resolved during the interactive prerequisite walkthrough.
- Final `wrangler` config flavor (`wrangler.toml` vs `wrangler.jsonc`) — cosmetic; pick at scaffold time.
