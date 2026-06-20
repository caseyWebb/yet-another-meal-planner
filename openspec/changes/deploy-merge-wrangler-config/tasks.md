## 1. Merge helper

- [x] 1.1 Create `scripts/merge-wrangler-config.mjs` exporting a pure `mergeWranglerConfig(codeConfig, operatorConfig)` that applies the per-key rule table from design.md: code-level keys (`main`, `compatibility_date`, `compatibility_flags`, `triggers`, `observability`, `workers_dev`) from code; `name`/`routes`/`vars` operator-overlay; `kv_namespaces` merged by binding name with **operator or absent ids only** (code ids dropped).
- [x] 1.2 Parse JSONC (both inputs have comments) — reuse the repo's existing JSON/TOML tooling or a JSONC parser, not raw `JSON.parse`. Provide a small CLI wrapper (`node scripts/merge-wrangler-config.mjs <operator.jsonc> <code.jsonc>` → merged JSON on stdout / written in place) for the workflow.

## 2. Tests (the security-critical core)

- [x] 2.1 `tests/merge-wrangler-config.test.mjs` (Node `--test`, like the other tooling tests):
  - code `triggers.crons` propagate when the operator config lacks them
  - `compatibility_date`/`compatibility_flags` come from code even when the operator's differ
  - operator `name`/`routes`/`vars` win
  - **`kv_namespaces`: operator id wins AND the code repo's id never appears in the output**
  - a code-only binding appears **without an id** (auto-provision)
  - an operator-declared id-less binding stays id-less

## 3. Wire into the deploy

- [x] 3.1 In `.github/workflows/data-deploy.yml`, replace the `cp "<operator config>" _code/wrangler.jsonc` overlay step with a step that runs the merge (operator config + `_code/wrangler.jsonc` → `_code/wrangler.jsonc`), positioned after `npm ci` (so the toolchain is available) and before Deploy.
- [x] 3.2 Confirm the downstream steps still work over the merged config (auto-provision writes ids back; `--var` coord injection; onboard/revoke unaffected since they read the operator's config, not the merged one).

## 4. KV-id footgun (open question)

- [x] 4.1 DONE (per maintainer): **scrubbed** the maintainer's KV ids + identifying vars from the code repo's `wrangler.jsonc` (id-less bindings, placeholder `GITHUB_APP_ID`, dropped `GITHUB_INSTALLATION_ID`/`DATA_*`); real local-dev values move to `.dev.vars` (`.dev.vars.example` updated). The merge strips code vars/ids regardless. Original task: Decide the open question: scrub the maintainer's real KV ids from the **code repo's** `wrangler.jsonc` (replace with id-less bindings) in addition to the merge-strip. If yes, do it and confirm the maintainer's own deploy path still provisions correctly; if deferred, rely on the merge-strip + tests and note the residual footgun.

## 5. Slim the data-repo template (coupled to the merge — land together)

- [ ] 5.1 In the template repo (`groceries-agent-data-template`, the `docs/data-template` submodule), slim `wrangler.jsonc` to the minimal operator-owned set per design Decision 5: keep `vars.GITHUB_APP_ID` (+ optional `name`, `workers_dev`/`routes`, id-less KV bindings); **remove** code-level keys (`main`, `compatibility_date`, `compatibility_flags`, `triggers`, `observability`). Update the file's explanatory comments to say code-level config is merged in at deploy.
- [x] 5.2 Verify the **KV-id write-back** path still pins provisioned ids into the slim operator config across deploys (creating `kv_namespaces` if absent); adjust the write-back step in `data-deploy.yml` if it assumes the section exists.
- [ ] 5.3 Bump the `docs/data-template` submodule pointer in this repo to the slimmed template commit (do this only alongside the merge step from group 3, never before).

## 6. Docs (same pass — no drift)

- [x] 6.1 `docs/SELF_HOSTING.md`: remove the manual "add `triggers` to your data-repo `wrangler.jsonc`" stopgap; describe the merged-config model, what an operator's `wrangler.jsonc` is responsible for now, and that new operators start from the slim template.
- [x] 6.2 `CONTRIBUTING.md` and/or `docs/ARCHITECTURE.md`: document the code-vs-operator wrangler ownership boundary (the rule table) so future wrangler changes land in the right place.
- [x] 6.3 `wrangler.jsonc`: update/remove the heads-up comment at the `triggers` block (the manual-sync caveat no longer applies once this lands).

## 7. Ship

- [x] 7.1 `npm run test:tooling` (incl. the new merge tests) + `npm run typecheck` green.
- [ ] 7.2 After merge + operator redeploy: confirm the cron registers in Cloudflare and `/health`'s `flyer-warm` job transitions from `never_run` to `ok` within a sweep interval; and that a from-scratch deploy off the slim template provisions KV and registers the cron.
