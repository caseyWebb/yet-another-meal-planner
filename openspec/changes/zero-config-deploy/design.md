## Context

The operator's deploy runs as a thin caller of the reusable `data-deploy.yml`, which checks out the operator's data repo (for `wrangler.jsonc`) + the code repo (for the Worker source), overlays the config, and `wrangler deploy`s with `CLOUDFLARE_API_TOKEN`. `data-onboard.yml`/`data-revoke.yml` are KV-only and address `TENANT_KV` by a separately-configured `tenant_kv_id`. The Worker reads `GITHUB_INSTALLATION_ID`, `DATA_OWNER/REPO/REF`, and the App key + Kroger creds from its env/secrets. We're on wrangler 4.99, which auto-provisions KV/R2/D1 from id-less bindings (≥4.45, [changelog](https://developers.cloudflare.com/changelog/post/2025-10-24-automatic-resource-provisioning/)).

## Goals / Non-Goals

**Goals**
- Shrink the operator's hand-edited config from ~9 values to ~1, and remove the manual KV-creation + dashboard-secrets steps — **web-UI only, no file editing** for a new operator.
- Keep the no-fork, private-control-plane, single-Actions-secret posture unchanged.
- Preserve the App private key's defense-in-depth (never in a repo).

**Non-Goals**
- Literal 1-click (Cloudflare/Kroger/GitHub-App registrations are irreducible).
- The GitHub App manifest flow, the Kroger redirect chicken-egg, the Deploy-to-Cloudflare button — explicitly out of scope.
- Migrating the operator's *already-running* instance to auto-provisioned KV (it keeps explicit ids).

## Decisions

1. **KV via native wrangler auto-provision, not the Deploy button.** The template `wrangler.jsonc` declares KV bindings with no `id`; `wrangler deploy` creates+binds them. The button would force a public fork-with-source and Workers Builds — reintroducing the fork we designed away to get a feature we already have. *Alternative considered:* a bootstrap workflow that `wrangler kv namespace create`s + patches config — strictly more code than letting deploy do it.

2. **Intuit `DATA_OWNER/REPO` at deploy from `github.repository`; inject as `--var`.** The Worker needs them at runtime (no Actions context), so deploy-time injection is the only place that knows them *and* can bake them in. `DATA_REF` defaults to `main`. *Alternative:* keep them in `wrangler.jsonc` — but they're literally the repo the workflow runs in, so hand-setting them is pure redundancy.

3. **Resolve the installation id at runtime, cache in KV.** The Worker already holds the App key, so it can `GET /app/installations` (App JWT) and pick the installation covering the data repo, caching the id. Removes `GITHUB_INSTALLATION_ID` from config. *Alternative:* keep it configured — but it's derivable from credentials the Worker already has.

4. **Onboard/revoke address KV by `--binding`, not by id.** They check out the data repo (where `wrangler.jsonc` lives) and run `wrangler kv key put --binding TENANT_KV`. This is *required* once ids are auto-provisioned (no stable id for a var) and makes `wrangler.jsonc` the single source of truth. *Cost:* they gain a checkout (they were deliberately checkout-free) — acceptable, since the config they need is in the very repo they run in.

5. **App key stays a manual Cloudflare worker secret; Kroger creds automated.** Per the secret-posture analysis: the deploy token already transitively grants the App key (deploy malicious code → read runtime secret), so the key's "never in a repo" rule is *defense-in-depth* (forces a noisy active deploy, not a passive read). Pushing it through GitHub trades that layer for one saved click; Secrets Store gives equivalent deploy-exposure (the binding is still `.get()`-able by deployed code) while adding a `src/` sync→async refactor and a `store_id`. So the App key stays manual (one CF dashboard screen — still web-UI). The Kroger creds are low blast radius (shared public-tier app, no PII) → push via `wrangler-action` `secrets:`.

6. **The operator's own running instance keeps explicit KV ids.** Stripping ids only applies to the *template* a new operator starts from. Casey's live namespaces hold real data; auto-provision creates *new* worker-name-prefixed namespaces, so it would silently orphan the existing data. His prod `wrangler.jsonc` stays pinned; the zero-config path is for fresh setups.

## Risks / Trade-offs

- **[Auto-provision not idempotent across redeploys]** → the gating spike (task 1). If the 2nd deploy with id-less bindings creates a *duplicate* namespace instead of reusing the same-named one, fresh operators would lose KV state on every deploy. **Mitigation:** if non-idempotent, the deploy commits the id-injected `wrangler.jsonc` back to the data repo (`contents:write`) after first deploy, so subsequent deploys pin the id. (`data-deploy.yml`'s overlay writes ids to the throwaway `_code/wrangler.jsonc` — the write-back must target the operator's repo copy.)
- **[`--binding` needs `wrangler.jsonc` present in onboard/revoke]** → they now checkout the data repo; verify `wrangler kv key put --binding` resolves the id from JSONC (comments) without a parse step.
- **[Runtime install-id resolution adds a GitHub API call]** → cache aggressively in KV; it changes rarely (only if the App is reinstalled). Handle the cache-miss/reinstall path.
- **[Kroger creds now in data-repo Actions secrets]** → accepted; low blast radius, private repo, dispatch-only workflows.

## Migration Plan

Additive for new operators. The template `wrangler.jsonc` changes don't touch the operator's *deployed* config until they redeploy. Casey's prod keeps explicit ids (no migration). The `src/` install-id change is backward-compatible: prefer the configured `GITHUB_INSTALLATION_ID` if still present, else resolve+cache — so existing deploys keep working through the transition, and the var can be dropped later.

## Open Questions

- Does `wrangler kv key put --binding` work against a JSONC config with comments, or do we need to strip comments first?
- Where to cache the resolved installation id — `TENANT_KV` vs `OAUTH_KV` — and the eviction/refresh trigger on App reinstall.
