## Why

The project is being renamed from "grocery-agent" to **Yet Another Meal Planner** ("yamp"), moving to the `yamp.cooking` domain and to new GitHub repositories. The rename is also a chance to erase the current singular/plural inconsistency (`grocery-` for the Worker/D1/plugin vs `groceries-` for the host/repos/marketplace) by settling on one name everywhere: `yamp`.

## What Changes

The rebrand touches every layer, but a hard line is drawn between **brand identifiers** (renamed) and **domain vocabulary** (kept):

- **KEPT — domain vocabulary, not brand.** The `grocery_list` D1 table and its columns, the `*_grocery_list` tools, the `/api/grocery` mount, the `useGrocery*` hooks, the "Groceries" nav label, the `shop-groceries` skill, and the `/cookbook` route + cookbook search feature all stay. A meal planner still produces a grocery list and browses a cookbook. No bulk find-replace on the word "grocer".

- **GitHub repositories** rename:
  - `caseyWebb/groceries-agent` → `caseyWebb/yet-another-meal-planner`
  - `caseyWebb/groceries-agent-data` → `caseyWebb/yet-another-meal-planner-deployment`
  - `caseyWebb/groceries-agent-data-template` → `caseyWebb/yet-another-meal-planner-deployment-template`

- **Domain** moves to `yamp.cooking`, apex-serving everything as today (member app at `/`, admin at `/admin`, connector at `/mcp`). The Worker derives its host at runtime, so this is a route + `WORKER_HOST` var + redeploy, plus off-repo re-registration of the OAuth callback (`https://yamp.cooking/oauth/callback`) with Kroger and the Cloudflare Access bypass.

- **Live Cloudflare resources** are renamed (full clean, single operator): Worker `grocery-mcp` → `yamp`, D1 `grocery-mcp` → `yamp`, R2 `grocery-corpus` → `yamp-corpus`, Analytics Engine datasets `grocery_usage`/`grocery_tool` → `yamp_usage`/`yamp_tool`. **BREAKING** for operational state: new resources are provisioned; the authored corpus is `rclone`-copied to the new bucket and the derived recipe index re-projects itself on the next reconcile, so only the non-derived operational D1 tables are hand-migrated; AE analytics history resets. KV binding names and ids are unchanged (generic, no brand).

- **Plugin / persona / skill identity** renames: plugin id `grocery-agent` → `yamp`, marketplace name `groceries-agent-data` → `yamp`, MCP server name `grocery-mcp` → `yamp`, persona-tier skills `grocery-core`/`grocery-cart`/`grocery-corpus`/`grocery-discovery` → `yamp-core`/`yamp-cart`/`yamp-corpus`/`yamp-discovery`, brand-bearing workflow skills `report-grocery-agent-bug` → `report-yamp-bug` and `configure-grocery-profile` → `configure-yamp-profile`. The persona in `AGENT_INSTRUCTIONS.md` refers to itself as yamp. Onboarding becomes `/plugin marketplace add caseyWebb/yet-another-meal-planner-deployment` → `/plugin install yamp@yamp`.

- **Product/user-facing strings** rename: the member web app brand (title, PWA manifest name/short_name/description, header label) `Cookbook` → yamp; the admin panel title `grocery-agent admin` → yamp admin; the Worker-rendered health badge and `/source` page literal `grocery-mcp` → yamp; the `README.md` title and product description.

- **npm workspace** renames: root package `groceries-agent` → yamp, scope `@grocery-agent/*` → `@yamp/*` across all packages, and the `grocery-satellite` bin. The generic binding vars (`env.DB`, `env.CORPUS`, `*_KV`) are unchanged.

- **Cross-repo CI**: both deployment repos' `deploy.yml` `uses:` references to the code repo are repointed to `caseyWebb/yet-another-meal-planner`; `ci.yml`'s deploy dispatch target and `UPSTREAM_SOURCE_URL` are updated. GitHub's rename redirects cushion but do not replace these edits.

- **Living docs** (`README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `docs/*`, package `CLAUDE.md`, agent/skill docs) are rebranded to describe current state. OpenSpec archives are left untouched (immutable history).

## Capabilities

### New Capabilities
<!-- A rebrand introduces no new capability. -->
None.

### Modified Capabilities
- `repo-structure`: the code/data repository names in the layout contract change to the `yet-another-meal-planner*` repos; the persona-source and generated-bundle references change from `grocery-agent`/`plugin/grocery-agent` to the yamp names; "grocery agent" product references become "yamp".
- `agent-plugin-distribution`: the plugin bundle id (`grocery-agent` → `yamp`), the persona-tier library skill names (`grocery-core`/`grocery-cart`/`grocery-corpus`/`grocery-discovery` → `yamp-*`), the marketplace repo/name (`<operator>/groceries-agent-data` → `<operator>/yet-another-meal-planner-deployment`, marketplace name `yamp`), and the connector name (`grocery-mcp` → `yamp`) change.
- `agent-bug-reporting`: the reporting skill is renamed `report-grocery-agent-bug` → `report-yamp-bug` (the `report_bug` tool and `bug_reports` table are unchanged); the `grocery-core` reference becomes `yamp-core`.
- `claude-ai-connector`: the connectable MCP endpoint / server name changes `grocery-mcp` → `yamp`, and the "Grocery Agent conversation" phrasing becomes "yamp".

## Impact

- **Code**: `packages/worker/wrangler.jsonc` (resource names), `scripts/build-plugin.mjs` (plugin/skill/persona ids), `packages/worker/src/tools.ts` (MCP server name), `usage.ts`/`health.ts`/`env.ts`/`tool-instrumentation.ts` (AE dataset names hardcoded in SQL), `source.ts`/`health.ts` (rendered brand string, `UPSTREAM_SOURCE_URL`), `AGENT_INSTRUCTIONS.md` (persona), all `packages/*/package.json` (npm scope), member/admin app titles + manifest, and the merge/build test pins that assert the old names.
- **Config / infra**: Cloudflare Worker, D1, R2, AE resources; the `yamp.cooking` route and `WORKER_HOST` var; Worker secrets re-`put` on the renamed Worker.
- **External systems**: the Claude.ai custom connector (re-added, display name set there), the Kroger OAuth redirect URI, the Cloudflare Access bypass app on `/oauth/*`, the published plugin's baked `.mcp.json` connector URL.
- **Repos**: the three GitHub repos and every cross-repo `uses:`/dispatch/link reference between them.
- **Docs**: `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `docs/*`, and the four modified spec deltas above. OpenSpec archives are out of scope.
