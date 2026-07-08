# Design — member-app-grocery

## Context

This is **P3** of the member web app plan (`docs/plans/web-app.md`, §5 W2 + §10 P3; §11
operator defaults confirmed 2026-07-07). P0 (session auth, `/api` mount + shared middleware,
`packages/app`/`packages/ui`, the app Playwright harness), P1 (the member core — including the
W3 status-transition guard in the shared `updateGroceryRow` op and the P1-D9 grocery page:
explicit rows only), and P2 (propose) are assumed landed. P3 = the derived to-buy view on every
surface, the order preview/commit UI, and the persona/skill consolidation. W4 (substitution
machinery) and W5 (aisle capture) are **P4** — the mock's substitutions panel and store-picker
aisle grouping stay out, exactly as P1-D9 scoped them.

Design source of truth: the committed export bundle
`docs/plans/web-app-design/project/cookbook/` — the grocery screen in `app-pages.js`
(`grocery()`: item rows, bottom add-row, store toolbar, the "Already in your pantry"
cross-reference with verify/buy-fresh nudges, the in-cart group with "Clear purchased",
"Add all to Kroger cart") and its handlers in `app-main.js` (`cart-toggle`, `cart-all`,
`cart-clear`, `ph-buy`, `pantry-verify`).

The real pipeline this designs against (read end-to-end):

- `computeToBuy` (`packages/worker/src/order.ts`) — the pure order-time set algebra:
  `active` list rows ∪ caller `menuNeeds` − `pantryNames`, merged by the injected
  canonical-id `resolve` (food rows via `groceryKey`, needs via `resolve`), quantities with
  `quantities`-map > need-quantity > default-1 precedence and `assumed_quantity` honesty,
  pantry hits diverted to `partials` unless `includePartials` confirms them. Each line carries
  `key` — the stored `normalized_name` it joins on.
- `placeOrder` (same file) — resolve every line (matcher or revalidated override) → single
  `checkpoint` batch for ambiguous/unavailable → three independent best-effort writes in order
  (SKU-cache commit → cart write → `advanceInCart` **only** after a successful cart write);
  `preview: true` resolves and reports without writing.
- `registerOrderTools` (`order-tools.ts`) — the tool closure: reads list + pantry, threads
  `IngredientContext.resolve` as the one funnel for keys/quantities/partials/overrides, builds
  `PlaceOrderDeps` over `resolveIngredient`/`revalidateSku`/`getLocationId` closures that live
  in `tools.ts`'s `buildServer` scope.
- `advanceInCartRows` / `advanceOrderedRows` (`session-db.ts`) — the two non-guarded advance
  paths (insert-on-missing vs update-only), both keyed through the same funnel.
- The **stale-cart reminder** is persona text (TOOLS.md lifecycle notes + the shop-groceries
  skill step 1), not code: "any items still `in_cart` from a prior order never confirmed
  `ordered`" — a deterministic predicate over the list this change makes a read-surface fact.
- The satellite pull-list (`satellite.ts` `handleOrderList`) — `computeToBuy({ list,
  pantryNames, resolve })` with **no menu needs** (see D4).

## Production spike (read-only, Cloudflare D1 query API, 2026-07-07)

Db `grocery-mcp` (`72599f36-…`):

