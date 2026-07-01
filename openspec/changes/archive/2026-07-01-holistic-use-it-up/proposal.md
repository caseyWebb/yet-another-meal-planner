## Why

`propose_meal_plan` today "uses up" perishables only shallowly and only when *asked*: the caller passes `boost_ingredients`, and each slot's pool gets one **uniform, static** pantry-overlap nudge (`pantryOverlap` in `semantic-search.ts`). That nudge is identical for every slot, never decrements as items get consumed, and is blind to quantity — so it can't do the thing a home cook actually wants: look at everything going bad in the fridge and **spread it across the week's recipes**, splitting a multi-serving item (a big bunch of cilantro, a family pack of ground beef) across two dinners without anyone typing "use up my cilantro."

Concretely, given A/B/C/D at risk (D worth two cooks), the desired plan is "recipe 1 uses A, B, and half the D; recipe 2 uses B, C, and the rest of the D" — emergent from the plan, not from an explicit use-it-up query. The current per-slot boost can't produce that: it double-credits D on every slot (no decrement) and never reasons about the plan as a *set* covering the fridge. This is the classic **weighted set-cover** shape, and the planner already fills slots **sequentially threading one selection state** — the exact place to fold coverage in.

## What Changes

- **NEW** an always-on **holistic at-risk coverage** term in the sequential fill. The planner derives an at-risk **demand multiset** from the caller's pantry (perishables, alias-normalized, weighted by age, with a coarse `quantity → count` so a multi-serving item demands multiple cooks), threads it through the cross-slot selection, and **credits each candidate for the still-uncovered demand it would satisfy** — decrementing the multiset on each pick so a multi-serving item's coverage **splits across two recipes** and a single-count item is credited once. Keyword + alias set-membership only (tiered perishable/key weights), **no vectors** — matching how the existing overlap works.
- **NEW** the demand is **derived, not asked**: it comes from the loaded pantry every call (always-on, holistic), so use-it-up happens without the caller stating it. The existing `boost_ingredients` param stays as an explicit **override/addition** ("definitely use these") folded into the same multiset.
- **NEW** **residual reporting**: after the whole plan is assembled, surface the at-risk demand that stayed **uncovered** (`uncovered_at_risk` at plan level) and refine each main's `uses_perishables` / `why` to name the at-risk items it actually **claimed** ("uses your cilantro, going bad"), not just any listed perishable.
- **UNCHANGED** the determinism, the hard gate, and the MMR + facet-cap diversity: coverage is an **additive, bounded, gate-respecting** term subordinate to vibe relevance — it can never admit a diet/reject/makeability-gated recipe, never drag a wildly off-vibe recipe into a slot, and stays reproducible given a seed. `search_recipes`' passive single-query boost is untouched.

## Capabilities

### New Capabilities

- `holistic-use-it-up`: the always-on, cross-recipe at-risk-perishable coverage layer the meal-plan planner applies during the sequential fill — deriving the pantry demand multiset (alias-normalized perishables, age-weighted, quantity→count), the decrementing weighted set-cover credit in selection (multi-serving split, single-count-once), the bound/gate discipline that keeps it subordinate to relevance and the hard gate, and the residual (`uncovered_at_risk`) + per-main claimed-item reporting.

### Modified Capabilities

<!-- None. This augments the `meal-plan-proposal` planner's sequential fill with an additive,
     subordinate coverage term; it does not change meal-plan-proposal's stated requirements
     (the hard gate, MMR + caps diversity, statelessness, determinism all still hold). Authored
     as a new capability to stay archival-order-independent of the still-unarchived
     propose-meal-plan-tool change, mirroring night-vibe-archetype-derivation. -->

## Impact

- **`src/diversify.ts`:** `DiversifyState` gains a `remainingAtRisk` demand multiset; `selectOne` adds the bounded coverage term to its objective and decrements the multiset on each pick (pure, deterministic). `newDiversifyState` seeds it.
- **`src/meal-plan-proposal.ts`:** `ProposalCtx` carries the derived at-risk demand (counts, not just names); the compose step reports `uncovered_at_risk` and refines per-main `uses_perishables`/`why` from what was actually claimed.
- **`src/meal-plan-proposal-tool.ts`:** load pantry, derive the at-risk multiset (perishable membership via the corpus vocabulary, age from `added_at`, `quantity → count`), merge `boost_ingredients` as an override, and stop double-applying the uniform pool boost for use-it-up (the stateful term becomes the single home for it inside the planner).
- **Reuses (no schema change):** `pantry` rows (`quantity`, `added_at`, `normalized_name`), the alias table, `perishable_ingredients`/`ingredients_key` on the index. **No new tables, no migration.**
- **Docs (lockstep):** `docs/TOOLS.md` (`propose_meal_plan` — always-on use-it-up, `uncovered_at_risk`, `boost_ingredients` now an override), `docs/ARCHITECTURE.md` (the set-cover-in-the-fill note). No `SCHEMAS.md` change.
- **`AGENT_INSTRUCTIONS.md`:** none required — use-it-up is now emergent; the persona no longer needs to pass `boost_ingredients` to get it (may still, to override).
