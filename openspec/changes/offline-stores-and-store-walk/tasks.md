## 1. Prerequisite contract integration

- [ ] 1.1 Rebase after `grocery-list-page-and-widget` and `store-adapters-card`; audit their final Grocery snapshot/checked/controller and store-adapter projection wire shapes against this design before editing shared surfaces.
- [ ] 1.2 Add workerd-pure shared types for shop-commit request/receipt/conflicts, aisle-map effective/mine documents and summaries, Offline walk context, placement sources, and adapter enrichment with stable discriminants and contract-version compatibility.
- [ ] 1.3 Add contract/unit fixtures pinning sorted canonical key hashing, receipt replay shape, map state boundaries, private nickname display precedence, and legacy-note parsing.

## 2. Receipt, note-recency, and preference schemas

- [ ] 2.1 Add the next D1 migration for tenant/session-keyed `shop_commits`, immutable `shop_commit_lines`, required indexes/constraints, and nullable `store_notes.updated_at`; keep all access behind `src/db.ts`.
- [ ] 2.2 Extend D1 row mappings/readers so old store notes fall back from `updated_at` to `created_at`, new notes initialize recency, and `update_store_note` advances recency without changing its addressable `created_at`.
- [ ] 2.3 Extend structured preferences validation/merge and adapter wire data for `stores.nicknames[slug]`, proving nickname writes are household-scoped and cannot mutate shared store name/label/address.
- [ ] 2.4 Add migration/data-layer tests for fresh and legacy notes, receipt/line constraints, tenant isolation, duplicate session claims, and additive preference compatibility.

## 3. Aisle-map projection and conditional editor operation

- [ ] 3.1 Implement tolerant canonical parsing/serialization for editor-authored and legacy `layout` notes plus exact canonical item `location` notes; omit unparseable route entries without dropping their attributed note records.
- [ ] 3.2 Implement `readAisleMap` over caller-visible notes with effective-per-aisle recency resolution, complete own contribution, deterministic tie-break/order, strong ETag, private visibility, and exact unknown/stale-at-180-days/mapped summaries.
- [ ] 3.3 Implement the atomic whole-document reconcile under `If-Match`: create/update/remove/collapse only the caller's layout notes, preserve all other authors and non-layout notes, default shared visibility, advance changed recency, and return fresh conflict/result projections.
- [ ] 3.4 Implement deterministic Offline placement precedence (exact location note, exact normalized section, Not mapped), aisle ordering, cold-last projection, and map/source warning metadata; retain Kroger captured-placement precedence.
- [ ] 3.5 Add focused map operation tests for shared/private visibility, multiple authors, stale boundary, correction/removal reveal, duplicate own notes, malformed legacy bodies, ETag races, unknown degradation, exact-match negative cases, cold-last, and no AI/external calls.

## 4. Exact shared shop-commit operation

- [ ] 4.1 Implement request canonicalization/validation and server-side context resolution for `store_walk` versus `manual_shop`, including existing-store/domain lookup, sorted unique keys, ULID/session ownership, and retained client occurrence time.
- [ ] 4.2 Implement the database-layer atomic claim that verifies snapshot/exact complete eligible checked set, stores receipt and line snapshots, conditionally gates every effect, consumes rows, and returns fresh Grocery state without partial outcomes.
- [ ] 4.3 Implement verified pantry receive inside the claim using shared add/merge semantics for grocery-kind grocery-domain rows only; preserve pantry metadata and stamp `last_verified_at`, while consuming household rows without pantry writes.
- [ ] 4.4 Implement immutable replay and concurrency results: same session/request returns stored receipt, changed payload returns `idempotency_conflict`, and different-session overlap yields `checked_set_changed` with no effects.
- [ ] 4.5 Add operation/data tests for exact success, empty/ineligible/wrong-domain/unchecked/in-cart/ordered/missing rows, virtual materialized rows, household rules, stale snapshot, response-loss replay, changed-payload replay, two-session races, tenant isolation, and atomic failure injection.

## 5. D16 manual/walk estimate materialization

- [ ] 5.1 Implement one pure no-network shop estimate resolver with strict SKU-cache → current warmed flyer → latest household non-voided last-paid → unpriced precedence, deterministic loose-quantity count/assumption, and source metadata.
- [ ] 5.2 Extend the sole `src/spend.ts` writer with receipt-line materialization keyed deterministically by tenant/session/line, always estimated for walk/manual, retaining capture-time department/provenance/store/fulfillment and NULL-unpriced events.
- [ ] 5.3 Compose estimate snapshots and spend writes into the shop claim so the stored receipt is the replay source and later cache/history changes never re-price; keep surfaces unable to write spend.
- [ ] 5.4 Add pricing/spend tests for every ladder level and freshness gate, quantity assumed/parsed, savings/amount arithmetic, pending department fill, unpriced capture, replay after source change, no duplicates, and zero external/AI calls.

## 6. API, MCP, adapter, and Grocery read wiring