| query | finding | consequence |
| --- | --- | --- |
| `grocery_list` by source/status | 20 rows, **all `source='ad_hoc'`, all `active`** | no production row was ever menu-materialized — the hand-expansion's output isn't even in the store today; no legacy `menu` rows to reconcile, and the change's dedup-by-canonical-id still covers any future overlap |
| `meal_plan` | 4 rows, 2 tenants (`casey`: chicken-and-black-bean-stew, honey-mustard-salmon + 2 open-world sides; `everett`: 2 mains), all `planned_for` NULL | the derived view has real material on day one; these rows are the **production acceptance fixture** — after deploy + facet convergence, `GET /api/grocery/to-buy` must show virtual rows for them |
| `recipes` ingredient facets | 200/200 rows carry non-empty `ingredients_key`; the planned recipes' facets are clean canonical ids (`chicken`, `black beans`, `poblano peppers`, …) | the classifier reliably produces normalized ingredient arrays at corpus scale — extending it with a full list is the same machine, more rows |
| pantry ∩ facet ids | casey's pantry: 231 rows, **all 231** `normalized_name`s are `ingredient_identity` ids; spot-join against the planned recipes' facets hits `chicken`, `cilantro`, `mayonnaise`, `onion` | the pantry subtraction produces sane coverage rows **today** — e.g. honey-mustard-salmon derives to-buy `salmon`, `mustard`, `honey` with `mayonnaise` pantry-covered. The set algebra needs no healing, only the full-list source |
| `sku_cache` / Kroger state | (not queried — no data question; the harness has no creds regardless) | test posture is D9 |

## Model identity at request time

**None.** The to-buy read is pure D1 (meal plan × projected facets × pantry × list) — zero AI,
zero Kroger. The LLM's fuzzy work moves **earlier** (the classify cron captures
`ingredients_full` once per body change) and **later** (checkpoint/partials/assumed-quantity
dispositions in Claude, or as member choices in the order dialog). This is the architecture's
capture → retrieve → narrow applied to the plan→list edge.

## Decisions

### D1 — A new `read_to_buy` tool, not a `read_grocery_list` mode param

The MCP surface for the derived view is a **new coarse read tool** sharing one op with
`GET /api/grocery/to-buy`.

- **Different projection, different contract.** `read_grocery_list` returns stored rows (all
  statuses, the writable store). The to-buy view is a computed projection: a set algebra over
  three stores with provenance (`origin`), a pantry-coverage section, and an honesty channel
  (`underived`). A `view:"to_buy"` param would make the return shape a union the description
  has to disambiguate — failing the skill-less test (`docs/TOOLS.md` boundary: the description
  must let a skill-less agent use it safely).
- **The description carries its own guarantees**: read-only; zero Kroger calls; the *same* set
  algebra `place_order` flushes (so "what would an order buy right now?" has one answer);
  `pantry_covered` mirrors `place_order`'s `partials`; `in_cart` is the stale-cart signal;
  `underived` names plan recipes whose ingredient list isn't derived yet (never silently
  dropped).
