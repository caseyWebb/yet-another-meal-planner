# Design — member-app-differentiators

## Context

This is **P4** of the member web app plan (`docs/plans/web-app.md`, §5 W4 + W5, §10 P4; §11
operator defaults confirmed 2026-07-07). P0–P3 are assumed landed: the session/`/api`/Playwright
foundations (P0), the member core with the browse page's two reserved slots (P1 D5), propose
with `rankCandidates`' widened optional-param signature (P2 D4), and the derived to-buy view +
order preview/commit + `buildOrderWiring` extraction (P3 D1/D3/D7/D8). P4 = the deterministic
substitution core + panel, aisle capture + grouping, and the two deferred browse rows.

Design source of truth: the committed export bundle
`docs/plans/web-app-design/project/cookbook/` — the substitutions panel (`app-pages.js`
`grocery()` subs block: toolbar toggle, `.subs-row` swap rows with reason pills, per-row
Swap/Keep, dismiss-all, the "No substitutions to suggest right now" empty state), the grocery
toolbar's store `<select>` + aisle-grouped list (`groupGrocery()`/`deptOf()`), and the browse
page's "New & trending" + "Picked for you" sections (`newTrending()`/`pickedForYou()`).

The real machinery this designs against (read end-to-end):

- **The identity graph as persisted** (`migrations/d1/0033_ingredient_identity.sql` + 0035):
  `ingredient_identity(id, base, detail, search_term, representative, concrete, …)` — SAME
  verdicts merge nodes via the union-find `representative` pointer (no edge);
  `ingredient_edge(from_id, to_id, kind ∈ {general, containment, membership}, source,
  audited_at)` — **directed satisfies edges**: `from_id` can be used where `to_id` is
  requested. SPECIALIZATION persists as an edge (production: `cabbage::type-napa → cabbage`
  kind `general`), not as vocabulary. The read precedent is `corpus-db.ts`'s lazy
  identities+edges pair (`satisfiesAmong`): load both tables once (252 edges — trivially
  in-memory), resolve every endpoint through `representativeResolver`, compute in JS.
