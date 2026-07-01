## Context

`propose_meal_plan` fills a week's slots **sequentially, threading one `DiversifyState`** across them (`assembleProposal` → `selectOne` in `src/diversify.ts`), so protein/cuisine caps and MMR de-duplication already span the whole week. Use-it-up, by contrast, is bolted on as a **uniform per-slot relevance nudge**: the tool passes `boost_ingredients` into `rankCandidates`, whose `pantryOverlap` adds a small (≤ `pantryWeight` = 0.12), **static, identical** boost to every slot's pool. That boost is baked into the pool score *before* selection, never decrements, and is quantity-blind.

A controlled spike (synthetic 11-recipe corpus, hand-built embeddings so every vibe↔recipe gap is exact; at-risk A=cilantro, B=bok choy, C=salmon, D=ground beef ×2; distractors sit on-vibe at cosine ≈ 0.985) measured exactly how far short that falls:

| | coverage | D-split (ground-beef uses) |
|---|---|---|
| **IDEAL** (coordination-aware) | 4/4 | 2 |
| baseline (`boost=[]`) | 0/4 | 0 |
| explicit `boost_ingredients` (today) | **2/4** | **1** |

The explicit boost only rescues an at-risk recipe when it can win its slot *on its own* — R2 carried **two** at-risk items so its boost saturated at +0.12, enough to beat the tofu distractor. Every single-item cover (cilantro, +0.06) and every recipe whose vibe home is decisively owned by a distractor (vibe gap ≈ 0.22 ≫ 0.12) stayed buried, and a multi-serving item never got a second home. Two structural gaps: **no cross-slot coverage coordination** and **no quantity awareness**. Both are the weighted-set-cover shape, and the sequential fill is the natural place to fold it in.

## Goals / Non-Goals

**Goals:**
- Holistic, **always-on** use-it-up: derive the at-risk demand from the pantry every call and spread it across the week's mains without the caller asking.
- **Quantity-aware split**: a multi-serving at-risk item is covered by *multiple* mains (D used twice); a single-count item is credited **once**.
- Keep it **keyword + alias set-membership** (tiered perishable/key weights), **no vectors** — the mechanism the existing overlap already uses.
- Stay **subordinate and safe**: additive, bounded coverage term; never admits a gated-out recipe; never drags a wildly off-vibe recipe into a slot; reproducible given a seed.
- **Residual honesty**: report the at-risk demand the plan couldn't cover; name per main what it actually claimed.

**Non-Goals:**
- Portion math / precise quantities. `quantity` is loose ("full"/"partial"/"low"/count) by design (the whiteboard-problem stance); coverage uses a **coarse** count, not grams.
- Re-ordering the week to optimize the cover. The sampled fill order (shape + cadence) is preserved; greedy-in-order is the approximation (see D5, Open Questions).
- Changing `search_recipes`' passive single-query pantry boost, or the `meal-plan-proposal` hard gate / MMR / cap contract.
- New tables or a migration. Everything reuses `pantry`, the alias table, and the index facets.
- An LLM in the loop. The whole term is deterministic arithmetic over stored state.

## Decisions

### D1 — Coverage is a stateful term in `selectOne`, not a pre-baked pool boost
The uniform `pantryOverlap` boost is the wrong shape: identical every slot, no decrement. Instead thread a **demand multiset** `remainingAtRisk: Map<item, count>` through `DiversifyState` and add a coverage term to `selectOne`'s objective:

```
val = λ·relevance − (1−λ)·redundancy + coverageWeight·cover(c) + jitter
cover(c) = Σ over items the candidate lists that STILL have remainingAtRisk>0,
           tiered: perishWeight if in perishable_ingredients else keyWeight if in ingredients_key,
           saturated at overlapCap
```
On pick, **decrement** `remainingAtRisk[item]` by 1 for each item the candidate claimed (down to 0). So the *marginal* value of covering an already-covered item is 0 — canonical greedy weighted set-cover. The pool ranking (`buildPool`) drops the use-it-up boost (pass empty `boostItems`) so the stateful term is the **single home** for use-it-up inside the planner and there's no double-count. *Alternative — keep the pool boost and add the term:* rejected, double-counts and the static half can't decrement.

