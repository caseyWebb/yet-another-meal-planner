## Why

Production `ingredient_alias.id` values still point at merged-away loser nodes (including retired 3-segment ids like `chicken::cut-legs::cut-thighs` from the pre-segment-guard backfill): the calibration's segment repair re-rooted the *nodes*, but aliases are the one keyed surface with no target-convergence reconcile — grocery/pantry re-key through the chain (`grocery-pantry-reconcile`) and so does `sku_cache` (`sku-cache-rekey`), while alias targets rot until the admin renders dead ids. Separately, the admin's Normalize › Aliases listing drowns in 1:1 self-entries (513 of 590 rows are `variant === id` resolver front-door rows, e.g. `kale → kale`), burying the ~77 real mappings an operator actually reviews.

## What Changes

- **Alias target convergence (data, deterministic, no LLM):** the `sku-cache-rekey` scheduled pass gains an idempotent alias-retarget step — every `ingredient_alias` row whose `id` no longer survives the representative chain (`resolve(id) !== id`, chased over identity rows only; the alias front-door is never consulted for the target) is re-pointed to its surviving id. Only the `id` column is written, so `source`, `confidence`, `decided_at`, and `audited_at` are preserved — this is key maintenance, not a re-decision, and writes no per-row normalization-log entry. A self-alias of a merged-away node (`variant === old id`) correctly becomes a real `variant → survivor` mapping. The job summary grows an additive `alias_retargeted` count, and the Audits observability counts it as work.
- **Mappings-only alias listing (display):** the Normalize area's alias table lists only real mappings (`variant !== id`, post-convergence) with a count chip for the canonical self-entries (e.g. "513 canonical entries"); self-rows render no table rows.

## Capabilities

### New Capabilities

_None — both changes extend existing capabilities._

### Modified Capabilities

- `ingredient-normalization`: new requirement — alias targets converge to surviving ids each scheduled tick, hosted in the sku-cache-rekey pass (deterministic, idempotent, metadata-preserving, summary-counted).
- `operator-admin`: new requirement — the Normalize alias listing shows real mappings only, with a canonical self-entry count chip instead of self-rows.

## Impact

- `packages/worker/src/sku-cache-rekey.ts` — the retarget planner + batched `UPDATE`s, `alias_retargeted` in `SkuRekeyResult`/job summary; `packages/worker/src/audit-admin.ts` — the sku pass's worked/summary fields include the new count (a retarget tick is not a settled no-op).
- `packages/worker/src/normalize-admin.ts` (`AliasRow`/`NormalizationPage` split into mappings + self-count) and `packages/worker/src/admin/pages/normalize.tsx` (`AliasesTab` renders mappings only + the chip; SSR and island share the component).
- Tests: `test/sku-cache-rekey.test.ts`, `test/normalize-admin.test.ts`, `test/audit-admin.test.ts`, Playwright `admin/visual/` (seed + page object + spec + regenerated screenshot).
- Docs: `docs/SCHEMAS.md` (`ingredient_alias.id` targets converge to survivors), `docs/ARCHITECTURE.md` (reconcile enumeration, one line).
