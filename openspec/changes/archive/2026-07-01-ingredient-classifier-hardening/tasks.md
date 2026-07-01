# Tasks — ingredient-classifier-hardening

## 1. Classifier contract (src/ingredient-classify.ts)

- [x] 1.1 Change `confirmIdentity`/`messages` candidates to `{ id: string; score?: number }[]`; serialize the user message as `[{"id":…,"similarity":…}]` (similarity rounded, omitted when absent); validator keeps taking the id list
- [x] 1.2 Add `canonical: string | null` to `IdentityConfirm`; `validateConfirm` passes it through (trimmed string or null) and never errors on it
- [x] 1.3 Harden `SYSTEM_PROMPT`: distinct-product rule with the four production counter-examples, low-similarity-raises-the-bar guidance, and the NOVEL `canonical` field spec; update the few-shots to scored candidates + `canonical`, and add the "dried medjool dates (pitted)" counter-example shot

## 2. Capture job (src/ingredient-normalize.ts)

- [x] 2.1 Add `NORMALIZE_CONFIRM_MIN = 0.72`; in `resolveOne`, reject a same/specialization pick whose chosen candidate's cosine is below it → `novelResolution` with `{ note: "confirm_below_min", rejected: { outcome, match, score } }` in the log detail
- [x] 2.2 Add `validateCanonicalId`; in `buildResolution`'s confirmed-NOVEL branch use a valid, non-colliding canonical as node id (base/detail derived, search_term flattened), always aliasing the surface term to the final id; record fallback reasons in log detail
- [x] 2.3 Add `knownIds()` to `NormalizeDeps` (full id set incl. merged/unembedded, appended with same-tick mints) wired to a new `readIdentityIds`; thread it into `buildResolution`
- [x] 2.4 Add the embedding backfill pre-drain pass: `embeddingless(limit)`/`storeEmbedding(id, vec)` deps, `NORMALIZE_EMBED_BACKFILL_MAX_PER_TICK = 25`, readable-form embed text, non-fatal failures, `embedded` summary counter, runs before `identityEmbeddings()` and even on an empty queue
- [x] 2.5 Update deps wiring (`buildNormalizeDeps`) and the co-resolution `confirm` call to the scored-candidates shape

## 3. Commit-time edge validation (src/corpus-db.ts)

- [x] 3.1 Add `filterCommittableEdges` (full-table identity + edge read, representative-resolve endpoints, drop self-loops and reverse pairs vs DB + same batch, return kept/skipped) and the new readers/writer `readIdentityIds`, `readEmbeddinglessIds`, `writeIdentityEmbedding`
- [x] 3.2 Apply the filter in `commitResolution` and `commitReconfirmEdges`, appending `edges_skipped` to the decision's log detail; insert kept edges with original endpoints

## 4. Re-confirm pass (src/ingredient-reconfirm.ts)

- [x] 4.1 Pass scored candidates (`ranked`) to the shared confirm; adjust the deps `confirm` signature and `known` set accordingly

## 5. Tests (packages/worker/test)

- [x] 5.1 ingredient-normalize.test.ts: guard rejection → novel fallback (below-min rejected + logged; at/above-min applied); canonical accept / invalid-fallback / collision-fallback / below-floor-unchanged; embedding backfill pass (stored + retrievable same tick, embed failure non-fatal, `embedded` counter); harness updated to the new deps
- [x] 5.2 corpus-db.test.ts: reverse-pair skip (DB + same-batch), post-merge self-loop skip, `edges_skipped` in the log detail, kept edges still insert; `readIdentityIds`/`readEmbeddinglessIds`/`writeIdentityEmbedding`
- [x] 5.3 ingredient-reconfirm.test.ts + ingredient-normalize.live.test.ts: adjust to the scored-candidates confirm shape; validateConfirm canonical passthrough cases

## 6. Docs & verification

- [x] 6.1 docs/ARCHITECTURE.md capture section: guard, canonical mint, edge commit validation, embedding backfill (current-state wording, no history)
- [x] 6.2 docs/SCHEMAS.md ingredient-identity section: document the normalization-log `detail` JSON keys (`note`, `reason`, `rejected`, `canonical_rejected`/`canonical_reason`, `edges_skipped`)
- [x] 6.3 `openspec validate ingredient-classifier-hardening`, `aubr typecheck`, `aubr test` all green
