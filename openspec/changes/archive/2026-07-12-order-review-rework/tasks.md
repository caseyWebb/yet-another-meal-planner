## 1. Grocery foundation and shared contracts

- [x] 1.1 Rebase after `grocery-list-page-and-widget` lands and inventory its `GroceryListData`, snapshot-version, send-group, shared-controller, member-adapter, MCP bridge, and test-harness seams; remove any now-duplicated assumptions from this change.
- [x] 1.2 Define `OrderReviewData`, `OrderReviewStage`, matched/decision/search/divergence lines, brand-save receipt, `OrderReviewModelContext`, fingerprint divergence, and discriminated send/outcome contracts in `@yamp/contract`, with independent floor/ceiling helpers and parser/version fixtures.
- [x] 1.3 Add canonical stage serialization and opaque preview-fingerprint helpers covering grocery/list versions, stage, location, brand families, selections, availability/quotes, quantities, derivation and left-off facts; prove ordering independence and a digest change for every commit-relevant source.
- [x] 1.4 Extend shared order shapes with explicit selection source, exact cache-diff result, verified-brand markers, persisted-send summary, and categorized left-offs while preserving backwards-compatible optional fields for existing `place_order` callers.

## 2. Native brand tiers and narrow save

- [x] 2.1 Replace matcher wiring from `readBrandPrefs`' flat projection to `readBrandTiers`, implement first-available-tier/equal-peer cheapest selection and terminal `any_brand` fallback, and delete the interim projection only after all callers/tests migrate.
- [x] 2.2 Extend matcher tests for absent families, multi-brand equal tiers, exhausted tier fall-through, tier-plus-any-brand, exhausted ask, cache revalidation, identity-relevance protection, quantity-aware price selection, and deterministic reasons.
- [x] 2.3 Implement the transactional `saveOrderBrandPreference` family operation with server-issued family key, expected family fingerprint, case-insensitive de-duplication into tier 1, `any_brand:false`, exact-state idempotence, stale conflict, and no unrelated-family/profile writes.
- [x] 2.4 Add app-callable MCP and member API adapters for narrow brand save with structured current-family/conflict returns, and cover new-family, tier-peer preservation, lower-tier removal, concurrent edit, cross-tenant, invalid/manual/broader selection, and repeat delivery.

## 3. Broader and manual catalog reads

- [x] 3.1 Implement the pure broader-ladder builder over representative-resolved direct `general` then `containment` ancestors, qualified bare base, and distinct stored search-term fallback; exclude membership/abstract/substitution/sibling/transitive nodes and enforce three-query de-duplication.
- [x] 3.2 Implement broader Kroger search with first-successful-rung stopping, fulfillability filter, twelve-result cap, relevance/sale/unit-price ranking, and structured factual divergence/missing-constraint notes.
- [x] 3.3 Implement bounded manual catalog search for existing/impulse client keys with 2–80 character validation, one current-location query, twenty-result cap, modality facts, and no preference/cache/identity/grocery writes.
- [x] 3.4 Add shared member and app-callable search adapters plus pure/Worker/API/tool tests for sparse graphs, base fallback, no-safe-rung, query/result caps, deterministic ordering/notes, modality filtering, malformed input, cross-tenant keys, and zero-write guarantees.

## 4. Stateless preview and final revalidation

- [x] 4.1 Extract `readOrderReview` over the grocery snapshot/to-buy algebra and matcher/search dependencies, producing matched/decision/underived/left-off sections, stale-cart gate, same-identity options, one featured swap, assumed-vs-specified quantities, transient quote totals, and a fingerprint without writes.
- [x] 4.2 Apply plain-JSON stages deterministically for skip/add-back, quantity, same-identity/broader/manual selection, Undo, impulse entries, and saved-brand verification markers; reject unknown/cross-line SKUs and never accept client prices.
- [x] 4.3 Implement final-send preflight that reruns the entire preview/revalidation, compares the fingerprint, validates cleared-cart acknowledgement, and returns a refreshed `review_changed`/categorized divergence or `cart_clearance_required` before any write.
- [x] 4.4 Add preview/fingerprint tests for list/row, plan, pantry, store, brand, price, promo, availability, quantity and candidate drift; prove stable same-input digests, selected-SKU revalidation, stage preservation only when compatible, and zero writes on every mismatch/error.
- [x] 4.5 Add thin `/api/grocery/order/review` and existing-order-endpoint adapters over the shared operations, with member/tool parity and non-Kroger/reauth/underived structured-error coverage.

## 5. Send, impulse, D16, and learning truth

- [x] 5.1 Reorder the shared order commit so send snapshot/in-cart advance remains before Kroger cart add, compensation remains exact on cart failure, and SKU-cache compare/upsert runs only after `cart.written:true`.
- [x] 5.2 Make the cache writer return exact inserted/updated/unchanged mappings and error without write churn, including fresh aisle placement on sent cache hits; cover cart-failure no-call and cart-success/cache-failure behavior.
- [x] 5.3 Materialize successfully resolved review impulses directly into `in_cart` inside the existing shared advance/send batch with `provenance:impulse`; ensure previewed/skipped/unresolved/revalidation-failed/compensated impulses leave no row, mapping, send line, or spend event.
- [x] 5.4 Build the discriminated send result from authoritative operation receipts: advance/rollback, cart, send id/snapshot error, persisted D16 item/total/savings read, cache changes/error, freshly verified tier-1 saved brands, and exact left-offs.
- [x] 5.5 Extend D16/order integration tests for planned-vs-impulse provenance, persisted-quote confirmation, later mark-placed verbatim spend materialization, snapshot failure with honest unavailable totals, compensation, partial cache failure, and no surface-emitted spend.
- [x] 5.6 Preserve current agent `place_order` compatibility during the documented window while requiring preview fingerprints for member/widget review sends; update type/tool fixtures for both paths and prove no automatic/offline send retry.

