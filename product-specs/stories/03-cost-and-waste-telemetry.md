# Story 03 — Cost & waste telemetry (capture → analyzers)

The Retrospective's Spend and Waste analyzers (pages/07) are read surfaces over telemetry
that does not exist today. The mockup shows the analytics in full detail but only hints at
capture. This story defines the capture contracts so the analyzers are honest derived
views, per the capture → retrieve → narrow doctrine.

## 1. Spend capture

**Target shape** (from the analyzer's needs): priced grocery line items
`{date/week, item, department, store, amount, provenance: planned|impulse}` at household
scope, plus a member-set **weekly budget** preference.

- **Primary source: the order flow.** Order commit (Kroger today; Instacart/satellite
  later — story 04) already resolves per-line prices at preview; persist the committed
  order's lines as spend events (est. price is acceptable; flyer savings recorded
  alongside — the Order Review's "estimated total / flyer savings" tiles and the spend
  analyzer must agree on source).
- **Store-walk / manual shop**: "Log a manual shop · N checked" marks checked lines
  purchased; price them best-effort (sku cache / flyer / last-paid memoized per item) and
  mark estimates as estimates. Offline stores (story 04) price the same way.
- **Provenance**: `planned` = line derived from plan/list (`for_recipes` or explicit list
  add before the shop); `impulse` = added during order review / at the store / cart
  additions outside the list. This maps onto the existing to-buy `origin` attribution —
  keep the mapping rule explicit in the proposal.
- **Budget**: one household-level `$N/week` preference (mock prop default $95; $0/unset
  hides the budget line). Lives in preferences (`update_preferences` + Preferences tab —
  note the mock forgot a budget control; add one).

## 2. Waste capture

**Target shape**: waste events `{date, item, department, reason, avoidability, value}`.

- **Capture point: pantry disposition** (pages/06). Regular pantry rows lose the bare
  trash button; removal is a disposition — **Used** (consumed; pure removal today, maybe
  a consumption signal later) or **Mark as waste** → reason modal. Stale-row trash stays
  (verification cleanup, not waste).
- **Reason vocabulary**: mock capture modal (6 reasons) and mock analytics (12 reasons)
  disagree — define ONE canonical enum at capture; suggested: spoiled, moldy, over-ripe /
  wilted, expired/past-date, freezer-burned, went-stale, forgot-about-it, bought-too-much,
  never-opened, other. Keep it small enough for a tap-list.
- **Avoidability**: derived from reason (+ item class), not asked at capture. E.g.
  freezer-burned/bought-too-much/forgot → avoidable; some (item, reason) pairs
  unavoidable. Derivation table is part of the spec, or LLM-classified in a cron
  (capture → retrieve → narrow) — decide in proposal.
- **Value**: derived from spend telemetry (last purchase price of the item, memoized),
  falling back to sku-cache estimate; never asked at capture. This sequences waste
  **after** spend capture.
- **Leftovers waste**: the analyzer shows a "Leftovers" pseudo-department; prepared items
  already exist in the pantry (`prepared_from`) so the same disposition flow covers them.

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
