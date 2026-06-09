## 1. Prerequisites (interactive, one-time)

- [x] 1.1 Confirm/create a Cloudflare account and claim a `workers.dev` subdomain (`caseywebb.workers.dev`)
- [x] 1.2 Create a scoped Cloudflare API token (Workers Scripts: Edit) and add it to GitHub Actions secrets as `CLOUDFLARE_API_TOKEN`
- [x] 1.3 Create a fine-grained GitHub PAT scoped to this repo with `contents:read+write` (write scope reserved for Change 06)

## 2. Worker scaffold

- [x] 2.1 Scaffold `worker/` with its own `package.json`, `tsconfig.json`, and `wrangler` config, separate from the root index-build tooling
- [x] 2.2 Add pinned dependencies: MCP SDK + `createMcpHandler`, `js-yaml`, `smol-toml`
- [x] 2.3 Wire the MCP server over Streamable HTTP via `createMcpHandler()` (stateless, no Durable Objects); register an empty tool set that lists over MCP

## 3. GitHub data-access client

- [x] 3.1 Implement the authenticated GitHub client wrapper (PAT from `env`, reads `main` HEAD)
- [x] 3.2 Add retry/backoff on transient failures and rate-limit responses; map exhausted failures to a structured `upstream_unavailable` error
- [x] 3.3 Add helpers: fetch `_indexes/recipes.json`, fetch a single repo file by path

## 4. Parsing + error conventions

- [x] 4.1 Implement workerd-safe frontmatter parsing: split on the `---` fence, parse YAML with `js-yaml`; no `gray-matter`
- [x] 4.2 Implement TOML parsing via `smol-toml`; map parse failures to structured `malformed_data`
- [x] 4.3 Define the shared structured-error helper and the enumerated codes (`not_found`, `index_unavailable`, `upstream_unavailable`, `malformed_data`, `unsupported`)

## 5. Read tools

- [x] 5.1 `list_recipes(filters)` — read the index, apply filter semantics (AND arrays, `status` default `active` / `"all"` opt-out, `exclude_cooked_within_days`, null-`last_cooked` passes `not_cooked_since`); `index_unavailable` on bad index
- [x] 5.2 `read_recipe(slug)` — return `{ slug, frontmatter, body }` (no `last_modified`); `not_found` on unknown slug
- [x] 5.3 `read_pantry(filter)` — support `category` and `prepared_only`; return `unsupported` for `stale_only`; empty `pantry.toml` yields `{ items: [] }`
- [x] 5.4 `read_preferences()` — return parsed `preferences.toml`
- [x] 5.5 `read_taste()` and `read_diet_principles()` — return raw markdown
- [x] 5.6 Register all six tools with input schemas on the MCP server

## 6. Tests

- [x] 6.1 Unit-test `list_recipes` filter semantics (AND arrays, status default/opt-out, window exclusion, never-cooked passes)
- [x] 6.2 Unit-test error cases (`not_found`, `index_unavailable`, `unsupported`, `malformed_data`) and empty-data resilience
- [x] 6.3 Unit-test parsing helpers against a fixture recipe and a comments-only TOML file

## 7. Deploy + CD

- [x] 7.1 First manual deploy: `wrangler deploy` (→ https://grocery-mcp.caseywebb.workers.dev), then `wrangler secret put GITHUB_TOKEN`
- [x] 7.2 Add `.github/workflows/deploy-worker.yml` triggering on push to `worker/**`, deploying with `CLOUDFLARE_API_TOKEN`
- [x] 7.3 Verify a push to `worker/**` redeploys via CD (run 27186569653: ci → typecheck → test → deploy, all green; worker live after redeploy)
- [x] 7.4 Confirm `.gitignore` covers `.dev.vars` and `.wrangler/`; document any gitignored-but-needed dev files in `worker/README.md`

## 8. Smoke test + docs

- [x] 8.1 Connect an MCP client to the deployed Worker; confirmed `list_recipes({ status: "active" })` returns the corpus (63 recipes)
- [x] 8.2 Exercised all six tools live + both error paths (`not_found`, `unsupported`); AND filter semantics and empty-pantry resilience confirmed
- [x] 8.3 Write `worker/README.md`: local dev (`wrangler dev` + Inspector + `.dev.vars`), the one-time manual deploy/secret setup, CD behavior, and `wrangler tail` for observability

## Verified

Local:
- `npm run typecheck` — clean (strict TS)
- `npm test` — 20/20 passing (filtering, parsing, error helpers)
- `npx wrangler deploy --dry-run` — bundles for workerd (393 KB gzip) with `nodejs_compat`

Live (https://grocery-mcp.caseywebb.workers.dev):
- Health `GET /`, MCP `initialize` (proto 2025-06-18), `tools/list` (all 6 tools, stateless)
- All six tools return correct structured data against the real public repo
- Error paths: `read_recipe(missing)` → `not_found`; `read_pantry(stale_only)` → `unsupported`
- `list_recipes` AND filter + empty-pantry resilience confirmed

Remaining: only 7.3 (CD redeploy), which fires automatically on the first commit+push.
