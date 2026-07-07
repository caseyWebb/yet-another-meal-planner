# Proposal — member-app-grocery

## Why

The member web app plan (`docs/plans/web-app.md` on the plan branch, §10 phase P3 / §5 W2) calls
for "grocery power": the **derived to-buy view** (no discrete "add the plan to the list" step),
the **`place_order` preview/commit UI**, and the **agent-side consolidation** of the persona and
skills onto one derive→cart pipeline shared with the app. Today the meal-plan skill hand-expands
every agreed recipe into `add_to_grocery_list` calls (LLM reads each body, matches ingredients
against the pantry, writes the absent ones), and `place_order`'s `menu_needs` are entirely
caller-supplied — the plan and the buy list are two stores the agent keeps in sync by prose.
W2 makes the derivation itself first-class: the plan's ingredient needs are computed at read
time, so changing the plan changes the list with no sync step and no stale expansion.

Grounding against the code corrected and sharpened the plan's premises:

- **Plan §5 W2 says `computeToBuy` "already derives `menu_needs ∪ grocery_list(active) −
  pantry_on_hand`" — but nothing derives `menu_needs` from the plan.** `computeToBuy`
  (`packages/worker/src/order.ts`) takes `menuNeeds` as caller input; the satellite pull-list
  (`satellite.ts`) calls it with **no** menu needs at all. The union/subtraction algebra is
  real and canonical-id-keyed; the plan→needs step is the actual gap, and its data source does
  not exist: the D1 `recipes` row carries only `ingredients_key` (the top 5–7 *defining*
  ingredients — "Full ingredient list lives in the body", `docs/SCHEMAS.md`). A complete,
  deterministic derivation needs a new **capture-once derived facet** (`ingredients_full`),
  not read-time body parsing (which would flood the ingredient-identity funnel with prep-clause
  garbage — see design D2).
- **The persona already promises what the code doesn't do.** The satellite cart-fill skill text
  tells the member the helper "pulls the same to-buy list the Worker resolves from my `active`
  grocery list (list ∪ menu-needs − pantry-have)" — but `handleOrderList` passes no menu needs;
  it only worked because the skill materialized menu ingredients as rows first. Once
  materialization stops, the pull-list (and the in-store walks, which read `read_grocery_list`)
  would silently lose every plan-derived ingredient. This change threads the same derivation
  through **every** flush surface, making the persona's claim true.
- **P3 owns the `received`-status drift (deliberately scoped out of P1).** The living
  `grocery-list` spec's schema requirement names a stored `received` status; the code's
  `GroceryStatus` union is `active | in_cart | ordered`, `docs/SCHEMAS.md` states explicitly
  that "`received` is not a stored status but the receive *action*", `docs/TOOLS.md` documents
  received as terminal **removal** (+ kind-gated pantry restock), and all four persona flush
  branches implement exactly that. This change settles it by **correcting the spec** (design
  D5): unanimity of code, docs, persona, satellite receipt, and the design mock's
  "Clear purchased" is on one side; a stored `received` would demand a migration, a pruning
  story, and a consumer that does not exist.
- Production spike (read-only D1, 2026-07-07, see design.md): 4 `meal_plan` rows across 2
  tenants and 200/200 recipes with `ingredients_key`; the facet ids and the pantry's
  `normalized_name`s are the **same canonical ids** (spot-join: `chicken`, `cilantro`,
  `mayonnaise`, `onion` on hand for the planned recipes) — the derivation's set algebra works
  on production data today, pending only the full-list facet. The 4 planned rows are the
  change's production acceptance fixture.

## What Changes

- **`ingredients_full` — a new Tier A derived facet** (`recipe-facet-derivation`): the complete
  ingredient list (plain names, no amounts/prep), one more output field on the **same** classify
  call that already derives `ingredients_key`, alias-normalized and projection-re-resolved
  exactly like the existing ingredient facets. A migration adds the columns and clears the
  facet gate so the corpus reclassifies organically over the bounded cron ticks (200 recipes);
  a not-yet-derived recipe is reported honestly (`underived`), never silently empty.
- **The derived to-buy view as a first-class read**: a shared op composes
  `deriveMenuNeeds` (meal-plan rows × `ingredients_full`) with the existing `computeToBuy`
  (active list ∪ plan needs − pantry, all on canonical ids) and returns to-buy lines with
  `origin: list | plan | both` provenance, a `pantry_covered` section joined with pantry verify
  metadata, the `in_cart` rows (the deterministic stale-cart signal), and `underived` slugs.
  Exposed as **`GET /api/grocery/to-buy`** and a new MCP **`read_to_buy`** tool — one op, two
  adapters (design D1: a new tool, not a `read_grocery_list` mode param).
- **The grocery page renders the union**: explicit rows plus virtual `source:"menu"` rows with
  `for_recipes` provenance, minus pantry coverage rendered as "Already in your pantry" with
  verify nudges ("Nd unchecked — verify" / "Buy fresh"). Editing or pinning a virtual row
  **materializes** it through the existing P1 add upsert (same canonical key, so it merges —
  no new write op, replay-class (b) preserved). Virtual rows have no remove; an order-time
  opt-out is `place_order`'s new order-scoped `exclude` (design D6).
- **`place_order` converges on the same pipeline**: it now derives the plan's menu needs
  server-side and unions them with caller `menu_needs` (which remain for true extras — e.g.
  open-world side ingredients not yet captured); a new `exclude` param drops named lines from
  the to-buy set before resolution. The **satellite pull-list** threads the same derivation, and
  the in-store walk skills read `read_to_buy` — every flush surface sees the same set.
- **`place_order` preview/commit UI**: the order flow from the app per the design bundle's
  grocery screen — preview (resolved lines with fresh price/on-sale, checkpoint items with
  candidate pick, pantry partials confirm, assumed-quantity counts, per-line exclude) →
  commit (overrides / include_partials / quantities / exclude) → in-cart advancement, with
  honest partial-failure rendering and a `reauth_required` re-link CTA. The tool closure is
  extracted into a shared `runPlaceOrder` op + `buildOrderWiring` deps builder (P1's extraction
  discipline; tool behavior unchanged). The member PATCH boundary widens to accept the
  W3-guarded `in_cart → ordered` advance ("Mark order placed" — exactly the affordance P1
  deferred to P3).
- **Agent-side consolidation** (`packages/worker/AGENT_INSTRUCTIONS.md`; the plugin bundle is
  generated, only the source changes): the meal-plan skill stops hand-expanding recipes into
  `add_to_grocery_list` calls — agreement saves the **plan**; the derived view is reviewed via
  `read_to_buy`, and only open-world side ingredients, confirmed extras, and quantity/note
  materializations are captured as rows. The shop-groceries flush branches all start from
  `read_to_buy` (stale-cart reminder from its `in_cart` section); the Kroger-online branch's
  checkpoint/partials/assumed-quantity dispositions stay LLM territory, unchanged. Tool
  descriptions carry the new guarantees; skills carry the when/how (the ownership boundary).
  W4's substitution machinery is **P4 — out of scope here**; the substitution *checkpoints*
  remain LLM-dispositioned as today.
- **Docs in lockstep, same pass**: `docs/TOOLS.md` (`read_to_buy` entry; `place_order` to-buy
  set, `exclude`, plan-needs derivation; grocery-list notes), `docs/SCHEMAS.md`
  (`ingredients_full` columns; the grocery lifecycle note — including correcting the stale
  "`ordered`/`ordered_at` exist in the schema but no path sets them" sentence, contradicted by
  `advanceOrderedRows` and the documented user-asserted advance; the pull-list description),
  `docs/ARCHITECTURE.md` (the derived to-buy read as a capture→retrieve→narrow instance; the
  app's order surface).

## Capabilities

### New Capabilities

- **`member-app-grocery`** — the member app's grocery-power surface: the derived to-buy read
  (one op behind the endpoint and the tool), the grocery page's virtual-row + pantry-coverage
  rendering with materialize-on-edit semantics, the order preview/commit endpoints and UI over
  the extracted `place_order` op (Kroger-gated, honest partial reporting, never offline-queued),
  and the no-Kroger-credentials Playwright posture.

### Modified Capabilities

- **`grocery-list`** — the schema requirement's status enum is corrected to the implemented
  `active | in_cart | ordered` with `received` defined as the terminal receive **action**
  (row removal + kind-gated pantry restock), settling the spec↔code drift; the provenance
  requirement's to-buy definition is updated to name the server-side shared derivation; a new
  requirement adds the derived to-buy read (virtual plan rows, pantry coverage, materialization
  semantics).
- **`order-placement`** — the resolve requirement derives plan menu needs server-side (union
  with caller `menu_needs`) and gains the order-scoped `exclude`; the lifecycle requirement
  states received-as-action explicitly and admits the member app as a user-assertion surface
  for the guarded `in_cart → ordered` advance.
- **`recipe-facet-derivation`** — Tier A gains `ingredients_full`; a new requirement pins its
  semantics (complete, name-level, alias-normalized, projection-re-resolved, organic
  reclassification convergence).
- **`satellite-order-cart-fill`** — the pull-list unions the plan-derived menu needs, restoring
  the documented "same to-buy list `place_order` flushes" guarantee once rows are no longer
  materialized.
- **`menu-generation`** — the to-buy assembly requirement becomes review-the-derived-view (the
  deterministic base) plus the agent's judgment layer (optional-ingredient asks, verify nudges,
  doubling materializations); the capture requirement drops the per-ingredient hand-expansion
  (plan rows + open-world sides + confirmed extras only); the smoke-test rubric follows.
- **`in-store-fulfillment`** — the aisle-ordered shopping list sources its items from the
  derived to-buy read, so a walk covers plan-derived ingredients that no longer exist as rows.

## Impact

- **D1 migration** (`packages/worker/migrations/d1/`, next number): `ingredients_full` TEXT
  (JSON array) on `recipe_facets` and `recipes`, plus the gate-clear (`UPDATE recipe_facets SET
  body_hash = NULL`) that triggers organic reclassification. No other schema changes — the view
  is computed, materialization reuses the existing row shape, sessions/ETags are P0 machinery.
- **Worker** (`packages/worker/src/`): `discovery-classify.ts` (classifier output field +
  contract), `recipe-classify.ts` (extract/normalize/seed paths), `recipe-projection.ts` +
  `recipe-index.ts` (column + re-resolution), new `to-buy.ts` (`deriveMenuNeeds`,
  `computeToBuyView`), `order.ts` (unchanged algebra; `exclude` applied by callers),
  `order-tools.ts` (extraction into `runPlaceOrder`; schema + description), `tools.ts`
  (`buildOrderWiring` extraction; `read_to_buy` registration), `satellite.ts` (pull-list
  derivation threading), `session-db.ts` (pantry-metadata join read if needed), `src/api/`
  (grocery area: to-buy GET, order POST, PATCH boundary widening).
- **Frontend**: `packages/app` grocery page (virtual rows, pantry-have section, order dialog,
  mark-order-placed), `packages/ui` pieces per the design bundle's grocery screen; deviations
  from the mock recorded in design D11.
- **Persona**: `packages/worker/AGENT_INSTRUCTIONS.md` — "The grocery list and the cart",
  meal-plan skill steps 6/8, shop-groceries branch texts (Kroger online, Kroger in-store,
  satellite cart-fill, in-store walk, map+walk). Deploy publishes the regenerated bundle;
  nothing generated is committed.
- **Tests**: Worker unit tests (facet derivation + normalization, `deriveMenuNeeds`,
  `computeToBuyView` origin/underived/pantry partition, `place_order` plan-needs union +
  `exclude` + unchanged-baseline, satellite pull-list union); route tests over the seeded
  local D1; app Playwright (to-buy view live against the seeded Worker; order flow via typed
  route-interception fixtures — no Kroger creds in the harness, design D9).

## Dependency

**Requires P0 (`member-app-foundations`), P1 (`member-app-core`), and P2
(`member-app-propose`) to have landed.** From P0: the session middleware, the `/api` mount +
shared error/ETag/build middleware, `packages/app`/`packages/ui`, the app Playwright harness.
From P1: the grocery route group and its D8 write classes, the W3 status-transition guard in the
shared `updateGroceryRow` op (this change widens only the member route's accepted values, never
the guard), the extraction discipline, and the profile Kroger-link state the order UI gates on.
From P2: nothing structural — P3 touches none of P2's surfaces; the phases are serial only
through `docs/` and the persona file. Tasks name P0/P1 pieces by role; the implementer binds
them to the landed actuals.
