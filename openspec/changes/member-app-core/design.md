# Design — member-app-core

## Context

This is **P1** of the member web app plan (`docs/plans/web-app.md`, ratified with §11 operator
defaults confirmed 2026-07-07). P0 (foundations) is assumed landed: session auth, the `/api`
mount + shared middleware, `packages/app` + `packages/ui`, the app Playwright harness. P1 fills
the mount with the member core — **existing ops only**, plus W3 (the grocery status guard) and
the two grounded exceptions recorded below (D3, D4) where the design bundle requires an
interaction the existing ops cannot express.

The design source of truth is the committed export bundle
`docs/plans/web-app-design/project/cookbook/` — read in full: `Cookbook App.html` →
`app-main.js` (shell, router, event wiring), `app-pages.js` (all P1 page renderers),
`app-state.js` (data shapes + actions), `app.css`, `cookbook-data.js` (corpus stand-in), `ds/`
(Basecoat). The propose flow (`app-propose.js` / `app-propose-ui.js` `Pages.propose`) is **P2**;
the substitutions panel, store picker/aisle grouping, and the pantry-have cross-reference on the
grocery page are **P3/P4** — excluded here. `ProposeUI.palette` (the night-vibe palette + the
reconciliation queue mounted in Profile) **is P1**.

## Model identity: none at request time

Every P1 endpoint is pure CPU + D1/R2/KV: index reads, `rankByKeyword` (pure field-weighted
keyword scorer), `nearestNeighbors` (pure cosine over cron-captured vectors), row CRUD. No
embedding happens at request time — the mock's search box is keyword search (its `rank()` is a
keyword scorer), so P1 ships keyword search only; ranked/semantic search arrives with P2's
propose work (D6). The one endpoint that *could* spend `env.AI` — vibe suggestion via
`runDerivation` (small-model cluster naming inside the derivation pipeline) — is gated by the
archetype-derive job's recorded health (D7) so a member-tappable button cannot spend it
unboundedly.

## Production spike (read-only, Cloudflare D1 query API, 2026-07-07)

`CLOUDFLARE_API_TOKEN` present; db `grocery-mcp` (`72599f36-…`):

| table | finding |
| --- | --- |
| `recipes` | 200 rows — the cookbook index is comfortably client-cacheable |
| `pantry` | 337 rows — the pantry page must handle ~100+ items/tenant; grouped rendering, no pagination needed yet |
| `grocery_list` | 20 rows, **all `status='active'`** — no `in_cart`/`ordered` rows exist; the W3 guard has no defect rows to converge, it prevents rather than heals |
| `night_vibes` | **0 rows** — the palette's empty state is the actual first render |
| `pending_proposals` | **47 pending**, all `kind='add_vibe'`, `producer='edge'`, 2 tenants — the reconciliation queue ships with real volume; the queue UI must render dozens of rows sanely |
| `cooking_log` | 2 rows, 2 tenants — the log page starts near-empty; empty states matter |
| `overlay` | 2 rows, 2 favorites |
| `profile` | 3 tenants, `lunch_strategy` NULL for all — no data blocks D10's single-select rendering |
| `job_health` | `archetype-derive` ok, last run fresh — the D7 gate would throttle today, as designed |

## Decisions

### D1 — W3 is a transition guard, not a flat reject (plan premise corrected)

**The plan's W3 premise ("place_order owns ordered") is contradicted by the code and docs:**
`place_order` advances resolved lines to `in_cart` (`order.ts` `advanceInCart` →
`advanceInCartRows`); **nothing in the order flow writes `ordered` except** the satellite
receipt flush (`advanceOrderedRows`, `session-db.ts`). `docs/TOOLS.md` (place_order lifecycle
notes) documents `ordered` as the **user-asserted** advance — *"I placed the order" → advance
`in_cart` items to `ordered` **via `update_grocery_list`***. A flat reject of `ordered` in
`update_grocery_list` would break that documented agent flow and orphan the state.

**Design:** guard the *transition*, in the shared op layer so the tool and the member route get
it identically:

- Pure check in `grocery.ts`: a `patch.status === "ordered"` is legal **iff** the target row's
  current status is `in_cart`. Everything else about the patch is unchanged; `active ⇄ in_cart`
  writes are unrestricted (including re-listing an `ordered` row back to `active` — a canceled
  order is a legitimate member correction, unchanged from today).
