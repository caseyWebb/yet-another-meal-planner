## 1. Schema + backfill

- [x] 1.1 Add `migrations/d1/0006_shared_corpus.sql`: `aliases`, `feeds`, `discovery_senders`, `discovery_members`, `flyer_terms`, `sku_cache`, `discovery_candidates` (UNIQUE url), `stores`, `store_notes`, `recipe_notes` + indexes.
- [x] 1.2 Add `migrations/0005-shared-corpus-d1.mjs`: read the data-repo checkout TOML (single files + `stores/`, `store_notes/`, `notes/` trees), parse, insert rows. Idempotent (reload per table).
- [x] 1.3 Test the backfill (`tests/shared-corpus-d1-backfill.test.mjs`): each artifact → rows; attribution/private preserved; inbox dedup by url.

## 2. Reads → D1

- [x] 2.1 Matcher: aliases + SKU cache → D1 (`src/corpus-db.ts`); cache lookup by `(ingredient, location_id)`.
- [x] 2.2 Stores: `list_stores`/`read_store` → D1.
- [x] 2.3 Notes: `read_store_notes` + `read_recipe_notes` → D1 (recipe-notes join the slice-4 ratings query; own-private + everyone-shared filter).
- [x] 2.4 Discovery: `read_discovery_inbox`, feeds reader, flyer-terms reader → D1.

## 3. Writes → D1 (with write-time validation)

- [x] 3.1 `update_aliases`, `update_feeds`, `update_discovery_sources` → D1.
- [x] 3.2 `add/update/remove_store` + write-time `validateStoreInput` (moved from the build).
- [x] 3.3 `add/update/remove_store_note`, `add/update/remove_recipe_note` → D1 (author = caller; private flag).
- [x] 3.4 SKU-cache writer (`order-tools.ts`) → upsert `sku_cache`.
- [x] 3.5 Email-ingest inbox writer → insert `discovery_candidates` (UNIQUE(url) dedup) + `validateDiscoveryCandidate`.

## 4. Build collapses to recipes-only

- [x] 4.1 `scripts/build-indexes.mjs`: removed `validateStore`/`validateDiscoveriesInbox`/`validateDiscoverySources`/`parseCheckToml`/`walkToml`; the run is recipe validation + index projection only.
- [x] 4.2 The dropped store/discovery validations moved into `src/validate.ts` as write-time checks (`validateStoreInput`, `validateDiscoveryCandidate`).

## 5. Remove TOML

- [x] 5.1 Removed all `smol-toml`/`parseToml`/`stringifyTomlWithHeader` usage from `src/**` and `scripts/build-indexes.mjs` (the Worker + build are TOML-free; `src/parse.ts`/`src/serialize.ts` keep only the YAML `parseMarkdown`/`serializeMarkdown` for recipes). **CORRECTION:** `smol-toml` is KEPT in `package.json` — the one-time `.mjs` backfill migrations (0001–0005) still parse the legacy TOML to migrate it into D1. The dependency can be dropped only after every operator has migrated and those migrations are retired.
- [ ] 5.2 **DEFERRED (post-backfill, NOT this PR):** the data-repo `.toml` files are the backfill SOURCE — the migrations read them at deploy time. Deleting them before the operator runs the backfill = data loss (unlike slice 1's *derived* `_indexes/recipes.json`). They are deleted as a separate data-repo commit only after D1 is confirmed authoritative. Documented in the operator playbook.

## 6. Docs

- [x] 6.1 `docs/SCHEMAS.md`: D1 tables replace the remaining shared-corpus TOML schemas.
- [x] 6.2 `docs/ARCHITECTURE.md`: the completed boundary — GitHub = recipes only; D1 = all domain data; KV = ephemeral infra.
- [x] 6.3 `CONTRIBUTING.md`: TOML data tooling removed from the runtime path; write-time validation replaced build-time for non-recipe data.

## 7. Verify

- [x] 7.1 `npm run typecheck` + `npm test` (523 pass / 9 skipped) + `npm run test:tooling` (124 pass) green — every read/write path; notes attribution/privacy; sku-cache + inbox dedup; build recipes-only.
- [ ] 7.2 Manual (NEEDS LIVE D1): backfill; matcher resolves via D1 aliases/cache; `read_recipe_notes` returns notes + group ratings in one path; store/discovery writes validate at the tool. Covered against a fake D1 in unit/tooling tests; live round-trip is the operator's deploy-time smoke.

> Note: the two spec deltas here (`shared-corpus`, `build-automation`) capture the architecture; per-tool deltas for `ingredient-matching`/`newsletter-discovery`/`recipe-notes` are folded into those.
