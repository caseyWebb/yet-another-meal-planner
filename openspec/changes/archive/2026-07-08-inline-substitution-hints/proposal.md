# Proposal — inline-substitution-hints

## Why

P4 (`member-app-differentiators`) shipped substitution suggestions as a single tool
`suggest_substitutions` (and `POST /api/grocery/substitutions`), surfaced in the member app
behind an explicit **"Propose substitutions"** toolbar box that opens an online-only panel
(`packages/app/src/routes/_app.grocery.tsx` `SubsPanel`). That one call welds two halves with
opposite cost profiles:

- a **cheap deterministic retrieve** — cross-ingredient siblings from the depth-1 identity-graph
  walk, each annotated `in_pantry` (a pantry row exists for the sibling's id) and `on_sale_hint`
  (a warmed flyer-rollup match). Pure D1 + KV, **zero product calls**, served even to walk-store
  tenants (`substitutions.ts` `identitySiblings` + the pantry/flyer join; `docs/TOOLS.md:460`,
  `:462`).
- an **expensive live narrow** — the cached pick revalidation + one term search +
  `compareUnitPrice` ranking per line, producing same-identity `alternatives` tagged with the
  closed vocabulary `cheaper` / `on_sale` / `in_stock`, budget-capped at 12 lines against the
  free-tier subrequest ceiling (`substitutions.ts` `MAX_SUBSTITUTION_LINES = 12`).

This is the one grocery tool that **straddles the repo's determinism boundary**, and the UI
expresses the weld: the whole panel is gated behind an explicit trigger and marked online-only
*because of the expensive half* — even though the two annotations members most want (a substitute
they already have; a substitute that's on sale) are the **cheap half** and need no live call.

Grounding this session against the code (read-only, 2026-07-08) sharpened the premises:

- **The flyer hint and the aisle enrichment are the same Kroger-call posture.** Both funnel
  through one `resolveLocationId(label)` (`kroger.ts:202`) that fires a live Locations GET **iff**
  the stored `preferred_location` label contains whitespace — the documented default
  (`"Kroger - 76104"`, `docs/SCHEMAS.md:35`) — and short-circuits to a passthrough for a bare
  locationId. The sibling walk + `in_pantry` are pure D1 (no resolve). So the cheap hints can
  **share the enriched read's single resolve** rather than earning their own — but they cannot
  ride the *default* zero-Kroger `read_to_buy` (spec-guaranteed byte-identical,
  `to-buy.ts:186`).
- **The cheap hints are orphaned for non-Kroger tenants today.** `suggest_substitutions` is
  invoked in exactly one persona passage — `shop-groceries` step 4, Kroger-online branch, *after*
  `place_order(preview)` (`AGENT_INSTRUCTIONS.md:382`). The walk/satellite branches never call it,
  so those shoppers get **no** hints — yet `read_to_buy` is read in every branch
  (`AGENT_INSTRUCTIONS.md:354/411/450/520`). Folding the cheap half into `read_to_buy` hands hints
  to the tenants who get nothing now.
- **The order preview already holds most of the expensive half.** Every resolved line already
  carries fresh `price` + `on_sale` (`order.ts:302-312`) and unavailable picks already route to
  checkpoint candidate lists — so `on_sale` and `in_stock` recovery are *already* at order time.
  The only net-new piece is the ranked `cheaper` list; auto-attaching it to the whole to-buy set
  would blow the 50-subrequest ceiling the 12-line cap dodges. So the expensive half stays a
  capped op called at preview — it **barely moves**.
- **The graph is sparse and this change stays honest about it.** P4's design records "with 252
  auto edges, most lines yield zero siblings today"
  (`openspec/changes/archive/2026-07-08-member-app-differentiators/design.md:202`). Inline
  substitute hints therefore render on **few** rows now and densify organically through the
  existing capture cron; the fold's immediate payoff is reaching walk/satellite tenants and
  collapsing the surface, not transforming every row.

## What Changes

- **Split `suggest_substitutions` along the determinism boundary.**
  - The **cheap half** (siblings + `in_pantry` + `on_sale_hint`) is extracted into a shared
    annotator (`annotateSubstitutes`) and folded into the **enriched** to-buy read: each to-buy
    line gains `substitutes[]`, populated behind the same single Locations resolve the aisle
    enrichment already pays. `in_pantry` siblings are pure D1 (served to every tenant, walk-store
    included); `on_sale_hint` fills in when the store resolves. The **default** `read_to_buy`
    stays byte-identical (zero Kroger).
  - `suggest_substitutions` / `POST /api/grocery/substitutions` **slim to alternatives-only** —
    the same-identity `cheaper` / `on_sale` / `in_stock` list, capped 12 with `remaining`
    pagination. The sibling/pantry/flyer half is removed; the price/availability half's cost and
    shape are unchanged, and it is still called at preview time.
- **Member app: drop the "Propose substitutions" box + `SubsPanel`.**
  - The grocery list renders the cheap hints **inline** on the rows that have them ("where
    applicable"): a substitute already on hand (`in_pantry`) and a substitute on sale
    (`on_sale_hint`), each with its relation label and the real sale price, a per-row accept
    (existing writes) and a per-session dismiss. The app always fetches the **enriched** read so
    hints show regardless of the aisle/category grouping toggle.
  - The same-identity `alternatives` (cheaper/on_sale/in_stock) move to the **order dialog** at
    preview time — the reason pills the panel showed, rendered where an order is about to be
    placed; accept stages `overrides` on the commit.
- **Generalize the enriched read.** The opt-in enrichment (one Locations resolve, zero product
  searches) now carries aisle placement **and** substitute hints; the flag names the enrichment
  (`enrich`, generalizing `with_aisles` / `?aisles=1`), and `flyer_as_of` rides the result for
  the UI's freshness caveat.
- **Persona + docs in lockstep.** `shop-groceries` step 4 splits: the in-pantry/sale substitute
  hints move to the list-review read (`read_to_buy` enriched, every branch), the same-identity
  alternatives stay at preview, and the order-scoped `exclude` write for a plan-derived sibling
  swap is threaded across the two moments. `docs/TOOLS.md` (`read_to_buy` substitutes; the
  slimmed tool; the `enrich` param), `docs/SCHEMAS.md` (the to-buy line's `substitutes[]`).

## Capabilities

### Modified Capabilities

- **`member-app-differentiators`** — the substitution surface is refactored along the
  determinism boundary. The deterministic sibling/pantry/flyer half moves onto the enriched
  to-buy read as a per-line `substitutes[]` computed by a shared annotator; the shipped panel
  requirement is replaced by inline list hints plus an order-dialog alternatives surface; the
  shared-read requirement slims to alternatives-only; and the aisle-enrichment requirement
  generalizes to carry both aisle placement and substitute hints under one resolve. The
  sibling-walk semantics, the closed reason vocabulary, and the never-writes / acting-reuses-
  existing-writes guarantees are preserved — only their home and trigger change.

## Impact

- **Worker** (`packages/worker/src/`): extract the walk + annotations into a shared
  `annotateSubstitutes(lines, deps)` (the sibling walk stays where it is; the pantry/flyer join
  moves with it); `to-buy.ts` enriched read calls the annotator and adds `substitutes[]`;
  `substitutions.ts` `suggestSubstitutions` slims to the price/availability half;
  `order-shapes.ts` (workerd-free leaf) moves `SiblingSuggestion` onto the to-buy line shape and
  keeps `SubstitutionAlternative` on the slimmed result; `tools.ts` (`read_to_buy` param
  generalized to `enrich`); `src/api/grocery.ts` (`?enrich=1`; the substitutions POST slimmed).
  No D1 migration — all inputs (identity graph, pantry, flyer rollup) already exist.
- **Frontend** (`packages/app`): `_app.grocery.tsx` — remove the trigger + `SubsPanel`; add the
  inline hint affordance to `ToBuyItem`; render the alternatives surface in `OrderPreview`;
  always fetch the enriched read; `lib/data.ts` (`useToBuy` enrich; retire the `fetchSubstitutions`
  panel path, repoint the alternatives fetch to the order dialog). `packages/ui` per the design
  bundle's row/pill patterns.
- **Persona** (`AGENT_INSTRUCTIONS.md`): `shop-groceries` step 4 split + the `exclude` threading;
  the walk/satellite branches inherit hints for free via the enriched `read_to_buy`.
- **Docs**: `docs/TOOLS.md`, `docs/SCHEMAS.md`.
- **Tests**: Worker unit (the annotator reproduces the old sibling half over the edge fixtures;
  the slimmed op still budgets + paginates; the enriched read carries `substitutes[]`; the
  default read stays byte-identical); app Playwright (the `subs-open` / `subs-pantry-hit` /
  `subs-sale-hint` testids move onto the inline rows + the order dialog; the P4 seed already has
  pantry rows, a sibling edge family, and a flyer rollup).

## Dependency

**Requires `member-app-differentiators` (P4) landed** — the substitution op, the pure sibling
walk, the aisle-enriched read, and the order dialog (`OrderPreview`) whose `overrides` input the
alternatives accept stages into. This change refactors P4's own surfaces; it introduces no new
external dependency and no migration.
