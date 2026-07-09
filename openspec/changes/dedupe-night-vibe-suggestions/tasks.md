# Tasks — dedupe-night-vibe-suggestions

Ordered Worker-inward: the pure dedupe module (§1) and the queue store (§2) land unit-tested
before the `runDerivation` wiring (§3) composes them; docs (§4) move in the same pass. **No
spike tasks** — every open question is settled in design.md (D1–D8) against the code and the
2026-07-08 production spike. No migration, no route, no UI, no wrangler change.

## 1. Worker: the pure dedupe module

- [x] 1.1 Add `packages/worker/src/night-vibe-dedupe.ts` (pure, no I/O — the
  `night-vibe-derive.ts` discipline): `planQueueConvergence(pending, basis, threshold)` over
  `pending: { id, vibe, created_at }[]` (caller pre-sorts or the function sorts by
  `(created_at ASC, id ASC)`; sort inside for safety) and
  `basis: { paletteVecs, rejectedVecs }`, with a `vecOf(phrase)` lookup injected as a
  prebuilt `Map<phrase, number[]>` — returns
  `{ superseded: { id, coveredBy: "palette" | "rejected" | string }[], representatives: { id, vibe }[] }`
  per design D4 (palette check, then rejected, then earlier-representative; representative =
  earliest created_at, tiebreak lowest id; comparison to representatives only, not transitive).
  And `filterCandidates(candidates, basisVecs, vecOf, threshold)` — drops a candidate within
  the threshold of any basis vector or of an earlier kept candidate, returning the kept list
  (design D1(d): within-run dedup is first-kept-wins). Reuse `cosineSimilarity`; default the
  threshold to `DEFAULT_DERIVE_PARAMS.dedupThreshold` (D2).
- [x] 1.2 `packages/worker/test/night-vibe-dedupe.test.ts` (vitest, off-`workerd`): synthetic
  unit vectors pinning — palette-covered supersedes; rejected-covered supersedes;
  group-collapse keeps the earliest (created_at then id tiebreak); idempotence (re-running
  over the survivors supersedes nothing); the sweep never emits a non-pending id (input is
  pending-only by contract — assert the plan touches only given ids); `filterCandidates`
  drops palette/pending/rejected-near candidates and the second of two near-identical
  candidates while keeping orthogonal ones; threshold boundary (≥ vs <). Include a
  production-shaped fixture distilled from design.md's casey rows (4 groups, 10 → 4).

## 2. Worker: the queue store

- [x] 2.1 `packages/worker/src/reconcile-db.ts`: widen `PendingProposal["status"]` to
  `"pending" | "accepted" | "rejected" | "superseded"`; add
  `supersedeProposals(env, tenant, ids, nowIso)` — one guarded UPDATE
  (`SET status='superseded', resolved_at=?  WHERE tenant=? AND id IN (…) AND
  status='pending'`, chunked if needed), returning rows changed. `setProposalStatus` stays
  member-verb-only (`accepted | rejected`).
- [x] 2.2 Extend `packages/worker/test/reconcile.test.ts`: `supersedeProposals` flips only
  pending rows (an accepted/rejected id in the list is untouched — the "dismissals never
  rewritten" guarantee at the store layer) and stamps `resolved_at`; `resolveProposal`
  against a superseded id answers the structured `conflict` naming `superseded`;
  `readProposals(…, "pending")` excludes superseded rows.

## 3. Worker: `runDerivation` wiring

- [x] 3.1 `packages/worker/src/night-vibe-suggest.ts` — compose per design D7: gate the
  cold-start fallback on `existingVibes.length === 0` (D6); read pending + rejected
  `add_vibe` proposals (`readProposals` × 2, filter `kind === "add_vibe"`, phrase from
  `payload.vibe` — skip rows without a string phrase); build the phrase-vector map with ONE
  `embedTextsCached` batch over pending + rejected + candidate phrases + palette vibes
  missing a `night_vibe_derived` row (stored palette vectors come from the already-loaded
  `paletteVecs`) (D3); run `planQueueConvergence` → `supersedeProposals`; run
  `filterCandidates` (basis: palette ∪ missing-palette ∪ rejected ∪ surviving-representative
  vectors) before the enqueue loop (exact-id skip + stable-id idempotency unchanged);
  `DerivationResult` gains `superseded: number`. Fix the now-true module comment about
  steady-state no-op; keep the sweep running even when `candidates` is empty.
- [x] 3.2 `runArchetypeDerivationJob`: fold `superseded` into the health/run summary and the
  usage counts (`{ members, enqueued, superseded }`).
- [x] 3.3 Tests: a `night-vibe-suggest` suite (vitest + `test/fake-d1.ts`, `vi.mock` the
  embedding module to a deterministic fake keyed by phrase): a queue of accumulated
  paraphrases converges (earliest survives, others superseded, `resolved_at` set); a
  candidate near a pending/rejected/palette phrase is not enqueued; a palette-holding
  thin-history member gets `source: "none"`, zero namer calls, and the sweep still runs; an
  empty-palette member still cold-starts; result carries `superseded`. Confirm
  `test/api-member.test.ts`'s mocked `runDerivation` shape still typechecks (add
  `superseded: 0` to the stub).
- [x] 3.4 `aubr typecheck` + `aubr test` green.

## 4. Docs (same pass, lockstep)

- [x] 4.1 `docs/TOOLS.md` — `suggest_night_vibes`: the phrase-space dedup guarantee (palette,
  pending, rejected, within-run), the cold-start empty-palette gate, and the return shape
  `{ candidates, enqueued, superseded, source }`; `confirm_proposal`: already-resolved wording
  covers superseded.
- [x] 4.2 `docs/SCHEMAS.md` — `pending_proposals.status`:
  `pending | accepted | rejected | superseded` with the one-line semantics (system-resolved by
  the derivation convergence sweep; never member-set). Mirror the enum comment in migration
  0027's successor? No — migrations are immutable; the doc is the living source.
- [x] 4.3 `docs/ARCHITECTURE.md` — the archetype-derivation paragraph (§ the generate half):
  describe the phrase-space dedup + queue convergence + cold-start gate as current state and
  remove the "chronically-rejected archetype is re-named each run … deferred refinement"
  residual (no history narration).

## 5. Verification

- [x] 5.1 `openspec validate "dedupe-night-vibe-suggestions"` passes; PR from the template
  with every consideration checked.
- [ ] 5.2 Post-deploy acceptance (first `archetype-derive` run after merge, ~20 h cadence):
  re-run the design.md spike queries read-only and assert the invariant — no same-tenant
  pending `add_vibe` pair at phrase cosine ≥ 0.85; no pending ≥ 0.85 to a palette or rejected
  phrase; rejected rows byte-identical; casey's pending count flat across the following tick
  (the D6 gate) — with the enumerated 2026-07-08 rows (design.md fixture) among the
  superseded.
