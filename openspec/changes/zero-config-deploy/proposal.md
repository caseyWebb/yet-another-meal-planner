## Why

Operator setup today (SELF_HOSTING steps 2–6) is config-heavy: create three KV namespaces and copy their ids, hand-edit `wrangler.jsonc` (~9 values), set a duplicate `TENANT_KV_ID` Actions var, and set runtime secrets in a separate Cloudflare dashboard pass. Almost all of it is **derivable or auto-provisionable with tooling we already run**: `wrangler deploy` (≥4.45, we're on 4.99) auto-provisions KV; the deploy runs *in the data repo's Actions* so it already knows the repo coords; the Worker already holds the App key, so it can resolve its own installation. Collapsing this shrinks the hand-edited config surface from ~9 values to ~1 and removes whole setup steps — **without** changing the no-fork, private-control-plane posture. (True one-click is impossible — Cloudflare, Kroger, and GitHub App registrations are irreducible external accounts — so the target is "minimal config, no file editing," not literal 1-click.)

## What Changes

- **KV auto-provisioning (Q1).** The operator-facing (template) `wrangler.jsonc` ships KV bindings **without ids**; `wrangler deploy` creates + binds them on first deploy. Removes SELF_HOSTING step 4 entirely.
- **Intuit `DATA_*` at deploy (Q5).** `data-deploy.yml` injects `DATA_OWNER`/`DATA_REPO` from `github.repository` + `DATA_REF` (default `main`) as `wrangler deploy --var`. Removes 3 hand-set vars; the Worker still gets them at runtime (deploy-time injection, since the Worker has no Actions context).
- **Runtime-resolve the installation id (Q3).** The Worker lists its GitHub App installations with the App JWT and caches the id in KV, instead of reading a configured `GITHUB_INSTALLATION_ID`. Removes 1 var. **MODIFIES** the multi-tenancy installation-token requirement.
- **Drop `TENANT_KV_ID` (Q4).** `data-onboard.yml`/`data-revoke.yml` check out the data repo and address KV by **`--binding TENANT_KV`** (single source of truth = `wrangler.jsonc`). Necessary once ids are auto-provisioned — there's no stable id left to put in a var.
- **Secret posture (resolved).** The **App private key stays a manual Cloudflare worker secret** — out of any repo, preserving its defense-in-depth layer; **not** Cloudflare Secrets Store (equivalent exposure + a `src/` async refactor + a `store_id` that fights zero-config) and **not** a GitHub secret. The lower-value **Kroger creds** are pushed by the deploy via `wrangler-action`'s `secrets:` input from data-repo secrets, removing their manual dashboard step.
- **SELF_HOSTING rewrite.** Steps 4–6 collapse; the operator's config surface drops to `{ name (defaulted), GITHUB_APP_ID }` plus a few repo Secrets/Variables pasted in the web UI.
- **Out of scope (low ROI / declined):** the GitHub App *manifest flow* (web-redirect, can't self-set a CF secret), the Kroger redirect-URI chicken-and-egg, and the Deploy-to-Cloudflare button (forces a public fork-with-source; we already get provisioning natively).

## Capabilities

### New Capabilities
- `operator-provisioning`: the zero-config operator setup contract — what the deploy auto-provisions/intuits vs. the minimal values an operator supplies, plus the per-secret posture (App key manual, Kroger automated).

### Modified Capabilities
- `multi-tenancy`: the GitHub App installation-token requirement — the installation is **resolved at runtime** from the App's installations (cached in KV), not read from a configured `GITHUB_INSTALLATION_ID`.

## Impact

- **Worker (`src/`):** drop `GITHUB_INSTALLATION_ID` from `Env` ([src/env.ts](src/env.ts)); add an installation resolver (App JWT → `GET /app/installations` → cache in `TENANT_KV`/`OAUTH_KV`); update call sites ([tools.ts](src/tools.ts), [email.ts](src/email.ts)). Kroger creds stay plain env strings in `src/` (only *how they're set* changes).
- **Reusable workflows:** `data-deploy.yml` (intuit `DATA_*` + `--var`, push Kroger secrets via `wrangler-action`), `data-onboard.yml` + `data-revoke.yml` (checkout + `--binding`, drop the `tenant_kv_id` input).
- **Config:** the **template** `wrangler.jsonc` (in the `docs/data-template` submodule) drops KV ids + `INSTALL_ID` + `DATA_*`. The operator's **own running** instance keeps its explicit ids — see the migration note in design (auto-provision would create *new* namespaces, not adopt existing data).
- **Docs:** SELF_HOSTING steps 4–6 rewrite; data-template README; CLAUDE.md secret/config notes.
- **Risk / gate:** the one real unknown is **wrangler auto-provision idempotency across redeploys** — does a second deploy with id-less bindings reuse the same-named namespace, or create a duplicate (silent data loss)? Spike = task 1. A non-idempotent result means the deploy commits the id-injected `wrangler.jsonc` back to the data repo (`contents:write`) instead of relying on by-name reuse.
