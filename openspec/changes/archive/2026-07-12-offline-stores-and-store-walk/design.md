## Context

The shipped in-store flow is an agent skill over `read_to_buy`, shared store identity, and attributed layout/location/stock notes. Its completion is prose choreography: remove each row, restock grocery-kind pantry rows, and offer storage guidance. That is no longer sufficient after D16 and D28. The Grocery sibling makes `checked_at` orthogonal to online `status`, materializes a virtual plan need when it is checked, and exposes one versioned Grocery snapshot. The Store-card sibling makes one projection the source of adapter and launcher state, while deliberately leaving Offline CRUD/map editing and the walk to this change.

D15 explicitly classifies walk check-offs and completion as offline-queued writes keyed by a client-minted session id. D28 explicitly rejects a `walk_sessions` table or Durable Object: URL/local view state owns the walk shell, and D1 grocery-row `checked_at` owns durable picked state. D16 requires manual/walk spend to materialize at completion through shared operations, using `sku_cache → warmed flyer → household last-paid` fallback and marking the result estimated. Existing store layout remains public/shared facts in attributed `store_notes`; another household's contribution is visible but never writable by the caller.

This change is sequenced after `grocery-list-page-and-widget` and `store-adapters-card`. It extends their `GroceryListData`, checked operation, shared component/controller, and `loadStoreAdapterProjection` contracts rather than creating parallel reads or UI. The user has authorized a local design for design request #7; no external design-project artifact is required today.

## Goals / Non-Goals

**Goals:**

- Make one exact, atomic, replay-safe shop completion the only walk/manual boundary for grocery consumption, verified pantry restock, and D16 estimated spend.
- Give `/api` and the agent voice walk thin adapters over that same operation and immutable receipt.
- Let a member start, check, pause, finish, and recover a store walk with zero connectivity and no server walk-session entity.
- Present and map existing Offline stores honestly, keeping shared identity/layout separate from household nickname/preferences.
- Make community map reconciliation ownership-safe and concurrency-safe while retaining attributed note/tool compatibility.
- Resolve Offline placement deterministically and degrade each line and map state without guesses.

**Non-Goals:**

- Instacart, Satellite browser-session freshness/cart fill, online Order Review, and Kroger cart placement are owned by sibling changes.
- This change does not add a shared-store identity CRUD form to the member app, a second store/adapter table, cross-device walk-navigation resume, or a server walk-session history model.
- It does not claim checkout-exact prices, infer a missing aisle with an LLM in a Worker read, or let one household edit/delete another household's notes.
- It does not turn the MCP Grocery widget into an offline host; MCP App mutations remain online-only under D15/D19.

## Decisions

### 1. A walk shell is local; `checked_at` is the only picked-item truth

Starting a member walk mints a ULID `session_id` and records `{session_id, tenant_stamp, store_slug, started_at, current_group, state}` in tenant-purged local storage. The route carries `mode=walk`, `walk=<session_id>`, and `store=<slug>` search params so reload/back/deep-link behavior is explicit. The local record contains navigation and, only after Finish, the frozen logical commit request until a durable receipt is adopted; it never contains an independently mutable checked set. Pause removes walk mode from the URL but retains the record, and the same device offers Resume. A different device starts a new local shell over the same server/cached `checked_at` rows.

Every check uses the Grocery sibling's canonical-key class-(b) operation. A plan-derived virtual line is therefore already a stored `source:"menu"` checked row before completion; shop commit never materializes virtual needs. The selected store's domain filters the rendered walk before it starts. Online-cart `in_cart`/`ordered` rows, unchecked rows, and rows for another domain never enter the walk or its completion payload.

The walk can start from the currently rendered persisted Grocery snapshot without a request. That snapshot gains a secret-free `walk_context` containing the selected Offline store's slug/shared label/household display name, domain, effective map summary, route groups, and map observation time. It carries no Kroger link/token or Satellite secret/state. An absent/cold cache still yields a usable Not mapped walk over persisted grocery lines; it does not fabricate a map.