## 6. Shared Order Review controller and component

- [x] 6.1 Implement the plumbing-agnostic `createOrderReviewController`, selectors, and `OrderReviewHostAdapter` in `@yamp/ui`, reusing Grocery line/quote/capability primitives and owning complete local stage, pending latch, conflict replacement, search state, save receipts, send outcome, and close reset.
- [x] 6.2 Build the shared accessible review layout from the approved mock: store/header tiles, quote disclaimer, stale-cart gate, matched lines, assumed-only steppers, fixed specified quantities, Skip/Add back, options/featured swap, decision cards, broader/manual dialogs, impulse add, sticky send footer, and responsive/error/loading states.
- [x] 6.3 Build the honest confirmed state with independent cart/in-cart/learned/saved/left-off/send-summary steps, no checkout claim, missing-snapshot handling, and Back to grocery only; latch against double submit and clear all stage/result state on close.
- [x] 6.4 Add shared controller/component tests for every stage transition/Undo, quote recalculation, save conflict/success, re-preview divergence, send gating/latching, partial failure, successful confirmation, close/reopen reset, accessibility/focus, and unknown/empty states.

## 7. Member grocery integration

- [x] 7.1 Replace the existing member order dialog with a Grocery launcher/page-shell mount of the shared Order Review component and a TanStack member adapter over preview/search/save/send endpoints; invalidate raw/snapshot/profile queries after relevant authoritative writes.
- [x] 7.2 Keep review/search/save/send online-only, explicitly exclude send from persisted mutation replay, handle offline/read-only/non-Kroger/reauth states, and ensure closing/reopening always fetches an empty-stage preview.
- [x] 7.3 Extend typed fixture routes and app Playwright coverage for the main review, assumed/specified quantity, stale-cart acknowledgement, choose-one/save, alternatives/swap, broader/manual recovery, impulse staging, changed preview, reauth/cart/cache/snapshot failures, confirmation, Back to grocery, and fresh reopen.
- [x] 7.4 Capture and review Order Review decision/confirmation screenshots in the app UI suite, fix accessibility/responsive regressions, and run `aubr test:app` as required by the member surface change.

## 8. MCP Order Review widget

- [x] 8.1 Register `display_order_review` plus app-callable boot preview, broader/manual search, narrow brand save, and fingerprinted `place_order` using the shared operations, structured errors, data-only payloads, equivalent plain text, and `ui://order/review` metadata.
- [x] 8.2 Add the self-contained Order Review widget build/resource entry and marker/CSP/resource tests, with no Worker HTTP route or `run_worker_first` entry.
- [x] 8.3 Implement the MCP host adapter with frozen first paint, contract/capability gates, D19 empty-stage boot re-preview, local staged state, read calls for fresh facts, and immediate non-debounced FULL model context after every staged interaction.
- [x] 8.4 Implement D18 persistent channels: brand save write then full context without message; final send write then full outcome context and one boundary message; `isError`, conflicts, `review_changed`, and failed sends never announce success.
- [x] 8.5 Implement sendMessage-only delegation and read-only degradation for missing capability, failed boot and unknown-newer contract; add fixture-driven tests for every action/channel, cached-payload refresh, no credential leakage, message counts, text parity, and fresh reopen.

## 9. Tool, schema, architecture, and persona lockstep

- [x] 9.1 Update `docs/TOOLS.md` for native brand-tier matching, review/preview/search/save app-callable operations, fingerprinted final send, cart-success-only exact learning, impulse inputs, honest result fields, and quote guarantees.
- [x] 9.2 Update `docs/SCHEMAS.md` for Order Review wire/model-context/search/outcome contracts, brand family fingerprint/merge semantics, send-record impulse projection and persisted-summary truth, and revised `sku_cache` write timing without inventing a review-session table.
- [x] 9.3 Update `docs/ARCHITECTURE.md` for stateless staging, preview fingerprint/revalidation, bounded broader ladder, cache-learning boundary, shared controller/host adapters, D18 draft-vs-write channels, and D19 boot re-preview.
- [x] 9.4 Update `AGENT_INSTRUCTIONS.md` and authored grocery/order skills so review uses `display_order_review`, ambiguous/broader/manual choices require confirmation, don't-care/save semantics use native families, prices remain quotes, and send results name carted/left-off/learned/saved facts exactly; rebuild generated plugin output only through the script.

## 10. Final verification

- [x] 10.1 Run targeted contract, matcher, broader/manual search, profile-save, order/D16, API/tool, shared-controller, member-adapter, MCP bridge/resource, and widget self-contained tests; fix every failure.
- [x] 10.2 Run `aubr typecheck`, `aubr test`, `aubr test:app`, `aubr build:widgets`, and `aubr build:plugin --check`; document credentialed/live Kroger suites not run.
- [x] 10.3 Validate `order-review-rework` with the repository-pinned OpenSpec CLI and verify the implementation extends the landed grocery foundation serially, with no Instacart/store-walk/manual-shop scope and no post-send Back to review.
