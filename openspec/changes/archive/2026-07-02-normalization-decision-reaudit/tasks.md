# Tasks — normalization-decision-reaudit

## 1. Schema + shared data layer (corpus-db)

- [x] 1.1 Add `migrations/d1/0035_reaudit.sql`: nullable `audited_at INTEGER` on `ingredient_alias` and `ingredient_edge` (NULL = pre-hardening backlog)
- [x] 1.2 In `src/corpus-db.ts` (patch via script — the file's intentional NUL byte makes Edit/grep treat it as binary): born-stamp `audited_at = now` on the alias upsert (insert + ON CONFLICT) and edge inserts in `commitResolution`, and on edge inserts in `commitReconfirmEdges`
- [x] 1.3 Add corpus-db readers/writers for the audit passes: `readAliasAuditBatch` (auto + un-stamped, oldest `decided_at`, bounded), `stampAliasAudited`, `readAliasTargets` (all variant→id rows for the orphan check), `readIdentitySources` (id/representative/source rows), `readEdgeAuditBatch` (auto + un-stamped, oldest, bounded), `readAllEdges` (with source for reverse-pair lookup), `deleteEdge`, `stampEdgeAudited`, `appendNormalizationLog`; export `representativeResolver`
- [x] 1.4 Extend `NormalizationLog.outcome` with `edge_drop` / `edge_keep`, and filter `edge_*` outcomes out of the admin Decisions stream in `src/normalize-admin.ts` (JS filter, no UI change)
- [x] 1.5 Extend `test/fake-d1.ts` minimally: `audited_at IS NULL` WHERE filter, generic single-column and multi-column UPDATE ... WHERE support, multi-column global DELETE (edge + sku_cache shapes)

## 2. Direction-check classifier

- [x] 2.1 Add `confirmSatisfiesDirection(env, from, to)` to `src/ingredient-classify.ts`: `forward | reverse | both | neither` over readable forms, hardened distinct-product rules + fixture few-shots, strict JSON, corrective retry, `storage_error`/`validation_failed` split; export the validator for unit tests

## 3. Alias re-audit pass

- [x] 3.1 Add `src/ingredient-alias-audit.ts` (sibling shape: pure core over injected deps + `buildAliasAuditDeps` + `runAliasAuditJob` writing `ingredient-alias-audit` health/run rows): self-alias deterministic stamp; otherwise embed the variant, retrieve top-K candidates always including the current survivor, run the hardened confirm with the pick guard, apply via `buildResolution` + `commitResolution` (audit marker + `previous_id` in the log detail), stamp; keep+stamp on contract-invalid; skip un-stamped on transient
- [x] 3.2 Implement the orphan merge: after a re-point, when the previous node is auto-sourced and retains no aliases, `mergeIdentities(previous → resolved target)`
- [x] 3.3 Tests `test/ingredient-alias-audit.test.ts`: self-alias stamp (no embed/LLM), high-cosine wrong alias re-pointed (sesame-seeds class), guard-rejected pick → verbatim novel mint (flaky-sea-salt class), specialization + novel-canonical mints, confirmed mapping kept, orphan merge (and NOT merged when other aliases remain / node is human), human rows excluded (reader test), contract-invalid keep+stamp, transient skip, per-tick bound

## 4. Edge re-audit pass

- [x] 4.1 Add `src/ingredient-edge-audit.ts` (same sibling shape, `ingredient-edge-audit` job): deterministic self-loop delete; reverse-pair resolution (human reverse wins deterministically; else one direction check keeps/deletes per verdict, `both` keeps both, `neither` deletes both); standing-edge validation (delete on `reverse`/`neither`, stamp on `forward`/`both`); `edge_drop`/`edge_keep` log rows; keep+stamp on contract-invalid; skip on transient
- [x] 4.2 Tests `test/ingredient-edge-audit.test.ts`: self-loop delete (no LLM), 2-cycle forward + reverse verdicts, both-kept, neither-deletes-both, human-reverse wins, standing edge drop + keep, contract-invalid keep+stamp, transient skip, bound, reader eligibility (auto + un-stamped only)

## 5. SKU-cache re-key pass

- [x] 5.1 Add `src/sku-cache-rekey.ts` (`sku-cache-rekey` job, grocery-reconcile shape): `readResolver` (no capture), plan re-keys in JS (resolution differs → move; collision keeps newer `last_used`, null loses, tie keeps canonical), bounded batch of DELETEs + upserts, `{ rekeyed, merged, truncated }` summary
- [x] 5.2 Tests `test/sku-cache-rekey.test.ts`: re-key on capture, collision keeps newer (both directions + null), non-resolving untouched with no novel-term enqueue, idempotent second run, representative-chain resolution, bound/truncation

## 6. Re-confirm guard parity + wiring

- [x] 6.1 Add `confirmMin` to `ReconfirmDeps` (wired to `NORMALIZE_CONFIRM_MIN`); reject a below-guard `same`/`specialization` pick in `reconfirmOne` to a logged no-op (`confirm_below_min` + rejected detail, no merge, no edges); extend `test/ingredient-reconfirm.test.ts`
- [x] 6.2 Wire the three new jobs into `scheduled()` Phase 1 in `src/index.ts` after the normalize/reconfirm/reconcile entries (comments in the established idiom); do NOT touch `HEALTH_JOBS`
- [x] 6.3 Extend `test/corpus-db.test.ts`: born-stamped `audited_at` on `commitResolution` (alias + edges) and `commitReconfirmEdges`, new readers/writers, `deleteEdge`/`stampEdgeAudited` SQL contract

## 7. Docs + verification

- [x] 7.1 `docs/SCHEMAS.md`: `audited_at` columns on both tables, the `edge_drop`/`edge_keep` log outcomes + audit detail markers (`audit`, `previous_id`), current-state wording
- [x] 7.2 `docs/ARCHITECTURE.md`: describe the re-audit passes + sku-cache convergence in the ingredient-normalization capture section (current state, no history narration)
- [x] 7.3 `aubr typecheck` (worker + admin client tsconfig) and the FULL `aubr test` suite green; `npx --yes openspec validate normalization-decision-reaudit`
