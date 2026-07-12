## Context

The current `place_order` operation already computes the derived to-buy set, resolves each line, returns a write-free preview, revalidates forced SKUs, advances resolved rows with a D16 send snapshot, and writes the additive/unreadable Kroger cart. The member route wraps that operation in a member-only dialog. Its matcher still consumes `readBrandPrefs`' lossy flat projection even though Band 1 shipped normalized `{ tiers, any_brand }` rows, and its cache write currently happens before the cart write, so a failed send can look “learned.” Unavailable lines have no deterministic recovery beyond an agent inventing substitutes.

The ratified grocery-first Band 3 change establishes `GroceryListData`, one `@yamp/ui` Grocery controller, member/MCP host adapters, an opaque grocery `snapshot_version`, grouped D16 sends, and `display_grocery_list`. Order review lands after and extends those seams. The spawning MCP payload remains first-paint-only under D19. Unlike the persistent Grocery list, a review is a disposable draft: skip, quantity, product choice, broader/manual selection, and impulse additions do not become shared state until final send. Saving a preferred brand is intentionally the sole pre-send persistent write.

The existing Order Review mock is the visual brief: compact quote tiles, a cleared-cart gate, matched lines, decision cards, and an honest step report. The user has approved drafting locally without the companion design project for this change.

## Goals / Non-Goals

**Goals:**

- Resolve native brand tiers exactly, without flattening equal-rank brands or losing terminal `any_brand` fallback.
- Make every preview/search read-only and every send freshly revalidated, with an explicit stale-review result rather than silent drift.
- Let a member resolve unavailable lines through bounded, explainable broader search or direct catalog search.
- Persist only an explicitly saved brand before send; teach SKU mappings only for products the Kroger cart actually accepted.
- Produce one structured, per-step truth for cart/send, list advancement, persisted quote totals/savings, learned mappings, verified brand saves, and left-off lines.
- Reuse one Order Review controller/component across the member modal and MCP App, extending the grocery contracts and host conventions.
- Keep staged MCP interactions agent-visible without pretending the draft is D1 state.

**Non-Goals:**

- This change does not complete Kroger checkout, read the existing Kroger cart, reconcile final fulfillment prices, or guarantee a promo.
- It does not treat broader candidates as identity synonyms, substitutions, or brand preferences, and it does not add identity-graph edges.
- It does not persist review sessions, draft choices, search queries, cleared-cart acknowledgements, or a post-send review that can replay old inputs.
- It does not implement Instacart, satellite fulfillment, offline-store walks, manual-shop completion, or a generic store-adapter order-review abstraction.
- It does not queue final send or any MCP-host operation offline.

## Decisions

### 1. Order review is a stateless projection plus explicit staged input

Add independently versioned `OrderReviewData`, `OrderReviewStage`, `OrderReviewModelContext`, `CatalogSearchResult`, and `OrderReviewOutcome` contracts in `@yamp/contract`. The authoritative preview operation receives an optional stage and returns:

- `contract_version`, `preview_fingerprint`, `grocery_snapshot_version`, `as_of`, Kroger store/location and quote disclaimer;
- stale-cart/send-group facts and whether `cleared_cart_ack` is required (the acknowledgement itself remains local);
- matched lines with canonical line key, stable display/provenance/recipe fields, assumed-vs-specified quantity, selected fresh product, same-identity options, optional featured swap, price/promo/unit comparison, and selection source;
- decision lines (`choose_one` or `unavailable`) with server-issued family/line keys and available recovery actions;
- staged impulse lines, left-off reasons, underived recipes, counts, transient estimated total, and transient flyer savings.

`OrderReviewStage` is plain JSON: skipped line keys, assumed quantities, SKU selections keyed by line, selected recovery metadata, bare impulse entries, and the list of brand-save markers the caller wants verified at send. It contains no product prices and no authority to bypass revalidation. The controller owns it locally; applying it to the preview is pure and closing/reopening discards it.

The member adapter posts the stage to the shared preview route when a server-derived quote/search result is needed and may compute immediate presentation-only skip/quantity totals from already-fresh lines between calls. The MCP adapter publishes the full current preview plus stage through model context after every staged interaction. These draft interactions intentionally perform no backend write: they are the order-review equivalent of the stateless propose controls, not mutations of shared D1. Search and re-preview are bridge reads. Save brand and final send are the only writes and follow all D18 write rules.

Alternative rejected: a D1 `order_review_sessions` table. It creates abandoned state, conflicts across hosts, makes reopening stale drafts dangerous, and is unnecessary because final commit already accepts the complete intent.

### 2. The preview fingerprint is the final-send compare point