- `updateGroceryRow` (`session-db.ts`) enforces it before persisting: violation → `ToolError`
  `validation_failed` with context `{ name, from, to }`, row unchanged. The legal
  `in_cart → ordered` advance now also stamps `ordered_at` (today's patch path leaves it null;
  `advanceOrderedRows` already stamps it — this closes the asymmetry).
- `advanceInCartRows` / `advanceOrderedRows` are separate functions, not routed through
  `updateGroceryItem` — untouched by construction.
- The MCP tool keeps `status: active | in_cart | ordered` in its schema (removing `ordered`
  would break the documented user-asserted advance); its **description** now states the
  transition guarantee. The member route (`PATCH /api/grocery/items/:name`) accepts only
  `active | in_cart` at its boundary — the web UI has no order-placed affordance until P3's
  `place_order` UI.
- `docs/TOOLS.md`: `update_grocery_list` entry + the lifecycle notes updated in the same pass.

(Aside, out of scope: the living `grocery-list` spec names a `received` status that the code's
`GroceryStatus` union does not model — TOOLS.md documents "received" as terminal removal. Not
touched here.)

### D2 — Extract the tool-closure ops; routes never re-implement

Most tools already delegate to named, route-callable functions (`readGroceryList`,
`readMealPlan`, `applyMealPlanRowOps`, `readPantry`, `applyPantryRowOps`,
`markPantryVerifiedRows`, `readProfile`, `loadRetrospective`, `readRecipeNotes`/`insert…`/
`update…`/`removeRecipeNote`, `readNightVibes`/`upsertNightVibe`/`deleteNightVibe`,
`readProposals`, `readNewForMe`, `loadRecipeIndex`/`rankByKeyword`/`nearestNeighbors`/`toHit`).
Six pieces of logic live **only inside MCP tool closures** and are extracted into shared ops
(same file family, exported, called by both the tool and the route; tool behavior unchanged,
existing tests must stay green):

| extracted op | from closure | shape |
| --- | --- | --- |
| `readRecipeDetail(env, tenant, slug)` | `read_recipe` (`tools.ts`) | corpus read + `parseMarkdown` + `mergeOverlay` + `recipeDescription` |
| `logCooked(env, tenant, entry, opts?)` | `log_cooked` (`cooking-write.ts`) | validation + `satisfied_vibe` stamp + log-insert/plan-clear in one batch; `opts.dedupe` (route-only) skips an identical `(date, type, recipe|name)` row — see D8 |
| `applyPreferencesPatch(env, tenant, patch)` | `update_preferences` (`write-tools.ts`) | `rejectUnknownPatchKeys` + `mergePatch` + `validatePreferences` + the column/brand batch |
| `assembleUserProfile(env, tenant)` | `read_user_profile` (`tools.ts`) | `readProfile` + the `initialized`/`missing` computation |
| `addNightVibe` / `patchNightVibe` | `add_night_vibe`/`update_night_vibe` (`night-vibe-tools.ts`) | slugify/conflict; merge-then-upsert |
| `resolveProposal(env, tenant, id, accept)` | `confirm_proposal` (`reconcile-tools.ts`) | `getProposal` + (`applyProposal` + status) / status-reject |

Also extracted as a composition: the meal-plan add path's `applyMealPlanRowOps` +
`stampLastPlanned` pairing (the new-for-me watermark advance) so the route can't forget the
watermark.

### D3 — `update_meal_plan` gains a `set` op (design-bundle gap)

The plan page's interactions include **removing a side chip** and **clearing a planned date**
(`app-pages.js` `plan()`: `side-remove`, the date input cleared). The existing `add` op is
union-only for `sides` and `op.planned_for ?? existing.planned_for` — a side can never be
removed and a date can never be cleared. New `MealPlanOp` variant:

```
{ op: "set", recipe, planned_for?: string | null, sides?: string[], from_vibe?: string | null }
```

`set` targets an existing row (absent → per-op conflict): `sides` supplied ⇒ replaced wholesale
(empty array removes all), `planned_for: null` ⇒ explicitly cleared, `from_vibe` preserved
unless supplied. Exposed on the MCP tool **and** the route in the same pass (operator decision
§11.4 precedent: one contract). `docs/TOOLS.md` + `meal-planning` spec delta in lockstep.

### D4 — Cooking-log list + delete are new thin ops (plan table corrected)

