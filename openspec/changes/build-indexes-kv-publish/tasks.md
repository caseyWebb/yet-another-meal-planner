## 1. Worker: DATA_KV binding + env type

- [ ] 1.1 Add id-less `{ "binding": "DATA_KV" }` to `kv_namespaces` in code repo `wrangler.jsonc`
- [ ] 1.2 Add `DATA_KV: KVNamespace` to `Env` interface in `src/env.ts`

## 2. Worker: switch recipe index reads from GitHub to KV

- [ ] 2.1 `src/tools.ts` — replace `readFile(sharedGh, "_indexes/recipes.json", …)` with `env.DATA_KV.get("index:recipes")` in the `list_recipes` handler; map null → `index_unavailable`
- [ ] 2.2 `src/cooking-tools.ts` — replace `readFile(sharedGh, "_indexes/recipes.json", …)` in `loadRetrospective` with `DATA_KV.get`; thread `DATA_KV` through to the function signature; update callers
- [ ] 2.3 `src/discovery-tools.ts` — replace `readOptional(sharedGh, RECIPE_INDEX)` with `DATA_KV.get("index:recipes")` in both discovery idempotency call sites
- [ ] 2.4 Remove `sharedGh` parameter from any function that no longer uses it for the index (if it was the only use); verify typecheck passes

## 3. build-indexes: KV publish step

- [ ] 3.1 In `scripts/build-indexes.mjs` `main()`: after `writeIndexes`, read `DATA_KV` namespace id from the data repo's `wrangler.jsonc` (JSON5 parse; extract `kv_namespaces.find(b => b.binding === "DATA_KV")?.id`)
- [ ] 3.2 If id present and `CLOUDFLARE_API_TOKEN` set: publish via Cloudflare KV REST API (`PUT /client/v4/accounts/<account_id>/storage/kv/namespaces/<id>/values/index:recipes`) — or use `wrangler kv key put --binding DATA_KV index:recipes --path _indexes/recipes.json`
- [ ] 3.3 If id absent or token absent: print a warning and skip (exit 0); do not fail `--check` mode (KV publish never runs in check mode)
- [ ] 3.4 Add `--publish` flag or auto-detect via env (prefer auto-detect: publish when token + id both available, skip otherwise)

## 4. CI: data-build-indexes reusable workflow

- [ ] 4.1 In `.github/workflows/data-build-indexes.yml`: declare `CLOUDFLARE_API_TOKEN` as an optional `secrets:` input
- [ ] 4.2 Pass `CLOUDFLARE_API_TOKEN` as an env var to the "Validate + regenerate indexes" step so `build-indexes.mjs` can auto-detect and publish
- [ ] 4.3 Update workflow comments to reflect the KV publish step

## 5. CI: data-deploy reusable workflow — post-deploy publish

- [ ] 5.1 In `.github/workflows/data-deploy.yml`: after the "Deploy" step, add a "Publish indexes to KV" step that runs `node _code/scripts/build-indexes.mjs --root .` with `CLOUDFLARE_API_TOKEN` set, so the index is in KV immediately after first deploy

## 6. Data-template repo

- [ ] 6.1 Add id-less `{ "binding": "DATA_KV" }` to `kv_namespaces` in `wrangler.jsonc`
- [ ] 6.2 Add `secrets: inherit` to the thin `build-indexes.yml` caller

## 7. Operator data repo

- [ ] 7.1 Add `{ "binding": "DATA_KV" }` (id-less) to `kv_namespaces` in `wrangler.jsonc` — id will be pinned on next deploy (or insert a manually-created namespace id directly)
- [ ] 7.2 Add `secrets: inherit` to `.github/workflows/build-indexes.yml`

## 8. Docs + spec sync

- [ ] 8.1 Update `docs/TOOLS.md` if any tool error codes or return shapes changed (they shouldn't, but verify)
- [ ] 8.2 Update `docs/SCHEMAS.md` note on `_indexes/recipes.json` to reflect it is written for git-diff/audit purposes but the Worker reads from KV
- [ ] 8.3 Sync modified specs (`data-indexing`, `build-automation`, `operator-provisioning`) from change dir to `openspec/specs/`

## 9. Verify

- [ ] 9.1 Run `npm run typecheck` — no errors
- [ ] 9.2 Run `npm test` — all tests pass
- [ ] 9.3 Deploy to production; confirm `DATA_KV` is provisioned and pin-back committed
- [ ] 9.4 Check CF dashboard: `DATA_KV` → key `index:recipes` exists and contains valid JSON
- [ ] 9.5 Call `list_recipes` via the agent; confirm recipes returned and no `index_unavailable` error
