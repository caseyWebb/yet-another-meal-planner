## 1. Shape

- [x] 1.1 Add `in_cart?: boolean` and `on_list?: boolean` to `SiblingSuggestion` in `packages/worker/src/order-shapes.ts` (present-when-true, mirroring `on_sale_hint`); update the doc comment to name the four surfacing reasons.

## 2. Annotator filter

- [x] 2.1 In `packages/worker/src/substitute-annotator.ts`, extend `AnnotateSubstitutesDeps` with `inCart: ReadonlySet<string>` and `onList: ReadonlySet<string>` (the caller's `in_cart` and active grocery-list keys).
- [x] 2.2 Take the full ordered walk (call `identitySiblings` uncapped — pass `cap = Infinity`) and drop the to-buy-set exclusion (`excludeIds`); keep only the self-line exclusion that `identitySiblings` already applies.
- [x] 2.3 Compute each walked target's reasons — `in_pantry` (existing `pantry` set), `in_cart` (`deps.inCart`), `on_list` (`deps.onList`), and `on_sale_hint` (existing `flyerHint`) — and keep a target only when at least one reason is truthy (on-sale independent; the three possession reasons require membership).
- [x] 2.4 Slice the surviving, precedence-ordered targets to `SIBLINGS_CAP`, and set `in_cart`/`on_list` only when true on each returned `SiblingSuggestion` (alongside the existing `in_pantry` and optional `on_sale_hint`).

## 3. Enriched read wiring

- [x] 3.1 In `packages/worker/src/to-buy.ts` `enrichView`, build `inCartKeys` and `activeListKeys` `Set<string>` from the already-loaded `list` via `storedGroceryKey(row, resolve)` (statuses `in_cart` and `active`), and thread them into the `annotateSubstitutes` deps. Confirm no new reads are introduced.

## 4. Inline-hint UI

- [x] 4.1 In `packages/ui/src/components/grocery-list.tsx`, render each substitute's surfacing justification from its reasons — "in your pantry" / "in your cart" / "already on your list" / "on sale — $X" — reusing/adding the `subs-*` testids; keep the accept (by line origin) and per-session dismiss unchanged, and keep an empty `substitutes[]` rendering clean.
- [x] 4.2 Extend the agent-facing snapshot renderer `grocerySnapshotText` (`packages/worker/src/grocery-snapshot.ts`) — a second `substitutes[]` consumer — to name the new `in_cart` ("in cart") and `on_list` ("on list") reasons alongside the existing pantry/promo annotations. (Scope discovered during apply.)

## 5. Tests

- [x] 5.1 Update `packages/worker/test/substitutions.test.ts`: assert non-actionable neighbors are dropped, each possession reason surfaces with its flag, on-sale surfaces independently (no possession), an active-list substitute surfaces flagged `on_list`, and a no-actionable line returns empty. (`substitution-capture.test.ts` is capture-side and needed no change.)
- [x] 5.2 Add a regression test that an actionable neighbor ranked past the raw `SIBLINGS_CAP` still surfaces (filter-before-cap), a survivors-cap test, and a `to-buy.ts` integration test that a plan-only virtual line does not surface (with the consolidation asymmetry) — plus the two-active-list-lines consolidation test.
- [x] 5.3 Add a snapshot-renderer test (`grocery-snapshot.test.ts`) for `in_cart`/`on_list`; add a mocked Playwright test in `app/visual/specs/substitutions.spec.ts` asserting the `in_cart`/`on_list` justifications render; seed keeps the live family actionable (pantry + shared-base sale) so the existing live and empty-affordance specs still hold.
- [x] 5.4 Run `aubr typecheck` (recursive, clean), `aubr test` (worker 2792 passed; ui/app 105 passed), `aubr test:app` (substitutions spec), and `openspec validate "scope-substitution-suggestions"`.
