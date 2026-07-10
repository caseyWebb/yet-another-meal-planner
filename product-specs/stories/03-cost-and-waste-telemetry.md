# Story 03 — Cost & waste telemetry (capture → analyzers)

The Retrospective's Spend and Waste analyzers (pages/07) are read surfaces over telemetry
that does not exist today. The mockup shows the analytics in full detail but only hints at
capture. This story defines the capture contracts so the analyzers are honest derived
views, per the capture → retrieve → narrow doctrine.

## 1. Spend capture

**Target shape** (from the analyzer's needs): priced grocery line items
`{date/week, item, department, store, amount, provenance: planned|impulse}` at household
scope, plus a member-set **weekly budget** preference.

- **Every purchase path is an emitter (D16)**: the Kroger online order, the Kroger
  in-store walk, the agent-guided voice walk, the member store-walk / "Log a manual
  shop", and satellite cart-fill. The member walk and the agent voice walk are the same
  purchase event and MUST emit identically.
- **Snapshot at send, materialize at the purchase assertion (D16)** — a two-phase
  contract. SNAPSHOT: `place_order` (and the satellite cart-fill receipt's in_cart
  advance) persists per-line resolved prices {pick/sku, qty, unit + promo price, flyer
  savings, store, fulfillment path, provenance} on a send record — the Order Review
  tiles render this snapshot, which is what makes tiles and analyzer agree on one
  source. MATERIALIZE: spend events are written by ONE shared src/ writer at the
  purchase assertion — the in_cart→ordered advance on every path
  (`update_grocery_list`, member "Mark order placed", satellite mark-placed), or receive
  of an in_cart row — copying snapshot prices verbatim, idempotent on (send id, line).
  Emission lives inside the shared ops, never a surface.
- **Walk / manual shop**: completion emits via the shared shop-commit op, best-effort
  priced (sku_cache → warmed flyer → per-household last-paid memo, flagged estimated),
  idempotent on the client-minted session id (D15). Offline stores (story 04) price the
  same way.
- **Negative rules (D16)**: rows leaving in_cart without a purchase assertion write no
  spend; receive prices nothing itself; re-listing an ordered row voids its events;
  never-marked orders surface as "awaiting mark-placed", not auto-counted.
- **Banding (D25)**: primary capture is a UI-free band-1 delta on `place_order` — the
  spend_events table + the weekly-budget preference + the order-placement spec delta.
  Band 3 extends it (impulse lines, savings tiles, manual-shop/walk path).
- **Provenance**: `planned` = line derived from plan/list (`for_recipes` or explicit list
  add before the shop); `impulse` = added during order review / at the store / cart
  additions outside the list. This maps onto the existing to-buy `origin` attribution —
  keep the mapping rule explicit in the proposal. Fulfillment path + store come from the
  shared op's context, not per-surface wiring.
- **Budget**: one household-level `$N/week` preference (mock prop default $95; $0/unset
  hides the budget line). Lives in preferences (`update_preferences` + Preferences tab —
  note the mock forgot a budget control; add one).
- **Last-paid memoization is PER-HOUSEHOLD** (behavioral data — the D2 memoization
  boundary), and waste $ values ride it from band 1.
- **Agent choreography**: the grocery/receive skills update in the same change so "I
  placed the order" / "I picked up the groceries" route through the ops that fire the
  writer; no MCP spend-write tool is minted — the agent reads aggregates via
  `retrospective`.
- **The department dimension (D17)**: ONE canonical analytics `department` dimension =
  page 06's controlled food-category vocab + `Household` + `Leftovers`, stamped
  immutably on every spend and waste event at capture — never derived at read time,
  never taken from store placement. Derivation is deterministic and identity-keyed:
  item → canonical ingredient id (IngredientContext funnel) → category, memoized per
  identity — the SAME source pantry-add autofill uses. Overrides bypass derivation:
  grocery `kind: household` → Household; pantry `prepared_from` rows → Leftovers (waste
  only); non-grocery `domain`/`kind: other` lines map to Household or are excluded from
  spend. The cost-per-meal exclusion = {Household, Beverages} of this dimension; events
  keep their capture-time stamp (vocab evolution never rewrites history); "Not mapped"
  can never reach analytics. Store placement {aisle, department} stays
  presentation-only for list grouping and the walk. Cross-referenced from §2/§3 and
  pages 05/06/07.

## 2. Waste capture

**Target shape**: waste events `{event_id (client-minted, D15), date, item id,
department (capture-stamped per D17), reason, value snapshot once spend history resolves
it}`.

- **Capture point: pantry disposition** (pages/06). Regular pantry rows lose the bare
  trash button; removal is a disposition — **Used** (consumed; pure removal today, maybe
  a consumption signal later) or **Mark as waste** → reason modal. Stale-row trash stays
  (verification cleanup, not waste).
- **Reason vocabulary**: mock capture modal (6 reasons) and mock analytics (12 reasons)
  disagree — define ONE canonical enum at capture; suggested: spoiled, moldy, over-ripe /
  wilted, expired/past-date, freezer-burned, went-stale, forgot-about-it, bought-too-much,
  never-opened, other. Keep it small enough for a tap-list.
- **Avoidability**: derived from reason (+ item class), not asked at capture — a
  versioned reason(+item-class)→avoidable|hard-to-avoid table as constants in src/,
  applied at analyzer READ time; not stored at capture, not an LLM cron. E.g.
  freezer-burned/bought-too-much/forgot → avoidable; some (item, reason) pairs
  unavoidable.
- **Value**: derived from spend telemetry (last purchase price of the item, memoized
  per-household), falling back to sku-cache estimate; never asked at capture. This
  sequences waste **after** spend capture.
- **Leftovers waste**: the analyzer's "Leftovers" pseudo-department is likewise a
  read-time derivation over `prepared_from`; prepared items already exist in the pantry
  so the same disposition flow covers them.

## 3. Analyzer reads (derived, household-scoped)

Both tabs: trailing 4/8/12-week ranges, weekly bars, KPI tiles, prior-period trend, and
a generated one-sentence insight banner. Spend: total / avg-week / cost-per-meal
(numerator excludes household+beverage depts; denominator = cook-log rows in range —
confirm which types count) / trend; breakdowns by department, by store, planned-vs-
impulse; top cost drivers with buy counts; budget line with over-budget highlighting.
Waste: tossed $ / items binned / waste rate (tossed ÷ (spend+tossed), red ≥10%) / trend;
breakdowns by department, by reason, avoidable-vs-hard-to-avoid; most-wasted items.

Aggregates are plain-code queries over the event tables (no LLM in the read path). The
insight banner is template-composed from the aggregates (mock does this deterministically
— keep it deterministic).

## 4. Agent integration

The `retrospective` tool / profile retrospective read should gain spend+waste aggregates
so menu-gen and chat can act on them ("stop buying cilantro", "under budget 3 weeks
running"). Waste signals feeding proposal scoring (single-use-perishable badge already
exists in propose) closes the loop — flag as a follow-on, not the first change.

## 5. Open questions

1. Are Kroger order prices authoritative enough (estimates at preview vs fulfillment
   receipts — Kroger cart can't be read back), or do we reconcile with anything later?
2. Multi-store attribution beyond Kroger: store field comes from the fulfillment path
   (adapter/store slug) — is a per-line store override ever needed (split shops)?
3. Cost-per-meal denominator rules (exclude `ready_to_eat`? count breakfasts?).
4. Household member attribution on spend (who shopped) — needed or noise?
5. Retention/rollup: keep line items forever or roll up beyond N months?
