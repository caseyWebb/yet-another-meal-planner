# Tasks — member-app-differentiators

Ordered **Worker-first**: the aisle capture (§1) and the two read ops (§2–§3) land fully
unit-tested before the routes (§4) and UI (§5) bind to the finished contract; the persona (§6)
and docs (§7) ride the same PR. Implementation is **serial** across the shared Worker surfaces
(`matching.ts`, `order.ts`/`order-tools.ts`, `corpus-db.ts`, `tools.ts`, `to-buy.ts`, `docs/`,
`AGENT_INSTRUCTIONS.md`); UI work within §5 parallelizes freely. **No spike tasks** — every
open question is settled in design.md (D1–D12) against the code and the production spike
(graph shape, sibling families, concrete-flag non-discrimination, degenerate cooking log, cache
locations). Assumes P0–P3 landed (proposal.md "Dependency"); tasks name their pieces by role
and the implementer binds to the landed actuals (e.g. `buildOrderWiring`, `computeToBuyView`,
`rankCandidates`' P2-widened signature).

## 1. Worker: aisle capture on the SKU cache (D5)

- [x] 1.1 Migration (`packages/worker/migrations/d1/`, next free number — 0041 at authoring,
  after P3's 0040): `ALTER TABLE sku_cache ADD COLUMN` × `aisle_number TEXT`,
  `aisle_description TEXT`, `aisle_side TEXT`, `aisle_captured_at TEXT` — all nullable, no
  backfill (convergence through the order pipeline). Update `docs/SCHEMAS.md`'s `sku_cache`
  line in the same commit.
- [x] 1.2 `matching.ts`: `ConfidentMatch` and the override-revalidation shape
  (`RevalidatedSku`) gain `aisleLocation` (the `KrogerCandidate` field passed through at the
  cache-revalidation, search-pick, and override paths). Additive — no scoring/step change; the
  resolve-only and never-substitutes contracts untouched.
- [x] 1.3 `order.ts` + `order-tools.ts`: `NewMapping` carries the aisle fields; `placeOrder`
  emits a mapping for **every** resolved line (cache-hit lines included — their revalidation
  already holds fresh aisle data); `makeCommitSkuCache` replaces skip-if-present with
  **skip-only-if-identical** (same SKU/brand/size/aisle) so differing rows refresh in place.
- [x] 1.4 `corpus-db.ts`: `NewSkuMapping` + `upsertSkuMappings` write the four columns
  (stamping `aisle_captured_at` when aisle data is present); `sku-cache-rekey.ts` carries the
  columns through its delete+reinsert (else the reconcile erases placements) — extend its test.
- [x] 1.5 Unit tests: commit refresh-on-difference (identical row skipped; changed aisle
  upserted in place; `last_used` refreshed on upsert), cache-hit line emits a mapping, rekey
  round-trips aisle columns, matcher threads `aisleLocation` untouched through
  confident/override paths.

## 2. Worker: the substitution op + the sibling walk (D1–D4)

- [x] 2.1 `corpus-db.ts`: `readIdentityNeighbors(env, ids)` beside `satisfiesAmong` — loads
  the identities+edges pair once (memoized like the existing lazy read), returns
  representative-resolved depth-1 neighbor sets per id (in-edges, out-edges with kinds, and
  shared-parent co-children) for the walk to consume.
- [x] 2.2 New `packages/worker/src/substitutions.ts`: the **pure walk**
  (`identitySiblings(x, graph)` implementing D3 exactly — satisfies / generalization
  (concrete, `general`/`containment` only) / same-kind shared-parent siblings; depth 1;
  precedence satisfies → general-siblings → generalizations → containment-siblings →
  membership-siblings; lexicographic within tier; dedup first-relation-wins; exclude self +
  to-buy set; concrete targets only; cap 4; `via`+`kind` labels) and
  `suggestSubstitutions(env, tenantId, input, wiring)` composing: to-buy default line set
  (P3 `computeToBuyView`) or funnel-resolved `names`; per line ≤ 1 `productById` revalidation
  + 1 `search`; one `compareUnitPrice` pass over current+candidates
  (`price = promo || regular`); the D2 reason vocabulary; pantry join (`in_pantry`); flyer
  rollup hints (primary store via the `store_flyer` resolution; term match per D3; the flyer
  reads' fixed default sale floor — no `min_savings_pct` input, D1's no-knob revision); the
  12-line budget with `remaining`; the no-location degradation (`location: null`, siblings
  still served). Read-only — the op performs no D1/KV/cart write.
- [x] 2.3 `tools.ts`: register `suggest_substitutions` over the same op via the existing
  `buildServer` closures (P3's `buildOrderWiring` family). Description carries the D1
  guarantees: read-only (never writes cart/cache/list; acting = `place_order`
  `overrides`/`exclude` or list add/remove), the closed reason vocabulary, the sibling
  relation labels ("proposes and names the relation — fitness is the caller's judgment"),
  the ≤ 2-Kroger-calls-per-line budget + `remaining` pagination, and the no-location
  degradation. `docs/TOOLS.md` entry in the same pass.
- [x] 2.4 Unit tests (`packages/worker/test/substitutions.test.ts`): every D3 rule over edge
  fixtures including the production `cabbage` (`::color-green`/`::type-napa`/`::color-red`,
  kind `general`) and `onion` families, a merged-representative endpoint, a membership-only
  line (labeled, last, capped), and a zero-neighbor line (empty `siblings`, no fabrication);
  D2 reasons against `compareUnitPrice` (cheaper only when both comparable; on-sale from
  promo; in-stock only when current unavailable; `no_cached_pick` with no mapping); budget →
  `remaining`; no-location path; op-is-read-only (fake D1 write counter stays zero).

## 3. Worker: aisle-enriched to-buy read + the browse-row ops (D6–D8)

- [x] 3.1 `to-buy.ts` (P3): `with_aisles` enrichment on the view op — batched `sku_cache`
  read at `(key, locationId)` with `''` fallback; `department` from `readIdentityNeighbors`
  out-edges (precedence `membership` → `general` → `containment`, representative-resolved,
  lexicographic tiebreak); per-line `placement` + top-level `location`; at most one Locations
  resolve, zero product searches; **default read byte-identical** (assert in test).
- [x] 3.2 `tools.ts`: `read_to_buy` gains `with_aisles?: boolean`; description addendum states
  the default's zero-Kroger guarantee is unchanged and the variant's exact cost. `docs/TOOLS.md`
  same pass.
- [x] 3.3 New `packages/worker/src/cookbook-rows.ts`: `readTrending(env, tenant, { windowDays:
  60, k: 8 })` — the D7 SQL (min-signal HAVING, deterministic ORDER BY), joined to the index,
  caller's rejects filtered; `readPickedForYou(env, tenant, { k: 6 })` — favorites-centroid
  query vector over stored `recipe_derived` vectors, candidates minus
  favorites/rejects/dietary-avoids (reuse the existing pool dietary gate predicate), one
  `rankCandidates` call with P2's optional params absent; empty favorites → `[]`.
- [x] 3.4 Unit tests: trending guard over the **production-shaped** log (2 rows, 1 cook each →
  empty) and a threshold-crossing log (ordering, window floor, reject filter, unprojected slug
  dropped); picked-for-you determinism (same inputs → same order), exclusions, empty-favorites
  → empty, and an `env.AI`-never-touched assertion (P1's mock pattern).

## 4. Worker: the /api routes (D1, D6–D8, D12)

- [x] 4.1 `src/api/grocery.ts`: `POST /grocery/substitutions` (session-gated, `jsonBody`,
  fake-wiring-injectable like P3's order route; **no ETag** — online-only class) and the
  `?aisles=1` variant on the to-buy GET (same ETag machinery, param in the representation).
- [x] 4.2 `src/api/cookbook.ts`: `GET /cookbook/trending` + `GET /cookbook/picked-for-you`
  (session-gated, `jsonWithEtag`), registered before the `:slug` param route per the P1
  ordering note.
- [x] 4.3 Route tests (`api-member.test.ts` pattern): substitutions POST over injected fake
  wiring (result shape, budget `remaining`, 401 sweep); the two GETs (ETag/304, empty states);
  aisles variant vs byte-identical default; `MEMBER_ENDPOINTS` gains every new route so the
  session-gating sweep covers them.

## 5. App: panel, grouping, browse rows (D4, D6, D9, D10)

- [x] 5.1 `packages/app/src/lib/data.ts`: hooks for the four surfaces — the substitutions
  mutation registered **online-only** (never persisted/replayed, D12); trending +
  picked-for-you queries invalidated by the favorites mutation.
- [x] 5.2 `_app.grocery.tsx` + `packages/ui`: the substitutions panel per the bundle's
  subs-panel section pattern — toolbar toggle, suggestion rows (line-through original →
  replacement, reason pill **with real prices** per D10, sibling rows labeled with
  `via`/relation + pantry/sale hints), per-row Swap/Keep, dismiss-all, the mock's empty-state
  copy; swap-accept wired per origin (D4: staged override / add+remove / materialize+staged
  exclude, with the "swapped from …" note); dismissals per-session client state.
- [x] 5.3 `_app.grocery.tsx`: aisle/category grouping toggle — aisle groups ordered
  numerically, the honest "Aisle unknown" bucket sub-grouped by department, department→kind
  fallback tiers with no location; in-cart group + check-off behavior unchanged (P1/P3).
- [x] 5.4 `_app.index.tsx`: slot 1 → "New & trending" (new-for-me first, trending backfill,
  dedup, cap 8), slot 2 → "Picked for you" (+ sub-copy + empty state); "All recipes" remains
  as the third section (D9); `RecipeList`/`browse-section` structure unchanged.
- [x] 5.5 Playwright (P0 harness rule — no phase merges without its specs):
  `admin/visual/seed.mjs` gains threshold-crossing `cooking_log` rows, favorites with
  `recipe_derived` vectors, aisle-tagged `sku_cache` rows, and the sibling edge family;
  `cookbook.page.ts`/`grocery.page.ts` + specs cover the rows (live), the grouping (live),
  and the panel via `page.route()` typed fixtures of the op result (cheaper+on-sale,
  out-of-stock, sibling-with-pantry-hit, empty) — fixtures type-checked against the exported
  result type; per-area screenshots surfaced for review.

## 6. Persona (`packages/worker/AGENT_INSTRUCTIONS.md`) (D4, D6)

- [ ] 6.1 Shop-groceries, Kroger-online branch: a **substitutions pass** at preview — call
  `suggest_substitutions` for the to-buy lines, present cheaper/on-sale/out-of-stock findings
  and labeled siblings, map accepted swaps to `overrides` (same-identity) or
  add/remove/materialize+`exclude` (cross-ingredient) before commit; judgment (fitness for
  the dish, "lower fat"-style reasoning) stays the agent's, grounded in the tool's data.
- [ ] 6.2 Kroger in-store walk / map+walk branches: read `read_to_buy` with `with_aisles` when
  the primary is Kroger; walk captured placements aisle-by-aisle, store-note `location` pins
  still winning; unchanged degradation for lines without placements and non-Kroger stores.
- [ ] 6.3 Tool descriptions in the same pass (the ownership boundary): `suggest_substitutions`
  (what/guarantees per 2.3), `read_to_buy` (param addendum per 3.2), `place_order` (mapping
  commit now refreshes learned fields incl. aisle placement).

## 7. Docs in lockstep, same pass

- [ ] 7.1 `docs/TOOLS.md`: `suggest_substitutions` entry; `read_to_buy` `with_aisles`;
  `place_order` commit-semantics note (refresh-on-difference, aisle capture).
- [ ] 7.2 `docs/SCHEMAS.md`: `sku_cache` aisle columns (write points, convergence posture,
  NULL until an order resolves the line at that location).
- [ ] 7.3 `docs/ARCHITECTURE.md`: the multi-tenancy paragraph names the group-wide trending
  read (counts only) beside the cross-tenant flyer cache; the substitution read as a
  capture→retrieve→narrow instance (graph proposes + labels, LLM/member judges).

## 8. Acceptance (gates before PR)

- [ ] 8.1 `aubr typecheck`, `aubr test`, `aubr test:admin` (untouched — assert no admin
  changes), app Playwright suite green with screenshots surfaced;
  `openspec validate member-app-differentiators --strict` green.
- [ ] 8.2 Production convergence checks, post-deploy: (a) an order against the live location
  leaves its resolved lines aisle-tagged in `sku_cache` (D5); (b) `GET /api/cookbook/trending`
  returns an empty set on the current 2-row log — no fake trending (D7); (c)
  `suggest_substitutions` for a `cabbage::type-napa`-keyed line returns the production sibling
  family labeled `general` via `cabbage` (D3 fixture).