Alternative rejected: persist a server walk row or copy checked keys into local session state. The former violates D28; the latter creates a third writer and makes reload/cross-member convergence unknowable.

### 2. `commitCheckedShop` claims an exact checked set and persists the receipt before consumption

Add a named `commitCheckedShop(env, tenant, request)` operation. Its request is plain JSON:

```ts
{
  session_id: string;                 // client-minted ULID, household-scoped idempotency key
  mode: "store_walk" | "manual_shop";
  store_slug: string | null;           // required for store_walk
  expected_checked_keys: string[];     // sorted unique canonical row keys shown at confirmation
  snapshot_version: string;            // Grocery snapshot rendered by the confirmer
  occurred_at: string;                 // client event time, retained across replay
}
```

The shared operation resolves store/domain server-side; a caller cannot supply provenance or a domain. For a store walk, eligible rows are exactly the tenant's rows with `status='active'`, non-null `checked_at`, and `domain` equal to the resolved existing store's domain. For manual shop, the context is `store=null`, `domain='grocery'`. Both grocery and household kinds are consumed, but only `kind='grocery' AND domain='grocery'` restocks pantry. Unchecked, `in_cart`, `ordered`, wrong-domain, missing, and already-consumed rows are ineligible. Empty commits are rejected.

The operation compares the sorted requested keys with the complete eligible checked set and verifies the rendered aggregate version as a preflight. Its atomic claim rechecks a bounded eligibility signature over grocery, pantry, plan, decisions, and the explicitly requested store/visible notes; enriched-only quote/corpus display inputs are not an unbounded transactional signature. Any relevant difference returns `checked_set_changed` with a fresh snapshot/current eligible keys and performs no write; it never silently includes a newly checked row or silently drops an unchecked/advanced row. This exact-set rule makes the completion sheet truthful and prevents a stale offline finish from sweeping unrelated work.

Add `shop_commits` keyed by `(tenant, session_id)` and immutable `shop_commit_lines` keyed by `(tenant, session_id, line_key)`. The commit stores a canonical request hash, resolved context, event/commit times, and result summary. In one database-layer atomic unit, it conditionally claims the id only if the exact eligibility predicate still holds, snapshots every consumed row and its pricing/pantry result into receipt lines, writes spend and pantry effects, then deletes the grocery rows. The durable receipt exists before/with destructive consumption, never after it as a best-effort follow-up. All access goes through `src/db.ts`.

A repeat with the same session id and request hash returns the stored receipt with `outcome:'replayed'`, even though the grocery rows no longer exist. The same id with a different hash returns `idempotency_conflict`. Two different sessions racing overlapping rows cannot both satisfy the claim: one commits, while the loser gets `checked_set_changed` and a fresh snapshot. A response lost after commit is therefore recoverable without double deletion, pantry quantity, or spend.

Alternative rejected: loop remove/update-pantry operations from either surface. It can partially consume, cannot reconstruct a receipt after deletion, and can double-restock on replay. A server session entity is not needed: `shop_commits` is an idempotency/audit receipt created only at completion, not mutable walk state.

### 3. Pantry and spend effects are line snapshots inside the shop commit

For every consumed grocery-kind grocery-domain row, reuse the shared pantry add/merge semantics with the grocery row's display/canonical key and loose buy quantity, then stamp `last_verified_at=occurred_at` in the same atomic unit. Existing pantry location/category/notes survive unless the normal merge contract explicitly changes them. Household/other rows are consumed and listed in the receipt but never enter pantry.

The shop operation asks one pure estimate resolver for each food line, in this order:

1. the most recent matching SKU-cache product price for the resolved store/location and canonical line;
2. the current warmed flyer match for that store and line;
3. the household's most recent non-voided paid unit price for the canonical line;
4. no price (`unit_price`/`amount` null) when all sources miss.