`preview_fingerprint` is an opaque SHA-256 digest of canonical serialized commit-relevant state: grocery snapshot/list membership and row versions, normalized stage, resolved location, effective brand family objects, each selected/candidate SKU's fresh availability and quote, assumed/specified quantities, pantry/plan derivation inputs, and underived/left-off dispositions. UI-only expansion state and the cleared-cart checkbox are excluded.

Final send accepts `{ stage, preview_fingerprint, cleared_cart_ack }`. The Worker reruns the full preview, including current cache revalidation/search and every forced SKU check, immediately before any advance/cache/cart write. If the digest differs, it returns `review_changed` with the refreshed preview and deterministic divergence entries (`list`, `store`, `availability`, `selection`, `quantity`, `price`, `promotion`, or `brand_preference`); it writes nothing and requires another explicit confirmation. If the stale-cart gate is present and acknowledgement is false, it returns `cart_clearance_required` without writing. A matching digest proceeds through the existing advance-before-cart safety ordering.

This is optimistic revalidation, not a promise that Kroger cannot change after its last API response. The cart accepts only SKU and quantity, so final fulfillment remains Kroger's authority.

Alternative rejected: trust the original preview or compare prices only. List/store/preference changes can be just as material as price drift, and a cached conversation can be arbitrarily old.

### 3. The matcher consumes brand tiers natively

Retire `readBrandPrefs` from matcher wiring and pass the canonical family map from `readBrandTiers`. After availability and top identity-relevance gating:

1. family absent: return `ambiguous`;
2. inspect stored tiers in order; the first tier having at least one case-insensitive exact brand match wins, and the existing quantity-aware deterministic price core chooses the cheapest acceptable product within that tier;
3. if every tier is exhausted and `any_brand:true`, choose the cheapest acceptable product from the top identity-relevance pool;
4. otherwise return the complete ranked ambiguous candidates.

Brands within one tier are equal; stored order is never a hidden rank. `any_brand:true` is terminal fallback even when tiers are present. A cache hit remains confident only after current-store revalidation. Dietary hints stay soft and a brand never crosses the identity-relevance gate. Reasons name `brand tier N` or `any-brand fallback` so the review can explain the pick.

The narrow `save_order_brand_preference` operation accepts the server-issued canonical `family_key`, selected same-identity brand, and an expected family fingerprint. In one transaction it removes case-insensitive duplicates of that brand from lower tiers, appends it to the existing first tier (preserving peer/lower-tier order) or creates `[[brand]]`, and sets `any_brand:false`; every other family is untouched. An identical desired state merges idempotently. A stale differing family returns conflict plus its current value. The switch is unavailable for broader/manual divergence candidates because saving one as the requested family's preferred brand would assert a false identity.

Alternative rejected: `update_preferences({brands:{family:{tiers:[[brand]]}}})`. That wholesale array replacement would erase existing peers and fallbacks and can clobber a concurrent profile edit.

### 4. Broader search follows one bounded identity ladder

The broader-search read applies only to a preview line currently unavailable. It never calls the matcher recursively, writes the cache, captures an alias, or mutates the graph. It builds a de-duplicated phrase ladder in this exact order:

1. representative-resolved, direct outward factual ancestors of the requested identity, `general` before `containment`, membership/abstract-class targets excluded, ordered by canonical id;
2. the exact bare-base identity for a qualified `base::detail` request when distinct and not already visited, using that node's stored `search_term` or the flattened base fallback;
3. the requested survivor's stored `search_term` only when it differs from every phrase already issued (the safe cold/abstract-node fallback).

The read issues at most three distinct Kroger searches total, stops after the first ladder rung yielding fulfillable results, and returns at most twelve candidates ranked by identity relevance to that rung, then sale/unit-price rules. It does not walk transitively, traverse siblings, use substitution edges, or delete arbitrary tokens. No rung means “no safe broader search”; manual catalog search remains available.

Every result carries structured `divergence`: source rung, requested and searched identity labels, traversed relation when present, requested constraint tokens missing from the product description/categories, and salient candidate words present in the description. The UI renders factual notes such as “searched Coffee (broader than Whole-bean coffee); product says ground and does not mention whole bean,” never an inferred equivalence. Selecting a broader result stages a forced SKU with that divergence; final send revalidates it and snapshots it under the original grocery line without modifying identity.

Alternative rejected: unconstrained query-token deletion or an LLM-generated substitution. Both are non-reproducible and can silently change the requested food.

### 5. Manual search is direct, bounded catalog lookup

`search_order_catalog` accepts a line key (or a client impulse key), current preview fingerprint, and trimmed free text of 2–80 characters. It performs one current-location Kroger product search, filters to curbside/delivery-fulfillable products, caps at twenty, and returns query-relevance-ranked candidates with brand, description, size, current regular/promo price, sale state, aisle when present, and explicit curbside/delivery modality. It does not consult brand preferences, update the cache, enqueue identity capture, or claim the product matches the original line.

