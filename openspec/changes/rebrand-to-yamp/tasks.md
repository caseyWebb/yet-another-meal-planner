# Tasks

Groups 1–7 are repo work (reversible on the branch). Groups 8–11 are the operator's off-repo console actions (GitHub / Cloudflare / Claude.ai / Kroger), ordered so the irreversible cutover is last. Rename by explicit target only — never a bulk find-replace on the bare word "grocer" (it would corrupt the `grocery_list` domain surface and the `/cookbook` feature, which stay).

## 1. Worker config + code brand identifiers (code repo)

- [ ] 1.1 `packages/worker/wrangler.jsonc`: Worker `name` `grocery-mcp` → `yamp`; D1 `database_name` `grocery-mcp` → `yamp`; R2 `bucket_name` `grocery-corpus` → `yamp-corpus`; AE `dataset` `grocery_usage`/`grocery_tool` → `yamp_usage`/`yamp_tool`. Leave binding names (`DB`, `CORPUS`, `*_KV`, `USAGE_AE`/`TOOL_AE`) unchanged.
- [ ] 1.2 AE dataset names hardcoded in SQL/code: `src/usage.ts` (`FROM grocery_usage`, `FROM grocery_tool`), `src/health.ts`, `src/env.ts`, `src/tool-instrumentation.ts` → `yamp_usage`/`yamp_tool`, in lockstep with 1.1.
- [ ] 1.3 `src/tools.ts`: MCP server `name` `grocery-mcp` → `yamp`.
- [ ] 1.4 Worker-rendered brand strings: `src/health.ts` badge SVG + failure-push title, `src/source.ts` `/source` page literal `grocery-mcp` → `yamp`; `src/source.ts` `UPSTREAM_SOURCE_URL` → `https://github.com/caseyWebb/yet-another-meal-planner`.
- [ ] 1.5 Repo-root `.mcp.json`: dev server key `grocery-mcp` → `yamp`; URL host → `yamp.cooking` (or keep the dev/local value if this file is dev-only — confirm against how it's used).

## 2. Plugin / persona / skill identity (code repo)

- [ ] 2.1 `scripts/build-plugin.mjs`: `PLUGIN_NAME` `grocery-agent` → `yamp`; `PLUGIN_DESCRIPTION` + `LIBRARY_DESCRIPTION` rebranded; library-skill tier naming `grocery-<tier>` → `yamp-<tier>`; `MCP_URL_PLACEHOLDER` → a `yamp` placeholder; emitted `.mcp.json` server key `grocery-mcp` → `yamp`.
- [ ] 2.2 `AGENT_INSTRUCTIONS.md`: title + persona voice ("your grocery agent" → yamp); persona-tier ids `grocery-core`/`grocery-cart`/`grocery-corpus`/`grocery-discovery` → `yamp-*`; brand-bearing workflow skills `report-grocery-agent-bug` → `report-yamp-bug`, `configure-grocery-profile` → `configure-yamp-profile`. Keep the activity/domain skill `shop-groceries` and all `grocery_list` tool references unchanged.

## 3. npm workspace names (code repo)

- [ ] 3.1 Root `package.json`: `name` `groceries-agent` → `yamp`; description; the `aube --filter @grocery-agent/*` script targets → `@yamp/*`.
- [ ] 3.2 `@grocery-agent/*` → `@yamp/*` across all `packages/*/package.json` names, `workspace:*` deps, imports, and oxlint configs.
- [ ] 3.3 Satellite `bin` `grocery-satellite` → `yamp-satellite`; update `packages/satellite/src/cli.ts` references and `docker-compose.example.yml` image name.

## 4. Apps brand (code repo)

- [ ] 4.1 Member app: `packages/app/index.html` `<title>`; `packages/app/vite.config.ts` PWA manifest `name`/`short_name`/`description`; header/brand labels in `src/routes/_app.tsx`, `login.tsx`, `_app.index.tsx` — `Cookbook` → yamp. Keep the `/cookbook` route and cookbook-search feature names.
- [ ] 4.2 Admin app: `packages/admin-app/index.html` `<title>`; `src/routes/__root.tsx` `document.title` + `<h1>` `grocery-agent admin` → `yamp admin`.
- [ ] 4.3 (Optional churn) localStorage keys `ga-theme` (admin `shell.tsx` + `index.html` inline read) and the `cookbook:*` prefix (member app) → yamp-namespaced. Resets stored theme/local state (fine for a single operator); update the login spec pin if the `cookbook:*` prefix changes.

## 5. Docs + spec prose + test pins (code repo)

- [ ] 5.1 Living docs rebranded to current state (no "used to"/"now"): `README.md` title + product description, `CONTRIBUTING.md`, root `CLAUDE.md`, `packages/worker/src/admin/CLAUDE.md`, `docs/*` (`ARCHITECTURE.md`, `TOOLS.md`, `SCHEMAS.md`, `SELF_HOSTING.md`, `authoring-store-adapters.md`, ADRs, spikes), and `.claude/agents`/`.claude/skills` docs.
- [ ] 5.2 Living-spec Purpose prose (not covered by requirement deltas) for the four modified specs: `mcp-server` is unaffected; update `claude-ai-connector` Purpose (`grocery-mcp` → `yamp`), `agent-bug-reporting` Purpose (`report-grocery-agent-bug` → `report-yamp-bug`), `agent-plugin-distribution` Purpose (still `TBD` — set it), and `repo-structure` Purpose (`grocery-agent system` → yamp; repo names).
- [ ] 5.3 Update test pins that assert the old names: `packages/worker/tests/merge-wrangler-config.test.mjs` (`grocery-mcp`, `database_name`), `packages/worker/tests/build-plugin.test.mjs` (`grocery-agent`, `grocery-mcp`, connector URL), `packages/satellite/tests/stamp-readme-badge.test.mjs` (placeholder hosts). Do NOT touch `openspec/changes/archive/**` (immutable history).

## 6. Deployment repos brand (yet-another-meal-planner-deployment + -template)

- [ ] 6.1 `yet-another-meal-planner-deployment`: `README.md` title + install commands (`/plugin marketplace add caseyWebb/yet-another-meal-planner-deployment` → `/plugin install yamp@yamp`) + doc deep-links; `wrangler.jsonc` header comment + resource names (Worker/D1 `grocery-mcp` → `yamp`, keeping the live `database_id` and KV ids); `.claude-plugin/marketplace.json` `name` `groceries-agent-data` → `yamp`, plugin `name` `grocery-agent` → `yamp`, `source` `./plugin/grocery-agent` → `./plugin/yamp`, description.
- [ ] 6.2 `yet-another-meal-planner-deployment-template`: `README.md`, `wrangler.jsonc` default resource names, `.claude-plugin/marketplace.json` (`name`/plugin `name`/`source`), `docs/SCRAPER.md` (doc links + GHCR image refs `ghcr.io/caseywebb/groceries-agent/scraper` → the new repo namespace).

## 7. Cross-repo CI wiring

- [ ] 7.1 Code repo `ci.yml`: deploy-dispatch target `--repo caseyWebb/groceries-agent-data` → `caseyWebb/yet-another-meal-planner-deployment`; any `caseyWebb/groceries-agent` self-references.
- [ ] 7.2 Code repo `.github/workflows/data-deploy.yml`: `repository: caseyWebb/groceries-agent` checkout ref → `caseyWebb/yet-another-meal-planner`; `.github/workflows/cla.yml` CLA doc URL.
- [ ] 7.3 Both deployment repos' `deploy.yml`: `uses: caseyWebb/groceries-agent/.github/workflows/data-deploy.yml@main` → `caseyWebb/yet-another-meal-planner/...@main` (explicitly, not via GitHub's rename redirect).