The resolver performs no live external request. A loose quantity's leading positive count is used when unambiguous; otherwise purchase count is one and `quantity_assumed` is recorded. Every walk/manual event has `estimated=1` even when a cached price exists, because no checkout receipt verified it. The receipt line records price source, unit price, computed amount/savings when known, quantity assumption, store, fulfillment (`store_walk | manual_shop`), department-at-capture, and planned/impulse provenance.

Extend the one `src/spend.ts` write boundary with a shop-receipt materializer; surfaces still cannot write `spend_events`. Events use a deterministic shop send key derived from tenant/session plus line key, so the existing event uniqueness posture also absorbs replay. Unpriced events remain useful item-count/provenance telemetry and are explicitly estimated. The operation returns counts and totals from its stored receipt, never re-prices on replay.

Alternative rejected: synthesize an online `order_send` before a walk. A walk has no send event or cart quote, and pretending otherwise would contaminate the D16 distinction between sent snapshots and completion estimates.

### 4. `/api` and agent voice completion are adapters over the same operation

Add session-gated `POST /api/grocery/shop-commit` and an MCP `commit_shop` tool with the same request/result semantics. Each validates transport shape, resolves the authenticated tenant, invokes `commitCheckedShop`, and returns its receipt or structured conflict; neither implements pantry/spend/deletion logic.

The agent voice walk changes its pacing, not its local-state doctrine: each confirmed "got it" calls the canonical checked-state operation, maintains a client-minted session id for that conversation/trip, sweeps unmatched items before completion, reads a fresh checked snapshot, and calls `commit_shop` with the exact eligible keys. Storage guidance remains a post-receipt conversational action and is not part of the deterministic commit. "Can't find it" mapping notes retain their confirmation rules.

The generic "Log a manual shop" member action uses the same `/api` endpoint with `mode:'manual_shop'`; it does not gain a store adapter. Tool descriptions call generic non-connected registry entries **Offline stores** per D6, while stable tool names (`list_stores`, etc.) remain unchanged.

Alternative rejected: have the agent continue remove/restock calls while only the member UI uses shop commit. That would preserve two correctness boundaries and let D16 behavior vary by surface.

### 5. The aisle editor replaces only the caller's attributed contribution under `If-Match`

Add a shared `readAisleMap(slug, viewerTenant)` projection over the existing store row and caller-visible `layout` notes. It returns:

- `effective`: one winning entry per normalized aisle id, with aisle label/order, sections, visibility-safe attribution, and `observed_at`;
- `mine`: the caller's own complete contribution, including shared/private visibility, stable note identity, and observation time;
- `etag`: a strong digest of every caller-visible layout note id/body/tags/private/recency participating in the read;
- summary `{state, aisle_count, as_of}`.

Add nullable `updated_at` to `store_notes`. Recency is `COALESCE(updated_at, created_at)`. Existing add rows initialize both times; `update_store_note` advances `updated_at` while retaining immutable/addressable `created_at`; old rows read `created_at`. For each normalized aisle id, the most recent visible contribution wins with note id as a deterministic tie-break. Duplicate older contributions remain attributed history to tools but do not produce duplicate effective aisles.

`PUT /api/stores/:slug/aisle-map` accepts `If-Match` and a whole document representing **only the caller's contribution**, not the effective community document. The reconcile atomically creates/updates/removes only that tenant's `layout` notes, canonicalizes editor-authored bodies (`Aisle <label>: <sections>`), collapses the caller's duplicate aisle notes, and leaves all `location`, `stock`, general, and other-author notes untouched. Changed contributions advance `updated_at`, so a correction participates honestly in recency. Removing one's winning entry may reveal the next-most-recent visible contribution. A mismatched ETag returns the fresh map without writing.

The UI labels the combined effective preview separately from **Your map contribution**. It never silently copies another author's effective map into `mine`; an explicit "Use current map as a starting point" action is required before adopting those facts as the caller's contribution. Shared is the default visibility, matching current notes; a private entry remains caller-only.

Alternative rejected: write a JSON layout column on `stores` or replace every visible note. Both violate the existing attributed-note ownership model. Per-row fire-and-forget edits are rejected because D15 classifies the member aisle map as a whole-document conditional editor.

