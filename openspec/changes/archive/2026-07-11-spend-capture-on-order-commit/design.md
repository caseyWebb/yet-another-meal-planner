# Design — spend-capture-on-order-commit

## Context

D16's two-phase contract exists because the two facts an analyzer needs — *what did this line cost* and *was it actually bought* — are known at two different moments, on different paths, and neither moment can be reconstructed later:

- **Prices are known only at send.** `place_order` resolves every line to a `ResolvedLine` carrying fresh `price: {regular, promo}` + `on_sale` (matcher path and override path both revalidate live; `src/matching.ts` `MatchResult` makes `price` non-optional on a resolve). The Kroger cart is additive and write-only (`PUT /v1/cart/add` `{upc, quantity}` — `docs/ARCHITECTURE.md`, the `place_order` SKU-not-price guarantee), so after the flush the numbers are unrecoverable. The satellite receipt's `order` observations carry an optional single observed `product.price` (`packages/contract/src/ingest.ts` `orderFields`) — no regular/promo split. `sku_cache` stores **no** prices (production-verified), and the KV flyer rollup is a store-wide sale scan, not a per-order record.
- **Purchase is known only at the user's assertion.** The lifecycle spec (order-placement) is explicit: neither flush may advance past `in_cart` on its own; `ordered` is minted only by the guarded user-asserted advance (`updateGroceryRow`'s W3 guard, `advanceOrderedRows` for satellite `mark_placed`), and receive is a terminal *action* (row removed + pantry restock), today expressed as agent choreography (`remove_from_grocery_list` + `update_pantry` — AGENT_INSTRUCTIONS receive flows), not a stored status or a shared op.

Production state (spike, 2026-07-10): no row has ever been `in_cart`/`ordered` (22 `active` rows, all `ad_hoc`, `ordered_at` NULL everywhere); `order_lists` empty. There is nothing to backfill — this change only has to be right going forward, and its production acceptance fixture is the first real order after deploy.

