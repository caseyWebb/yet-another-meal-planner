# Design — ingredient-classifier-hardening

## Context

The organic-ingredient-normalization capture (`src/ingredient-normalize.ts` + `src/ingredient-classify.ts` + the commit paths in `src/corpus-db.ts`) is live. Its first ~3 production hours (311 identity nodes, 456 classifier decisions) confirmed five defect classes, all silent shared-corpus corruption:

1. `resolveOne` gates the classifier call on `ranked[0].score >= NORMALIZE_FLOOR (0.5)`, but the classifier may then pick ANY of the top-10 candidates regardless of that candidate's own cosine — "flaky sea salt" became a specialization of "fish sauce" (chosen-candidate cosine 0.598), "half loaf sourdough bread" of "bread flour" (0.705).
2. The SYSTEM_PROMPT has no distinct-product counter-examples and the model never sees semantic distance, so plausible-looking mis-specializations pass any distance guard ("dried medjool dates" → `dried fruit blend::type-medjool-dates` at 0.745, "canned salmon" → `salmon fillets, skin-on::form-canned` at 0.764).
3. NOVEL mints canonize the raw queued term verbatim as node id/base/search_term — pantry free-text like "frozen leg quarters (10 lb bag, freezer burned)" is now a canonical identity node.
4. `validateConfirm` checks only kind-enum and endpoint membership; the commits `INSERT OR IGNORE`. Production holds a 2-cycle: `whole cardamom pods -[containment]-> ground cardamom` AND `ground cardamom -[general]-> whole cardamom pods`.
5. `addAliases` inserts identity rows with `embedding` NULL and `readIdentityEmbeddings` selects only embedded survivors — human-minted nodes are invisible to cosine retrieval, so the same concept re-mints as a duplicate.

Constraints: the existing failure model (transient → defer; contract-invalid → fail-safe NOVEL) must be preserved; ids stay append-only; no new dependencies; fake-D1 in tests can't GROUP BY or do subqueries, so validation reads are full-table + JS filtering (the existing corpus-db idiom).

## Goals / Non-Goals

**Goals:**
- Reject SAME/SPECIALIZATION picks against semantically-distant candidates deterministically (a guard constant), falling back to the existing NOVEL mint path.
- Show the classifier each candidate's cosine and teach it distinct-product boundaries.
- Mint confirmed-novel nodes under a clean, classifier-proposed canonical id, with a validation + collision fallback to today's verbatim behavior.
- Make edge commits reject reverse-pair contradictions and post-merge self-loops.
- Backfill embeddings for embedding-less survivor nodes so human mints join the retrieval set.

**Non-Goals:**
- No repair/migration of already-corrupted production rows (operator repairs those by hand; this change stops the bleeding).
- No canonical-id re-home of existing nodes; ids remain append-only.
- No distance guard on the SKU co-resolution pass (the shared-SKU signal is deliberately non-embedding evidence; its conservative confirm gate stands) and none on the re-confirm pass in this change (its candidates come from the same registry, but production damage was all capture-side; extending the guard there is a cheap follow-up if its logs show the same class).
- No D1 schema change.

## Decisions

