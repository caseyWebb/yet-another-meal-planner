# Proposal — member-app-differentiators

## Why

The member web app plan (`docs/plans/web-app.md` on the plan branch, §10 phase P4 / §5 W4 + W5)
calls for the differentiators: **W4 substitutions** (a deterministic core + the mock's
substitutions panel), **W5 aisle capture + grouping** (the only mockup feature needing new
data), and the **trending + picked-for-you** browse rows P1 explicitly deferred (P1 design D5
reserved the two browse-page slots "without layout change"). Today none of this exists: the
matcher is contractually resolve-only and never substitutes, so "swap this for something
cheaper" is pure LLM prose with no deterministic footing; Kroger's per-item `aisleLocations`
data is normalized onto every `KrogerCandidate` (`packages/worker/src/kroger.ts`) and then
**dropped** — nothing persists it, so the grocery list cannot be walked in store order; and the
browse page renders P1's placeholder sections because the trending/picked-for-you ops were
grounded as nonexistent (P1 D5: "no such function exists anywhere").

Grounding against the code and production D1 (read-only spike, 2026-07-07) corrected and
sharpened the plan's premises:

- **The substitution raw material already exists as deterministic machinery** — it has never
  been composed. `compareUnitPrice` (`unit-price.ts`) is the pure price-per-unit core;
  `kroger_prices` already returns the full fulfillable product list with `{regular, promo}`,
  on-sale flags, and `aisleLocation` per product; the flyer rollup is a warmed KV cache
  (`flyer:{store}:{locationId}`, `flyer-warm.ts`) readable with zero fan-out. W4's
  "cheaper / on-sale / out-of-stock" core is one coarse read composing these — no new external
  surface, no model call.
- **The sibling walk has real data today — with a sharp caveat the plan couldn't see.**
  Production `ingredient_identity` holds 552 nodes (34 concepts, 5 union-find merges) and 252
  `ingredient_edge` rows — 99 `general`, 20 `containment`, 133 `membership`, all
  `source='auto'`. Useful sibling families exist *now*: 22 general-kind parents and 29
  membership-kind parents have ≥ 2 children (e.g. `cabbage` ← `cabbage::color-green` /
  `cabbage::type-napa` / `cabbage::color-red`; `onion` ← white/yellow, green, red; `flour` and
  `cottage cheese` membership families of 7). But the `concrete` flag does **not** discriminate
  good substitution families from bad ones — `flour` (a great swap family) and `vegetables` (a
  terrible one, fan-in 10) are *both* concept nodes — so the walk cannot silently trust class
  membership; it must label every suggestion with its relation and parent and keep membership
  siblings last and capped (design D3). Many lines will have zero siblings — the panel degrades
  to price/availability suggestions honestly, and the graph densifies organically through the
  existing capture cron.
- **The plan's "store aisle at match time" is impossible as written** — the matcher's contract
  is resolve-only ("NEVER writes the SKU cache", `matching.ts` header; the living
  `ingredient-matching` spec pins it). Aisle capture instead rides the one place SKU knowledge
  is already persisted: `place_order`'s batched SKU-cache commit — which today **skips**
  already-cached `(ingredient, location)` keys entirely (`order-tools.ts`
  `makeCommitSkuCache`), so without a commit-semantics change a cached mapping would never gain
  aisle data. The commit becomes refresh-on-difference (design D5).
- **Trending is degenerate in production today and must be designed for that.** `cooking_log`
  holds **2** recipe entries total across 2 tenants (one cook each). A naive GROUP BY would
  render a fake "trending" row out of single cooks; the op therefore carries a minimum-signal
  guard (≥ 2 cooks or ≥ 2 distinct tenants in the window) and the browse row composes
  new-for-me first with trending as backfill — production's current data is the acceptance
  fixture for the *empty* trending state.
- **Group-wide trending is a new deliberate cross-tenant read** and needs its tenancy posture
  stated: precedent exists (the cross-tenant group-favorites query over `overlay`, the
  group-aggregated recipe-notes read, the operator `group-insights` area), and the row exposes
  counts only — never which member cooked what. `docs/ARCHITECTURE.md`'s multi-tenancy text is
  updated in the same pass.

## What Changes

- **A deterministic substitution read** — one shared op behind a new coarse MCP tool
  `suggest_substitutions` and `POST /api/grocery/substitutions`: per to-buy line, the
  revalidated current pick (cached SKU), same-identity alternatives from one term search ranked
  by `compareUnitPrice` with a closed reason vocabulary (`cheaper` / `on_sale` / `in_stock`),
  and cross-ingredient sibling suggestions from a depth-1 walk over the persisted identity
  graph (representative-resolved, relation-labeled, membership-last, capped), annotated with
  pantry hits and flyer-rollup sale hints. Read-only: it never writes the cart, the cache, or
  the list; acting on a suggestion reuses existing writes (order `overrides`/`exclude`,
  row add/remove, materialize). Subrequest-bounded with honest `remaining` pagination.
- **Aisle capture on the SKU cache** — a D1 migration adds
  `aisle_number`/`aisle_description`/`aisle_side`/`aisle_captured_at` to `sku_cache`;
  `place_order`'s SKU-cache commit carries the resolved candidate's `aisleLocation` and
  refreshes existing rows when learned fields differ (instead of skipping); the rekey reconcile
  carries the new columns. Convergence is organic: every order refreshes placements for the
  lines it resolves.
