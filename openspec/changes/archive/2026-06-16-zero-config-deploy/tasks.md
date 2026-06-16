## 1. Gating spike — KV auto-provision idempotency (informs the deploy design)

- [x] 1.1 ~~scratch-account deploy~~ — **resolved via docs** (empirical deploy deferred to the operator; no longer gating). wrangler's auto-provision idempotency is **write-back-dependent**: it writes provisioned ids back to the config and reuses them on redeploy. It does NOT guarantee name-based dedup for an id-less config.
- [x] 1.2 Our overlay copies the operator's config to the throwaway `_code/wrangler.jsonc`, so wrangler's write-back is **discarded** — every deploy would re-provision. JSONC handling is moot once we persist ids ourselves (surgical patch of the data-repo file).
- [x] 1.3 **DECISION → write-back path.** The deploy persists the provisioned KV ids back to the operator's data-repo `wrangler.jsonc` (`contents: write`) after the first deploy; subsequent deploys read them (deterministic, no duplicates). Safe regardless of wrangler's by-name behavior. Drives tasks 3.3 / 5.1.

## 2. Runtime installation-id resolution (`src/`)

- [x] 2.1 Installation resolver in `github-app.ts`: App JWT → `GET /repos/{owner}/{repo}/installation` → id, cached module-level (isolate-lifetime; cold start re-resolves; reinstall handled by re-resolution). Lazy inside `createInstallationAuth` (no async ripple through tenant resolution).
- [x] 2.2 `GITHUB_INSTALLATION_ID` now optional in `Env` + `Tenant.installationId` optional; the auth provider takes `{ id?, owner, repo }` and prefers a configured id (backward-compatible).
- [x] 2.3 Call sites updated ([tools.ts](src/tools.ts), [email.ts](src/email.ts)); tests added (resolve + resolve-failure); `tenant.test.ts` unchanged (still exercises the configured-id path). Suite green.

## 3. Deploy intuits `DATA_*` + sets Kroger secrets (`data-deploy.yml`)

- [x] 3.1 Deploy command injects `--var DATA_OWNER:<owner> --var DATA_REPO:<repo> --var DATA_REF:main`, owner/repo derived from `GITHUB_REPOSITORY` in a coords step.
- [x] 3.2 A post-deploy step `wrangler secret put`s the Kroger creds **only if** provided as repo secrets (never clobbers dashboard values with empties). App key not handled. Reusable workflow accepts optional `KROGER_CLIENT_ID/SECRET`.
- [x] 3.3 Pin-back step copies `_code/wrangler.jsonc` → the data-repo config and commits if changed (`permissions: contents: write`). Carries a "VERIFY on first real deploy" note (write-back format; surgical patch is the fallback).

## 4. Onboard/revoke address KV by `--binding` (`data-onboard.yml`, `data-revoke.yml`)

- [x] 4.1 Both now check out the data repo and use `wrangler kv key put/delete --binding TENANT_KV` — with a VERIFY note (if wrangler kv chokes on the config's missing `main`, parse the id / pass `--namespace-id`).
- [~] 4.2 `tenant_kv_id` dropped from both **reusable** workflows. The **thin callers** (data-template submodule) still wire it — handled in task 5.2 (cross-repo).

## 5. Template config + docs

- [x] 5.1 Template `wrangler.jsonc` (submodule): id-less KV bindings, dropped `GITHUB_INSTALLATION_ID` + `DATA_*`, `name` defaulted to `grocery-mcp`, `workers_dev: true` for an out-of-box URL — only `GITHUB_APP_ID` left to set. *(Cross-repo: commit in the template repo + bump the submodule ref.)*
- [x] 5.2 Thin callers (submodule): `tenant_kv_id` dropped from onboard/revoke; `deploy.yml` gained `permissions: contents: write` (pin-back). *(Cross-repo.)*
- [x] 5.3 `docs/SELF_HOSTING.md`: step 4 now "auto-provisioned (nothing to do)"; step 5 is one value (`GITHUB_APP_ID`); step 6 deploys + App-key-only dashboard; step 2 drops the install-id capture. Added the "already running an older instance" migration note.
- [x] 5.4 data-template README updated (no `TENANT_KV_ID`, one-value config). CLAUDE.md had no stale config phrasing to change.

## 6. Validate + verify

- [x] 6.1 `openspec validate --strict` ✓; typecheck clean; **443 worker + 75 tooling tests pass**.
- [ ] 6.2 **Post-ship (needs a real deploy):** fresh deploy (KV auto-provisions + ids pin back), onboard (`--binding`), a tool write (runtime install-id resolution). Also confirms the two "VERIFY" assumptions (wrangler write-back format; `kv key put --binding` vs missing `main`).
- [x] 6.3 Prod root `wrangler.jsonc` untouched (explicit ids + `INSTALLATION_ID` retained); the code honors a present `GITHUB_INSTALLATION_ID` (tenant.test.ts). Backward-compatible.
