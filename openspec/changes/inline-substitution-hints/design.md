# Design — inline-substitution-hints

## Context

P4 (`member-app-differentiators`, archived 2026-07-08) introduced substitution suggestions as
one op behind `suggest_substitutions` / `POST /api/grocery/substitutions`, and surfaced them in
the member app as a toolbar-triggered, online-only panel (`_app.grocery.tsx` `SubsPanel`). The
op composes two independently-degrading halves (already documented as such — `docs/TOOLS.md:459`
alternatives vs `:460` siblings, `:462` no-location degradation): a pure identity-graph
walk + pantry/flyer annotations, and a live per-line term search + unit-price ranking. This
change **dissolves the op along that seam** and rehomes each half where it belongs, dropping the
panel.

The real machinery this designs against (read end-to-end this session):

- **The substitution op** (`packages/worker/src/substitutions.ts`): `suggestSubstitutions(env,
  tenantId, input, wiring)` — per line, `identitySiblings` (a depth-1 walk over the loaded
  identity+edge pair, representative-resolved, membership-last, capped 4) annotated
  `in_pantry: pantry.has(id)` (`readPantryNames`) and `on_sale_hint = flyerHint(saleItems, base)`
  (a warmed-rollup match, no per-sibling search); then the price/availability half —
  `wiring.productById` revalidate + one `wiring.search` + one `compareUnitPrice` pass → capped
  `alternatives` tagged `cheaper`/`on_sale`/`in_stock`. Result shape in `order-shapes.ts:160-218`
  (`SiblingSuggestion`, `SubstitutionAlternative`, `LineSuggestions`,
  `SuggestSubstitutionsResult`).
- **The to-buy read** (`packages/worker/src/to-buy.ts`): `computeToBuyView` — pure D1, returns
  `ToBuyView { to_buy, pantry_covered, in_cart, underived, location? }`; the default read returns
  before any Kroger touch (`to-buy.ts:186`), and the opt-in `with_aisles` enrichment resolves the
  store once (`resolveLocationId`, `to-buy.ts:221`) to join `sku_cache` aisle placement per line.
  `ToBuyViewLine` at `order-shapes.ts:94-113`.
- **The location resolver** (`packages/worker/src/kroger.ts:202-223`): `resolveLocationId(label)`
  — `if (!/\s/.test(label)) return label` (no HTTP for a bare id), else a live Locations GET. The
  flyer read (`substitutions.ts` `readStoreFlyer`) and the aisle enrichment are its two grocery
  callers, gated identically on `primary === "kroger"` + label shape.
- **The order preview** (`packages/worker/src/order.ts:242-329`): `placeOrder` builds
  `ResolvedLine { …, price?, on_sale?, aisleLocation? }` (fresh price/on_sale per resolved line),
  routes ambiguous/unavailable lines to `checkpoint` with `candidates`, and short-circuits on
  `preview`. It runs **no** term search on the cache-hit path (`matching.ts:440-456`), so ranked
  cheaper-alternatives are not present today.
- **The persona** (`AGENT_INSTRUCTIONS.md`): `read_to_buy` is the shop-time read in every branch
  (`:354/411/450/520`); `suggest_substitutions` is called once, at `shop-groceries` step 4
  (`:382`), after `place_order(preview)`, presenting both halves and mapping accepts onto the
  imminent flush (`overrides`; add/remove; materialize + order-scoped `exclude`).

## Decisions

### D1 — Split on the determinism boundary; do not add a parallel hint endpoint

The cheap half is a **deterministic retrieve** over persisted data (identity graph + pantry +
warmed flyer rollup); the repo's architecture puts deterministic retrieval in the coarse read
everyone already calls. So the cheap half folds into `read_to_buy` (the retrieve), and the
expensive half — a **live narrow** — stays a preview-time op. No new "hints" endpoint is
introduced: a parallel surface would duplicate the walk and split the to-buy render across two
reads. This is the whole shape of the change; D2–D8 are its consequences.

### D2 — The cheap hints ride the enriched read's single resolve; the default read stays pure

`on_sale_hint` needs the store's `locationId`, which is exactly the one Locations resolve the
`with_aisles` enrichment already pays (D2 fact: same `resolveLocationId`, live only for a
whitespace label). Rather than earn a second resolve or a second flag, the substitute hints ride
the **existing enrichment**. The flag is generalized from `with_aisles` / `?aisles=1` to `enrich`
/ `?enrich=1` — the enriched read now returns aisle placement **and** `substitutes[]` under one
resolve and zero product searches. The **default** read is untouched and byte-identical (P4's
`ingredient-matching`/to-buy zero-Kroger guarantee holds). The `with_aisles` name is retired
rather than kept as a muddy alias — it shipped the same day and has two persona call sites + one
app hook, so the churn is trivial and docs stay describing current state.

*Rejected — two flags (`with_aisles` + `with_substitutes`) sharing the resolve.* Honest-named and
granular, but the enriched read is already "everything store-derived for these lines" and both
extras are cheap once the resolve is paid; one flag is the simpler contract. The in-store branch
computing siblings it ignores is one batched neighbor query — acceptable.