### 6. Map status and Offline display have explicit public/private boundaries

The adapter projection continues to source Offline identity only from grocery-domain rows in the shared `stores` registry. It gains for each row:

- `shared_name`/address/slug from the registry;
- `nickname` from household preferences at `stores.nicknames[slug]`;
- `display_name = nickname ?? label ?? name`;
- `aisle_map: { state:'unknown'|'stale'|'mapped', aisle_count, as_of }` from the map projection.

A nickname write uses the existing preferences whole-document `If-Match` merge path, is online-only, and never updates `stores.name` or shared `stores.label`. Member UI does not add/remove/edit shared store identity in this slice; existing MCP store CRUD remains the registry-authoring path. Missing selected slugs retain the Store-card sibling's unavailable behavior.

Map state is deterministic: `unknown` means no effective aisle entry is visible; `stale` means entries exist but the newest effective observation is older than 180 days; `mapped` means at least one entry exists and the newest is within 180 days. Stale remains usable with a "Map may be out of date" hint; unknown is not an error and yields Not mapped placement. The 180-day constant lives with the shared map projection and is tested at the boundary. Private notes can affect only their owner's projection/status and never another household's summary.

Alternative rejected: reuse shared `label` for a household nickname. Store identity is cross-household objective data; a private nickname must not become a shared-corpus mutation.

### 7. Offline aisle placement is deterministic, sparse, and per-line honest

Editor-authored layout notes use structured aisle/section data on the wire and canonical note text at rest, while the reader tolerantly parses legacy `Aisle 7: baking, spices` bodies. For an Offline store, the Grocery snapshot placement resolver applies precedence:

1. a caller-visible, parseable `location` note that exactly names the canonical/display line and an aisle;
2. an exact normalized match between the line's server-derived presentation section and one effective map section;
3. no aisle (`Not mapped`).

No substring/fuzzy/LLM guess runs in the Worker. Kroger captured SKU placement keeps its existing precedence on a Kroger walk. Effective aisle groups sort by parseable aisle order then label; frozen/refrigerated lines are held for a final **Grab last** group under the existing cold-chain contract; all unresolved lines form trailing **Anywhere / Not mapped**. `stale` placement may still order the walk but carries a visible warning; `unknown` never blocks a walk.

The adapter projection and Grocery snapshot call the same map summary/resolver. A map or standing-store change invalidates enriched Grocery placement while preserving grocery membership/check state. The secret-free selected Offline context returned with the Grocery snapshot is what the local walk persists; credential-bearing adapter state remains outside the offline query allowlist.

Alternative rejected: let the member client independently parse notes or guess departments. Shared operations keep the Profile summary, Grocery route, and agent read consistent and testable.

### 8. The active member walk follows approved design request #7

The existing Grocery component gains a walk variant; the member route remains its URL/local-state host. On Start, the normal page header and grouping toggle are replaced by store/display name, `N of M` checked progress, and a progress bar. The route renders aisle groups in resolved order. The controller marks the first incomplete group active, collapses completed groups to checked summary rows, lets the member reopen them, preserves the sibling's existing checkbox/strikethrough rows, and trails Grab last and Anywhere / Not mapped.

Walk mode hides add-row, recipe grouping, in-cart/order launcher, pantry coverage, substitution, and underived panels. It shows no per-tap spinner; optimistic check state is immediate. When disconnected it shows a quiet "Offline — changes will sync" note. Pause leaves the view without clearing checks or the local record.

Finish opens a sheet with checked/total counts, explicit unchecked-kept copy, pantry-restock explanation, estimated-spend caveat, and the exact logical key/session/store/time request plus an initial snapshot precondition. Online success shows the durable receipt, removes the local session, and exits walk mode. Offline confirm queues the immutable logical request, marks local state `pending_commit`, freezes those line edits, and shows "Finishing when online" while checked rows remain visibly pending rather than pretending they were consumed. After prior queued checks settle, execution rebases only the delivery snapshot precondition. Replay success adopts the returned authoritative Grocery snapshot/receipt and clears the session. A checked-set/idempotency conflict restores the review/walk with the fresh snapshot and an actionable message; it never retries with a broadened set automatically.

