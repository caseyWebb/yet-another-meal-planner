## Context

The Worker has four HTTP surfaces today: the OAuth-gated `/mcp` API, the invite-code `/authorize` consent page, the Kroger `/oauth/*` callback, and the `HEALTH_TOKEN`-gated `/health`. Onboarding/revocation live **outside** the Worker, in `data-onboard.yml` / `data-revoke.yml` (reusable workflows the operator's private data repo calls), which shell out to `wrangler kv key put/delete` and `wrangler d1 execute` and print the minted invite code into the run summary. The invite code (`invite:<code> → username` in `TENANT_KV`, paired with the `tenant:<username>` allowlist entry) is the one thing that surface keeps out of public view, and only because the run executes in a **private** repo.

Cloudflare Access has prior art here: the very first write-enabled deploy (`git-write-tools`) put the **MCP endpoint** behind Access Managed-OAuth, then `multi-tenant-friend-group` replaced that with the Worker's own OAuth provider so friends needn't be in the operator's Access org — which is why `multi-tenancy` now says the Worker "SHALL NOT rely on Cloudflare Access for **MCP-surface** identity." That carve-out is surface-specific: Access is still the right tool for an **operator-only** surface, where there is exactly one identity and no third-party-onboarding constraint.

## Goals / Non-Goals

**Goals**
- Onboard / revoke / rotate / list members from an authenticated operator UI that never writes an invite code to a git-hosted log, removing the last reason the data repo must be private.
- Reuse existing precedents: the `plugin/`-style committed-generated artifact, `src/db.ts` structured-error access, the `merge-wrangler-config.mjs` allowlist, the "emit truthful state, decide policy outside" health philosophy.
- Keep operator setup to web-UI only: one Access app + a couple of non-secret vars.

**Non-Goals**
- **Making the data repo public** — a separate, later change; this only removes the blocker.
- **Moving plugin distribution into the data repo** — the cited downstream benefit, out of scope.
- **Subsuming the recipe site** — the Pages cookbook stays a distinct GitHub Pages surface; the admin app does not host or replace it.
- A general operator console (D1 browsing, log viewing, config editing) — v1 is tenant lifecycle only.

## Decisions

1. **Cloudflare Access gates `/admin*` only; the MCP surface is untouched.** `/admin` is operator-only, so Access's interactive identity policy (email OTP or an IdP) is a clean fit and introduces no per-member Access dependency. The MCP surface keeps its own OAuth provider. *Alternative considered:* a shared `ADMIN_TOKEN` secret mirroring `HEALTH_TOKEN` — lower setup, but a static bearer guarding a mint-invite/purge-data surface, with no identity or MFA; rejected in favor of Access for the higher blast radius.

2. **Verify the Access JWT in the Worker, and turn off `workers.dev`.** Edge enforcement alone leaves the `*.workers.dev` hostname as a bypass of the custom-domain Access app, so the Worker validates `Cf-Access-Jwt-Assertion` (signature against the team JWKS, `aud === ACCESS_AUD`, issuer) on every `/admin*` request, and `wrangler.jsonc` sets `workers_dev: false` (already a merged code-level key) so the Access-protected custom domain is the only route in. Use **`jose`** (Web-Crypto build, workerd-safe, Cloudflare-documented for exactly this) over a hand-rolled RS256 verify — vetted code on a security-critical path. The JWKS is cached **in-isolate** by `jose`'s `createRemoteJWKSet` (one keyset per team domain, re-fetched on an unknown `kid`) — no KV round-trip on the verify path.

3. **Opt-in, fails closed.** When `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` are unset, `/admin*` responds 404 (mirrors the retired `HEALTH_TOKEN` 404-when-unset), so a deploy that hasn't configured Access never exposes an admin surface. When set, a request without a valid audience-matched JWT is 403. A **dev-only bypass** (`ADMIN_DEV_BYPASS=1` in gitignored `.dev.vars`, honored only when the Access vars are absent) lets `wrangler dev` serve the panel locally; it cannot engage once Access is configured.

4. **`/health` stays open and tenant-clean; `HEALTH_TOKEN` is dropped.** The payload is tenant-data-free by construction (counts, timestamps, error classes), so it carries no secret-worthy data. Coarsen the lone exception — `d1.error`'s raw `storage_error` string collapses to the `d1.ok` boolean — and the endpoint is safe to expose unauthenticated. This *removes* management surface (no token, no second Access app, no service-token story for monitors) and matches the Worker's existing "emit truthful state; decide policy outside" stance: **who may read `/health` is an edge decision** (an operator who wants it restricted adds an Access app or WAF rule with zero Worker code). *Alternative considered:* a dedicated `/health` Access app with a service-token policy for automated pollers — more to manage than `HEALTH_TOKEN`, not less; rejected.

5. **Onboard / revoke / rotate move into the Worker, and revoke gets complete.** The handlers use the Worker's own `TENANT_KV` + `DB` bindings (through `src/db.ts`), so onboarding is two KV writes and `connector_url` is just `${new URL(request.url).origin}/mcp` (the Worker is on-host — the workflow's whole host-resolution dance disappears). Revoke now (a) scans `invite:*` and deletes the entries whose value is the member, so the operator needn't paste a code; (b) deletes the per-tenant `kroger:refresh:<id>` token, which `data-revoke.yml` left behind; and (c) purges the per-tenant D1 tables + attributed notes in one `db.batch`. The per-tenant table list is centralized in one constant so a future table can't silently escape the purge. Removing the allowlist entry is what locks the member out — an already-issued OAuth token stops resolving at `resolveTenant` even though it still exists in `OAUTH_KV`.