### D3 — `in_pantry` is pure-D1, `on_sale_hint` is store-gated, both under one code path

The sibling walk + `in_pantry` need no location; `on_sale_hint` needs the resolve. Both are
computed by the shared `annotateSubstitutes` behind the `enrich` flag, so there is **one** code
path. A walk-store / no-location tenant still gets siblings + `in_pantry` (pure D1) and a
label-keyed flyer match with **zero** Kroger calls — the same degradation the op guarantees today
(`substitutions.ts` no-location branch), now reaching those tenants through `read_to_buy` for the
first time (they never called `suggest_substitutions`).

### D4 — Keep `suggest_substitutions` as a slim alternatives-only tool; do not fold it into `place_order`

The expensive half already fires exactly at preview time (persona step 4, after
`place_order(preview)`), and the order preview cannot cheaply absorb whole-list alternatives: a
term search per resolved line has no 12-line cap and would breach the free-tier subrequest
ceiling. Keeping `suggest_substitutions` as a **capped, paginated, alternatives-only** op (a) is
the minimal-disruption path — it stays where it fires, just loses the sibling/pantry/flyer half,
(b) preserves its budget discipline and its on-demand "cheaper option for X?" capability, and (c)
leaves the `place_order` contract untouched. The app's order dialog calls it at preview and
renders the pills the panel used to.

*Rejected — fold alternatives into `place_order(preview)` and retire the tool.* Cleaner surface
on paper, but forces a per-line search budget onto the whole-list preview and couples
comparison-shopping to the cart write. The tool already sits at the right moment; slimming beats
merging.

### D5 — Same-identity alternatives surface in the order dialog, not the list

`on_sale` and `in_stock` recovery are already at order time on `ResolvedLine` /
`checkpoint.candidates`; the net-new render is the ranked `cheaper` list. The app surfaces the
slim tool's `alternatives` in `OrderPreview` (reason pills → accept stages `overrides`), which is
also *where a member is deciding what to buy*. The grocery **list** shows only the cheap
substitute hints (D6). This keeps the expensive, online, budgeted work off the list read and on
the order path.

### D6 — Inline list hints are actionable and honest about sparsity

Each to-buy row with a `substitutes[]` entry renders the relation-labeled swap: an `in_pantry`
sibling ("use the green cabbage you have") and/or an `on_sale_hint` sibling ("cauliflower's on
sale — $X at your store"), with a per-row **accept** (existing writes, D7) and a per-session
**dismiss** (never persisted, as the panel's dismiss was). Rows without a substitute render
clean — no empty container, no fabricated hint. This is "where applicable" made literal: with
252 auto edges most rows carry nothing, and that is the honest state, densifying through the
capture cron. Accept stays actionable rather than passive because P4 already defined the accept
writes and removing capability is not asked for.

### D7 — Accepting a hint reuses existing writes; the `exclude` seam spans two moments

Unchanged from P4's "acting on a suggestion reuses existing writes only": a same-identity swap →
`place_order` `overrides`; a cross-ingredient sibling swap on an explicit row →
`add_to_grocery_list` (note) + `remove_from_grocery_list`; on a **virtual** (`origin:"plan"`)
row → materialize-add + an **order-scoped `exclude`** of the original. The one new wrinkle: hints
now appear at list-review (before the flush), so a virtual-row swap's materialize-add lands
immediately while its `exclude` is **staged in client order state** and applied at the eventual
`place_order` — exactly what `SubsPanel` does today via `stageSwap`/`swapSibling`, just triggered
from the row. The persona's step 4 prose is split so the hint moment (list review, every branch)
and the flush moment (`place_order`, Kroger-online) each own their write.

### D8 — The enriched read's ETag folds the hint inputs

`read_to_buy` is ETagged; `substitutes[]` depends on the pantry, the flyer rollup (`flyer_as_of`),
and the identity graph. The enriched read's ETag SHALL incorporate those versions (pantry
`last_verified`/rowset, `flyer_as_of`, edge-set marker) so a warmed flyer or a pantry edit
invalidates cached hints rather than serving stale swaps. `flyer_as_of` is returned on the view
for the UI's "as of" caveat.

## Sparse-data honesty

Repeated for emphasis because it governs expectations: `suggest_substitutions`'s sibling half is
already mostly empty in production (P4 spike: 252 `source='auto'` edges; "most lines yield zero
siblings today"). This change does **not** make hints appear where the graph has no edge — it
moves the *existing* hints to a better place and a wider audience (every branch, incl.
walk/satellite). The visible day-one delta is: the panel disappears, a minority of rows gain an
inline swap, the order dialog gains the price pills, and no member has to press a button to learn
they already own a substitute. Density improves as the capture cron adds edges — no code change
needed for that curve.

## What this change does NOT do

- No D1 migration and no new external call — every input already exists and is already read.
- No change to the sibling-walk algorithm, the closed reason vocabulary, the matcher's
  resolve-only/never-substitutes contracts, or `place_order`'s contract.
- No new write operation — accept reuses `overrides` / add / remove / materialize / `exclude`.
- No multi-store picker and no aisle-grouping change (P4's grouping requirement is untouched; the
  `enrich` flag simply also carries `substitutes[]`).