A generic transport error keeps the frozen request pending and exposes Retry finish independently of the currently rendered checked rows. That covers the response-loss interval where the server receipt is durable and the authoritative refetch has already removed the rows: retrying the identical logical request returns the receipt instead of minting a conflicting event time.

Alternative rejected: optimistically delete rows at offline Finish. Until the receipt exists, deletion and pantry/spend are not authoritative and a later conflict must remain recoverable.

### 9. Offline registration, purging, and tests are part of the boundary

Register the shop-commit mutation under a stable mutation key with plain-JSON variables and serial replay. Its `session_id`, `expected_checked_keys`, store/mode, and `occurred_at` are minted/captured once and survive restore; `snapshot_version` is captured as an initial precondition and resolved again at execution after earlier queued checks settle. The mutation and local walk record are tenant-stamped and purged with the existing logout/identity-change operation.

The app's persisted allowlist continues to include Grocery data and adds only the secret-free Offline `walk_context`; it never persists the credential-bearing adapter projection or full profile. The aisle-map whole-document write and nickname preference write are class (a): disabled offline and never queued. MCP/App-host shop completion remains online-only because D15's zero-connectivity guarantee applies to the member PWA queue, not MCP Apps.

Worker tests cover exact eligibility, atomic no-partial conflicts, same/different-session races, replay after destructive deletion, pricing ladder and unpriced events, pantry verification/kind rules, tenant/store isolation, and map ownership/ETag/recency/privacy. App unit/integration tests cover mutation restore/order/purge and local-session state. Playwright extends page objects first, then covers known/stale/unknown maps, nickname boundaries, mid-walk/completion/pending/conflict states, pause/resume, zero-connectivity checking/finish/reload/replay, and desktop/tall screenshots.

## Risks / Trade-offs

- **[An exact offline finish can conflict after another member changes the checked set]** → Preserve the queued payload and return a fresh snapshot; require explicit review rather than silently consuming a different set.
- **[Legacy freeform layout notes may not parse]** → Keep them visible in attributed notes, omit only their route projection, and let the member editor rewrite the caller's contribution into canonical form.
- **[Recency does not establish objective correctness]** → Attribute contributions, show stale age, and let a newer correction win without deleting history or another author's note.
- **[Cached/flyer/last-paid estimates can differ materially from checkout]** → Mark every shop event estimated, retain source/unpriced flags in the receipt, and never present the total as a receipt-exact charge.
- **[A local paused session does not resume its active aisle on another device]** → State this boundary plainly; checked progress itself converges through D1, and another device can start a new local shell.
- **[Shop receipt tables retain purchase detail]** → Treat them as tenant-scoped behavioral records with the same keep-forever/export posture as spend events and never expose them cross-tenant.

## Migration Plan

1. Land/merge the Grocery and Store-card sibling prerequisites, then add additive store-note recency and shop-receipt migrations plus data-layer operations/tests. Existing notes fall back to `created_at`; no backfill or manual production surgery is required.
2. Add shared map/placement and shop-commit operations, spend writer extension, MCP tool, and `/api` adapters. Keep old agent receive prose unused only after the new tool/persona lands in the same deploy.
3. Enrich adapter/Grocery contracts and wire Store-card nickname/map editing, then add the local walk controller and offline mutation lifecycle.
4. Update docs/persona/plugin and run targeted Worker/type/app/tooling tests plus full app Playwright screenshot review.
5. Deploy additively. A code rollback can hide the new UI/endpoints while retaining receipts/events and additive note timestamps/preferences. Do not roll back by deleting committed receipt, pantry, or spend data; those represent completed user assertions.

## Open Questions

None. The exact checked set, receipt/replay outcomes, estimate ladder, map ownership/recency, 180-day stale boundary, nickname scope, local walk states, and offline classifications are resolved above.