- [ ] 6.1 Add session-gated `POST /api/grocery/shop-commit` and aisle-map GET/conditional PUT routes as thin adapters with structured conflict/error mapping; keep them under the existing `/api*` Worker-first dispatch.
- [ ] 6.2 Register `commit_shop` as a thin MCP adapter over the same operation and update the canonical checked-state tool surface needed by voice "got it"; return exact receipt/conflict data with no duplicated receive logic.
- [ ] 6.3 Enrich `loadStoreAdapterProjection` Offline rows/launcher entries with shared identity, household nickname/display name, and shared map summary, preserving D6 registry reuse, missing-selection behavior, deterministic ordering, and secret-free payloads.
- [ ] 6.4 Extend the shared Grocery snapshot/read operation with selected secret-free Offline `walk_context`, effective placement/route groups and map metadata; invalidate placement on map/store changes while preserving membership, checked state, and explicit paused-session store identity.
- [ ] 6.5 Add Worker/member API/MCP tests for session gating, schema validation, projection parity, private-note exclusion, route conflicts, shared-operation identity, no direct DB/surface spend writes, and no credential fields in walk context.

## 7. Store card nickname and map editor

- [ ] 7.1 Extend the app query/client layer for aisle-map ETags and adapter enrichment; keep nickname/map writes online-only outside the persisted mutation registry and reconcile projection/Grocery queries after success/conflict.
- [ ] 7.2 Add Offline-tab nickname editing through the existing preferences ETag/rebase flow, visibly separate household nickname from shared store identity, and prove no shared-registry write is issued.
- [ ] 7.3 Build the accessible whole-document aisle editor with separate effective community preview and Your map contribution, add/reorder/remove/visibility controls, explicit adopt-current action, stale/unknown/mapped copy, `If-Match` conflict recovery, and offline-disabled save using shared UI primitives.
- [ ] 7.4 Extend app page objects and Playwright Store-card coverage first for registry reuse, nickname isolation, mapped/stale/unknown summaries, own/effective distinction, adopt behavior, multi-author recency, conflict, privacy, offline-disabled saves, responsive layout, and focus/keyboard return.

## 8. Member active walk and offline lifecycle

- [ ] 8.1 Extend the shared Grocery controller/component with walk intentions/selectors for local session creation/resume/pause, current/completed aisle groups, authoritative/optimistic check progress, exact completion payload capture, pending receipt, success, and conflict replacement.
- [ ] 8.2 Implement tenant-stamped URL/local state (`mode`, `walk`, `store`) and purge integration; start from persisted secret-free Grocery context without a round trip, retain only navigation locally, preserve store on pause, and never create a server walk session.
- [ ] 8.3 Implement the approved active UI: replacement store/progress header, progress bar, active aisle, collapsible completed summaries, unchanged checkbox rows, Grab last, Anywhere / Not mapped, quiet offline note, Pause/Finish footer, and hidden pantry/substitution/order/add/underived panels.
- [ ] 8.4 Implement the Finish sheet and exact payload freeze; show unchecked-kept/restock/estimate copy, durable receipt on success, and fresh actionable review on checked-set/idempotency conflict without automatic broadening.
- [ ] 8.5 Register serial class-(b) shop-commit replay after prior checks, persist immutable session/key/snapshot/time variables, render offline pending without optimistic deletion, freeze captured-line edits, adopt receipt/snapshot on replay, and purge the queue/session on identity change.
- [ ] 8.6 Persist only selected secret-free Offline walk context with Grocery data; add negative tests that adapter credentials/profile/map/nickname writes never persist/queue and that a cold missing map degrades to Not mapped.
- [ ] 8.7 Extend app page objects/Playwright coverage first for mapped and unmapped start, mid-walk collapse/progress, hidden panels, pause/resume/reload, unchecked retention, completion/receipt, offline check+finish+reload+ordered replay, response-loss replay, replay conflict, tenant purge, desktop/tall screenshots, and no per-tap spinners.

## 9. Agent choreography, docs, and final verification

- [ ] 9.1 Update `AGENT_INSTRUCTIONS.md` Band-3 shopping/voice flow to call checked writes on confirmed picks, retain a trip session id, sweep unmatched lines, complete only through `commit_shop`, and offer storage guidance after its receipt; remove advisory remove/restock choreography.
- [ ] 9.2 Update `docs/TOOLS.md` for `commit_shop`, checked voice behavior, exact eligibility/receipt/replay, and D6 Offline wording while preserving stable store tool names; document the member API operations where appropriate.
- [ ] 9.3 Update `docs/SCHEMAS.md` for `checked_at` consumption, receipt tables/retention, store-note recency/effective map/ETag, preferences nicknames, adapter/Grocery walk wire shapes, spend estimate fields, and the explicit absence of a walk-session table.
- [ ] 9.4 Update `docs/ARCHITECTURE.md` for local-state versus receipt boundaries, one shared completion/write path, ownership-safe community maps, sparse placement, offline classification, purge, and convergence/race behavior.
- [ ] 9.5 Run `aubr build:plugin --check`, targeted Worker/API/MCP/map/shop/spend/offline tests, `aubr typecheck`, and relevant tooling tests; fix failures without weakening exactness or offline contracts.
- [ ] 9.6 Run `aubr test:app`, review every changed per-area screenshot at desktop and tall/mobile sizes, iterate until stable, then run `mise exec -- openspec validate offline-stores-and-store-walk` and verify every task/spec/doc obligation before code review.
