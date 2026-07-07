# Tasks — member-app-grocery

Ordered **Worker-first**: the derived facet (§1) and the to-buy/order ops (§2–§4) land fully
unit-tested before the routes (§5) and UI (§6) bind to the finished contract; the persona (§7)
and docs (§8) ride the same PR. Implementation is **serial** across the shared Worker surfaces
(`discovery-classify.ts`, the projection/index pair, `order-tools.ts`, `tools.ts`,
`satellite.ts`, `docs/`, `AGENT_INSTRUCTIONS.md`); UI work within §6 parallelizes freely.
**No spike tasks** — every open question is settled in design.md (D1–D12) against the code and
the production spike. Assumes P0 + P1 + P2 landed (proposal.md "Dependency"); tasks name their
pieces by role and the implementer binds to the landed actuals.

## 1. Worker: the `ingredients_full` derived facet (D2)

- [ ] 1.1 Migration (`packages/worker/migrations/d1/`, next number — 0040 at authoring): add
  `ingredients_full TEXT` (JSON array, NULL until derived) to `recipe_facets` **and**
  `recipes`, then `UPDATE recipe_facets SET body_hash = NULL` — the gate-clear that makes the
  bounded classify pass re-derive the corpus organically (no manual backfill). Update
  `docs/SCHEMAS.md`'s `recipes` + `recipe_facets` sections in the same commit.