Plan §4 lists the `log` area as "`log_cooked` …, delete, `retrospective`" as if a delete
existed. **Neither a member-facing list read nor any delete exists** (the log is append-only;
`retrospective` is the only read). The log page (`app-pages.js` `log()`) renders a
most-recent-first list with per-row remove. Two thin ops, no new semantics:

- `readCookingLog(env, tenant, { limit })` — bounded, most-recent-first (`date DESC, id DESC`),
  recipe rows enriched with `title`/`protein`/`cuisine` via the same `LEFT JOIN recipes`
  COALESCE idiom `loadRetrospective` uses.
- `deleteCookingLogRow(env, tenant, id)` — tenant-scoped delete by the existing `id` PK;
  deleting a row organically updates everything derived from the log (`last_cooked` MAX(date),
  retrospective, vibe cadence debt) since none of it is materialized.

**Web-only; no new MCP tool** — the agent has no delete flow today and the plan's API table is a
web-app surface. Recorded in the `cooking-history` spec delta.

### D5 — Browse rows: new-for-me + full index; trending/picked-for-you deferred to P4

The mock's browse page is "New & trending" + "Picked for you" — but §4 marks trending
(`cooking_log` GROUP BY) and picked-for-you (`rankCandidates` favorites-affinity wrap) as
**new** ops and §10 assigns them to **P4**. Grounded: no such function exists anywhere
(`rankCandidates` is used only by `search_recipes` ranked mode and the proposal planner). P1
renders the browse page with a **"New for you"** section from the existing `readNewForMe`
(watermark-aware) and an all-recipes list from the index; the trending/picked-for-you rows take
those slots in P4 without layout change.

### D6 — P1 search is keyword-only

`GET /api/cookbook/search?q=` reuses `rankByKeyword` over `loadRecipeIndex` — exactly what the
public `/cookbook/search` JSON route already serves (same `CookbookHit` shape), now behind the
session for the app shell. No request-time embedding in P1; the freeform-phrase embed
(hash-cached) is P2's propose work.

### D7 — The vibe-suggest endpoint is gated; the tool is not (grounded finding)

Plan §1 requires the app's suggest endpoint to reuse the archetype-derivation job's `job_health`
gate. Grounded: **the ~20h gate exists only on the cron** (`runArchetypeDerivationJob` skips
when `readJobHealth("archetype-derive")` is ok and within `DERIVE_INTERVAL_MS = 20h`);
`suggest_night_vibes` → `runDerivation` is **ungated** — deliberate for the agent-mediated path.
Design: `POST /api/vibes/suggest` checks `readJobHealth("archetype-derive")` first — last run ok
and within the interval ⇒ `{ throttled: true, retry_after_ms }` (HTTP 200, no `env.AI` touch);
otherwise `runDerivation(env, tenant.id, seed, max)` → `{ candidates, enqueued }` (proposals
land in the same pending queue the page lists). The MCP tool stays ungated (unchanged
behavior). UI affordance: a "Suggest from your cooking" button in the palette header beside
"Add a vibe" (smallest deviation from the mock, which self-populates its queue locally; a live
app needs an explicit trigger — uses existing Basecoat/shadcn button styles, no new design
language; flagged for a future Claude Design pass if the operator wants it restyled).

### D8 — Two-writer write classes (normative)

Per plan §6. Class **(a)** = whole-document write, requires `If-Match`, 412 on mismatch → SPA
refetches, rebases, re-presents. Class **(b)** = idempotent upsert keyed on a canonical id,
last-write-wins, **never** `If-Match` — offline mutation replay must not 412 on stale
snapshots.

