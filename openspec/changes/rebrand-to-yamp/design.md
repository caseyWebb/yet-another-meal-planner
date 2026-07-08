## Context

The system is one self-hosted Worker serving a single friend group; there is exactly **one operator** (caseyWebb) and no fleet. That single fact reshapes the rebrand: the migration steps normally framed as "every operator must re-provision and re-add" collapse to a one-time set of console actions the operator performs once.

Current naming is inconsistent: `grocery-` (singular) for the Worker/D1/MCP-server/plugin, `groceries-` (plural) for the production host (`groceries-mcp.caseywebb.xyz`), the repos, and the marketplace. The rename standardizes on `yamp` for all technical short identifiers and the long `yet-another-meal-planner*` form for the GitHub repos.

The critical constraint is separating **brand identifiers** from **domain vocabulary**. A raw case-insensitive `grocer` search hits ~3,145 times across ~616 files, but the large majority are the domain concept "grocery list" — the `grocery_list` D1 table, `*_grocery_list` tools, the `/api/grocery` mount, `useGrocery*` hooks, the "Groceries" nav label, and the `grocery-list` feature spec. Renaming the product does not touch any of that. The brand identifiers are a surgical subset.

## Goals / Non-Goals

**Goals:**
- Rename the product to Yet Another Meal Planner / yamp across every brand surface: repos, domain, plugin/persona/skills, apps, docs, npm scope, and live Cloudflare resources.
- Standardize on `yamp` for all technical short identifiers; erase the singular/plural split.
- Keep the recipe index rebuild self-healing during the D1/R2 migration rather than hand-migrating derived data.
- Keep the four affected specs in lockstep with the renamed identifiers.

**Non-Goals:**
- Renaming domain vocabulary (`grocery_list` and its surface, `/cookbook` route + cookbook search, `shop-groceries`). These describe activities/features, not the brand.
- Rewriting OpenSpec archives (`openspec/changes/archive/**`) — immutable history.
- Changing the operator's Cloudflare account, Access team (`dirtbags.cloudflareaccess.com`), or account id — those are operator identity, unrelated to the brand.
- Renaming the generic Worker binding vars (`env.DB`, `env.CORPUS`, `*_KV`) — they carry no brand and renaming them is pure churn.

## Decisions

