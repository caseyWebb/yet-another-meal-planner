## ADDED Requirements

### Requirement: Always-on holistic at-risk coverage

The `propose_meal_plan` planner SHALL apply a holistic at-risk **coverage** term across the week's mains on **every** call, derived from the caller's pantry, WITHOUT requiring the caller to request use-it-up. The planner SHALL build an at-risk **demand multiset** from the pantry — each entry an alias-normalized perishable item and a coarse count — and thread it through the sequential cross-slot selection so the plan, taken as a set, covers as much of the at-risk demand as it can. The existing `boost_ingredients` param SHALL remain supported as an explicit **override**, unioned into the same demand multiset, not as the only way to trigger use-it-up.

#### Scenario: Use-it-up happens without an explicit request

- **WHEN** a caller requests a plan and has at-risk perishables in their pantry but passes no `boost_ingredients`
- **THEN** the planner still favors mains that consume those at-risk perishables, spreading them across the week's slots

#### Scenario: An explicit override is honored, not required

- **WHEN** a caller passes `boost_ingredients`
- **THEN** those items are added to the derived at-risk demand (a guaranteed part of the cover), and the pantry-derived items still participate

### Requirement: Quantity-aware coverage split

The coverage term SHALL be a **decrementing weighted set-cover** over the demand multiset: each candidate is credited only for the demand that is **still uncovered** at selection time, and on selection the covered items' counts are decremented (to a floor of zero). A **multi-serving** at-risk item (count > 1) SHALL therefore be able to be covered by **more than one** main across the week, while a **single-count** item SHALL be credited to at most **one** main (covering it again adds no marginal value). Item→candidate matching SHALL use alias-normalized **set membership** over the recipe's `perishable_ingredients` and `ingredients_key` (tiered: a perishable match weighs more than a key-only match), **not** vector similarity.

#### Scenario: A multi-serving item splits across two mains

- **WHEN** an at-risk item's derived count is two and two different mains each list it
- **THEN** the planner can select both, and each is credited for that item once (the item is used across two recipes)

#### Scenario: A single-count item is credited once

- **WHEN** an at-risk item's count is one and several mains list it
- **THEN** only the first-selected main is credited for it; later mains that also list it receive no additional coverage credit for that item

#### Scenario: Coverage matching is keyword + alias, not vectors

- **WHEN** the planner scores coverage for a candidate
- **THEN** it counts alias-normalized membership of the candidate's `perishable_ingredients` / `ingredients_key` in the still-uncovered demand, with no embedding cosine involved in the coverage term

### Requirement: Coverage is bounded, gate-respecting, and deterministic

The coverage term SHALL be **additive and subordinate** to vibe relevance: it operates **only over survivors of the hard gate** (diet / reject / makeability), so it SHALL NOT admit a recipe the gate excluded; its per-candidate contribution SHALL **saturate** so one item-rich recipe cannot claim every slot; and it SHALL be weighted so a saturated cover can overcome a **moderate** relevance gap but cannot pull a decisively off-vibe recipe into a slot. Selection SHALL remain **deterministic given a seed** — identical pantry, inputs, and seed yield the identical week — with the coverage term computed as pure arithmetic over the threaded selection state (no new randomness, no AI call).

#### Scenario: Coverage never overrides the hard gate

- **WHEN** a recipe that would cover an at-risk item is excluded by the diet / reject / makeability gate
- **THEN** it is never selected, regardless of how much at-risk demand it would satisfy

#### Scenario: Coverage is bounded against relevance

- **WHEN** covering an at-risk item requires a recipe that is decisively off the slot's vibe (a relevance gap well beyond the coverage budget)
- **THEN** the on-vibe recipe is still chosen and the at-risk item is left for another slot or reported as uncovered

#### Scenario: Same seed, same plan

- **WHEN** the same pantry, inputs, and seed are supplied twice
- **THEN** the identical week — including which at-risk items each main covers — is returned

### Requirement: Residual and claimed-item reporting

After the plan is assembled, the tool SHALL report the at-risk demand that remained **uncovered** as a plan-level `uncovered_at_risk` list, and each main's `uses_perishables` (and its `why`) SHALL name the at-risk items that main actually **claimed** (decremented from the demand), not merely any perishable it happens to list. Reporting SHALL NOT fabricate coverage — an item appears under a main only if that main was credited for it.

#### Scenario: Uncovered at-risk items are surfaced

- **WHEN** the assembled plan does not consume every at-risk item
- **THEN** the response includes the still-uncovered at-risk items at plan level, so the caller can re-roll, lock, or shop around them

#### Scenario: A main reports only what it claimed

- **WHEN** a main lists a perishable that an earlier main already fully covered
- **THEN** that item does not appear in this main's `uses_perishables` (it was not credited to this main)