| endpoint | class | canonical key / notes |
| --- | --- | --- |
| `PATCH /api/profile/preferences` | (a) | merge-patch over the assembled preferences document |
| `PUT /api/profile/taste`, `PUT /api/profile/diet-principles` | (a) | whole markdown field |
| `PATCH /api/vibes/:id` | (a) | vibe edit (plan §6 names vibe edits class (a)) |
| `POST /api/vibes` | (b)-shaped | slugified id; duplicate ⇒ structured `conflict` (replay-safe) |
| `DELETE /api/vibes/:id` | (b) | id; second delete ⇒ `not_found` treated as converged |
| `POST /api/grocery/items` | (b) | canonical ingredient id (`normalized_name`); re-add merges |
| `PATCH /api/grocery/items/:name` | (b) | canonical id; status limited to `active|in_cart` (D1) |
| `DELETE /api/grocery/items/:name` | (b) | canonical id |
| `POST /api/pantry/ops`, `POST /api/pantry/verify` | (b) | canonical id (`normalized_name`) |
| `POST /api/plan/ops` (add/remove/set) | (b) | recipe slug |
| `PUT /api/overlay/favorite` | (b) | `{ slug, favorite: boolean }` — explicit **set**, not toggle |
| `POST /api/cookbook/recipes/:slug/notes` | (b) | `(author, slug, created_at)` with **client-minted `created_at`** |
| `PATCH`/`DELETE …/notes/:created_at` | (b) | `(author, slug, created_at)`; author-scoped |
| `POST /api/log` | (b) | route passes `dedupe: true` to `logCooked` — an identical `(date, type, recipe|name)` row short-circuits `{ deduped: true }`, so a replayed paused mutation cannot double-log; the MCP tool keeps today's append-always behavior |
| `DELETE /api/log/:id` | (b) | id |
| `POST /api/vibes/proposals/:id/confirm` | (b) | proposal id; already-resolved ⇒ structured `conflict` (converged) |
| `POST /api/vibes/suggest` | n/a | gated trigger (D7), safe to repeat |

**Toggle-shaped UI = explicit set on the wire** (favorite, in-cart): the client computes the
target state so replaying the same mutation twice converges instead of oscillating.

**ETag mechanics (no schema change, zero migrations):** the shared middleware (P0) emits a weak
ETag = hash of the response representation and honors `If-None-Match` → 304. Class (a) routes
recompute the current representation hash and compare `If-Match`; mismatch → 412 with a
structured `conflict` body. No `updated_at` columns are added.

**Error → HTTP** (shared middleware, P0-owned; **extended by this change**): P0's table maps
`validation_failed`→400, `not_found`→404, `unsupported`→405, the storage class
(`storage_error`/`index_unavailable`)→503, plus the API-layer `unauthorized`→401,
`csrf_rejected`→403, `rate_limited`→429. P1's endpoints additionally surface codes P0 never
mapped — **this change extends the shared table** (task 5.2, in the shared middleware, never
per-route) with: `conflict`→409 (and **412** when the conflict is a failed `If-Match`
precondition), `insufficient_permission`→403, `reauth_required`→401; anything unmapped stays
500. Bodies always keep the structured code so the SPA branches on `error`, not on status text.

### D9 — Grocery page scope