This change implements **after** its band-1 sibling `pantry-disposition-foundations`, which owns the D17 module: `src/department.ts` (the snake_case vocabularies; `DEPARTMENTS` = the 14 food categories ∪ `household` ∪ `leftovers`; `stampDepartment`), the identity-keyed memo (`ingredient_identity.category` — nullable, cron-owned like `embedding`, representative-resolved, `household` as the classifier's non-food terminal), and the bounded `ingredient-category` scheduled job (phase-1 group; classify → pantry backfill → waste-event stamp). This change **consumes and extends** that machinery — it ships no parallel vocab, memo table, or classify pass.

## Goals / Non-Goals

**Goals**

- Persist the send-time snapshot on both existing commit paths (`place_order`, satellite cart-fill receipt) as the one source Order Review tiles (band 3) and the analyzer (band 4) will agree on.
- Materialize spend events through one shared writer at the purchase assertion, with D16's negative rules as enforced guarantees, idempotent on `(send_id, line_key)`.
- Stamp the D17 department on spend lines via the sibling-owned shared derivation (`src/department.ts` + the `ingredient_identity.category` memo), extending the `ingredient-category` job so pending stamps converge to the true category.
- Land the weekly-budget preference contract and a minimal read so the loop is verifiable end-to-end from band 1.

**Non-Goals**

- No UI (D25(1)) — no member-app or admin surface, no Playwright deltas.
- No impulse-capture UX, no manual-shop/walk pricing, no savings tiles — band 3, riding these same ops.
- No analyzer aggregations beyond the minimal retrospective section — band 4.
- No pantry category/location split, no waste events, no department vocab/memo/classifier of our own — `pantry-disposition-foundations` owns those; this change consumes and extends them.
- No reconciliation of quotes against fulfillment receipts — no such source exists (resolved question 1).

## Decisions

### D1 — Send record: `order_sends` + `order_send_lines`, written atomically with the in-cart advance

One send row per flush, per-line child rows. On the `place_order` path the snapshot statements join the **same D1 batch** as `advanceInCartRows`' row upserts: the send exists iff the advance succeeded, there is no orphan half-state, and the failure ordering story is unchanged (sku-cache commit → advance+snapshot → cart write). The cart-failure rollback batch deletes the send lines + send row alongside its existing compensation (a failed cart write means nothing was sent; tiles must never render a phantom order). If the rollback itself fails, the send remains alongside the stranded `in_cart` rows — consistent with the existing "visible under-buy" posture, and the user marking those rows ordered anyway still materializes honest resolved prices.

`placeOrder` (`src/order.ts`) stays pure: the snapshot rides the existing `advanceInCart` dep, whose receipt widens to `{ inserted, sendId }`, and `rollbackInCart` keeps compensating exactly what the advance did. `PlaceOrderResult` gains `send: { recorded: boolean; id?: string; error?: string }` (leaf `order-shapes.ts`, honest independent reporting like `sku_cache`/`cart`/`list`). Preview and empty-resolve short-circuit before any write, exactly as today — **snapshot at send means the real flush only**.

On the satellite path the send id is **deterministic: the order-list id**. The receipt intake's first landing (`row.status !== "received"` in `handleOrderReceipt`) builds the snapshot from the carted/substituted observations and threads it into the same `advanceInCartRows` call; `INSERT OR IGNORE` on the send + lines makes the residual double-intake replay (noted in `ingest.ts`) converge instead of double-recording.

Schema (migration `NNNN_spend_capture.sql` — the next free number at implementation time; `0050` as of planning, after the sibling's `NNNN_pantry_location_disposition.sql` takes `0049`):

```sql
CREATE TABLE order_sends (
  id            TEXT PRIMARY KEY,   -- place_order: minted per flush; satellite: the order_list id
  tenant        TEXT NOT NULL,
  store         TEXT NOT NULL,      -- 'kroger' | the satellite store slug
  location_id   TEXT,               -- resolved Kroger locationId; the order-list's (nullable)
  fulfillment   TEXT NOT NULL,      -- 'kroger_online' | 'satellite'
  order_list_id TEXT,               -- satellite correlation; NULL on the Kroger path
  created_at    TEXT NOT NULL       -- ISO 8601
);
CREATE INDEX idx_order_sends_tenant ON order_sends (tenant, created_at);

CREATE TABLE order_send_lines (
  send_id       TEXT NOT NULL,
  line_key      TEXT NOT NULL,      -- === grocery_list.normalized_name (the canonical key the advance uses)
  name          TEXT NOT NULL,      -- display at send
  sku           TEXT,               -- Kroger UPC / satellite productId; NULL when unreported
  brand         TEXT,
  size          TEXT,
  quantity      INTEGER NOT NULL,   -- package count sent
  price_regular REAL,               -- per-package regular price at resolution (NULL on the satellite path)
  price_promo   REAL,
  on_sale       INTEGER,            -- 1/0; NULL = unknown (satellite)
  unit_price    REAL,               -- effective per-package price: promo when on sale else regular;
                                    -- the satellite's observed product.price; NULL when unpriced
  savings       REAL,               -- deriveSavings(regular, promo) when on sale, else 0; NULL = unknown
  estimated     INTEGER NOT NULL DEFAULT 0,  -- 1 = fallback-priced (band 3); send-path quotes are 0
  department    TEXT,               -- D17 stamp; NULL ONLY while pending classification (D5 below)
  provenance    TEXT NOT NULL,      -- 'planned' | 'impulse' (D6 below)
  for_recipes   TEXT,               -- JSON array
  PRIMARY KEY (send_id, line_key)
);
```

Per-field feasibility (the spike's answer to story 03 q1, normative):

| D16 field | Kroger `place_order` | satellite receipt |
| --- | --- | --- |
| pick/sku, brand, size | `ResolvedLine.sku/brand/size` (fresh) | `product.productId/description/size` (brand not split out → NULL, description rides `name` context) |
| qty | package count sent | the issued line's quantity |
| unit + promo price | `price.{regular,promo}` at the location — a **send-time quote**; fulfillment may differ (weight-priced items charge by actual weight; promos may lapse/appear) | single observed `product.price` → `unit_price`; regular/promo/on_sale NULL-unknown |
| flyer savings | `deriveSavings(regular, promo)` when `isOnSale` — the same single source the flyer/matcher use; the KV rollup is NOT consulted | NULL (unknowable from one number) |
| store / fulfillment path | resolved `locationId`, `'kroger'`, `'kroger_online'` | `order_lists.store/location_id`, `'satellite'` |
| provenance | D6's deterministic mapping | `planned` by construction |

Not capturable anywhere (documented, not worked around): fulfillment-time actual charges, substitutions Kroger makes at pick time, taxes/fees. The snapshot is the spend truth **by definition**.

### D2 — Row↔send linkage: an internal `grocery_list.sent_in` column, not a latest-send lookup

The materializer must know *which* send a row's in-flight state belongs to. Inferring it (latest `order_send_lines` row for the key) is wrong in a reachable case: a row received long ago, re-added, manually moved `active → in_cart` by the member (a freely-writable transition), then marked ordered would resurrect months-old prices. A nullable `sent_in` column stamped **only** by the two snapshot-writing advances makes the linkage exact and makes the negative rules trivially enforceable:

- `place_order`/satellite advance → `sent_in = send id` (same batch as the snapshot).
- manual `active → in_cart` (`updateGroceryRow`) → `sent_in` stays NULL — no send, no spend.
- `in_cart → active` → clear `sent_in` (left the flight without an assertion; no spend — and its snapshot lines simply never materialize).
- `in_cart → ordered` → keep `sent_in`; the writer materializes from it.
- leaving `ordered` (re-list, either direction) → void the events for `(sent_in, key)`, clear `sent_in` (rides the same branch that already clears `ordered_at`).
- rollback → cleared with the compensation (inserted rows are deleted anyway).

`sent_in` is an internal linkage: documented in SCHEMAS.md, threaded through `GroceryItem`, **not** surfaced as an editable tool/API field (no writer accepts it; it rides reads harmlessly).

### D3 — The one writer: `src/spend.ts`, called from inside the shared status ops, never a surface

`spend_events` are written by exactly one function, `recordPurchaseAssertion(env, tenant, rows, occurredOn)`, which loads the `(sent_in, line_key)` snapshot lines and `INSERT OR IGNORE`s events copying them **verbatim** (no re-pricing, no re-derivation — department and provenance included; a department still pending on the snapshot line copies as NULL, and the `ingredient-category` job's fill converges both rows, D5). Call sites are the two shared assertion ops every surface already funnels through:

- `updateGroceryRow` (session-db) — the guarded `in_cart → ordered` advance behind the `update_grocery_list` tool AND the member `PATCH /api/grocery` route (band 3's "Mark order placed" UI lands on this op with zero new wiring — D16's requirement that the shared op already serve it).
- `advanceOrderedRows` (session-db) — the satellite `mark_placed` advance (already filtered to `in_cart` rows by its caller).

"Receive of an in_cart row" (the collapsed ordered+received assertion): **verified in code, no shared receive operation exists today** — the terminal receive action is realized as per-row `remove_from_grocery_list` calls + one `update_pantry` restock (AGENT_INSTRUCTIONS receive flows; the `in-store-fulfillment` spec). The guarantee therefore homes in the ops that DO exist: `removeGroceryRow` carries the explicit negative guarantee that a removal **never** writes spend (a remove is ambiguous — it is also "changed my mind" — so it cannot be a purchase assertion), and "receive prices nothing itself" holds structurally because receive has no op of its own to price anything in. The spec delta additionally binds the future: **any operation that completes a receive for rows still `in_cart` SHALL internally perform the purchase assertion first** (advance → materialize via this same writer → complete) — band 3's shared shop-commit/receive op (D28/D16) lands on that contract, closing the gap properly inside an op. Until then the persona's receive flows carry an **advisory** choreography step — advance `in_cart` rows to `ordered` before removing — so the collapsed assertion records spend today; a skill-less or stale agent that removes without advancing under-counts (visible, self-healing, and strictly safer than inferring purchases from deletion). This keeps the writer's call sites at two shared ops and adds no third semantics to removal.

Voiding is the writer module's other entry: `voidSpendEvents` sets `voided_at` (rows are never deleted — audit + keep-forever retention) from `updateGroceryRow`'s leave-`ordered` branch. Reads filter `voided_at IS NULL`.

```sql
CREATE TABLE spend_events (
  send_id     TEXT NOT NULL,
  line_key    TEXT NOT NULL,
  tenant      TEXT NOT NULL,
  occurred_on TEXT NOT NULL,        -- ISO date of the purchase assertion (parity with ordered_at)
  name        TEXT NOT NULL,
  sku         TEXT,
  quantity    INTEGER NOT NULL,
  unit_price  REAL,                 -- copied verbatim from the snapshot line
  amount      REAL,                 -- unit_price * quantity; NULL when the snapshot was unpriced
  savings     REAL,
  estimated   INTEGER NOT NULL DEFAULT 0,
  department  TEXT,                -- copied from the snapshot line; NULL ONLY while pending (filled once by the ingredient-category job, D5)
  provenance  TEXT NOT NULL,
  store       TEXT NOT NULL,
  fulfillment TEXT NOT NULL,
  voided_at   TEXT,
  PRIMARY KEY (send_id, line_key)   -- D16's idempotency key
);
CREATE INDEX idx_spend_events_tenant ON spend_events (tenant, occurred_on);
CREATE INDEX idx_spend_events_item   ON spend_events (tenant, line_key, occurred_on);
```

`idx_spend_events_item` is the per-household **last-paid memo** read (latest non-voided priced event per key) that story 03 §2's waste valuation and band 3's estimation ladder consume — a query, not a table, respecting D2's behavioral-data boundary (tenant-scoped, never cross-household).

Idempotency/replay analysis (D15 statement): no new member-reachable write exists. The advance is already replay-safe (the W3 guard rejects a second `ordered` write with `from: "ordered"`); the writer's `(send_id, line_key)` PK absorbs any race the guard misses; satellite receipt + `mark_placed` re-posts converge on the deterministic send id + `INSERT OR IGNORE` + the caller's `in_cart` filter. Client-minted idempotency keys (D15) arrive with band 3's walk/manual-shop session ids — the first client-originated telemetry writes.

### D4 — Both snapshot writes are honest-best-effort, never blocking the member's groceries

On the `place_order` path the snapshot shares the advance batch, so its failure IS the advance's failure (already reported, cart write skipped, safe retry). Building the snapshot rows (department memo read, provenance mapping) happens before the batch; a failure there degrades to advancing **without** a send (`send.recorded: false` + error in the result, rows advance with `sent_in` NULL) rather than failing the order — telemetry never costs the member their groceries. Same posture on the satellite arm: a snapshot-build failure logs and the advance proceeds bare. The gap is visible (result field / no send for the order list) and self-describing: those rows simply produce no spend events.

### D5 — The department dimension: consume the sibling's module + memo; NULL-pending fill-once; extend the `ingredient-category` job

The D17 machinery is owned by `pantry-disposition-foundations` (its design D1/D5/D6, implemented before this change): `src/department.ts` exports the snake_case vocabularies (`PANTRY_CATEGORIES` — `produce | dairy | meat | seafood | grains | bakery | canned | condiments | oils | spices | baking | frozen | snacks | beverages`), `DEPARTMENTS` = the 14 categories ∪ `household` ∪ `leftovers` (**no `other` value**), and `stampDepartment`; the memo is `ingredient_identity.category` (nullable, cron-owned like `embedding`, representative-resolved, `household` as the classifier's non-food terminal so classification always terminates); the `ingredient-category` job (`src/ingredient-category.ts`, phase-1 `scheduled()` group, `AiActivity: "ingredient-category"`) runs bounded idempotent phases: classify → pantry backfill → event stamp.

This change adds to that machinery, never beside it:

- **`departmentForGroceryLine({ key, kind, domain }, memoLookup)` joins `src/department.ts`** — the grocery-line-shaped derivation: deterministic overrides stamp immediately and are never pending (`kind: household`/`other` or a non-grocery `domain` → `household` — the "2x4 lumber" fixture; included in spend, excluded from cost-per-meal); else a memo hit stamps its value (any memo value, `household` included); else **NULL = pending classification**. `leftovers` is waste-side only (`prepared_from` rows via `stampDepartment`) — spend lines never stamp it. Never store placement, never read-time derivation (D17). `COST_PER_MEAL_EXCLUDED = ["household", "beverages"]` is defined beside the vocab as the constant band 4 consumes.
- **`department` on `order_send_lines` and `spend_events` is nullable**: NULL means pending, and the fill is **NULL → value, exactly once** — a stamped value is never rewritten (vocab/memo evolution never rewrites history, D17). This is the sibling's D5 semantics verbatim, so waste and spend events share ONE pending/immutability model; band-4 analytics read stamped values only, and "Not mapped" never reaches analytics because the backlog drains (the sibling's spike: the whole registry classifies in ~a day; anything that has sat on the list more than one tick is warm).
- **The `ingredient-category` job gains a spend-fill phase** (the same idiom as its `waste_events` stamp phase): fill `order_send_lines.department` and `spend_events.department` where NULL from the memo via `line_key` → alias/identity → representative `category` (any memo value, `household` included). NULL→value only; bounded; idempotent; no new job, no new `scheduled()` wiring, no new AI activity. No separate enqueue is needed: every food line key IS a canonical id minted through the IngredientContext funnel (grocery adds capture; plan-derived needs and satellite `item_id`s are already ids), so the ids appear in the classify phase's existing backlog (`ingredient_identity` unclassified survivors); non-food keys never enter the registry and never need to — the `household` override stamps them at capture.

Why NULL-pending beats a fallback value: a fallback stamp (e.g. `other`) on a food id that classifies one tick later would be a permanently wrong immutable value; NULL-pending converges to the TRUE category through the pipeline while preserving stamp immutability. Why the memo fill is a cron LLM and the capture chain is not: the determinism boundary — tools are plain code; the fuzzy 14-way taxonomy call is the sibling job's capture-once work, retrieved deterministically at capture.

### D6 — Provenance mapping: `planned` unless the line exists only as an unattributed caller extra

Deterministic rule, computed in `runPlaceOrder` where the three input sets are distinguishable: a line is `planned` iff its key is in the stored-list key set or the server-derived plan-needs key set, **or** its merged `for_recipes` is non-empty (an open-world side supplied via `menu_needs` is plan work); else `impulse` (a spontaneous caller extra — the only band-1 impulse source; order-review/store additions arrive in band 3). Satellite pull-list lines are `planned` by construction. This is the explicit mapping onto the to-buy `origin` attribution story 03 §1 requires.

### D7 — Weekly budget: a defined preference scalar on the `profile` row

`weekly_budget` joins `DEFINED_PREFERENCE_KEYS`: validated as a finite number ≥ 0 (`malformed_data` otherwise), `null` deletes (RFC 7396), stored as a new `profile.weekly_budget REAL` column following the existing defined-scalar idiom, assembled into the `read_user_profile` preferences object when non-null. Semantics documented at the contract: household-level dollars/week; unset or `0` = no budget line (the band-2 control and band-4 analyzer read it; nothing in band 1 acts on it beyond the retrospective echo).

### D8 — Minimal retrospective `spend` section (band-1 read), band 4 extends

`retrospective` gains a read-only household-scoped section computed by plain SQL over non-voided events:

```
spend: {
  weekly_budget: number | null,
  weeks: [{ week_start, total, savings, events, estimated }],  // trailing 4 ISO weeks (Mon), newest last
  awaiting_mark_placed: number   // current in_cart rows with a send linkage (the D16 "never auto-counted" surface)
}
```

Rationale: D16's "awaiting mark-placed" needs an agent-visible home in band 1, the capture needs an end-to-end verification read, and the choreography ("under budget 3 weeks running") should work from day one. No LLM in the read path; `period` does not scope it (fixed trailing window, like `underused`); band 4 replaces/extends this shape — its spec delta owns the full analyzer.

### D9 — What the tool descriptions vs the persona carry (ownership boundary)

Tool descriptions own the new guarantees: `place_order` — the send-record side effect + the `send` result field; `update_grocery_list` — "the `in_cart → ordered` advance records the order's spend from its send-time snapshot; re-listing an `ordered` row voids its spend"; `remove_from_grocery_list` — "removes never write spend". The persona owns only choreography: the receive flows' advisory advance-first step (D3 — the enforced guarantees all live in the ops). A skill-less agent can use the tools safely from their descriptions alone.

## Risks / Trade-offs

- **Quotes ≠ receipts.** Accepted and documented (resolved q1): there is no fulfillment feedback channel; the analyzer's numbers are send-time quotes. The alternative — no spend telemetry — is strictly worse, and every field records exactly what was known.
- **Collapsed-receive spend is advisory-choreography until band 3's receive op.** No shared receive op exists today (D3, code-verified); a skill-less or stale agent (D21 window) that removes `in_cart` rows without advancing under-counts — visible as an empty spend week, self-healing on plugin refresh, and strictly safer than inferring purchases from deletion. The spec already binds any future receive-completing op to perform the assertion internally; band 3's shop-commit/receive op closes the gap.
- **A pending department can ride a materialized event briefly.** Bounded by the `ingredient-category` job's spend-fill phase (NULL→value within a tick in steady state); band 4 reads stamped values only.
- **Send retained on failed rollback.** Consistent with the existing stranded-`in_cart` posture; the events only materialize on a user assertion, which remains honest.
- **Migration numbering race** with band-1 siblings — serialized implementation; renumber on rebase (the repo already tolerates historical duplicate prefixes, but don't add new ones).

## Migration Plan

Purely additive (`NNNN_spend_capture.sql`, `0050` as of planning — after the sibling's migration): three `CREATE TABLE` + two `ALTER TABLE ... ADD COLUMN` (both nullable). No backfill — production has zero lifecycle history (spike-verified). Deploy applies it `--remote` as usual. Rollout risk is nil for existing reads (new columns are absent from every existing SELECT's column list except where this change threads them). Implements after `pantry-disposition-foundations` (this migration assumes `ingredient_identity.category` and `src/department.ts` exist).

**Production acceptance (post-deploy convergence checks, no manual surgery):** (a) the first real `place_order` flush writes one `order_sends` row + priced lines with sane departments/provenance and stamps `sent_in`; (b) the member's "I placed the order" advance materializes matching `spend_events` verbatim; (c) `retrospective().spend` reflects them and `awaiting_mark_placed` goes 0 → N → 0 across the flow; (d) re-listing one row voids its event; (e) NULL-pending departments on `order_send_lines`/`spend_events` drain to 0 across `ingredient-category` ticks (its `job_runs` report the spend-fill counts) and no stamped value is ever rewritten; (f) `update_preferences({ weekly_budget: 95 })` round-trips through `read_user_profile`.

## Out of scope (explicit)

Impulse capture UX, manual-shop/walk commit + estimation ladder, savings tiles, `display_order_review`, the shared shop-commit/receive op (band 3); analyzer tabs + full aggregates, avoidability, Leftovers analytics (band 4); waste events, pantry category/location split, the department vocab/memo/classifier themselves (`pantry-disposition-foundations` — this change only adds `departmentForGroceryLine`/`COST_PER_MEAL_EXCLUDED` and the spend-fill phase); the budget UI control (band 2); any member-app-offline reclassification (no new member-reachable writes).
