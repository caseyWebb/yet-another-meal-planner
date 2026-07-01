## 1. Stateful coverage in the selection core (de-risk the math first)

- [x] 1.1 `src/diversify.ts` — extend `DiversifyState` with `remainingAtRisk: Map<string, number>` (the demand multiset, item → still-uncovered count); `newDiversifyState()` seeds it empty. Add coverage tuning to `DiversifyParams` (`coverageWeight`, plus reuse of the tiered `perishWeight`/`keyWeight`/`overlapCap` shape from `semantic-search.ts`), defaulted in `DEFAULT_DIVERSIFY_PARAMS`. `DiversifyCandidate` gains `perishable_ingredients`/`ingredients_key` (the coverage-term inputs).
- [x] 1.2 `selectOne` — add the bounded coverage term `coverageWeight · cover(c)` to the MMR objective (`coverageGain` sums tiered weight of each candidate item **still** in `remainingAtRisk` (>0), saturated at `overlapCap`); on pick, **decrement** each claimed item's count to a floor of 0 and return `claimed` on the pick. Pure, deterministic, gate-agnostic (still only reorders survivors).
- [x] 1.3 `admit` (locked picks) also decrements the demand for items the locked recipe claims (returns them), so a locked use-it-up recipe doesn't leave its items falsely uncovered.
- [x] 1.4 `test/diversify.test.ts` (+10) — coverage picks an at-risk recipe over an equally-relevant non-cover; multi-serving (count 2) splits across two mains to zero; single-count credited once; saturation caps a hoarder; key-tier < perishable-tier; `coverageWeight=0` reduces to plain MMR; determinism; `admit` consumes; no-demand no-op.

## 2. Derive the at-risk demand from the pantry (always-on)

- [x] 2.1 `src/use-it-up.ts` (pure, tested) — `deriveAtRiskDemand`: keep pantry items that are perishable (member of the corpus **perishable vocabulary**, alias-normalized union of `perishable_ingredients`) past the freshness floor, mapping `quantityToCount` (`full`→2, explicit leading count→that capped, else→1). Age available as a floor knob (default 0 = always-on; weight curve deferred, Open Question). `meal-plan-proposal-tool.ts` loads `readPantry`, builds the vocab, and normalizes pantry names via the same `normalizeItems`.
- [x] 2.2 Union `boost_ingredients` (normalized) into the demand as an explicit override (never lowering a larger pantry count); thread the multiset into `ProposalCtx.atRiskDemand`.
- [x] 2.3 `buildPool` — passes empty `boostItems` to `rankCandidates` (pool score = pure vibe relevance), so the stateful coverage term is the single home for use-it-up (no double-count). Candidate `perishable_ingredients`/`ingredients_key` populated via `toDiversify` (locked + pool sites). `search_recipes`' passive boost untouched.
- [x] 2.4 `assembleProposal` seeds `state.remainingAtRisk` from `ctx.atRiskDemand` before the fill loop.

## 3. Residual + claimed-item reporting

- [x] 3.1 `src/meal-plan-proposal.ts` — after the fill, the leftover `remainingAtRisk` (>0) becomes plan-level `uncovered_at_risk`; each main's `uses_perishables` is set from the pick's `claimed` (locked picks from `admit`'s returned claim), with a "uses your X (going bad)" `why`. The per-slot single-use `flags.waste` stays as a hint.
- [x] 3.2 `ProposalResult` gains `uncovered_at_risk`; wired through the tool return (+ the empty-palette early return).
- [x] 3.3 `test/meal-plan-proposal.test.ts` (+5) — always-on coverage with no boost; multi-serving split across two slots; `uncovered_at_risk` names the leftovers; a main reports only claimed items; coverage can't conjure an item outside the gated pool.

## 4. Docs (lockstep)

- [x] 4.1 `docs/TOOLS.md` — `propose_meal_plan`: use-it-up is now always-on (pantry-derived), `boost_ingredients` is an override, and the return carries `uncovered_at_risk`. Tool `description` string updated in lockstep.
- [x] 4.2 `docs/ARCHITECTURE.md` — the set-cover-in-the-fill note (demand multiset threaded through the sequential selection; keyword+alias, no vectors; residual honesty). No `SCHEMAS.md` change (no new tables).

## 5. Verify

- [x] 5.1 `aubr typecheck` + `aubr test` green (1362 passing; +21 across `diversify` / `meal-plan-proposal` / new `use-it-up`).
- [~] 5.2 The synthetic spike harness (`spike/meal-plan-examples/use-it-up.*`) is upgraded to the new API and now asserts the coverage term reaches **IDEAL — 4/4, D-split 2** on the controlled scenario (legacy boost got 2/4, split 1). Re-running it against the **real corpus** to finalize `coverageWeight` / `quantity→count` / age floor from the Open Questions remains **manual** (needs real pantry + corpus).
- [x] 5.3 `openspec validate "holistic-use-it-up"` passes.