- **Guard constant `NORMALIZE_CONFIRM_MIN = 0.72`, applied in `resolveOne` after the confirm returns.** Calibration from all 38 production same/specialization decisions: every correct pick's chosen-candidate cosine was ≥ 0.736; the two confirmed disasters were 0.598 and 0.705. 0.72 sits between the worst bad (0.705) and the best-calibrated good band (0.736) with margin both ways; the brief's "~0.70" would have passed the 0.705 disaster, so the constant lands just above it. On rejection the term falls into `novelResolution` (verbatim mint — the classifier's canonical proposal accompanies only NOVEL outcomes), and the log detail records `{ note: "confirm_below_min", rejected: { outcome, match, score } }`. Rejecting rather than re-asking keeps the failure model two-outcome (defer / fail-safe-novel); fragmentation is cheap and self-healing (re-confirm + co-resolution passes own merging).
- **Scored candidates in the prompt; contract gains an advisory `canonical`.** `confirmIdentity` (and both job deps' `confirm`) takes `{ id, score? }[]` instead of `string[]`; the user message serializes `[{"id":…,"similarity":0.83}]` (score omitted when absent — the co-resolution pass has no cosine, by design). The SYSTEM_PROMPT gains: the distinct-product rule with the four production counter-examples (dates ≠ dried fruit blend, canned salmon ≠ fresh skin-on fillets, bread ≠ bread flour, a salt ≠ a fish sauce), the low-similarity-raises-the-bar guidance, and the NOVEL `canonical` field (clean lowercase product name, noise stripped, `base` or `base::detail`). One new few-shot ("dried medjool dates (pitted)" over a 0.74 "dried fruit blend" candidate → novel with canonical "medjool dates") demonstrates both at once. `validateConfirm` passes `canonical` through as string-or-null and NEVER errors on it — a malformed canonical must not burn the retry budget or fail a mint.
- **Canonical validation and collision live in the job, not the classifier module.** Consistent with the existing contract comment ("ids are constructed by the JOB, not trusted from the model"). `buildResolution` for a confirmed NOVEL uses the canonical when it passes `validateCanonicalId` — trimmed non-empty, all-lowercase, no `(`/`)`/`,`/newline, ≤ 64 chars, and every `::`-split segment non-empty with no stray `:` — AND is not an existing node id or alias variant (checked against a full id set including merged losers and unembedded nodes, plus every alias variant — the resolver's front door is the alias map, so a standing variant→other-node row would shadow a freshly minted node of the same name). Node `base`/`detail` derive from the canonical; `search_term` is the canonical flattened (`::` → space); the surface term is always the alias variant to whatever id wins. Invalid/missing/colliding canonical → verbatim mint with the reason in the log detail (`canonical_rejected` + `canonical_reason`). Below-floor mints never see a classifier, so they keep verbatim behavior by construction. The full id set is a new `NormalizeDeps.knownIds()` (a per-tick read of every identity id and alias variant, terms-gated like `identityEmbeddings`), appended with ids minted earlier in the tick.
- **Edge validation is a commit-time filter in `corpus-db.ts`, shared by `commitResolution` and `commitReconfirmEdges`.** A `filterCommittableEdges` helper reads `ingredient_identity(id, representative)` + `ingredient_edge(from_id, to_id)` (full-table + JS, the fake-D1 idiom), resolves both endpoints through `representativeResolver`, and drops: self-loops after resolution, and any edge whose reverse resolved pair exists in the DB (any kind) or earlier in the same batch. Kept edges insert with their ORIGINAL endpoints (read-time resolution is the existing contract). Skipped edges are appended to the decision's log `detail` as `edges_skipped: [{ from, to, kind, reason }]` — the log row rides the same batch, so the audit trail names exactly what was withheld. Commit-time (not `validateConfirm`-time) because the contradiction is against DB state the validator can't see, and because it also covers the re-confirm pass and edges synthesized by the job itself (the specialization `general` edge).
- **Embedding backfill is a bounded pre-drain pass inside `reconcileNormalization`.** New deps `embeddingless(limit)` (`SELECT id … WHERE embedding IS NULL AND representative IS NULL ORDER BY decided_at LIMIT ?`) and `storeEmbedding(id, vec)` (an UPDATE), cap `NORMALIZE_EMBED_BACKFILL_MAX_PER_TICK = 25`, embedding the readable form (`id.split("::").join(" ")`, the re-confirm pass's convention). It runs before `identityEmbeddings()` is read so backfilled nodes join the tick's own retrieval set, and it runs even on an empty queue (a human mint should become retrievable without waiting for novel-term traffic). Failures log-and-skip (rows stay NULL → retried next tick) and never fail the tick; a new `embedded` summary counter surfaces it in `job_health`.

## Risks / Trade-offs

- [A guard constant calibrated on 38 decisions may reject a true synonym ranked at 0.70–0.72] → Rejection mints a fragment, not corruption; the re-confirm and co-resolution passes merge true synonyms later. The constant is exported and log detail records every guard rejection, so recalibration is a one-line change with an audit trail.
- [Commit-time edge reads add two full-table SELECTs per committed resolution] → Tables are small (hundreds of rows) on the internal D1 bucket; consistent with the existing full-table + JS-filter idiom. Not batched across the tick to keep the `commit(r)` deps boundary unchanged.
- [Reverse-pair skip drops the NEW edge even when the OLD edge is the wrong one] → Deliberate: never auto-delete (edges are open-world hints; the operator can prune). Skipping keeps the graph acyclic-per-pair; log detail keeps the evidence.
- [Canonical collisions fall back to verbatim rather than aliasing to the existing node] → Deliberate conservatism: the classifier proposed the string, not an identity judgment against that node; the reconfirm/co-resolution passes own merging. Cost is a fragment.
- [The re-confirm pass gets no distance guard in this change] → Its `same` outcome merges (destructive-ish); mitigated by the prompt hardening + scored candidates it now shares, and flagged as the first follow-up if its logs show a distant merge.

## Migration Plan

Code-only; no D1 migration. Deploys with the normal Worker deploy. Existing bad rows (the production 2-cycle, free-text node ids) are operator repairs, out of scope. Rollback = revert the commit.

## Open Questions

None.
