## Why

The data repo is one secret away from being public, and that secret is the **invite code**. Onboarding mints it through a GitHub Action (`data-onboard.yml`) that prints the code into the run summary; the only thing keeping it private is that the Action runs in the **private** data repo — the workflow header says so outright ("the run + its summary — which carry the invite code — are visible only to the operator"). Invite codes are persistent and reusable — `resolveInvite` never expires them — so a code that ever appeared in a run log is a standing bootstrap into that tenant until rotated.

Everything else an operator keeps in the data repo is non-sensitive: `wrangler.jsonc` holds resource identifiers (KV/D1 ids, `GITHUB_APP_ID`, the host) that are inert without the Cloudflare API token, and that token is an **encrypted Actions secret** a visibility flip does not expose. So the **last** thing tying the data repo to "must be private" is the invite-code path running through Actions logs. Move onboard/revoke/rotate into an authenticated operator surface that never writes a code to a git-hosted log, and the data repo can later go public — unlocking the free-tier Pages cookbook and in-data-repo plugin distribution (both out of scope here, but they are why this matters).

## What Changes

- Add an **operator admin panel**: a static **Elm** SPA served same-origin from the Worker at `/admin`, backed by `/admin/api/*` handlers that perform **onboard / revoke / rotate / list** directly against the Worker's `TENANT_KV` + `DB` bindings. The minted invite code is shown **once** in the authenticated UI and never logged.
- Gate `/admin*` with **Cloudflare Access** (an operator-identity policy). The Worker verifies the injected `Cf-Access-Jwt-Assertion` (signature + audience) as defense-in-depth, sets `workers_dev: false` so the Access-protected custom domain is the only route in, and treats unset Access config as **disabled (404)** — opt-in, fails closed. The gate covers the operator admin surface only; the MCP surface keeps its own OAuth provider, so `multi-tenancy`'s "no Access on the MCP-surface identity" holds.
- **Retire `HEALTH_TOKEN`; leave `/health` open and tenant-clean.** The `/health` payload is tenant-data-free by construction, so it needs no app-level secret — drop `HEALTH_TOKEN` and its in-Worker checks, and coarsen the one data-ish field (`d1.error` raw string → `d1.ok` boolean). Whether to restrict reads becomes a pure-edge operator choice (Cloudflare Access or a WAF rule), needing no Worker code; the ntfy failure push is unchanged.
- Move the revoke purge into the Worker and make it **complete**: delete the allowlist entry, find-and-delete the member's invite(s) by scanning `invite:*` (no pasted code), purge every per-tenant D1 table + attributed notes through `src/db.ts`, and delete the per-tenant `kroger:refresh:<id>` token (today's workflow leaves it).
- **Retire the Actions-based flow:** remove `data-onboard.yml` / `data-revoke.yml` (code repo) and the thin `onboard.yml` / `revoke.yml` callers (data repo + template). Onboarding is now the admin panel.
- Build/serve: an `admin/` Elm source tree + `scripts/build-admin.mjs` (deterministic, `--check`) producing a **committed** `admin/dist/` (the `plugin/`-style committed-generated precedent), served via the Workers `assets` binding. Add `assets` to the `merge-wrangler-config.mjs` allowlist (the silent-drop trap) so it reaches operator deploys.

## Capabilities

### New Capabilities
- `operator-admin`: the Access-gated operator admin surface — the static admin SPA and the in-Worker onboard/revoke/rotate/list operations that replace the onboard/revoke GitHub Actions.

### Modified Capabilities
- `operator-provisioning`: the onboard/revoke **KV-writing workflows are retired**; the allowlist write path is now the in-Worker admin surface, not a GitHub Action.
- `background-job-health`: the `/health` gate is **removed** — `HEALTH_TOKEN` is retired and the endpoint is unauthenticated and tenant-clean by default; restricting reads is an optional edge concern. The ntfy push is unchanged.

## Impact

- **New (code repo):** `src/admin.ts` (handlers + the `requireAccess` JWT verify), `admin/**` (Elm source + `elm.json` + `index.html`), `scripts/build-admin.mjs`, committed `admin/dist/**`, `test/admin.test.ts`.
- **Edited (code repo):** `src/index.ts` (route `/admin*`; open `/health`), `src/env.ts` (drop `HEALTH_TOKEN`; add `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`), `src/health.ts` (drop the token branches; coarsen `d1.error`), `wrangler.jsonc` (`assets`, `workers_dev:false`), `scripts/merge-wrangler-config.mjs` + its test (allowlist `assets`), `package.json` (Elm build dep; `jose` for JWT verify), docs (`ARCHITECTURE.md`, `SELF_HOSTING.md`, the surface inventory).
- **Removed (code repo):** `.github/workflows/data-onboard.yml`, `.github/workflows/data-revoke.yml`.
- **Removed (data repo + template):** `.github/workflows/onboard.yml`, `.github/workflows/revoke.yml`.
- **Operator setup (manual, documented):** one narrowly-scoped Cloudflare Access app on `/admin*` (operator-identity policy) and the `ACCESS_*` vars. **Footgun:** scope it to `/admin*` only, never the hostname root, or Access gates `/mcp` and breaks every member's connector.
- **Migration:** before any later public flip of the data repo, rotate every invite code that appeared in a now-public Actions log (the new rotate op); old workflow runs may also be deleted. Making the repo public itself is a **separate, later** change — this one only removes the blocker.