- **The price/availability machinery**: `kroger.ts` normalizes `aisleLocation
  {number, description, side?}` and `price {regular, promo}` onto every `KrogerCandidate`;
  `unit-price.ts` `compareUnitPrice` ranks within one dimension and routes the rest to
  `incomparable`; `matching.ts` is resolve-only ("NEVER writes the SKU cache … NEVER
  substitutes") with the cache commit living in `order-tools.ts` `makeCommitSkuCache`, which
  **skips** any `(ingredient, location_id)` key already cached; the flyer is a warmed KV
  rollup (`flyer:{store}:{locationId}` → `FlyerRollup{items: FlyerItem[], as_of}`; `FlyerItem`
  carries `matched_terms` — every scan term that surfaced the product), read with zero fan-out.
- **The ranking machinery** (`semantic-search.ts`): `rankCandidates(candidates, queryVec,
  favorites, boostItems, now, params, k)` blends cosine-to-query + `favoriteWeight ·
  favoriteAffinity` + freshness + overlap boost over **cron-captured** `recipe_derived`
  vectors; P2 D4 adds optional trailing `nudge?`/`proteinWants?` params whose omission is
  bit-identical (P2 tasks §2.1). Callers today: `search_recipes` ranked mode, the propose
  planner.
- **The browse slots** (`packages/app/src/routes/_app.index.tsx`, P1): two
  `browse-section` blocks — `new-for-you` (watermark read) and `all-recipes` — with the file
  comment "the P4 trending/picked-for-you rows' slots taken by the P1 sections".

## Production spike (read-only, Cloudflare D1 query API, 2026-07-07)

Db `grocery-mcp` (`72599f36-…`):

| query | finding | consequence |
| --- | --- | --- |
| identity graph size | 552 nodes (34 `concrete=0` concepts, 5 merged via `representative`), 252 edges: 99 `general` / 20 `containment` / 133 `membership`, **all `source='auto'`** | a sibling walk has real material today; representative resolution is live (5 merges) and must be applied to every endpoint |
| sibling families (fan-in ≥ 2 per `(to_id, kind)`) | `general`: 22 of 69 parents (max 6 — `all-purpose flour` ← whole-wheat/bread/cake/rye/semolina/pizza); `membership`: 29 of 44 (max 10); `containment`: 2 of 16. Concrete families: `cabbage` ← `::color-green`/`::type-napa`/`::color-red`, `onion` ← white-or-yellow/green/red | depth-1 shared-parent siblings are the productive walk; containment contributes near-nothing as a sibling source (it stays as a direct-neighbor kind); these named families are the change's walk acceptance fixtures |
| `concrete` flags of high-fan-in parents | `flour`, `beans`, `chili`, `peppers`, `hot sauces (various)`, `vegetables` are **all** `concrete=0`; `cottage cheese`, `mushrooms`, `onion`, `cabbage`, `kale`, `lentils` are `concrete=1` | the concrete flag cannot gate membership-sibling quality (`flour` = good family, `vegetables` = bad family, same flag) — the walk labels relations and orders/caps instead of filtering on parent concreteness (D3); suggestion **targets** must still be concrete (buyable) |
| `cooking_log` | **2** `type='recipe'` rows total, 2 tenants, 1 cook each (2026-06-26, 2026-07-01) | trending is degenerate today; the min-signal guard (D7) must yield an **empty** trending set on exactly this data — that is the production acceptance fixture |
| `sku_cache` | 20 rows; `location_id ∈ {'', '03500520'}` | one real location; aisle columns start NULL everywhere and converge order-by-order (D5); the legacy `''` rows keep the matcher's existing fallback semantics |

## Model identity at request time

**None.** The substitution read is D1 + KV + the same bounded Kroger product calls
`kroger_prices` already makes; the walk is pure CPU over 252 in-memory edges; trending is one
GROUP BY; picked-for-you is cosine over cron-captured vectors (no embed call — the query vector
is a centroid of *stored* favorite embeddings). The LLM stays at the edges: dispositioning a
suggestion (accept/ignore/ask) is conversation in Claude or a tap in the app.

## Decisions

### D1 — A new coarse `suggest_substitutions` tool + `POST /api/grocery/substitutions`, one op

The skill-less test (P3 D1's yardstick) settles the surface:

- **Not a `kroger_prices` extension.** `kroger_prices` answers "what does this ingredient cost
  here" for arbitrary names; the substitution read answers "what would I *swap* on my to-buy
  list and why" — it needs the current pick (SKU cache + revalidation), the to-buy provenance,
  the pantry join, the flyer hint, and the graph walk. A mode param would make the return a
  union the description must disambiguate — the exact failure P3 D1 rejected.
- **Not a `place_order preview` overload.** Preview resolves for *carting*; a substitutions
  pass must be callable before any order intent, from the panel or a walk, and must be
  guaranteed write-free — a guarantee `place_order`'s description can never carry.
- **One shared op** `suggestSubstitutions(env, tenantId, input, wiring)` in new
  `packages/worker/src/substitutions.ts`, wired via P3's `buildOrderWiring` closure family
  (location, search, productById, SKU-cache read) — the tool passes the `buildServer` closures,
  the route builds fresh ones (P2/P3 extraction discipline).

Input: `{ names?: string[], max_lines?: number, min_savings_pct?: number }`. `names` absent =
the caller's current to-buy set (P3 `computeToBuyView`) in view order; present = resolved
through the `IngredientContext` funnel like every other name input. Result:

```
{
  suggestions: [{
    for: { name, key, origin? },                    // origin from the to-buy view when derived
    status: "ok" | "current_unavailable" | "no_cached_pick",
    current: { sku, brand, description, size, price, on_sale, available,
               unit_price?, base_unit?, aisleLocation } | null,
    alternatives: [{ sku, brand, description, size, price, on_sale, available,
                     unit_price?, base_unit?,
                     reasons: ("cheaper" | "on_sale" | "in_stock")[] }],
    siblings: [{ id, label, relation: { role: "satisfies" | "sibling" | "generalization",
                                        kind: "general" | "containment" | "membership",
                                        via? },
                 in_pantry: boolean,
                 on_sale_hint?: { sku, description, price, savings } }]
  }],
  remaining: string[],          // unprocessed this call (subrequest budget) — call again
  location: { id: string } | null,   // null = no resolvable Kroger location
  flyer_as_of: string | null
}
```

**Bounded subrequests, honest pagination.** Per line: ≤ 1 `productById` revalidation (when a
cached pick exists) + exactly 1 term search — ≤ 2 Kroger calls. `max_lines` defaults to and is
capped at **12** (≤ 25 upstream calls incl. token + location resolve — comfortably under the
free-tier 50-subrequest cap the flyer warm's budget note documents); unprocessed names return
in `remaining` so the caller (panel or agent) continues. Kroger's client-side `Semaphore(6)`
bounds concurrency.

**Graceful degradation without a Kroger location** (walk-store tenants): `location: null`,
`current: null`/`alternatives: []` with `status: "no_cached_pick"`, but `siblings` (graph +
pantry) and flyer hints (the primary store's rollup, Kroger or satellite — the `store_flyer`
resolution) are still served. Rejected: erroring like `kroger_prices` does — the graph half of
the read is store-independent value.

### D2 — Same-identity alternatives: revalidate the pick, one search, `compareUnitPrice`, a closed reason vocabulary

Per line key (canonical id, location-tagged cache preferred with `''` legacy fallback — the
matcher's D7 lookup semantics, read not modified):

1. **Current pick**: the cached `(key, location)` mapping revalidated via `productById` —
   fresh price/fulfillment/aisle. Unavailable → `status: "current_unavailable"`. No mapping →
   `"no_cached_pick"` (alternatives still computed; nothing to be "cheaper than").
2. **Candidates**: one `search(searchTerm(key))` (the resolver's stored `search_term`, else the
   flattened base — the same phrase the matcher searches), filtered to fulfillable, current SKU
   excluded.
3. **Ranking**: one `compareUnitPrice` pass over current + candidates with
   `price = promo > 0 ? promo : regular` — comparability (dimension grouping, `incomparable`)
   is decided by the existing core, never re-derived. Alternatives are returned ranked, capped
   at **5**.
4. **Reasons — closed, deterministic vocabulary**: `cheaper` iff both the alternative and the
   current pick ranked comparable and `alt.unit_price < current.unit_price`; `on_sale` iff
   `0 < promo < regular` (the existing `isOnSale`); `in_stock` iff
   `status = "current_unavailable"` and the alternative is fulfillable. The mock's `"in stock
   now"` maps to `in_stock`; the mock's `"lower fat"` is **not** producible deterministically
   and stays LLM territory (D10) — the vocabulary is exactly these three.

### D3 — The sibling walk: depth-1 over the persisted graph, relation-labeled, membership-last, capped

All computation over the one lazily-loaded identities+edges pair (the `satisfiesAmong`
precedent — new `readIdentityNeighbors` beside it in `corpus-db.ts`), with **every endpoint
resolved through `representativeResolver` first** and self-loops produced by resolution
dropped. Let `r(·)` be that resolution and `x = r(line key)`. Exactly three depth-1 relations:

- **satisfies** — `{ r(f) | (f → x, kind) ∈ E }`, any kind: things the graph declares usable
  where `x` is requested (the edge's defining semantics). Production: `oyster mushrooms` for a
  `mushrooms` line.
- **generalization** — `{ r(t) | (x → t, kind) ∈ E, kind ∈ {general, containment} }`: the
  thing `x` itself satisfies, suggestible only when the target node is `concrete = 1`
  (buyable). Production: `cabbage` for a `cabbage::type-napa` line. `membership` targets are
  **excluded** here — a membership parent is a class (`vegetables`), not a purchase.
- **sibling** — `{ r(f₂) | ∃ p, kind: (x → p, kind) ∈ E ∧ (f₂ → p, kind) ∈ E ∧ r(f₂) ≠ x }`:
  co-children of one shared parent, **same kind on both edges**, labeled with
  `via = p` and the kind. Production: `cabbage::color-green` / `cabbage::color-red` for
  `cabbage::type-napa`.

**Depth is exactly 1** (one edge, or two edges through one shared parent). No transitive
chains: containment chains wander (`chicken::whole` → `chicken::thighs` does not make thighs'
neighbors whole-chicken substitutes), and the 252-edge graph gives depth-2 no data-backed
payoff today.

**Ordering and cap instead of parent filtering.** The spike killed the tempting gate
(membership siblings only under concrete parents): `flour` (excellent family) and `vegetables`
(noise) are both concepts. Instead, every suggestion is filtered to **concrete targets** and
emitted in a fixed precedence — `satisfies`, then `general`-kind siblings, then
`generalization`s, then `containment`-kind siblings, then `membership`-kind siblings — each
tier ordered lexicographically for determinism, deduped across tiers (first relation wins),
excluding `x` itself and any id already in the caller's to-buy set, capped at **4 per line**.
Membership-last + the cap means a `vegetables`-style broad family only surfaces when nothing
better exists, and always labeled `via: "vegetables"` so the member/agent sees exactly why.
The relation label is the honesty mechanism: deterministic code proposes and *names* the
relation; judging fitness for the dish stays with the LLM or the member (the architecture's
narrowing step).

**Annotations, zero extra fan-out**: `in_pantry` joins the tenant's pantry
(`normalized_name = r(sibling)`) — a sibling already on hand is the best possible suggestion;
`on_sale_hint` matches the primary store's flyer rollup by term — a `FlyerItem` whose
`matched_terms` (or, for satellite rollups whose `matched_terms` is empty by contract, whose
lowercased `description`) contains the sibling's `base` or `search_term` — carrying
`{ sku, description, price, savings }`. No live search per sibling — the flyer read is the
only price signal siblings get (a member can tap a sibling into a fresh
`suggest_substitutions`/`kroger_prices` call for live prices).

**Sparse-data honesty**: with 252 auto edges, most lines yield zero siblings today — the
`siblings` array is empty, the panel shows the price/availability half alone, and nothing
fabricates a suggestion. The graph densifies through the existing normalization capture cron;
no new derivation job, no manual seeding.

### D4 — Acting on a suggestion reuses existing writes; the never-substitutes guarantee is untouched

The read proposes; **no new write op exists**, and nothing acts implicitly:

- **Same-identity swap** (a different SKU for the same ingredient) = the order dialog stages a
  `place_order` **`override`** `{ name, sku }` (P3 D7's input, revalidated by contract before
  the cart). Client-side staged state until commit — the propose-session precedent (plan §5
  W1's explicit non-work: no server-side session).
- **Cross-ingredient swap on an explicit row** = the two existing class-(b) idempotent writes:
  add the replacement (`POST /api/grocery/items`, note `"swapped from {name}"` — the mock's
  provenance cue) + remove the original.
- **Cross-ingredient swap on a virtual (`origin:"plan"`) row** = materialize the replacement +
  stage an order-scoped **`exclude`** for the original (P3 D4/D6: a virtual row has no remove;
  suppression state was rejected there and is not reintroduced here). The panel says what will
  happen ("excluded from this order; the plan still lists it").
- **Keep / dismiss-all** = per-session client state (the mock's `__subsDismissed`), never
  persisted.
- The matcher's `Matcher never substitutes` requirement is composed with, not modified: the
  suggestion never enters the matcher, the cache, or the cart except as an explicit
  caller-supplied override/row — exactly the boundary the tool description states.

### D5 — Aisle capture rides the SKU-cache commit, refresh-on-difference (plan-text correction)

Plan §5 W5 says "store Kroger `aisleLocations` on the SKU cache **at match time**" — impossible
as written: the matcher is contractually resolve-only. The capture point is `place_order`'s
batched commit, with two corrections grounded in `order-tools.ts`:

- **`makeCommitSkuCache` skips any already-cached `(ingredient, location_id)` key**, so a
  cache-hit line would never gain aisle data. The skip becomes **skip-only-if-identical**
  (same SKU/brand/size/aisle) — a differing row is upserted in place (the existing
  `ON CONFLICT … DO UPDATE`), refreshing `last_used` and `aisle_*` organically each order.
- **`placeOrder` emits a mapping for every resolved line** — including cache-hit lines, whose
  step-2 revalidation (`productById`) already carries fresh `aisleLocation` — not only newly
  learned ones; the commit's identical-skip keeps write churn near zero.

Plumbing (all additive): `ConfidentMatch` and the override `RevalidatedSku` gain
`aisleLocation` (threaded from the `KrogerCandidate` the pipeline already holds);
`NewMapping`/`NewSkuMapping` gain the aisle fields; migration adds nullable
`aisle_number` / `aisle_description` / `aisle_side` / `aisle_captured_at TEXT` to `sku_cache`;
`sku-cache-rekey.ts` (which deletes + reinserts rows with an explicit column list) carries the
new columns or the reconcile would silently erase placements. **No backfill** (repo rule:
convergence through the pipeline): production's 20 rows start NULL and heal as orders run —
the post-deploy check is that an order against location `03500520` leaves its resolved lines
aisle-tagged.

### D6 — Aisle-enriched to-buy read: opt-in param, graph-derived department fallback, default byte-identical

- `read_to_buy` gains `with_aisles?: boolean`; `GET /api/grocery/to-buy` gains `?aisles=1`.
  **Absent, the read is unchanged** — P3 D1's "zero Kroger calls" guarantee stays absolute for
  the default read; the description states the param variant costs at most one Locations
  resolve (label → locationId, exactly `kroger_flyer`'s posture) and **zero product searches**.
- Enrichment per `to_buy` line: `placement: { aisle_number?, aisle_description?, aisle_side?,
  department? } | null` — aisle fields from the `sku_cache` row at `(key, locationId)` (with
  `''` legacy fallback), `department` derived from the identity graph: the line key's parents
  via out-edges, precedence `membership` (class labels like `vegetables`, `flour` are exactly
  department-shaped), then `general`, then `containment`, representative-resolved,
  lexicographic tiebreak — deterministic and stable. No parent → `department` absent. A
  top-level `location: { id } | null` says which store placements are for; no resolvable
  location → placements carry `department` only.
- **Grouping is the client's job**, three tiers (the mock's modes mapped to reality): aisle
  groups ordered by numeric aisle for lines with placements; an explicit **"Aisle unknown"**
  bucket (labeled honestly — not the mock's fake "Aisle 99") sub-grouped by `department`;
  with no location at all, groups fall back to `department`, then the existing `kind` buckets
  (the mock's category mode — data already on every row). A simple aisle/category toggle
  replaces the mock's hardcoded four-store picker (D10): real store identity comes from the
  profile's primary store, and non-Kroger stores have no deterministic placement source (their
  layout lives in agent-judged store notes — the in-store-fulfillment walk, unchanged).
- The agent side gets the same data: the Kroger in-store walk prefers captured placements for
  lines that have them (`in-store-fulfillment` MODIFIED), degrading per-line to the existing
  judgment path — store notes' `location` pins still win where present.

### D7 — Trending: group-wide GROUP BY, min-signal guard, counts only

`readTrending(env, { windowDays = 60, k = 8 })` — deliberately **group-wide** (no tenant
filter):

```sql
SELECT recipe, COUNT(*) AS cooks, COUNT(DISTINCT tenant) AS cooks_by, MAX(date) AS last_cooked
  FROM cooking_log
 WHERE type = 'recipe' AND recipe IS NOT NULL AND date >= ?floor
 GROUP BY recipe
HAVING COUNT(*) >= 2 OR COUNT(DISTINCT tenant) >= 2
 ORDER BY cooks DESC, cooks_by DESC, last_cooked DESC, recipe ASC
 LIMIT ?k
```

- **Tenancy posture, stated**: the friend-group model already reads cross-tenant for the
  group-favorites query (`idx_overlay_recipe`, `docs/SCHEMAS.md`), the group-aggregated
  recipe-notes read, and the operator `group-insights` leaderboards. Trending follows: it
  exposes **counts only** (`cooks`, `cooks_by`) joined to the shared recipe index — never
  which member cooked what, no names, no per-member rows. `docs/ARCHITECTURE.md`'s
  multi-tenancy paragraph gains this read next to the flyer's cross-tenant cache note, same
  pass.
- **The min-signal guard is the sparse-data design**: a recipe trends only with ≥ 2 cooks or
  ≥ 2 distinct cooks in the window. Production today (2 log rows, 1 cook each) yields an
  **empty** trending set — that exact data is the acceptance fixture: the guard must return
  nothing, and the browse row must render new-for-me content alone with no fake "trending"
  badge. Results are joined to the index (dropped if unprojected) and filtered by the
  *caller's* overlay rejects (group fact, personal lens — same posture as `list_recipes`).
- Surface: `GET /api/cookbook/trending` (session-gated, ETagged) → `{ recipes: [lite +
  { cooks, cooks_by, last_cooked }], window_days }`. **HTTP-only, no MCP tool**: the agent
  already has `retrospective` (per-tenant history) and ranked `search_recipes`; no skill needs
  group trending, and the tool surface stays lean (the plan's §4 table scopes these rows to
  the app's cookbook area).

### D8 — Picked-for-you: a deterministic favorites-centroid wrap of `rankCandidates`

`readPickedForYou(env, tenant, { k = 6 })` in `cookbook-rows.ts`:

- Load the same material `search_recipes` ranked mode loads (`recipe_derived` vectors +
  the caller's favorite vectors + `resolveRankParams`); candidates = the index minus the
  caller's favorites, minus rejects, minus recipes conflicting with the profile's dietary
  avoids (the same gate predicate the propose pool applies — reused, not re-derived).
- Query vector = the **normalized centroid of the caller's favorite embeddings** — stored
  vectors only, zero `env.AI` calls, fully deterministic. Then one plain
  `rankCandidates(candidates, centroid, favoriteVecs, [], now, params, k)` call: the centroid
  gives "near your taste's center of mass", the existing `favoriteAffinity` term sharpens
  toward the nearest favorite, freshness keeps new imports competitive. P2's optional
  `nudge`/`proteinWants` params are **absent** (bit-identical omission per P2's contract);
  no signature collision.
- **No favorites → empty result**, and the row renders the mock's exact empty state
  ("Favorite a few recipes and tailored picks show up here.") — no silent backfill from the
  index (the mock's backfill made "picked for you" mostly non-personalized; recorded in D10).
- Surface: `GET /api/cookbook/picked-for-you` (session-gated, ETagged) → `{ recipes: [lite] }`
  — no scores, no why-labels (the mock shows none). HTTP-only, same rationale as D7.

### D9 — Browse slots: fill per P1 D5; "All recipes" stays as a third section

P1 D5 promised the two rows "take those slots in P4 without layout change". Slot 1
(`new-for-you`) becomes **"New & trending"**: the P1 new-for-me items first (watermark
semantics unchanged), then trending backfill (deduped), capped at 8 — the mock's own comment
("new adds first, then group-trending"). Slot 2 (`all-recipes`) becomes **"Picked for you"**
with its sub-copy and empty state. Both keep the P1 `browse-section` + `RecipeList` structure —
the "no layout change" promise is kept at the section-pattern level.

**Deviation, recorded**: the P1 "All recipes" index list remains below as a third
`browse-section` rather than vanishing with its slot. The mock's browse has no all-recipes
affordance because its sample corpus is 20 recipes and search covers it; deleting the only
full-index browse over a 200-recipe corpus is a regression no mock evidence supports.
Flagged for the companion Claude Design pass together with D10's items.

### D10 — Design-bundle deviations (recorded; flag for a Claude Design pass)

| mock | reality shipped | why |
| --- | --- | --- |
| reason pills are free text from a hardcoded 13-entry map (`cheaper`, `on sale`, `out of stock`, `in stock now`, `lower fat`) | closed vocabulary `cheaper` / `on_sale` / `in_stock` + `status: current_unavailable`, each grounded in `compareUnitPrice`/promo/fulfillment; **`lower fat` is not producible deterministically** and stays LLM territory in Claude | determinism boundary |
| panel shows no prices at all | each alternative row carries real `price`, `unit_price`/`base_unit`, and the pill (e.g. "cheaper — $0.31/oz vs $0.42/oz"); the smallest coherent extension of the pill pattern | "cheaper" without numbers is an unsubstantiated claim over real data we have |
| Swap is a destructive one-click rename (`g.name` overwritten, `source:"ad_hoc"`) | per-origin real semantics (D4): staged override / add+remove / materialize+exclude, with the mock's `"swapped from …"` note kept | rows are canonical-id-keyed upserts; renaming in place would corrupt provenance and replay safety |
| four hardcoded stores in a picker; department→aisle maps invented per store; unknown = literal "Aisle 99" | aisle/category toggle; placements from captured per-SKU data at the profile's primary Kroger store; honest "Aisle unknown" bucket; non-Kroger layout stays agent territory (store notes) | the mock's aisle maps and store list have no data source; "Aisle 99" is a fake number |
| picked-for-you silently backfills from the index when favorites are sparse | empty state until favorites exist | "picked for you" must not be mostly non-personalized |
| trending is a static slug list with no window or signal | 60-day windowed GROUP BY with a min-signal guard; empty today | honesty over sparse production data |

### D11 — Test posture (extends P3 D9)

- **Op layer (vitest)**: the walk is a pure function over injected identity/edge fixtures —
  every D3 rule unit-tested (direction, kind pairing, representative resolution incl. a merged
  endpoint, concrete-target filter, precedence/cap/dedup, in-pantry + flyer-hint annotation,
  the production `cabbage`/`onion` families as fixtures); reason derivation tested against
  `compareUnitPrice` outputs (comparable, incomparable, promo edge cases);
  `suggestSubstitutions` over `MatchDeps`-style stubs + a fake flyer KV (budget cap →
  `remaining`; no-location degradation). Commit refresh-on-difference + rekey column carry over
  the fake D1; aisle enrichment + department precedence over seeded local SQLite; trending
  guard replaying the **production-shaped** sparse log (2 rows → empty) and a threshold-crossing
  log; picked-for-you determinism, exclusions, and a `runDerivation`-style assertion that
  `env.AI` is never touched.
- **Route layer (vitest, `api-member.test.ts` pattern)**: the substitutions POST over injected
  fake wiring; the two cookbook GETs (ETag, session sweep — the `MEMBER_ENDPOINTS` table gains
  every new route); the `?aisles=1` variant vs the byte-identical default.
- **Playwright**: the browse rows and aisle grouping run **live** against the seeded Worker —
  `admin/visual/seed.mjs` gains threshold-crossing `cooking_log` rows, favorites (+ their
  `recipe_derived` vectors), aisle-tagged `sku_cache` rows, and the sibling edge family; the
  substitutions panel is driven by `page.route()` interception of
  `POST /api/grocery/substitutions` fulfilling **typed fixtures** of the op's result shape
  (cheaper + on-sale, out-of-stock, siblings-with-pantry-hit, empty) — zero Kroger creds,
  zero product-code hooks (P3 D9's rejection of an in-Worker fake client stands). Page objects:
  `grocery.page.ts` + `cookbook.page.ts` extended, specs + per-area screenshots per the P0
  harness rule.

### D12 — Read/write classes and caching (P1 D8 applied)

| surface | class | notes |
| --- | --- | --- |
| `POST /api/grocery/substitutions` | **online-only** | member-initiated fetch (the mock's explicit button); never offline-queued or replayed (Kroger fan-out is not idempotent-free work); no ETag; results are per-session client state |
| `GET /api/grocery/to-buy?aisles=1` | ETagged read | same op family as the default read; the param is part of the cache key client-side |
| `GET /api/cookbook/trending` | ETagged read | short staleTime; group-wide data, personal reject filter applied server-side |
| `GET /api/cookbook/picked-for-you` | ETagged read | recomputes on favorites change (the favorites mutation invalidates it client-side) |
| swap-accept writes | (b) / staged | add/remove/materialize are the existing P1/P3 class-(b) upserts; overrides/excludes are client-staged into the one online-only order commit (P3 D7) |

## Page → endpoint → op map (normative)

| page / interaction | endpoint | backing op (file) |
| --- | --- | --- |
| Grocery: "Propose substitutions" panel | `POST /api/grocery/substitutions` | **new** `suggestSubstitutions` (`substitutions.ts`) ← `buildOrderWiring` (P3), `readIdentityNeighbors` (`corpus-db.ts`), `readFlyerRollup` (`flyer-warm.ts`), `compareUnitPrice` (`unit-price.ts`) |
| MCP `suggest_substitutions` | — | same op |
| Swap accept: same-identity | (staged) `POST /api/grocery/order` `overrides` | P3 `runPlaceOrder` — unchanged |
| Swap accept: cross-ingredient, explicit row | `POST /api/grocery/items` + `DELETE /api/grocery/items/:name` | P1 `addGroceryRow`/`removeGroceryRow` — unchanged |
| Swap accept: cross-ingredient, virtual row | `POST /api/grocery/items` + (staged) order `exclude` | P1 add + P3 exclude — unchanged |
| Grocery: aisle grouping | `GET /api/grocery/to-buy?aisles=1` | P3 `computeToBuyView` + **new** aisle/department enrichment (`to-buy.ts`) |
| MCP `read_to_buy` `with_aisles` | — | same enrichment |
| Browse: "New & trending" | `GET /api/cookbook/new-for-me` (P1) + **new** `GET /api/cookbook/trending` | `readNewForMe` (P1) + **new** `readTrending` (`cookbook-rows.ts`) |
| Browse: "Picked for you" | **new** `GET /api/cookbook/picked-for-you` | **new** `readPickedForYou` (`cookbook-rows.ts`) ← `rankCandidates` (`semantic-search.ts`) |
| Aisle capture | — (rides `place_order` / `POST /api/grocery/order`) | `makeCommitSkuCache` refresh-on-difference (`order-tools.ts`), `upsertSkuMappings` (`corpus-db.ts`) |

## Out of scope (explicit)

Any change to the matcher pipeline or its never-substitutes/resolve-only contracts (composed
with, not modified); auto-applying any suggestion (no write op exists on this surface);
persisted dismissals or per-line suppression state (P3 D6's rejection stands); a multi-store
picker or non-Kroger deterministic aisle data (store-notes layout remains agent territory);
depth-2+ graph walks, edge-weight learning, or any new normalization/derivation job; an MCP
tool for trending/picked-for-you (D7/D8: HTTP-only); per-member trending or any per-member
attribution in the trending read; portion-aware substitution math (presence/package semantics
hold); offline hardening beyond D12's class assignments (P5); the admin data-explorer's
`sku_cache` view (unchanged — new columns are additive and its query names its columns);
`AGENT_INSTRUCTIONS.md` changes beyond D4's substitutions pass, the walk's placement source,
and the three tool descriptions.