- **Aisle-enriched to-buy read** — an opt-in `with_aisles` param on `read_to_buy` /
  `?aisles=1` on `GET /api/grocery/to-buy` (P3's view op) joins per-line placements from
  `sku_cache` at the caller's location and derives a `department` fallback from the identity
  graph's parents. The default read is byte-identical and keeps P3's zero-Kroger guarantee; the
  enriched read costs at most one Locations resolve and zero product searches.
- **Grocery page: substitutions panel + aisle grouping** — the mock's panel (trigger button,
  reason pills, per-row Swap/Keep, dismiss-all, empty state) wired to the real op with real
  prices; swap-accept maps per line origin to real writes. Aisle/category grouping toggle with
  an honest "Aisle unknown" bucket (not the mock's fake "Aisle 99") and department/kind
  fallbacks; no multi-store picker (the mock's four hardcoded stores are a recorded deviation).
- **Trending + picked-for-you browse rows** — `GET /api/cookbook/trending` (group-wide
  `cooking_log` GROUP BY, windowed, min-signal-guarded, reject-filtered, counts only) and
  `GET /api/cookbook/picked-for-you` (a thin deterministic wrap of `rankCandidates`: favorites
  centroid as the query vector, favorites/rejects/dietary-avoids excluded, stored vectors only
  — zero AI calls). The browse page's two P1 slots render "New & trending" (new-for-me first,
  trending backfill) and "Picked for you" (with the mock's no-favorites empty state); the P1
  "All recipes" section remains below as a third section (recorded deviation, design D9).
- **Persona + docs in lockstep, same pass**: the shop-groceries Kroger-online branch gains a
  substitutions pass at preview (tool-grounded, replacing improvised swap prose); the Kroger
  in-store walk prefers captured aisle placements via `read_to_buy` `with_aisles`;
  `docs/TOOLS.md` (new tool entry, `read_to_buy` param, `place_order` mapping-commit note),
  `docs/SCHEMAS.md` (`sku_cache` columns), `docs/ARCHITECTURE.md` (cross-tenant read posture).

## Capabilities

### New Capabilities

- **`member-app-differentiators`** — the member app's differentiator surface: the deterministic
  substitution read (one op behind the tool and the endpoint, with the sibling-walk semantics
  and its never-writes guarantee), the aisle-enriched to-buy read with graph-derived department
  fallback, the grocery page's substitutions panel + aisle grouping, and the trending +
  picked-for-you browse rows with their sparse-data honesty and tenancy posture.

### Modified Capabilities

- **`order-placement`** — the "persist learned mappings" requirement gains aisle capture: each
  committed mapping carries the resolved candidate's aisle placement, and the commit refreshes
  an already-cached row whose learned fields (SKU/brand/size/aisle) differ instead of skipping
  it, so placements converge organically with every order.
- **`in-store-fulfillment`** — the aisle-ordered shopping list, when the resolved store is the
  caller's Kroger primary, prefers captured per-SKU placements (`read_to_buy` `with_aisles`)
  for the lines that have them; agent judgment and store notes cover the rest, unchanged.

## Impact

- **D1 migration** (`packages/worker/migrations/d1/`, next free number — 0041 at authoring,
  after P3's 0040): four nullable `sku_cache` columns. No backfill — placements converge
  through the order pipeline (repo rule: no manual surgery).
- **Worker** (`packages/worker/src/`): new `substitutions.ts` (the op + the pure walk);
  `matching.ts` (`ConfidentMatch`/`RevalidatedSku` carry `aisleLocation` — additive),
  `order.ts` (mappings emitted for all resolved lines, aisle threaded), `order-tools.ts`
  (commit refresh-on-difference), `corpus-db.ts` (`NewSkuMapping`/`upsertSkuMappings` columns;
  an identity-neighbors read reusing the loaded identity+edge pair), `sku-cache-rekey.ts`
  (columns carried), `to-buy.ts` (P3; `with_aisles` enrichment), new `cookbook-rows.ts`
  (`readTrending`, `readPickedForYou` over `semantic-search.ts`'s `rankCandidates`), `tools.ts`
  (register `suggest_substitutions`; `read_to_buy` param), `flyer-warm.ts` (rollup read reused,
  unchanged), `src/api/` (grocery: substitutions POST + aisles param; cookbook: two GETs).
- **Frontend**: `packages/app` — `_app.grocery.tsx` (panel + grouping toggle),
  `_app.index.tsx` (the two rows into the P1 slots), `lib/data.ts` hooks; `packages/ui` pieces
  per the design bundle's subs-panel section pattern. Mock deviations recorded in design D10.
- **Persona**: `packages/worker/AGENT_INSTRUCTIONS.md` — shop-groceries Kroger-online
  substitutions pass; Kroger in-store walk placement source; tool descriptions
  (`suggest_substitutions` new, `read_to_buy` param, `place_order` commit note).
- **Tests**: Worker unit tests (walk semantics over edge fixtures, reason derivation vs
  `compareUnitPrice`, commit refresh-on-difference, rekey column carry, aisle enrichment,
  trending guard against the production-shaped sparse log, picked-for-you determinism +
  zero-AI); route tests over fakes; app Playwright (panel + grouping via typed
  route-interception fixtures; rows live against the seeded Worker — seed gains cooking-log
  rows crossing the signal threshold, favorites, aisle-tagged `sku_cache` rows, and a sibling
  edge family).

## Dependency

**Requires P0 (`member-app-foundations`), P1 (`member-app-core`), P2 (`member-app-propose`),
and P3 (`member-app-grocery`) to have landed.** From P1: the browse page's two reserved slots
(D5) and the grocery route group. From P2: `rankCandidates`' widened optional-param signature
(nudge/protein params stay absent here — omission is bit-identical by P2's own contract). From
P3: the to-buy view op (`computeToBuyView`), the `read_to_buy` tool, the order-wiring
extraction (`buildOrderWiring`), and the order dialog whose `overrides`/`exclude` inputs the
substitutions panel stages into. Tasks name P0–P3 pieces by role; the implementer binds them to
the landed actuals.
