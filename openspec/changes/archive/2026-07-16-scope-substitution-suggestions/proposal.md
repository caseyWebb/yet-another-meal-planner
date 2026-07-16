## Why

The grocery-list substitution hints are too eager: the shared annotator surfaces
*every* concrete identity-graph neighbor of a to-buy line (siblings, generalizations,
membership co-children, captured taste edges), so a napa-cabbage line shows "Try red
cabbage?" whether or not the member owns, is buying, or can get a deal on red cabbage.
Most rows carry noise the member can't act on. A substitution is only worth showing
when it is *actionable* — the member already has it, is already getting it, or it is on
sale right now.

## What Changes

- Narrow each to-buy line's `substitutes[]` (Surface A — the enriched to-buy read's
  cross-ingredient hints) to only **actionable** substitutes. A substitute surfaces when
  its resolved id is:
  - **in the pantry** (a pantry row exists), or
  - **in the cart** (an `in_cart` grocery row), or
  - **already an active grocery-list line**, or
  - **on sale** at the member's primary store (the warmed flyer rollup matches).
- Sale is an **independent** surfacing reason — an on-sale substitute surfaces even when
  the member does not already have it. The other three reasons require possession.
- **BREAKING (annotator behavior):** the annotator's current rule that *excludes* any
  substitute already in the caller's to-buy set is flipped for active-list membership —
  being on the list becomes a *reason to surface* (a consolidation nudge), not a reason
  to hide. The self-line exclusion and representative resolution are unchanged.
- The per-substitute annotation flips from decoration into the **justification**: each
  surfaced substitute is labeled with why it appeared — "in your pantry" / "in your cart"
  / "already on your list" / "on sale — $X".
- A line with no actionable substitute renders clean (empty `substitutes[]`), as today —
  which is now the common case.

Out of scope: Surface B (the order dialog's same-identity SKU `alternatives` from
`suggestSubstitutions`) is untouched. No new write operation; acting on a hint reuses the
existing writes. The annotator stays pure D1 + warmed-flyer, zero Kroger product calls.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `member-app-differentiators`: the "Sibling suggestions are a labeled depth-1 walk"
  requirement gains an actionability filter (pantry ∪ cart ∪ active-list ∪ on-sale) over
  the walk's output, with on-sale as an independent surfacing reason; the to-buy-set
  exclusion flips for active-list membership. The "Inline substitute hints on the to-buy
  list" requirement reframes the per-substitute annotation as the surfacing justification.

## Impact

- **Code:** `packages/worker/src/substitute-annotator.ts` (`annotateSubstitutes` — filter
  + cart/list membership inputs), `packages/worker/src/to-buy.ts` (`enrichView` threads
  the already-loaded cart/active-list key sets into the annotator deps).
- **UI:** `packages/ui/src/components/grocery-list.tsx` (inline hint copy → justification).
- **Tests:** `packages/worker/test/substitutions.test.ts`,
  `packages/worker/test/substitution-capture.test.ts`, and the Playwright
  `packages/worker/app/visual/specs/substitutions.spec.ts`.
- **Contract/shape:** `SiblingSuggestion` (in `order-shapes.ts`) may gain a surfacing-reason
  field; `on_sale_hint`/`in_pantry` semantics reframed. No D1 migration, no tool param
  change, no Kroger-cost change.
- **Docs:** none required (tool contract and schemas unchanged); spec deltas only.
