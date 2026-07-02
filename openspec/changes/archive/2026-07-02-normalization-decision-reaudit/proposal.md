## Why

The organic ingredient-normalization system captured its first ~300 identity nodes under pre-hardening rules, and several of those decisions are wrong: aliases collapsed onto semantically-distant nodes ("flaky sea salt" → `fish sauce::type-sea-salt`), plain products aliased into prepared specs ("sesame seeds" → `toasted sesame seeds::toast`), contradictory/wrong-direction satisfies edges (a `whole cardamom pods`/`ground cardamom` 2-cycle, `spaghetti → rigatoni`), and `sku_cache` rows keyed by legacy raw terms that nothing re-keys when resolution changes. The just-merged `ingredient-classifier-hardening` change prevents NEW bad decisions (confirm-distance guard, distinct-product prompt rules, canonical ids, edge gating); this change is its retroactive counterpart — the pipeline must converge the existing bad data to a good state BY ITSELF, since one-time manual data surgery was explicitly rejected.

## What Changes

- **Rolling alias/decision re-audit** (`ingredient-alias-audit` job): a bounded, self-quiescing scheduled pass over AUTO-sourced alias mappings decided under older rules. A deterministic pre-filter stamps only **self-aliases** (the variant string equals the row's node id — the alias every mint writes for its own node; ~288 of production's 322 rows) with no LLM call; **every other** auto mapping gets one hardened classifier confirm (candidates retrieved from the current registry, always including the currently-mapped node), because embedding distance is structurally blind to the distinct-product / prep-vs-product defect class (4 of the 6 known-bad production aliases cosine above the 0.72 guard — e.g. 'sesame seeds'→`toasted sesame seeds::toast` at 0.879). The confirm's pick stays subject to the `NORMALIZE_CONFIRM_MIN` distance guard exactly as in capture, and the re-decision is applied via existing primitives only (re-point the alias, mint a node with canonical-id synthesis, or `mergeIdentities`) — never deleting nodes, never touching `source='human'` rows, logging every applied correction. When a re-point strands an auto node with no remaining aliases, the orphan is merged (`representative` pointer) into the re-decision's resolved node so it exits the retrieval set instead of lingering as a nonsense candidate.
- **Edge re-audit reconcile** (`ingredient-edge-audit` job): a bounded rolling pass over AUTO edges — rep-resolved self-loops deleted deterministically; reverse-pair 2-cycles resolved by one classifier direction-check (the losing edge deleted); standing edges validated by a cheap classifier satisfies-check under the hardened distinct-product rules (dropped on "no"). Human edges untouched; audited edges stamped so the pass self-quiesces.
- **sku_cache re-key reconcile** (`sku-cache-rekey` job): every tick, plain code (no LLM) resolves each `sku_cache.ingredient` through the current alias/representative chain and re-keys rows whose resolution differs, keeping the newer `last_used` on a (canonical, location) conflict. Idempotent; non-food rows never resolve and stay as-is by construction.
- **Guard parity in the re-confirm pass**: the periodic re-confirm's `same`-outcome merge (and its specialization edge pick) now applies `NORMALIZE_CONFIRM_MIN` the same way capture applies it — a distant pick is rejected to a logged no-op instead of merging.
- **Born-audited new decisions**: capture/re-confirm commits stamp `audited_at` on the alias/edge rows they write, so post-hardening decisions never re-enter the audit backlog and the passes converge to a standing no-op.
- New D1 migration `0035_reaudit.sql`: `audited_at` columns on `ingredient_alias` and `ingredient_edge`.

## Capabilities

### New Capabilities

(none — all changes extend the existing ingredient-normalization capability)

### Modified Capabilities

- `ingredient-normalization`: ADDED requirements for the rolling alias re-audit pass, the edge re-audit pass, and sku_cache key convergence; MODIFIED requirement "Periodic re-confirm of under-connected nodes" to apply the confirm-distance guard to its merge/specialization decisions.

## Impact

- **Worker source**: new `src/ingredient-alias-audit.ts`, `src/ingredient-edge-audit.ts`, `src/sku-cache-rekey.ts`; guard parity in `src/ingredient-reconfirm.ts`; a direction/satisfies classifier check in `src/ingredient-classify.ts`; new readers/writers + born-stamped commits in `src/corpus-db.ts`; wiring in `src/index.ts` `scheduled()` Phase 1.
- **D1**: `migrations/d1/0035_reaudit.sql` (two nullable `audited_at` columns; NULL = pre-hardening backlog).
- **Jobs/observability**: three new `job_health`/`job_runs` names (`ingredient-alias-audit`, `ingredient-edge-audit`, `sku-cache-rekey`), mirroring `ingredient-normalize`/`ingredient-reconfirm` (not added to `HEALTH_JOBS`, same as those jobs).
- **Docs**: `docs/SCHEMAS.md` (new columns, log detail notes), `docs/ARCHITECTURE.md` (re-audit passes in the capture section).
- **Tests**: new vitest files for the three passes (incl. the high-cosine wrong-alias fixtures — sesame-seeds-class rows the classifier must re-point — and orphan-merge-on-re-point) + extensions to `ingredient-reconfirm`/`corpus-db` tests; small fake-D1 SQL-shape additions (generic UPDATE WHERE, multi-column edge DELETE).