- [ ] 1.2 `discovery-classify.ts`: add `ingredients_full` to the classifier's output fields,
  prompt instruction ("EVERY ingredient the body lists — plain names, no quantities, no prep
  clauses, no optional-markers; a disjunctive line records its primary"), the few-shot
  examples, and the contract validator (required non-empty string array on a classify;
  superset-of-`ingredients_key` is NOT enforced — the two are independent outputs).
- [ ] 1.3 `recipe-facets.ts` + `recipe-classify.ts`: carry the field through
  `ClassifiedFacets`/`EMPTY_FACETS`, `extractFacets` (normalize via `normalizeIngredientList`
  + `ctx.resolveList` capture, exactly as `ingredients_key`), `facetBinds`/`UPSERT_SQL`, and
  both import-time seed paths (`seedRecipeFacets`, `seedClassifiedFacets`). Tier A: no vault
  control, no authored override (`facetGateHash` inputs unchanged).
- [ ] 1.4 `recipe-projection.ts` + `recipe-index.ts`: project `ingredients_full` into
  `recipes` (JSON column list + the effective-facet merge as Tier A) and re-resolve it
  through the current resolver at each projection alongside
  `ingredients_key`/`perishable_ingredients`; index read reconstruction mirrors the column.
- [ ] 1.5 Unit tests (`packages/worker/test/`): classify-contract acceptance/rejection for the
  new field; extract/normalize (prep-clause-free names resolve to canonical ids; novel terms
  enqueue); projection round-trip + re-resolution; seed paths carry the field; the gate-clear
  migration leaves every facet row stale (re-derivable) without touching stored values.

## 2. Worker: the to-buy derivation + view op (D1, D3)

- [ ] 2.1 New `packages/worker/src/to-buy.ts`: `deriveMenuNeeds(env, tenant)` →
  `{ needs: MenuNeed[], underived: string[] }` over `meal_plan` rows × projected
  `recipes.ingredients_full` (merge `for_recipes` across recipes; open-world `sides` strings
  contribute nothing; a planned slug with no recipe row or a NULL/empty derived list →
  `underived`). Presence-only: no quantities.
- [ ] 2.2 `computeToBuyView(env, tenant)` in the same file: list + pantry + ingredient context
  → the **unchanged** `computeToBuy` with the derived needs → partition lines by `key` vs
  stored rows into `origin: "list" | "plan" | "both"`; join `partials` to `readPantry` rows
  for `pantry_covered` (`quantity`/`category`/`last_verified_at`); collect `in_cart` rows
  (`name`, `added_at`); return the D1 view shape.
- [ ] 2.3 Unit tests over the real local SQLite env (`sqlite-d1.ts`): derived-only, list-only,
  and merged (`both`) lines; canonical-id merge across surface forms (a pantry "green onion"
  covers a derived "scallions" need); underived reporting; open-world sides ignored;
  `pantry_covered` metadata join; `in_cart` section; repeated reads write nothing (the
  no-materialization guarantee); non-food rows keep `normalizeName` keys.

## 3. Worker: `read_to_buy` + `place_order` convergence (D1, D4, D8)

- [ ] 3.1 `tools.ts`: extract `buildOrderWiring(env, tenantId)` from the `buildServer` closures
  (`resolveIngredient`, `revalidateSku`, `getLocationId` over the same
  preferences/brands/ingredient-context/SKU-cache reads — the P2 `buildProposeDeps`
  precedent); `buildServer` keeps per-request memoization by calling it once. Register
  **`read_to_buy`** (no params) over `computeToBuyView`, description carrying D1's guarantees
  (read-only; zero Kroger/AI calls; the same set algebra `place_order` flushes;
  `pantry_covered` ≙ `partials`; `in_cart` = the stale-cart signal; `underived` honesty).
- [ ] 3.2 `order-tools.ts`: extract the tool closure body into
  `runPlaceOrder(env, tenantId, input, wiring)`; thread `deriveMenuNeeds` into the to-buy
  computation (derived needs ∪ caller `menu_needs`), add `exclude: string[]` (funnel-resolved,
  dropped before resolution) to the schema and the op, and surface `underived` on the result.
  Tool description rewritten: derives the plan's needs itself, `menu_needs` = supplements,
  `exclude` semantics, `underived` honesty — existing guarantees (checkpoint, partials,
  overrides pin SKU-not-price, independent best-effort writes, in_cart-after-cart-success)
  restated unchanged.
- [ ] 3.3 `satellite.ts` `handleOrderList`: thread `deriveMenuNeeds` into the pull-list's
  `computeToBuy` call and surface the underived slugs on the response (contract type in
  `packages/contract` extended additively).
- [ ] 3.4 Unit tests: `runPlaceOrder` with `PlaceOrderDeps`/wiring fakes — plan-needs union
  (derived + caller + materialized row dedup to one line), `exclude` drops before resolution,
  preview writes nothing, `underived` rides the result, and an **unchanged-baseline** test (no
  plan, no new params ⇒ result deep-equals today's behavior; existing `order.test.ts` and
  tool tests pass unmodified). `order-endpoints.test.ts`: pull-list includes derived needs
  with correct `item_id`s; a carted derived line advances via the existing insert-on-missing
  keying; Kroger-primary refusal unchanged.
- [ ] 3.5 `add_to_grocery_list` / `read_grocery_list` descriptions (`grocery-tools.ts`): the
  materialization note (a plan ingredient needs no add; adding one pins it — merge semantics
  unchanged) and the pointer to `read_to_buy` for shop-time reads.

## 4. Worker: order + to-buy routes (D7, D12)

- [ ] 4.1 Grocery route group (P1's `src/api/` grocery area): `GET /grocery/to-buy` →
  `computeToBuyView` (ETagged read, P0 middleware). `POST /grocery/order` →
  `runPlaceOrder` over `buildOrderWiring`, accepting the tool input shape (`menu_needs`,
  `quantities`, `include_partials`, `overrides`, `exclude`, `preview`); gate to Kroger-online
  fulfillment (non-Kroger primary → structured `unsupported` directing to the right flow —
  the satellite pull-list's precedent) before any resolution.
- [ ] 4.2 Widen the member PATCH boundary (`PATCH /grocery/items/:name`) to accept
  `status: "ordered"` — the route-level allowlist only; the W3 transition guard in
  `updateGroceryRow` stays the enforcement (untouched).
- [ ] 4.3 Route tests (fake wiring injected): to-buy GET shape + ETag/304; order preview vs
  commit; honest partial (`cart.written:false` + `reauth_required` code crosses the boundary
  with P1's 401 mapping); fulfillment-mode refusal; PATCH `ordered` legal from `in_cart`
  (stamps `ordered_at`), `validation_failed` (400) from `active`; exports stay `import type`
  clean for `hc`.

## 5. App: grocery page derived view + order flow (D6, D7, D11, D12)

- [ ] 5.1 Grocery page reads `GET /api/grocery/to-buy` (+ the P1 list read for row-level
  state): render to-buy lines with `origin` attribution ("from your plan" cue on virtual
  rows, `for_recipes` links), the "Already in your pantry" section (verify → P1 pantry-verify;
  stale-perishable flag from `last_verified_at`; "Buy fresh" → materialize add), the
  `underived` quiet notice, and the in-cart group (P1 clear-purchased kept).
- [ ] 5.2 Materialize-on-edit: editing/pinning a virtual row issues the P1 add upsert
  (`source:"menu"`, carried `for_recipes`, edits) — class (b), replay-safe; explicit rows keep
  P1 behaviors. No remove affordance on virtual rows (design D6's real-action mapping).
- [ ] 5.3 Order dialog (Kroger-gated by the P1 profile `kroger` state + `preferences.stores`):
  stale-cart warning when `in_cart` is non-empty; preview table (resolved lines with fresh
  price/on-sale, checkpoint candidate picker → `overrides`, partials confirm →
  `include_partials`, assumed-quantity counts → `quantities`, per-line exclude → `exclude`);
  commit renders each write's result independently — never "cart populated" on
  `cart.written:false`; `reauth_required` → re-link CTA over the P1 kroger-login-url read.
  The commit mutation is **online-only** (never persisted/replayed).
- [ ] 5.4 "Mark order placed" on the in-cart group → PATCH `status:"ordered"` per item
  (explicit set, class (b)); transition-error rendering.
- [ ] 5.5 UI built from the design bundle's existing language (subs-panel section pattern,
  Basecoat dialog/list); record the D11 deviations in the PR for the future Claude Design
  pass.

## 6. App Playwright coverage (D9)

- [ ] 6.1 Extend the shared seed (`admin/visual/seed.mjs`): recipes with `ingredients_full`
  (+ `recipe_facets` rows), `meal_plan` rows for the seeded member, pantry rows (one
  stale-verified perishable covering a planned ingredient), and grocery rows (one `active`
  ad-hoc, one `in_cart`).
- [ ] 6.2 Grocery page objects + specs (`packages/worker/app/visual/`): live to-buy view —
  virtual rows with attribution, pantry coverage + verify nudge, materialize-on-edit
  (`origin:"both"` after), underived notice, add/remove/in-cart P1 regressions.
- [ ] 6.3 Order-flow specs via `page.route()` interception of `POST /api/grocery/order`,
  fulfilling fixtures **typed against the exported op result type**: clean resolve → commit;
  checkpoint + partials + assumed-quantity disposition round-trip (asserting the commit
  request body carries `overrides`/`include_partials`/`quantities`/`exclude`); failed cart +
  `reauth_required` honest rendering; mark-order-placed against the live seeded Worker.
- [ ] 6.4 Run `aubr test:admin` + the app suite (web sessions:
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`); surface the per-area screenshots for review.

## 7. Persona consolidation (D10 — `packages/worker/AGENT_INSTRUCTIONS.md` only; bundle is generated)

- [ ] 7.1 "The grocery list and the cart": plan ingredients are never hand-copied; the
  derived to-buy set follows the plan; `read_to_buy` is the shop-time read.
- [ ] 7.2 Menu-request skill: step 6 → post-save `read_to_buy` review (pantry-covered verify
  nudges, optional-ingredient asks, underived honesty; `read_recipe`/`read_recipe_notes` kept
  for cooking judgment/notes); step 8 → `update_meal_plan` + only open-world-side
  ingredients/extras/materializations via `add_to_grocery_list` (doubling = materialized
  quantity annotation + note); the per-ingredient expansion text deleted.
- [ ] 7.3 Shop-groceries: all branches open with `read_to_buy` (+ profile); Kroger online —
  stale-cart from the view's `in_cart`, preview without bulk `menu_needs`, dispositions
  unchanged, "skip it" → `exclude`; in-store/map+walk branches walk the `to_buy` lines
  (attribution shown; picked virtual line completes via pantry restock — no row to remove);
  satellite branch text now true as written (pull-list carries derived needs).
- [ ] 7.4 `aubr build:plugin -- --check` (source validation; nothing generated is committed);
  read the diff against the tool/skill ownership boundary (descriptions own guarantees,
  skills own flow).

## 8. Docs in lockstep + validation

- [ ] 8.1 `docs/TOOLS.md`: new `read_to_buy` entry; `place_order` — derived plan needs,
  `menu_needs`-as-supplements, `exclude`, `underived`, unchanged guarantees restated; the
  grocery-list section notes (shop-time reads point at `read_to_buy`; lifecycle notes
  unchanged in substance).
- [ ] 8.2 `docs/SCHEMAS.md`: `ingredients_full` on `recipes`/`recipe_facets` (Tier A,
  snapshot + re-resolution semantics); the grocery lifecycle note — correct the stale
  "`ordered`/`ordered_at` exist in the schema but no path sets them" sentence (user-asserted
  advance + satellite mark-placed + `ordered_at` stamping) and state the lifecycle as
  `active → in_cart → ordered` + terminal receive action; the satellite pull-list paragraph
  gains the plan-derived union.
- [ ] 8.3 `docs/ARCHITECTURE.md`: the derived to-buy read as a capture→retrieve→narrow
  instance (classify-time capture of `ingredients_full` → deterministic derivation →
  LLM/member dispositions); the app's order surface and its online-only posture.
- [ ] 8.4 `openspec validate member-app-grocery --strict` green; `aubr typecheck`,
  `aubr test`, `aubr test:tooling` green; existing order/grocery/satellite tests pass
  unmodified except where a task above names them.
- [ ] 8.5 **Production acceptance (post-deploy, read-only):** after the facet convergence
  ticks complete, verify against production D1 that the 4 existing `meal_plan` rows (2
  tenants) yield derived to-buy lines via the deployed read — e.g. `honey-mustard-salmon`
  derives `salmon`/`mustard`/`honey` to-buy with `mayonnaise` pantry-covered for its tenant —
  and that `reconcile_errors`/`job_health` show the classify pass converging (pending → 0)
  with no parked regressions.