P1 grocery = explicit rows only: category grouping (client-side over `kind`:
groceries / home goods / other — the mock's no-store "category" mode), bottom add-row,
per-item in-cart set + remove, source facet + `for_recipes` links, "Clear purchased" = remove
each `in_cart` row (per `docs/TOOLS.md`, received is terminal **removal** — matches the mock's
`clearInCart`). **Excluded** (later phases): store picker + aisle/department grouping (W5/P4),
substitutions panel (W4/P4), "Add all to Kroger cart" / order preview (P3), the
"Already in your pantry" cross-reference + derived to-buy virtual rows (W2/P3).

### D10 — Profile field mapping (mock → real contract)

| mock control | real field / op | note |
| --- | --- | --- |
| Cooking nights seg (2–5) | `preferences.default_cooking_nights` via merge-patch | |
| Lunch strategy multi-chips (buy/cook/leftovers) | `preferences.lunch_strategy` — **single-select** over the real vocab `leftovers | buy | mixed` | production validates a single enum; the mock's multi-select array (incl. "cook") does not exist. Deviation recorded; changing the preference vocabulary is out of scope |
| Ready-to-eat seg | `preferences.ready_to_eat_default_action` (`opt-in | auto-add`) | |
| Resurface-after + novelty slider | `preferences.rotation` | |
| Dietary avoid/limit token fields | `preferences.dietary` | |
| Store + ZIP | `preferences.stores` | preferred location read-only (set via Kroger link flow) |
| Ranked brands | `preferences.brands` (tri-state ranked arrays) via merge-patch | |
| "In your words" markdown | profile `taste` field (`PUT /api/profile/taste` → `setProfileFields`) | |
| "Kitchen & household" markdown | **no backing field** — `kitchen` is `{ owned[], notes: per-equipment record }` | replaced by the `diet_principles` markdown editor (a real `PROFILE_MARKDOWN_FIELDS` member, labeled "Dietary principles") + a read-only owned-equipment card. Deviation recorded |
| Taste read (derived prose + chips) | `GET /api/profile/retrospective` (`loadRetrospective`) | cuisine/protein mixes, cadence; favorites chips from overlay + index |
| Kroger badge / link | `kroger` state on `GET /api/profile` (refresh-token presence in `KROGER_KV`) + `GET /api/profile/kroger-login-url` (`buildKrogerConsentUrl`, origin threaded from the request) | |

### D11 — Palette page uses the production vibe vocabulary

The mock's vibe rows use a free `WEATHER_TAGS` chip list and a single `season`. Production
(`night-vibe-db.ts`): `weather_affinity` / `weather_antipathy` are a **closed enum**
(`grill | cold-comfort | wet` + legacy values), `season` is `string[]`, and rows carry
`facets`, `cadence_days`, `pinned`, `base_weight` — **no** `last_satisfied` or `embedded`
columns. `GET /api/vibes` merges `readNightVibes` with `readVibeLastSatisfied` (MAX(date) over
`cooking_log.satisfied_vibe`); the cadence-debt meter is client-derived
(`(now − last_satisfied) / cadence_days`, "never cooked" when absent — matching the mock's
`statusOf` thresholds). The edit form renders the real vocab; no "any" pseudo-tag is persisted.

### D12 — Reconciliation queue renders kind-specific actions only

Real proposals are `kind: add_vibe | prune_vibe | adjust_cadence` with `payload`, `rationale`,
`evidence`; the only member ops are `readProposals(tenant, "pending")` and confirm
(accept/reject). The mock's extra "Stretch to Nd" button **on a prune** proposal has no backing
op (stretch = a separate `adjust_cadence` proposal with `payload.cadence_days`). P1 renders:
`add_vibe` → "Add vibe" / "Dismiss"; `adjust_cadence` → "Adjust to Nd" / "Dismiss";
`prune_vibe` → "Retire" / "Dismiss". Reject **is** the dismiss (recorded status, stable id,
never re-surfaced). The queue must render dozens of rows sanely (production: 47 pending).

### D13 — Login page restyle only; auth shape is P0's

The mock's login card fakes username/password + a quick-login roster. The real model (plan §3,
P0) is a single **invite code**. P1 restyles P0's login to the design's card (brand mark,
single field, submit); no roster, no password. Deviation recorded.

### D14 — Notes shape

Real notes carry `tags: string[]` + `private` + `(author, created_at)` identity. The mock's
single free-text `tag` input maps to a one-element `tags` array (UI may accept comma-separated
input later without contract change). `created_at` is client-minted at compose time (D8
idempotency). The detail page splits "Your notes" (own, editable, incl. private) from "From
other members" (shared only) — exactly the `readRecipeNotes` privacy rule
(`private=0 OR author=caller`).

## Page → endpoint → op map (normative)

