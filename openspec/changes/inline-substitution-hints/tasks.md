# Tasks — inline-substitution-hints

Ordered **Worker-first**: the shared annotator + the enriched read + the slimmed op land fully
unit-tested (§1–§2) before the route/tool contract (§3) and the UI (§4) bind to them; the persona
(§5) and docs (§6) ride the same PR. Implementation is **serial** across the shared Worker
surfaces (`substitutions.ts`, `to-buy.ts`, `order-shapes.ts`, `tools.ts`, `src/api/grocery.ts`,
`docs/`, `AGENT_INSTRUCTIONS.md`); UI work within §4 parallelizes. **No spike tasks** — every
open question is settled in `design.md` (D1–D8) against the code read this session and P4's
archived spike (graph sparsity, the flyer/aisle shared resolve, the persona call sites). Assumes
P4 landed (`proposal.md` "Dependency"); tasks name P4 pieces by role and the implementer binds to
the landed actuals (`suggestSubstitutions`, `identitySiblings`, `computeToBuyView`,
`resolveLocationId`, `OrderPreview`).

## 1. Worker: extract the shared substitute annotator

- [ ] 1.1 In `substitutions.ts`, extract the cheap half into
  `annotateSubstitutes(lineKeys, deps)`: the `identitySiblings` walk (unchanged) + the
  `in_pantry: pantry.has(id)` join (`readPantryNames`) + the `on_sale_hint = flyerHint(...)` match
  over the warmed rollup (`readStoreFlyer` + `filterByMinSavings` + satellite-staleness
  suppression). Deps are the loaded identity+edge pair, the pantry names set, and the resolved
  primary-store flyer rollup (all already assembled in `suggestSubstitutions` today). Pure D1 +
  KV — no `productById`, no `search`. Returns `Map<lineKey, SiblingSuggestion[]>`.
- [ ] 1.2 Batch the neighbor read: `annotateSubstitutes` loads edges for **all** requested line
  ids in one `readIdentityNeighbors` call (no per-line N+1), since the enriched read covers the
  whole to-buy set, not a 12-line budget.
- [ ] 1.3 `order-shapes.ts` (workerd-free leaf): keep `SiblingSuggestion` as the annotator's
  output; it becomes the element type of the new `ToBuyViewLine.substitutes?`. Leave
  `SubstitutionAlternative` / `LineSuggestions` for the slimmed op (§2).
- [ ] 1.4 Unit tests: `annotateSubstitutes` reproduces the exact sibling/pantry/flyer output the
  P4 op produced for the same fixtures (the `cabbage` family, an `in_pantry` hit, an
  `on_sale_hint` from a seeded rollup, and an empty result for a no-edge line); no Kroger call is
  issued.

## 2. Worker: slim `suggest_substitutions` to alternatives-only

- [ ] 2.1 `suggestSubstitutions` drops the sibling/pantry/flyer half (now `annotateSubstitutes`)
  and returns `LineSuggestions` with `siblings` **removed** — the current pick status +
  `alternatives` (`cheaper`/`on_sale`/`in_stock`, capped 5) only. The 12-line budget +
  `remaining` pagination + no-location degradation (empty `alternatives`, `location: null`)
  are retained on this half.
- [ ] 2.2 Update `SuggestSubstitutionsResult` / `LineSuggestions` in `order-shapes.ts` to drop
  `siblings`; `flyer_as_of` moves to the enriched to-buy view (§3), not the alternatives result.
- [ ] 2.3 Unit tests: the slimmed op still ranks by `compareUnitPrice`, tags the closed reason
  vocabulary, paginates over 12, and degrades with no location — the pre-existing alternatives
  tests pass with the sibling assertions removed.

## 3. Worker: the enriched read + the route/tool contract

- [ ] 3.1 `to-buy.ts`: generalize the enrichment from `withAisles` to `enrich`. When set, after
  the single `resolveLocationId`, call `annotateSubstitutes` for the to-buy line set and attach
  `substitutes?` per line **alongside** the existing aisle `placement`; add `flyer_as_of` to the
  view. The default (`enrich` absent) read is byte-identical — no walk, no resolve, no
  `substitutes`/`flyer_as_of` keys.
