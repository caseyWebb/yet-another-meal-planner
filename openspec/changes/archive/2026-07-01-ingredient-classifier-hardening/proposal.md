# Ingredient Classifier Hardening

## Why

The organic ingredient-normalization capture shipped and its first hours of production data (311 identity nodes, 456 classifier decisions) surfaced five defect classes: the classifier can confirm SAME/SPECIALIZATION against a semantically-distant candidate ("flaky sea salt" → specialization of "fish sauce" at cosine 0.598), the prompt lacks distinct-product counter-examples so plausible-looking mis-specializations pass ("canned salmon" → "salmon fillets, skin-on::form-canned"), novel mints canonize raw pantry free-text as node ids ("frozen leg quarters (10 lb bag, freezer burned)"), nothing prevents contradictory/cyclic edges (a 2-cycle between "whole cardamom pods" and "ground cardamom" landed), and human-minted nodes never get embeddings so they are invisible to cosine retrieval, guaranteeing duplicate mints. These are silent-corruption bugs in shared corpus data — every tick without them fixed adds more damage.

## What Changes

- **Confirm-distance guard**: a SAME/SPECIALIZATION pick whose chosen candidate's own cosine is below a confirm minimum (~0.70, calibrated from the 38 production same/spec decisions: all correct picks ≥ 0.736, both disasters ≤ 0.705) is rejected and falls back to the NOVEL mint path, with the guard rejection recorded in the normalization log detail.
- **Classifier prompt hardening**: explicit distinct-product rules (a distinct product is NOT a specialization of a superficially-similar one) and per-candidate cosine scores in the prompt, with guidance that low similarity raises the bar for SAME/SPECIALIZATION.
- **Canonical id proposal for NOVEL mints**: the classifier additionally proposes a clean `canonical` id for NOVEL outcomes (lowercase product name, packaging/storage noise stripped, `base` or `base::detail` form); the job validates it and uses it as the node id/base/search-term basis, falling back to the verbatim term when invalid, missing, or colliding with an existing node id. The surface term always aliases to the final id. Below-floor mints (no LLM call) keep verbatim behavior.
- **Edge contradiction/cycle validation at commit**: an edge whose reverse pair already exists (in the same batch or the DB) and any self-loop after representative resolution is skipped and logged, never inserted.
- **Embedding backfill for human-minted nodes**: the normalize job embeds a bounded batch of embedding-less survivor nodes each tick before the drain, so human-minted nodes join the cosine retrieval set.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ingredient-normalization`: the capture confirm gains a chosen-candidate distance guard (reject → NOVEL fallback); NOVEL mints derive a validated canonical id instead of canonizing the raw term; edge commits reject reverse-pair contradictions and self-loops; the job backfills embeddings for registry nodes missing one so human mints are retrievable.

## Impact

- `packages/worker/src/ingredient-normalize.ts` — confirm-minimum guard, canonical-id validation/collision handling, embedding backfill pass, new summary counters.
- `packages/worker/src/ingredient-classify.ts` — prompt rules + scored candidates, `canonical` field in the confirm contract/validator.
- `packages/worker/src/corpus-db.ts` — edge reverse-pair/self-loop filtering at commit (capture + re-confirm commit paths), embedding-less node reader/writer.
- `packages/worker/src/ingredient-reconfirm.ts` — passes scored candidates to the shared confirm; benefits from the same edge validation.
- `packages/worker/test/` — extended normalize/classify/reconfirm/corpus-db unit tests.
- `docs/ARCHITECTURE.md` (capture description), `docs/SCHEMAS.md` (normalization log `detail` fields). No D1 schema change; no new dependencies.