| page / interaction | endpoint | backing op (file) |
| --- | --- | --- |
| Browse: index | `GET /api/cookbook/index` | `loadRecipeIndex` + `toHit` + title sort (`recipe-index.ts`, `cookbook-search.ts`) |
| Browse: New for you | `GET /api/cookbook/new-for-me` | `readNewForMe(env, tenant, floorDay, limit)` (`discovery-db.ts`) |
| Search | `GET /api/cookbook/search?q=` | `rankByKeyword(index, q)` (`cookbook-search.ts`) |
| Recipe detail | `GET /api/cookbook/recipes/:slug` | **extracted** `readRecipeDetail` (corpus read + `parseMarkdown` + `mergeOverlay` + `recipeDescription`) |
| Similar recipes | `GET /api/cookbook/recipes/:slug/similar` | `loadRecipeEmbeddings` + `nearestNeighbors` + `toHit` (`cookbook-similar.ts`) |
| Notes read | `GET /api/cookbook/recipes/:slug/notes` | `readRecipeNotes(env, slug, caller)` + group favorites (`corpus-db.ts`) |
| Note add / edit / delete | `POST` / `PATCH` / `DELETE …/notes[/:created_at]` | `insertRecipeNote` / `updateRecipeNote` / `removeRecipeNote` (`corpus-db.ts`) |
| Cook with Claude | — (client link) | `https://claude.ai/new?q=` + `/cook <slug>` — no backend |
| Favorites list | `GET /api/overlay` | `readOverlay(env, tenant)` (`profile-db.ts`), joined client-side to the cached index |
| Favorite set | `PUT /api/overlay/favorite` | `applyOverlayEdit` + `setOverlay` (`overlay.ts`, `profile-db.ts`) — explicit set |
| Meal plan read | `GET /api/plan` | `readMealPlan` (`session-db.ts`) |
| Plan add/remove/schedule/sides | `POST /api/plan/ops` | `applyMealPlanRowOps` (+ `stampLastPlanned` on add) (`session-db.ts`, `discovery-db.ts`); `set` op per D3 |
| Grocery read | `GET /api/grocery` | `readGroceryList` (`session-db.ts`) |
| Grocery add / patch / remove | `POST` / `PATCH` / `DELETE /api/grocery/items[/:name]` | `addGroceryRow` / `updateGroceryRow` (W3-guarded) / `removeGroceryRow` (`session-db.ts`) |
| Pantry read | `GET /api/pantry` | `readPantry(env, tenant, filter)` (`session-db.ts`) |
| Pantry ops / verify | `POST /api/pantry/ops` / `POST /api/pantry/verify` | `applyPantryRowOps` / `markPantryVerifiedRows` (`session-db.ts`) |
| Log list | `GET /api/log` | **new** `readCookingLog` (D4) |
| Log add | `POST /api/log` | **extracted** `logCooked` (dedupe on, D8) |
| Log delete | `DELETE /api/log/:id` | **new** `deleteCookingLogRow` (D4) |
| Profile read | `GET /api/profile` | **extracted** `assembleUserProfile` (+ Kroger link state, D10) |
| Preferences patch | `PATCH /api/profile/preferences` | **extracted** `applyPreferencesPatch` |
| Taste / diet-principles markdown | `PUT /api/profile/taste` / `…/diet-principles` | `setProfileFields` (`profile-db.ts`) |
| Taste read (derived) | `GET /api/profile/retrospective?period=` | `loadRetrospective` (`cooking-tools.ts`) |
| Kroger link | `GET /api/profile/kroger-login-url` | `buildKrogerConsentUrl` (`oauth.ts`) |
| Palette read | `GET /api/vibes` | `readNightVibes` + `readVibeLastSatisfied` (`night-vibe-db.ts`) |
| Vibe create / edit / delete | `POST` / `PATCH` / `DELETE /api/vibes[/:id]` | **extracted** `addNightVibe` / `patchNightVibe`; `deleteNightVibe` |
| Queue read | `GET /api/vibes/proposals` | `readProposals(env, tenant, "pending")` (`reconcile-db.ts`) |
| Proposal confirm | `POST /api/vibes/proposals/:id/confirm` | **extracted** `resolveProposal` (`applyProposal` + `setProposalStatus`) |
| Suggest (gated) | `POST /api/vibes/suggest` | `readJobHealth("archetype-derive")` gate → `runDerivation` (`night-vibe-suggest.ts`, `health.ts`) |

Sidebar counts (favorites / plan / to-buy) derive client-side from the already-cached area
queries — no counts endpoint.

## P0 baseline assumptions

Named by role; the implementer binds to P0's actuals:
1. A session middleware yielding the resolved tenant (the member analog of `requireAccess`) on
   everything under `/api`.
2. A shared `/api` error layer mapping `ToolError` codes → HTTP per D8 (the admin app's
   `statusForToolError` pattern, extended).
3. Shared ETag emission / `If-None-Match` handling and the `X-App-Build` header.
4. `packages/app` (TanStack Router routes, query client, `hc` client over the exported route
   types) and `packages/ui` (shadcn/ui + tokens per the design bundle `ds/`).
5. The app Playwright harness (seeded `wrangler dev`, page-object registry, per-area
   screenshots, blocking CI job).

## Out of scope (explicit)

Propose flow + W1 tool extensions (P2); derived to-buy view, `place_order` preview/commit UI,
persona/skill consolidation (P3/W2); substitutions (W4), aisle capture/grouping (W5), trending +
picked-for-you ops (P4); offline persister/paused-mutation replay hardening beyond keeping every
class (b) write replay-idempotent (P5); admin SPA (P6); `toggle_reject` UI (no surface in the
design bundle — endpoint deferred until one exists); any change to the `received` status
modeling; passkeys, CORS, server-side propose sessions.