6. **Elm SPA, committed `admin/dist/`, served via the `assets` binding, same-origin.** Same-origin serving means **no CORS** at all (it only arises cross-origin). Elm compiles via `scripts/build-admin.mjs` (`aubr build:admin`, deterministic + `--check`, like `build-plugin.mjs`) — run on a dev/build box, with the output **committed** to `admin/dist/`, so the data-repo deploy needs no Elm toolchain and just serves static files (the `plugin/` committed-generated precedent). `wrangler.jsonc` gains `assets` (directory `admin/dist`, bound) with `/admin*` routed worker-first so the API reaches the handler and the Access gate runs before any static file; **`assets` is added to the `merge-wrangler-config.mjs` allowlist** or it is silently dropped from operator deploys (the same trap that once shipped the `ai` binding undeployed). The committed minified bundle is non-reviewable in diffs; the authored `admin/src/**` is the source of truth and `build:admin --check` verifies the committed bundle **on the build box** — CI deliberately does **not** run it (Elm's compiler + registry are kept out of the test CI), so a stale bundle is caught at build/deploy time rather than by a test gate; a lightweight Elm-free CI guard (fail if `admin/src` changed without `admin/dist`) is a noted future option. The `.map` is gitignored.

7. **A new `operator-admin` capability; the admin is the 4th no-tenant surface.** It joins `scheduled()` (cron), `email()`, and `/health` as a surface that runs without a per-tenant OAuth session — deliberately cross-tenant (its job is to manage every tenant), gated by Access instead of a tenant token. No determinism-boundary concern: it is plain CRUD, no LLM.

## Risks / Trade-offs

- **[Access app misscoped to the hostname root]** would gate `/mcp` / `/authorize` / `/oauth/*` and break every member's connector — and `multi-tenancy` forbids Access on the MCP surface. **Mitigation:** the Worker only *requires* Access on `/admin*` (a stray JWT elsewhere is ignored), so a misscope fails toward "Access blocks too much" (loud, operator-visible) rather than silently trusting Access on `/mcp`; `SELF_HOSTING` documents the path scope explicitly.
- **[Committed minified Elm blob]** is opaque in review. **Mitigation:** authored source in `admin/src/**` is the reviewable truth; `build:admin --check` verifies the bundle on the build box (Elm-in-CI was declined, so the test CI does not run it); treat `admin/dist/` like `plugin/` (never hand-edited). A future Elm-free CI guard (fail if `admin/src` changed without `admin/dist`) can close the drift window if it ever bites.
- **[`assets` dropped from operator deploys]** if the merge allowlist isn't updated — the documented silent-drop trap. **Mitigation:** allowlist `assets` + a `merge-wrangler-config` test asserting it survives the merge.
- **[Cutover ordering]** — deleting the onboard/revoke Actions before the panel is live and Access is configured would leave no way to onboard. **Mitigation:** sequence the Actions removal **last**, after the panel is deployed and verified end-to-end.
- **[JWT verification edge cases]** (clock skew, JWKS rotation). **Mitigation:** small leeway, short-TTL JWKS cache with re-fetch on unknown `kid`, fail closed on any verification error.
- **[Open `/health` anonymous load]** — the `SELECT 1` probe runs per hit. **Mitigation:** trivial query under the free-tier caps; an operator who cares restricts at the edge (WAF/Access) without Worker code.

## Migration Plan

Additive until the final step, sequenced so onboarding is never unavailable:

1. Ship the Worker (`/admin` + `requireAccess`, `/health` opened, `HEALTH_TOKEN` removed) and the committed Elm bundle; deploy.
2. Operator creates the `/admin*` Access app (identity policy), sets `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD`, sets `workers_dev:false`, redeploys.
3. Operator verifies onboard / rotate / revoke / list through `/admin` end-to-end, and confirms `/health` still answers.
4. **Then** remove the onboard/revoke reusable workflows (code repo) and the `onboard.yml` / `revoke.yml` callers (data repo + template).
5. Drop the `HEALTH_TOKEN` secret from the deployed Worker (no longer read).

Before any *future* change makes the data repo public: rotate every invite code that ever appeared in an Actions run summary (now the panel's rotate op), and optionally delete the historical onboard workflow runs.

## Open Questions

- **`jose` vs hand-rolled RS256.** Leaning `jose` for a security-critical verify; revisit only if dependency footprint is a concern on `workerd`.
- **Exact `assets` routing key** to keep `/admin/api/*` on the Worker (`run_worker_first` glob vs `not_found_handling`) — confirm against the deployed wrangler version during apply.
- **In-Worker email-claim allowlist** as defense-in-depth beyond the Access policy — deferred; the Access policy is the allowlist for v1, with the verified `email` claim available for audit logging if wanted.