Selecting a result is local stage. For an unavailable existing line it carries `selection_source:'manual'` and an explicit divergence note. The same read backs “Add something” impulse lines: the entered label is normalized only during re-preview/final send, and nothing is added to the grocery list before commit.

### 6. Only a successful cart send teaches SKU mappings

Reorder the current best-effort tail without changing its under-buy/double-add safety posture:

1. build and validate the send snapshot, then atomically advance/materialize all resolved lines to `in_cart` with the send record;
2. call Kroger cart add;
3. on cart failure, compensate rows/send exactly as today and do not call the SKU-cache writer;
4. only after `cart.written:true`, compare/upsert mappings and return exact `inserted`, `updated`, and `unchanged` keys (or one cache error).

This means a failed cart never teaches, including a broader/manual selection. Cache hits can still refresh placement after a successful send. If cart succeeds but cache write fails, the groceries remain sent and the result says zero learned with the cache error; telemetry/learning never costs the order.

Staged impulse entries are resolved like caller extras. On successful advance, the shared operation materializes each resolved extra directly as an `in_cart` grocery row linked to the send; its immutable send line carries `provenance:'impulse'`. A skipped, unresolved, unavailable, revalidation-failed, or cart-failed impulse entry creates no lasting active row and no spend event. The same D16 send builder/writer is used; no UI emits spend.

### 7. One honest outcome composes authoritative receipts

`place_order` returns a discriminated `OrderReviewSendResult`:

- `review_changed` or a structured pre-write error with refreshed preview;
- `send_failed`, independently reporting list advance/rollback, cart, send-record, and cache states without a confirmed screen;
- `sent`, with `cart_count`, `send_id` when recorded, the persisted send-record item count/estimated total/flyer savings (or an explicit snapshot error), exact learned mapping changes, verified saved-brand markers, and `left_off[]` with `skipped | undecided | unavailable | revalidation_failed | underived` reason.

The request's saved-brand markers are not trusted claims: final send rereads those families and returns only family/brand pairs currently present in tier 1 with `any_brand:false`, labeled `verified`; the controller also retains the actual authoritative save-tool receipts from this open review. `OrderReviewOutcome` composes those receipts with the send result, so “Saved your preferred brand” appears only after a successful save or current-state verification. “Learned N store matches” counts inserted/updated cache mappings only. Confirmation totals/savings come by send id from persisted D16 lines, not client math or a stale preview.

If `cart.written:false`, the UI never enters Confirmed. If the cart succeeds while send snapshot recording failed, it confirms the cart/list steps but renders totals/savings unavailable and the exact error. This preserves D16's “telemetry never costs groceries” rule.

### 8. The shared component extends the grocery-first seams

Add `OrderReview` and `createOrderReviewController` to `@yamp/ui`, reusing grocery line labels, quote formatting, host capability types, and modal/launcher seams but not nesting member/MCP plumbing. `OrderReviewHostAdapter` supplies re-preview, broader/manual reads, brand save, final send, model-context publication, completion notification, and close-to-grocery.

The component follows the mock's hierarchy: title/store, `Going to cart` / transient `Estimated total` / positive `Flyer savings` tiles; stale-cart warning and required acknowledgement; Matched section with assumed-only steppers, Skip/Add back, same-identity options and one featured swap; Needs a decision cards with save-brand, broader and manual recovery; sticky send footer; and the stepwise confirmation report. Accessibility uses fieldsets/radio groups, switch labels, live status, focus restoration, and keyboard-safe dialogs.

After `sent`, the only navigation is **Back to grocery**. It closes the member modal or the MCP card boundary and clears controller stage. Launching/opening again always calls a fresh empty-stage preview; sent rows are already `in_cart` and absent from to-buy. The send button latches while in flight and remains unavailable on the confirmed state. There is no “Back to review” and no retained payload that can double-add the completed set.

### 9. Member and MCP adapters share operations but different transports

The member adapter maps to `/api/grocery/order/review`, `/api/grocery/order/search`, `/api/grocery/order/brand`, and the existing `/api/grocery/order` commit endpoint, all thin adapters over shared operations. Preview/search/save may run only online; send remains non-queueable. The grocery page launcher mounts the shared review modal and invalidates grocery raw/snapshot queries after brand save or send.

`display_order_review()` invokes the empty-stage preview and returns `structuredContent:OrderReviewData`, equivalent text, and `_meta.ui.resourceUri:'ui://order/review'`. App-callable bridge tools expose boot re-preview, broader/manual search, narrow save, and `place_order`; they carry data only under the grant.