**1. Full clean, including live Cloudflare resources — not surface-only.**
The Worker (`grocery-mcp` → `yamp`), D1 (`grocery-mcp` → `yamp`), R2 (`grocery-corpus` → `yamp-corpus`), and AE datasets (`grocery_usage`/`grocery_tool` → `yamp_usage`/`yamp_tool`) are renamed. Alternative considered: keep the resources named `grocery-*` (invisible to users) and only mask the two spots that render the literal name (the health badge, `/source`). Rejected because the single-operator context makes the migration a one-time afternoon task, and leaving the internals mismatched perpetuates exactly the inconsistency the rebrand is meant to erase. Trade-off accepted: AE analytics history resets (datasets can't be renamed/migrated) and the D1/R2 data moves.

**2. Derived data heals itself; only operational tables are hand-migrated.**
The recipe index in D1 is projected by `src/recipe-projection.ts` from the R2 corpus every reconcile tick. So the D1/R2 migration is: `rclone` the authored corpus `grocery-corpus` → `yamp-corpus` (R2 is S3-compatible), let the reconcile re-project the `recipes` table into the new D1, and hand `export`/`import` only the **non-derived** operational tables (profiles, sessions, cooking log, `grocery_list`, staples, stockup, favorites/rejects, notes, aliases, sku_cache, stores, feeds, discovery inbox, bug_reports). This aligns with the repo's "data converges through the pipeline, never through manual surgery" principle — the derived surface rebuilds organically. Alternative: full D1 dump/restore including `recipes`. Rejected as unnecessary and off-principle.

**3. Domain `yamp.cooking`, apex serves everything.**
Matches today's single-Worker model (app at `/`, admin at `/admin`, connector at `/mcp`). The Worker already derives its host from `new URL(request.url).origin`, so no runtime code hardcodes the host — the change is a Cloudflare route + the `WORKER_HOST` Actions var + a redeploy to re-bake the connector URL. Alternative: subdomain split (`app.`/`mcp.`) with a landing page at the apex. Rejected for now — the Worker has no host-aware routing and there's no landing page; a split can come later without blocking the rename.

**4. Member app folds into the yamp brand.**
The member app is currently branded "Cookbook". Its title, PWA manifest (name/short_name/description), and header become yamp. The `/cookbook` route and the cookbook search feature keep their names — in the specs "cookbook" means the recipe collection, not the app. No spec mandates the app display name, so this is implementation-level (vite config, `index.html`, `_app.tsx`, `login.tsx`).

**5. `yamp` for all short technical ids; long form only for repo slugs.**
Worker/D1 `yamp`, R2 `yamp-corpus`, AE `yamp_usage`/`yamp_tool`, npm scope `@yamp/*`, MCP server `yamp`, plugin id `yamp`, marketplace name `yamp`, skill tiers `yamp-*`. Setting the marketplace `name` to `yamp` (independent of the repo slug) keeps the install command short: `/plugin install yamp@yamp`. The repos use the descriptive `yet-another-meal-planner*` form the operator chose.

**6. Brand-bearing skills renamed; activity/domain skills kept.**
`report-grocery-agent-bug` → `report-yamp-bug` and `configure-grocery-profile` → `configure-yamp-profile` (the "grocery" there is the product). `shop-groceries` and the `grocery_list` tool surface stay (the "grocery" there is the activity/feature). This is the judgment line that keeps a rename from corrupting domain meaning.

**7. KV namespaces untouched.**
Their binding names (`KROGER_KV`, `TENANT_KV`, `OAUTH_KV`) are generic and `OAUTH_KV` is required by the OAuth library; their ids map to live data. No brand appears in the parts the repo controls, so they are left as-is.

## Risks / Trade-offs

- **Renaming the code repo breaks cross-repo CI** → Both deployment repos' `deploy.yml` do `uses: caseyWebb/groceries-agent/...@main`; `ci.yml` dispatches `deploy.yml` to the data repo. GitHub 301-redirects a renamed repo, but repoint every `uses:`/dispatch/`UPSTREAM_SOURCE_URL` reference explicitly rather than relying on redirects.
- **The connector URL is baked into the published plugin** (`plugin/grocery-agent/.mcp.json` → `https://groceries-mcp.caseywebb.xyz/mcp`) → After the domain + resource rename, redeploy re-bakes `.mcp.json` with `https://yamp.cooking/mcp`; the operator re-adds the connector in Claude.ai. Because there is one user, no coordinated fleet update is needed; the old host can stop serving once the connector is re-added.
- **Renaming the Worker creates a new script** → Secrets set via `wrangler secret put` do not follow; re-`put` every secret on `yamp`, attach the `yamp.cooking` route to it, then delete the old `grocery-mcp` Worker. This is the fiddliest single step.
- **AE analytics history resets** → New datasets start empty; the admin Usage panels show no history until data re-accumulates. Accepted as the cost of consistency.
- **Test pins assert the old names** → `merge-wrangler-config.test.mjs`, `build-plugin.test.mjs`, and `stamp-readme-badge.test.mjs` assert `grocery-mcp`/`grocery-agent`; they must be updated in the same pass or CI fails.
- **Accidental domain-vocabulary rename** → A careless sweep on "grocer" would corrupt the `grocery_list` table/tools and the `/cookbook` feature. Mitigation: rename by explicit target list (the brand subset), never by bulk replace on the bare word.

## Migration Plan

Ordered so the repo work lands first (all reversible on the branch) and the irreversible console actions come last:

1. **Repo/code/docs/config rebrand** on `claude/yamp-rebrand-migration-1jta36` across all three repos: package names + `@yamp/*` scope, `wrangler.jsonc` resource names, `build-plugin.mjs` + `AGENT_INSTRUCTIONS.md` (plugin/persona/skill ids), AE dataset names in `usage.ts`/`health.ts`/`env.ts`/`tool-instrumentation.ts`, rendered brand strings + `UPSTREAM_SOURCE_URL`, app/admin titles + manifest, marketplace name, the four spec deltas, living docs, and the test pins. Verify with `aubr typecheck` + `aubr test` + `aubr test:tooling`.
2. **Rename the three GitHub repos** to the `yet-another-meal-planner*` names.
3. **Repoint cross-repo references**: both deployment repos' `deploy.yml` `uses:`, `ci.yml`'s dispatch target, and any doc/link references — explicitly, not via redirect.
4. **Cloudflare / external console actions**: provision the `yamp.cooking` route, set `WORKER_HOST` var, re-`put` Worker secrets on the new `yamp` Worker, re-register the Kroger OAuth redirect URI (`https://yamp.cooking/oauth/callback`) and the Access bypass on `/oauth/*`.
5. **Data migration**: `rclone` corpus `grocery-corpus` → `yamp-corpus`; let the reconcile re-project the recipe index into the new D1 `yamp`; `export`/`import` the non-derived operational tables.
6. **Deploy and cut over**: deploy (re-bakes `.mcp.json` to `https://yamp.cooking/mcp`), re-add the connector in Claude.ai (set its display name to yamp), verify end-to-end, then delete the old `grocery-mcp` Worker and old resources.

**Rollback:** steps 1–3 are git-reversible. Before step 5, the old D1/R2/Worker still hold live data and the old connector still works — cutover is not committed until step 6 deletes the old resources, so aborting between 4 and 6 leaves the old deployment fully functional.

## Open Questions

- Should the newsletter-discovery email address (`groceries-agent@caseywebb.xyz`, configurable at runtime) move to a `yamp.cooking` address, or stay on `caseywebb.xyz`? Not blocking — it's operator infra, not a spec requirement.
- Does the operator want the old `groceries-mcp.caseywebb.xyz` host to redirect to `yamp.cooking` for a grace period, or hard-cut? Single user, so a hard cut is viable.