- Rejected: extending `read_grocery_list` (union return, muddied guarantees); putting the read
  only on the HTTP surface (the agent-side consolidation needs the same read — the walks and
  the menu skill's review step call it).

Return shape (tool and endpoint identical):

```
{
  to_buy:        [{ name, quantity, assumed_quantity, for_recipes, origin: "list"|"plan"|"both",
                    key, kind, domain, note? }],
  pantry_covered:[{ name, for_recipes, on_hand: { quantity?, category?, last_verified_at? } }],
  in_cart:       [{ name, added_at }],
  underived:     [slug, ...]
}
```

`quantity` is the **package count** the order would use (need-quantity when a materialized row's
annotation supplies none — derived rows default to 1 with `assumed_quantity: true`; the
no-portion-math stance holds: derivation is presence-only).

### D2 — Menu needs are a capture-once derived facet (`ingredients_full`), not read-time body parsing

The plan asserts the derivation is "already LLM-free"; grounding shows the *algebra* is, but the
plan→ingredient-names step has no deterministic source: `recipes.ingredients_key` is the top
5–7 defining ingredients by contract (`docs/SCHEMAS.md`), and the full list exists only as
authored `## Ingredients` markdown bullets in the R2 body.

- **Chosen: a new Tier A derived facet, `ingredients_full`** — the complete ingredient list as
  plain names (no amounts, no prep clauses, no optional-markers), one more output field on the
  **same** classify call (`discovery-classify.ts` prompt + contract + examples;
  `recipe-classify.ts` extract/seed paths) that already reads the whole body to produce
  `ingredients_key`. Zero additional AI calls per recipe. Normalized through
  `normalizeIngredientList` and funneled through `ctx.resolveList` for novel-term capture
  exactly like `ingredients_key`/`perishable_ingredients`; stored on `recipe_facets`, projected
  into `recipes`, and **re-resolved through the current resolver at each index projection**
  (the existing snapshot-vs-index semantics, unchanged machinery).
- **Rejected: deterministic read-time parsing of the `## Ingredients` bullets.** Stripping
  bullets and leading quantities (`stripLeadingQuantity`) is easy; the residue is not:
  "boneless chicken thighs, cut into strips", "plus more for serving", "or tamari",
  sub-headings ("### For the sauce"). Those strings would enter `IngredientContext.resolve` —
  which **captures misses** — polluting the identity graph the architecture promises "only
  ever ingests real food vocabulary", and failing the pantry join precisely where it matters.
  The classifier already does this extraction cleanly (spike: production facet arrays are tidy
  canonical ids at corpus scale).
- **Convergence is organic through the pipeline** (repo rule): the migration adding the columns
  also clears the classify gate (`UPDATE recipe_facets SET body_hash = NULL`), so the bounded
  classify pass re-derives the 200-recipe corpus over a few ticks with no manual backfill.
  Until a planned recipe converges, the view lists its slug under `underived` — honest,
  structured, self-healing. Import-time seeding (`seedRecipeFacets`/`seedClassifiedFacets`)
  carries the field from day one for new recipes.
- **The gate-clear is intentional whole-corpus reclassification — blast radius named and
  bounded.** Clearing `body_hash` makes every recipe stale to the classify pass
  (`recipe-classify.ts:121` — `state.get(r.slug)?.body_hash !== r.bodyHash`), which re-runs the
  **whole** classify call per recipe: the exact path a body edit takes, at corpus scale (200
  recipes, bounded by `maxPerTick` + the wall-clock budget, quota-aware). Expected churn:
  classifier nondeterminism can flip some existing **Tier A** values (`ingredients_key`,
  `perishable_ingredients`, `side_search_terms`, `meal_preppable`) and the **classified Tier B
  defaults** on recipes with no authored override — values that search filtering, the propose
  pool gates, and the waste callout consume. Second-order cascade: the description's
  `content_hash` domain includes the projected `ingredients_key`/`course`/`protein`/`cuisine`/
  `season` (`description.ts:23–32,41–54`), so a churned recipe triggers one description
  regeneration and, via the `description_hash` embed gate, one re-embed
  (`recipe-embeddings.ts:5–10`) — each behind its own per-tick cap. (`description` itself is
  **not** re-derived by the gate-clear directly — it lives in `recipe_derived` behind its own
  hash; only facet churn reaches it.) All of this is the pipeline's normal reclassification
  behavior — idempotent writes, hash-gated convergence, no data loss — and task 8.5's
  post-deploy check watches `job_health` across the convergence window for parked/errored
  regressions.
- **Authored Tier B overrides survive reclassification by construction — verified in code.**
  `recipe_facets` stores only *classified* values; authored overrides live in R2 frontmatter
  and win at **every** index projection, not at classify time: `recipe-projection.ts:226`
  calls `mergeEffectiveFacets(frontmatter, classified)`, and `recipe-facets.ts:112–145`
  implements Tier B authored-wins (`protein`/`cuisine`/`course`/`season`: an authored key —
  even an explicit null — beats the classified value; `tags` is the stable authored ∪
  classified union). Re-deriving a `recipe_facets` row therefore cannot displace an authored
  pin. The reclassify is also override-aware exactly like a fresh classify: the authored
  `course` threads in as `courseOverride` (`recipe-classify.ts:341,354` cron path;
  `:268–275` sync seed path), and `facetGateHash` folds the Tier B overrides into the gate
  (`recipe-classify.ts:196`). Corollary: because the description hash reads the *effective*
  (merged) values, an override-pinned Tier B field cannot contribute description churn —
  only Tier A (`ingredients_key`) and unpinned Tier B defaults can.
- **Staleness**: an authored body edit already flips `facetGateHash` → reclassify → the derived
  needs follow. No new invalidation machinery.

### D3 — One derivation op; the view is `computeToBuy` post-partitioned

New `packages/worker/src/to-buy.ts`:

- `deriveMenuNeeds(env, tenant)` → `{ needs: MenuNeed[], underived: string[] }`: read the
  tenant's `meal_plan` rows; for each planned slug, read the projected `ingredients_full`
  (already current-resolver ids); emit one `MenuNeed { name, for_recipes: [slug…] }` per
  ingredient (merged across recipes); a planned slug with no row or an empty derived list goes
  to `underived`. **Open-world `sides` strings contribute nothing** — they have no recipe; their
  ingredients remain the agent's world-knowledge capture (see D10), unchanged from today.
  No quantities: derivation is presence-only (the persona's no-portion-math stance).
- `computeToBuyView(env, tenant)` → the D1 shape: loads list + pantry (+ ingredient context),
  runs the **same** `computeToBuy` with the derived needs, then partitions: a line whose `key`
  matches a stored row is `origin:"list"` (or `"both"` when the plan also needs it); a line
  with no stored row is `origin:"plan"` (the virtual row). `pantry_covered` = `computeToBuy`'s
  `partials` joined to the pantry rows (via `readPantry`) for `quantity`/`category`/
  `last_verified_at` — the verify-nudge metadata the mock renders. `in_cart` = the stored
  `in_cart` rows (name + `added_at`).
- `computeToBuy` itself is **unchanged** — the partition is a post-pass over `key`, and every
  existing caller/test keeps its exact behavior.

### D4 — Every flush surface converges on the derivation

- **`place_order`** calls `deriveMenuNeeds` and unions the result with caller-supplied
  `menu_needs` before `computeToBuy` (the same merge semantics — canonical-id dedup makes a
  caller-supplied duplicate harmless). `menu_needs` stays in the schema for true extras
  (open-world side ingredients the agent enumerated, a spontaneous "also grab…"), no longer the
  bulk plan expansion. `underived` slugs ride the tool result so the agent can say "the plan's
  X isn't derived yet — want me to add its items?" instead of silently under-buying.
- **New `exclude: string[]` param** on `place_order` (and the order endpoints): names resolved
  through the same funnel and dropped from the to-buy set before resolution. Needed because a
  virtual row has no remove affordance (D6) — the opt-out is order-scoped, not persisted
  state. Symmetric with `include_partials` (both are per-flush dispositions keyed by resolved
  name).
- **Satellite pull-list** (`handleOrderList`): thread `deriveMenuNeeds` into its `computeToBuy`
  call — restoring the already-documented persona guarantee ("the same to-buy list the Worker
  resolves… list ∪ menu-needs − pantry-have") that only held while the skill materialized rows.
  The receipt path is untouched: a derived line that gets carted advances via the existing
  insert-on-missing `advanceInCartRows` keying (the line's `item_id` **is** the canonical key a
  materialized row would use — `computeToBuy.key`'s documented contract).
- **Implementation note (receipt advance, 2026-07-08):** "the receipt path is untouched" was
  impossible as written — the receipt's publish step (`ingest.ts`) advances only issued ids
  **still on the list as `active`** (the deliberate no-resurrection guard), so a carted
  *derived* line (which has no row) was silently skipped, contradicting this decision's own
  insert-on-missing claim and the satellite spec's scenario. Closest faithful implementation:
  the publish step, on seeing a carted issued id with **no stored row**, re-derives the plan
  needs and advances the id **iff the plan still derives it** (through `advanceInCartRows`'
  insert-on-missing branch — a derived need's name IS its canonical id). A missing id the plan
  no longer needs stays skipped, preserving the no-resurrection guard for removed explicit
  rows. The receipt *endpoints* are untouched; only the shared publish filter learned about
  derived lines.
- **In-store walks** (persona): the walk branches read `read_to_buy` instead of
  `read_grocery_list`, so plan-derived ingredients appear on a walk with their `for_recipes`
  attribution. Completion (received = remove + restock) is unchanged — a picked **virtual** row
  has no list row to remove; the restock (`update_pantry` add) is what makes it disappear from
  the next derivation (pantry subtraction), which the skill text states so the agent doesn't
  hunt for a row to delete.

### D5 — `received` is settled: correct the spec, model the action

The living `grocery-list` spec names `status: active | in_cart | ordered | received`; nothing
else in the system agrees:

| witness | position |
| --- | --- |
| `grocery.ts` `GroceryStatus` | `active \| in_cart \| ordered` |
| `docs/SCHEMAS.md` grocery_list | "`received` is not a stored status but the receive *action* (the row is removed and the pantry restocked)" |
| `docs/TOOLS.md` lifecycle notes | received = terminal: `remove_from_grocery_list` + kind-gated `update_pantry` restock |
| persona (all four flush branches) | remove + restock + storage tips; walks go `active → received` with **no** stored stage |
| satellite receipt | advances to `ordered` at most; `received` never posted |
| design mock | "Clear purchased" removes in-cart rows |

**Decision: MODIFY the spec to the three-value enum and define receive as the terminal
action** (removal + `grocery`-kind pantry restock), fulfillment-mode-agnostic. Modeling a stored
`received` instead would cost a migration, a pruning policy (the list is "intent for the next
order" — terminal rows would accumulate), guard-table growth, and reader updates on every
surface — to serve **no consumer**: nothing reads a received row, because the receive semantics
(pantry restock) live in the pantry, where they already land. The spec sentence is drift from
the pre-D1 lifecycle sketch. The same pass fixes `docs/SCHEMAS.md`'s stale
"`ordered`/`ordered_at` exist in the schema but no path sets them" (contradicted by
`advanceOrderedRows`, the documented user-asserted advance, and P1's `ordered_at` stamping) and
aligns `order-placement`'s lifecycle requirement wording ("received" names the assertion and its
action, not a stored value).

### D6 — Virtual-row interaction semantics: materialize on edit, no remove, order-scoped exclude

- **Materialize** = the existing P1 add upsert (`POST /api/grocery/items` /
  `add_to_grocery_list`) with the derived row's name, `source:"menu"`, `for_recipes` carried
  over, plus whatever the member edited (quantity annotation, note). Because the canonical key
  is identical, the stored row and the derived need **merge** in every later view
  (`origin:"both"`) and in `computeToBuy` — no duplicate line can exist by construction. No new
  write op; D8 write-class (b) (idempotent upsert on canonical id) is preserved, so offline
  replay stays safe. Pinning (the mock's implicit "keep this even if the plan changes") is the
  same write with no edits.
- **No remove on a virtual row.** It has no row to delete, and a persisted suppression would be
  new hidden state the plan contradicts on its next read. The real intents map to real actions:
  "I already have it" → pantry add/verify (it moves to `pantry_covered` organically — the
  mock's `ph-buy` inverse); "we're not cooking that" → remove the recipe from the plan; "don't
  buy it this order" → the order dialog's per-line **exclude** (D4), which the agent mirrors
  conversationally at preview.
- **A materialized row later removed re-derives** as a virtual row while the plan still needs
  it — deliberate and documented (the plan is the source of truth; removal un-pins, it doesn't
  un-plan).

### D7 — The order flow: one endpoint, preview param, never offline-queued

- **`POST /api/grocery/order`** takes the tool's input shape (`menu_needs`, `quantities`,
  `include_partials`, `overrides`, `exclude`, `preview`) and returns the tool's result shape
  (+ `partials`, `underived`) — one contract with the MCP tool, mirroring `POST /api/propose`
  (P2). Preview is the same endpoint with `preview: true` (the op's own discriminant), not a
  second route: the UI's preview→commit is literally the tool's documented two-call flow.
- **Write-class: neither (a) nor (b) — online-only.** A cart write is not idempotent (Kroger
  `PUT /v1/cart/add` accumulates) and must never ride TanStack's paused-mutation replay: the
  commit mutation is registered online-only (no persistence), and the spec pins the negative
  guarantee. A dropped connection mid-commit surfaces the tool's honest partial result on
  refetch (`in_cart` advancement only after a successful cart write — the list is the truth).
- **Gating:** the order affordance renders only for a Kroger primary with a linked account (the
  P1 profile read's `kroger` state + `preferences.stores`); a `reauth_required` `cart.code`
  renders the re-link CTA over the existing `GET /api/profile/kroger-login-url`. A
  fulfillment-mode mismatch server-side returns the structured `unsupported` error (the
  satellite pull-list's 409-with-direction precedent), so the endpoint cannot silently flush a
  walk-store tenant to a Kroger cart.
- **Mark order placed:** the in-cart group gains the user-asserted `in_cart → ordered` advance
  — `PATCH /api/grocery/items/:name` with `status:"ordered"`, which P1's route boundary
  rejected pending "P3's place_order UI". P3 widens the **route boundary only**; the W3
  transition guard in the shared `updateGroceryRow` (legal only from `in_cart`, stamps
  `ordered_at`, `validation_failed` otherwise) is the enforcement and is untouched. The UI
  offers it on the whole in-cart group ("I placed this order"), each item an independent
  class-(b) idempotent set.
- **Stale-cart reminder in the UI:** when the view's `in_cart` section is non-empty at order
  time, the dialog leads with the same warning the skill gives (clear the Kroger cart manually
  — the API is write-only) before the commit button arms. Deterministic, from the read; no new
  server state.

### D8 — Extraction: `runPlaceOrder` + `buildOrderWiring` (P1/P2 discipline)

The whole `place_order` closure body (list+pantry reads → funnel-keyed input maps →
`computeToBuy` → `placeOrder` with real deps) is extracted to
`runPlaceOrder(env, tenantId, input, wiring)` beside the tool; the tool passes its existing
closures, the route builds fresh ones via `buildOrderWiring(env, tenantId)` — exported from
`tools.ts`'s closure family (`resolveIngredient`, `revalidateSku`, `getLocationId` over
preferences/brands/ingredient-context/SKU-cache reads), the exact `buildProposeDeps` precedent
from P2. Tool behavior unchanged; the existing `order.test.ts` / tool tests stay green
unmodified (the D2/D4 additions get their own tests). `read_to_buy` and the to-buy route share
`computeToBuyView` the same way.

### D9 — Kroger-less test posture

The Playwright harness (`packages/worker/app/visual/`, P0) is local + offline (miniflare
D1/KV, no secrets) — the real matcher/cart path cannot run in it, and must not.

- **Op layer (vitest):** `runPlaceOrder` and `placeOrder` test over injected fakes — the
  existing `order.test.ts` pattern (`PlaceOrderDeps` stubs, `MatchResult` literals) extended
  with plan-needs union, `exclude`, and underived reporting; `computeToBuyView` and
  `deriveMenuNeeds` test over the real local SQLite env (`sqlite-d1.ts`) like
  `order-endpoints.test.ts`.
- **Route layer (vitest):** the order route tests inject a fake wiring (the same stubs), so
  preview/commit/partial-failure/`reauth_required` cross the HTTP boundary without Kroger.
- **Playwright:** two postures. (1) The **to-buy view runs live** against the seeded Worker —
  the shared seed (`admin/visual/seed.mjs`) gains recipes with `ingredients_full`, `meal_plan`
  rows, pantry rows (one stale-verified perishable for the nudge), and grocery rows, so
  virtual rows / pantry-coverage / materialize-on-edit are real end-to-end renders. (2) The
  **order dialog** is driven by `page.route()` interception of `POST /api/grocery/order`,
  fulfilling **typed fixtures** of the op's result shape (a clean resolve, a
  checkpoint+partials+assumed-quantity batch, a `cart.written:false` + `reauth_required`
  failure) — the UI is tested against the real contract with zero product-code test hooks and
  zero credentials; the fixtures' type-check against the exported result type keeps them
  honest. Rejected: a dev-only fake Kroger client inside the Worker (product-code
  contamination; the op layer already owns that seam).

### D10 — Persona/skill consolidation scope (exact edits)

`packages/worker/AGENT_INSTRUCTIONS.md` (source only; the bundle is generated at deploy):

- **"The grocery list and the cart"** (intro): capture stays for ad-hoc / household /
  pantry-low / stockup / open-world-side items; **plan ingredients are never hand-copied** —
  the to-buy set derives from the meal plan automatically and `read_to_buy` is the one read
  that shows it (list ∪ plan − pantry, the same set an order flushes).
- **Menu request (meal-plan skill), step 6**: keep `read_recipe` + `read_recipe_notes` for
  what they're actually for (cooking judgment, tweaks/warnings, waste callouts, optional
  ingredients) — but the pantry-presence pass is no longer the agent's string-matching job:
  after saving the plan, call `read_to_buy` and review — surface `pantry_covered` verify
  nudges and **optional-ingredient asks** (an optional ingredient the pantry lacks is an ask
  before materializing it as a row), report `underived` honestly. Semantic-equivalent
  matching is the funnel's job now; the agent narrates exceptions, not the mapping.
- **Step 8 (persist)**: `update_meal_plan` as today; `add_to_grocery_list` **only** for
  open-world side ingredients (world-knowledge enumeration, `source:"menu"`, `for_recipes:
  []`, identifying `note` — unchanged), confirmed extras, and **materializations** (the
  meal-prep doubling's quantity annotation + note now lands as a materialized `source:"menu"`
  row for the scaled items — same mechanism as the app's pin). The blanket per-ingredient
  expansion is deleted.
- **Shop-groceries**: branch detection unchanged; every branch's first read becomes
  `read_to_buy` (+ `read_user_profile`). Kroger online: the stale-cart check reads the view's
  `in_cart` section; step 3's preview no longer passes bulk `menu_needs` (the tool derives
  the plan; `menu_needs` only for extras); dispositions (checkpoint picks, partials,
  assumed-quantity produce counts, sale-SKU overrides) unchanged — LLM territory; a
  "don't buy this one" disposition maps to `exclude`. Kroger in-store / in-store walk /
  map+walk: walk the `to_buy` lines (virtual rows included, with `for_recipes` attribution);
  completion notes that a picked virtual row has no row to remove — the pantry restock is
  what clears it from the next derivation. Satellite cart-fill: text unchanged except the
  claim is now true (D4); still no `place_order`, no walk list.
- **Tool descriptions** (the boundary: descriptions own what/guarantees, skills own when):
  `read_to_buy` (new — D1's guarantees), `place_order` (derives plan needs itself; `menu_needs`
  = supplements; `exclude`; `underived` honesty), `read_grocery_list` (unchanged store read;
  points shop-time reads at `read_to_buy`), `add_to_grocery_list` (a plan ingredient needs no
  add; adding one materializes/pins it — merge semantics unchanged).

### D11 — Design-bundle deviations (recorded; flag for a Claude Design pass)

- **Virtual rows**: the mock's grocery data materializes menu items as ordinary rows and its
  pantry cross-reference is display-only over word-stem matching. P3 renders virtual rows in
  the same item shape with a small "from your plan" origin cue, and the pantry section's rows
  come from the canonical-id derivation, actions wired to real ops (`pantry-verify` →
  `POST /api/pantry/verify`; `ph-buy` "Buy fresh" → the materialize add +
  `include_partials`-style intent at order time).
- **The order dialog**: the mock's `cart-all` is a one-shot toast (`sendAllToCart`) with no
  preview. The real flow needs preview → disposition → commit (checkpoint candidate picker,
  partials confirm, assumed-quantity steppers, per-line exclude, honest result panel) — built
  from the bundle's existing design language (the subs-panel section pattern + Basecoat
  dialog/list primitives), the smallest coherent extension. Both deviations are flagged for a
  future companion-Claude-Design pass per the repo rule; no new design language is invented
  here.
- "Clear purchased" (mock `clearInCart` = remove each in-cart row) is P1's received-removal
  behavior and stays; it sits beside the new "Mark order placed" advance (D7).

### D12 — Read/write classes and caching (P1 D8 applied)

| surface | class | notes |
| --- | --- | --- |
| `GET /api/grocery/to-buy` | ETagged read | weak ETag over the representation (P0 middleware); short staleTime + refetch-on-focus — agent-made plan/list/pantry changes surface on next focus |
| materialize add | (b) | existing P1 endpoint; canonical-id upsert, replay-safe |
| `PATCH …/items/:name` (incl. `ordered`) | (b) | explicit set; W3 guard is the invariant |
| `POST /api/grocery/order` | **online-only** | never persisted/replayed (D7); preview is safe to repeat, commit is not idempotent |
| pantry verify ("Already in your pantry") | (b) | existing P1 endpoint |

## Page → endpoint → op map (normative)

| page / interaction | endpoint | backing op (file) |
| --- | --- | --- |
| Grocery: derived view (to-buy + pantry-covered + in-cart + underived) | `GET /api/grocery/to-buy` | **new** `computeToBuyView` ← `deriveMenuNeeds` + `computeToBuy` (`to-buy.ts`, `order.ts`) |
| MCP `read_to_buy` | — | same `computeToBuyView` |
| Edit/pin a virtual row (materialize) | `POST /api/grocery/items` (P1) | `addGroceryRow` (`session-db.ts`) |
| Verify a pantry-covered item | `POST /api/pantry/verify` (P1) | `markPantryVerifiedRows` |
| "Buy fresh" on a stale pantry hit | `POST /api/grocery/items` (P1) | `addGroceryRow` (materialize) |
| Order preview | `POST /api/grocery/order` `{ preview: true }` | **extracted** `runPlaceOrder` + `buildOrderWiring` (`order-tools.ts`, `tools.ts`) |
| Order commit (overrides / include_partials / quantities / exclude) | `POST /api/grocery/order` | same |
| Kroger re-link CTA | `GET /api/profile/kroger-login-url` (P1) | `buildKrogerConsentUrl` |
| Mark order placed | `PATCH /api/grocery/items/:name` `{ status: "ordered" }` | `updateGroceryRow` (W3-guarded; route boundary widened) |
| Clear purchased | `DELETE /api/grocery/items/:name` (P1) | `removeGroceryRow` |
| `place_order` (MCP) | — | `runPlaceOrder` (now deriving plan needs; + `exclude`) |
| Satellite pull-list | `POST /satellite/order/list` | `computeToBuy` + **`deriveMenuNeeds`** (`satellite.ts`) |

## Out of scope (explicit)

W4 substitutions (deterministic core, the subs panel UI, the graph walk) and W5 aisle
capture/grouping + store picker — P4; trending/picked-for-you — P4; offline persister hardening
beyond D12's class assignments — P5; any change to `computeToBuy`'s algebra, the W3 guard, the
satellite receipt path, or the `advanceInCartRows`/`advanceOrderedRows` keying; a stored
suppression state for derived rows (D6 rejects it); a stored `received` status (D5 rejects it);
portion-math/quantity derivation (presence-only holds); any new design language (D11).