## 8. Verify (repo-side, before any cutover)

- [ ] 8.1 `aubr typecheck`, `aubr test`, `aubr test:tooling` all green (in a web session: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` for the Playwright suites).
- [ ] 8.2 `openspec validate "rebrand-to-yamp" --strict` passes; `aubr build:plugin --check` validates the rebranded source.
- [ ] 8.3 Targeted residual-brand sweep: no `grocery-mcp`/`grocery-agent`/`groceries-agent`/`@grocery-agent` outside `openspec/changes/archive/**`; confirm the `grocery_list` table/tools, `/api/grocery`, `useGrocery*`, the "Groceries" nav, `shop-groceries`, and `/cookbook` are intact (domain vocabulary, deliberately unchanged).

## 9. GitHub repo renames (operator action)

- [ ] 9.1 Rename `caseyWebb/groceries-agent` → `caseyWebb/yet-another-meal-planner`, `groceries-agent-data` → `yet-another-meal-planner-deployment`, `groceries-agent-data-template` → `yet-another-meal-planner-deployment-template`.
- [ ] 9.2 Update local git remotes to the new URLs; confirm the deployment repos' `deploy.yml` `uses:` refs (task 7.3) resolve to the renamed code repo.

## 10. Cloudflare + external re-registration (operator action)

- [ ] 10.1 Add the `yamp.cooking` custom-domain route to the (renamed) Worker; set the `WORKER_HOST` Actions var → `yamp.cooking`.
- [ ] 10.2 Re-`put` every Worker secret on the new `yamp` Worker (secrets do not follow a rename).
- [ ] 10.3 Re-register the Kroger OAuth redirect URI (`https://yamp.cooking/oauth/callback`) and update the Cloudflare Access bypass app on `/oauth/*` to the new host.

## 11. Data migration + deploy cutover (operator action, last)

- [ ] 11.1 `rclone` the authored corpus `grocery-corpus` → `yamp-corpus` (R2 S3-compatible); let the reconcile cron re-project the `recipes` index into the new D1 `yamp` (no manual recipe migration).
- [ ] 11.2 `export`/`import` only the non-derived operational D1 tables (profiles, sessions, cooking log, `grocery_list`, staples, stockup, favorites/rejects, notes, aliases, sku_cache, stores, feeds, discovery inbox, bug_reports) into `yamp`.
- [ ] 11.3 Deploy (re-bakes the published `.mcp.json` connector URL to `https://yamp.cooking/mcp`); re-add the connector in Claude.ai and set its display name to yamp.
- [ ] 11.4 Verify end-to-end (connect, a read, an authorized write); then delete the old `grocery-mcp` Worker, D1, R2 bucket, and AE datasets. (AE history does not carry over — expected.)