The MCP adapter freezes spawning content for first paint, validates contract floor/ceiling, probes capabilities, and performs an empty-stage boot re-preview before enabling controls (D19). Every staged interaction immediately publishes the FULL `OrderReviewModelContext` (preview, complete stage, saved-brand receipts and current action) with no debounce; preview/search reads precede that context update when fresh server facts are needed. A successful brand save calls the write, adopts the authoritative returned preview/family state, then publishes full context. Final send calls `place_order`, publishes the full outcome/current state, then sends one `ui/message`. No other interaction requests a model turn.

Degradation is: server tools plus model-context support → interactive; sendMessage-only → explicit delegation message naming the complete requested action; neither, failed boot, or unknown-newer contract → read-only first paint/text fallback. Resolved `isError`, conflicts, and send failures produce no success context or completion message.

### 10. Documentation and verification are part of the contract

Update `docs/TOOLS.md` for native brand matching, app-callable review/search/save operations, fingerprinted `place_order`, exact result fields, and cart-success-only learning. Update `docs/SCHEMAS.md` for the versioned review payloads, D16 impulse-line semantics, send result projection, and revised `sku_cache` write timing; no new persistence table is required. Update `docs/ARCHITECTURE.md` for the stateless review boundary, broader ladder, final revalidation, and shared host adapters.

Update `AGENT_INSTRUCTIONS.md` and authored grocery/order skills so the agent displays the review, never chooses an ambiguous brand or broader/manual candidate silently, records “don't care” through the existing preference surface only on explicit direction, treats prices as quotes, and describes send/left-off/learned/save results exactly. Rebuild generated plugin output only through its build script.

Tests cover native tier matrices; ladder/difference/search bounds; fingerprint changes and zero-write stale sends; cache learning timing; impulse snapshot/materialization; brand merge conflicts; API/tool parity; shared controller states; member Playwright screenshots/interaction; MCP boot/context/message/degradation; self-contained resource output; and no-credential fixtures.

## Risks / Trade-offs

- **[Preview fingerprint changes often as prices move]** → return categorized divergence and the refreshed review, preserving compatible stage choices where their SKU remains available while requiring one new explicit send confirmation.
- **[Broader graph data is sparse]** → use only bounded factual ancestors/base/search-term fallbacks, explain every rung, and leave manual search available; never manufacture an identity edge.
- **[A successful external cart call can still lose its HTTP response]** → retain advance-before-cart ordering, disable automatic/queued retries, latch the controller, and make reopen start from the now-`in_cart` set; do not claim transactional idempotency the Kroger API cannot provide.
- **[Brand save races the profile editor]** → use a family fingerprint and narrow transactional merge; idempotently accept the exact already-saved state and conflict on a differing stale family.
- **[Cart succeeds but cache/send reporting fails]** → confirm each step independently, keep groceries authoritative, and never infer learning/totals from intent.
- **[Adjacent Band 3 work shares grocery contracts]** → implement after grocery-list-page-and-widget and extend its contract/controller adapters serially; do not duplicate snapshot or host plumbing.
- **[Local design bypasses the usual companion project]** → keep the approved mock hierarchy, existing shared primitives, and screenshot/interaction coverage as the reviewable visual contract.

## Migration Plan

1. Land/merge the grocery-list-page-and-widget foundation first. Rebase this change so `GroceryListData`, controller seams, exact send grouping, and host harness are present.
2. Land native tier matching, broader/manual pure reads, narrow brand-save operation, stateless review contracts/fingerprint, and tests. Remove the matcher-only flat projection after all callers compile.
3. Change order commit timing so cache writes occur only after cart success; add exact cache diff/result and impulse materialization through the existing D16 advance/snapshot operation. Existing callers remain supported with optional review fields.
4. Land member endpoints, shared controller/component, member modal, and app coverage; keep the old dialog behind no parallel route once parity tests pass.
5. Land MCP display/app-callable tools, resource bundle, adapter, persona/docs, and build tests.
6. Verify old brand rows read unchanged, old `place_order` callers without fingerprints retain their documented agent flow during the deprecation window while the member/widget send path requires one, and no preview/search operation writes D1 or the cart.

Rollback removes the new member/widget exposure first and restores the old matcher caller projection/order dialog. The brand/send/cache schemas remain compatible because this change changes interpretation and result projection rather than requiring destructive stored-data migration. Never roll back by deleting send, cache, or preference data.

## Open Questions

None. Tier selection, save merge, broadening bounds, manual search, draft persistence, boot behavior, revalidation, learning timing, impulse provenance, outcome honesty, and post-send navigation are decided above.
