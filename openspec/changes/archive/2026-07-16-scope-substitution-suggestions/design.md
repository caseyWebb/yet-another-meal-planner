## Context

Two deterministic substitution surfaces exist. **Surface A** — each to-buy row's
`substitutes[]` — is produced by the shared annotator `annotateSubstitutes`
(`substitute-annotator.ts`) and folded into the enriched to-buy read (`to-buy.ts`
`enrichView`). It runs a depth-1 identity-graph walk and returns *every* concrete neighbor
(capped at `SIBLINGS_CAP = 4`), each merely *annotated* `in_pantry` / `on_sale_hint`.
**Surface B** — the order dialog's same-identity SKU `alternatives` from
`suggestSubstitutions` (`substitutions.ts`) — is a separate op and is out of scope here.

The annotator is pure D1 plus a warmed-flyer KV read: zero Kroger product calls, run over
the whole to-buy set. Today it *excludes* any walked target already in the caller's to-buy
set. The problem: `in_pantry` is a decoration, not a gate, so a napa-cabbage line shows
"Try red cabbage?" whether or not the member has, is buying, or can deal on red cabbage.
Most rows carry un-actionable noise.

`enrichView` already loads everything the fix needs: the full grocery `list` (so `in_cart`
and active-list rows are in hand), the `pantry` names set, and the staleness-filtered flyer
`saleItems`. The walk and the flyer match are unchanged; only *which* walked targets survive
changes.

## Goals / Non-Goals

**Goals:**
- Surface a walked substitute only when it is **actionable**: in the pantry, in the cart, an
  active grocery-list line, or on sale at the primary store.
- Make on-sale an **independent** surfacing reason (surfaces even when not on hand); the
  three possession reasons require the member to actually have/be-getting the item.
- Carry the surfacing reason(s) on each returned substitute so the UI renders the
  justification, not a decoration.
- Keep the annotator pure D1 + warmed-flyer — no new reads, no Kroger call, no migration.

**Non-Goals:**
- Surface B (order-dialog same-identity `alternatives`) — untouched.
- Any new write path or one-tap accept semantics — accepting reuses the existing writes.
- Cross-ingredient sale substitution *computed at order time* — the sale nudge lives on the
  list, so no order-time graph-walk/flyer-match is built.

## Decisions

### 1. Filter lives in the annotator, over the full walk, before the cap

The actionability filter is applied inside `annotateSubstitutes`, so `substitutes[]` means
"actionable" for every consumer, and the behavior is unit-testable in one place.

Critically, the filter runs **before** the `SIBLINGS_CAP` truncation. Today
`identitySiblings` caps internally; if the cap ran first, a line whose four lexicographically
earliest neighbors are all non-actionable would filter to empty even when actionable
neighbors ranked 5th–6th exist. So the annotator takes the full ordered walk (call
`identitySiblings` uncapped), applies the actionability predicate preserving precedence
order, then slices to `SIBLINGS_CAP`. Alternative rejected: filtering in `enrichView` or the
UI — leaks the walk's precedence/cap logic out of the annotator and risks cap-then-filter
starvation.

### 2. Drop the to-buy-set exclusion; the filter subsumes it

The annotator's `excludeIds` (survivor ids of the whole to-buy set) is removed. Only the
self-line exclusion (`identitySiblings` already drops `neighbors.id`) remains. The
actionability filter then does the right thing on its own:
- a **plan-only virtual** to-buy line is not in the pantry, cart, or active list, so unless
  it is on sale it fails the filter and does not surface (preserving the old intent);
- an **active-list** line *does* satisfy reason (c), so it surfaces as a consolidation nudge
  (the new intent).

### 3. Membership sets are built in `enrichView` and threaded as deps

`enrichView` builds two `Set<string>` from the already-loaded `list`, keyed with
`storedGroceryKey(row, resolve)` (the same canonical-id space the walk's targets resolve to):
`inCartKeys` (rows with `status === "in_cart"`) and `activeListKeys` (rows with
`status === "active"`). Both are added to `AnnotateSubstitutesDeps` alongside the existing
`pantry`. No new reads — the pantry set is already threaded, and `list` is already a
parameter.

### 4. Reason fields on `SiblingSuggestion`

Add `in_cart?: boolean` and `on_list?: boolean` to `SiblingSuggestion` (in `order-shapes.ts`),
present-when-true, mirroring `on_sale_hint`'s present-when-matched style. `in_pantry` stays a
required boolean (unchanged, minimal blast radius). Every returned substitute has at least one
reason truthy by construction. The UI renders each truthy reason as its justification line.

### 5. Non-Kroger tenants keep the possession reasons

Pantry/cart/list are pure D1 and always available; on-sale requires a resolvable flyer. A
tenant with no Kroger location still gets possession-based actionable substitutes (and
label-keyed satellite on-sale hints where a rollup exists) — the same graceful degradation the
enriched read already documents, now filtered.

## Risks / Trade-offs

- **Cap-then-filter starvation** → filter the full walk before slicing to `SIBLINGS_CAP`
  (Decision 1); a unit test asserts an actionable neighbor ranked past the raw cap still
  surfaces.
- **ETag / snapshot staleness for cart/list edits** → `substitutes[]` now depends on the
  grocery list rowset. `GET /grocery/to-buy?enrich=1` ETags via `jsonWithEtag` over the whole
  response body, and the enriched body carries `substitutes[]`, so any cart/list edit that
  changes a surfacing reason changes the body and therefore the ETag automatically — no
  separate edge-marker to maintain. No action needed beyond the annotator change.
- **Consolidation-accept edge** → accepting an `on_list` substitute maps to the existing
  add-replacement + remove-original writes; the replacement is already on the list, so the add
  is covered by the existing duplicate-prevention path and the net effect is removing the
  original. No new write; behavior falls out of the unchanged accept requirement.
- **Sparser hints** → most rows will now show nothing. That is the intent (kill the noise);
  the "renders clean" scenario becomes the common case, and the inline-hint UI already handles
  an empty `substitutes[]` with no empty container.