### D2 — The demand is DERIVED from the pantry, always on
The multiset is built in the tool wrapper from the loaded `pantry` rows, every call — that's what makes it holistic rather than asked:
- **Perishable?** normalized item name ∈ the corpus **perishable vocabulary** (the alias-normalized union of every recipe's `perishable_ingredients`). Deterministic, needs no per-item shelf-life table, and guarantees the item is one a recipe can actually consume.
- **At-risk weight** from `added_at` age — older perishables weigh more (closer to spoiling). A freshness floor keeps a just-bought item out (it isn't at risk yet).
- **`quantity → count`** (coarse): `"full"` → 2, `"partial"`/`"low"` → 1, an explicit numeric → that (capped). This count is the item's set-cover demand — the multi-serving split falls straight out of it.

`boost_ingredients` stays as an explicit **override**: its items are unioned in (with a guaranteed count) so the caller can still say "definitely use these," but the common case needs no param. *Alternative — expiry column on pantry:* rejected, no such column exists and the whiteboard stance is deliberate; age + perishable-membership is the honest proxy.

### D3 — Bounded and gate-respecting, tuned to beat a real vibe gap
Coverage must be strong enough to win a slot for an at-risk recipe (the spike shows the passive +0.12 loses to a ~0.22 vibe gap) yet never strong enough to admit junk. So: it operates **only over hard-gate survivors** (same as MMR — it reorders, never admits), it **saturates** (an item-hoarding recipe can't run away with every slot), and `coverageWeight` is set so a saturated cover can overcome a **moderate** vibe gap but a decisively off-vibe recipe (gap ≫ budget) still stays out. The exact value is the primary tuning knob (Open Questions) — the spike gives the target: it must clear realistic gaps (~0.2) for at-risk items without clearing the ~0.22+ gaps that mark a genuinely wrong dish.

### D4 — Residual is the truer waste signal; keep the single-use flag as a hint
After the plan is assembled, any `remainingAtRisk[item] > 0` is **uncovered at-risk demand** — surface it as a plan-level `uncovered_at_risk` ("you still have salmon and cilantro going bad this plan doesn't use"). Each main's `uses_perishables`/`why` names the at-risk items it actually **claimed** (decremented), not merely any perishable it lists. The existing per-slot `flags.waste` (a perishable no *other* main shares) stays as a cheap hint, but residual demand is the authoritative "still going bad" view. *Alternative — redefine `flags.waste` as residual:* avoided to keep the change archival-order-safe and non-breaking; residual is a new plan-level field layered on top.

### D5 — Greedy in the sampled fill order, determinism preserved
Set-cover quality depends on order, but re-ordering the week would fight the shape/cadence sampling and the determinism guarantee. Keep the **sampled fill order**; greedy weighted set-cover in that fixed order is the approximation — and it's exactly the "constructed in sequence" behavior the exploration wanted. The term is pure arithmetic over the threaded state, so the plan stays reproducible given a seed; only jitter is random. A coverage-aware fill-order refinement (most-constrained item first, or a second pass) is a future option, noted below, not this change.

## Open Questions

- **`coverageWeight` value.** Must let a saturated cover overcome a moderate vibe gap (spike: passive +0.12 lost to a 0.22 gap) while staying subordinate to the gate and to a decisively-off-vibe rejection. Start from the spike geometry (target: clear ~0.2, not ~0.25+) and confirm against the real corpus; expose it as a param alongside `lambda` so it's tunable without a redeploy.
- **`quantity → count` mapping.** `"full"→2, partial/low→1` is a first guess; the real distribution of pantry `quantity` strings (and how often a "full" bunch truly feeds two dinners) should calibrate it. Cap the count so one hoarded item can't demand the whole week.
- **Age → at-risk weight curve + freshness floor.** How old before a perishable counts as at-risk, and how steeply weight rises with age. Needs the real `added_at` distribution; conservative floor to start (don't nudge a fresh item).
- **Perishable-vocabulary membership vs. a staples `perishable` flag.** Corpus-vocabulary membership is the default at-risk test; whether to also honor the `staples.perishable` flag (or a pantry `notes` hint) is a refinement.
- **Fill-order optimality.** Greedy-in-order leaves cover on the table vs. a coordination-aware order (spike IDEAL 4/4 vs. achievable-in-order). Measure the gap on the real corpus before deciding whether a second pass is worth it.

## Risks / Trade-offs

- **Over-nudging into off-vibe dinners.** Mitigated by the saturation + `coverageWeight` bound + gate-only operation; the spike harness (re-run on the real corpus) is the guardrail — watch that vibe relevance doesn't visibly degrade.
- **Greedy leaves cover unclaimed.** Accepted for determinism/shape integrity; `uncovered_at_risk` makes the residual **honest** rather than hidden, and the caller can re-roll or lock to chase it.
- **Coarse quantity mis-estimates the split.** Low blast radius — a wrong count only over/under-demands a nudge, never gates anything; `quantity` is loose by design.
- **Cross-tenant safety.** Pantry is per-tenant; the derivation reads only the caller's rows — no new cross-tenant surface.