- [ ] 3.2 ETag (D8): the enriched read's ETag folds the pantry rowset/verify marker, `flyer_as_of`,
  and the identity edge-set marker so a warmed flyer or pantry edit invalidates cached hints.
- [ ] 3.3 `tools.ts`: rename the `read_to_buy` param `with_aisles` → `enrich`; its description
  documents that the enriched read carries aisle placement **and** substitute hints under one
  Locations resolve, read-only, and that acting on a hint reuses existing writes. `src/api/grocery.ts`:
  `?aisles=1` → `?enrich=1`; slim the `POST /api/grocery/substitutions` handler's result to the
  alternatives-only shape.
- [ ] 3.4 Route/tool tests: `GET /api/grocery/to-buy?enrich=1` returns `substitutes[]` +
  `flyer_as_of` + `placement`; the default read is byte-identical (the P4 byte-identical assertion
  retargeted to `enrich`); the tool and endpoint return the same enriched view.

## 4. Frontend: drop the panel, inline the hints, move alternatives to the order dialog

- [ ] 4.1 `_app.grocery.tsx`: remove the "Propose substitutions" trigger (`subs-open`) and
  `SubsPanel`; `useToBuy` always requests the enriched read (`enrich`) so hints render under both
  grouping modes. `lib/data.ts`: `useToBuy` gains `enrich`; retire the panel's `fetchSubstitutions`
  path.
- [ ] 4.2 `ToBuyItem`: render each `substitutes[]` entry inline on its row — relation label
  (`RELATION_LABEL`), the `in_pantry` pill (`subs-pantry-hit`) and the `on_sale_hint` pill with
  the real price (`subs-sale-hint`), a per-row **accept** (Swap) mapping to the existing writes
  by origin (explicit → add+remove; virtual → materialize + staged order `exclude`) and a
  per-session **dismiss**. Rows with no substitute render unchanged.
- [ ] 4.3 `OrderPreview`: render the slim op's `alternatives` per line — the reason pills the
  panel used (`cheaper — $a vs $c`, `on sale — $promo (was $regular)`, `in stock now`) with an
  accept that stages `overrides` on the commit. Fetch the alternatives at preview (online-only,
  never queued).
- [ ] 4.4 App Playwright: move `subs-pantry-hit` / `subs-sale-hint` onto the inline rows (live
  against the seeded Worker — the P4 seed's pantry rows + sibling edge family + flyer rollup drive
  them); the alternatives pills assert in the order dialog against the intercepted order/substitutions
  fixture; delete the panel page object. Surface the per-area screenshots.

## 5. Persona

- [ ] 5.1 `AGENT_INSTRUCTIONS.md` `shop-groceries`: split step 4. The in-pantry/sale **substitute
  hints** move to the list-review read (step 1 / the `read_to_buy` `enrich` read, present in every
  branch — walk/satellite included, which get them for the first time); the same-identity
  **alternatives** stay at preview after `place_order(preview)`. Thread the order-scoped `exclude`
  for a plan-derived sibling swap across the two moments (materialize at hint time, `exclude`
  staged onto the flush). Update the tool references (`read_to_buy` `enrich`;
  `suggest_substitutions` alternatives-only).

## 6. Docs (same PR)

- [ ] 6.1 `docs/TOOLS.md`: `read_to_buy` gains the `enrich` param and the `substitutes[]` /
  `flyer_as_of` return; `suggest_substitutions` slims to alternatives-only (drop the sibling/
  pantry/flyer paragraph, keep the closed vocabulary + budget + no-location degradation).
- [ ] 6.2 `docs/SCHEMAS.md`: document the to-buy line's `substitutes[]` (the `SiblingSuggestion`
  shape) on the enriched read; note it is derived (identity graph + pantry + flyer rollup), never
  stored.

## 7. Verification

- [ ] 7.1 `aubr typecheck && aubr test && aubr test:app` green; the enriched read exercised
  end-to-end against the seeded `wrangler dev` (inline hints + order-dialog pills) with no network
  egress; `openspec validate "inline-substitution-hints"` passes.
