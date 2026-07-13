# Overview — mockup inventory, deltas, and sequencing

The mockup is a complete member-app redesign: six sidebar destinations (Cookbook, Meal
plan, Grocery list, Pantry, Retrospective, People), a six-tab Profile & preferences page
(Taste profile, Preferences, Meal vibes, Discovery, Satellites, Account & security), a
Connect-to-Claude modal, and four conversation/app widgets (Meal Planning, Grocery List,
Order Review, Recipe Card). Sidebar shows live counts (plan, grocery, people) and the
tenant identity footer with a settings gear (→ Profile) and sign-out.

## Page index

| Spec | Surface | Overall delta |
|---|---|---|
| [pages/01-cookbook.md](pages/01-cookbook.md) | Cookbook (browse/search/filter, Recommended panel) | Restructure + new filter bar; favorites folds in |
| [pages/02-recipe-detail.md](pages/02-recipe-detail.md) | Recipe detail + Recipe Card widget (guided cook) | Tweaks; widget implies new body-annotation contract |
| [pages/03-meal-plan.md](pages/03-meal-plan.md) | Meal plan (slots, empty-slots grid, projects) | New meal-type dimension + projects section |
| [pages/04-plan-your-week.md](pages/04-plan-your-week.md) | Propose flow + Meal Planning widget | Per-meal steppers; slot UX simplification |
| [pages/05-grocery-list.md](pages/05-grocery-list.md) | Grocery list + Order Review + store walk | Dept/recipe grouping, brand decisions, walk mode |
| [pages/06-pantry.md](pages/06-pantry.md) | Pantry (locations, multi-add, Used/waste) | Location dimension; disposition capture |
| [pages/07-retrospective.md](pages/07-retrospective.md) | Retrospective (log / spend / waste tabs) | New page shell; spend+waste are new product areas |
| [pages/08-people.md](pages/08-people.md) | People (household, friends, requests) | New social layer (see story 01) |
| [pages/09-profile-taste-and-preferences.md](pages/09-profile-taste-and-preferences.md) | Taste profile + Preferences tabs | Per-meal cadence, store adapters, brand tiers |
| [pages/10-profile-meal-vibes.md](pages/10-profile-meal-vibes.md) | Meal vibes tab | Meal-scoped vibes; inline suggestions |
| [pages/11-profile-discovery.md](pages/11-profile-discovery.md) | Discovery tab (feeds) | New member surface; follow relation is new |
| [pages/12-profile-satellites.md](pages/12-profile-satellites.md) | Satellites tab | Member surface over existing operator backend |
| [pages/13-account-and-security.md](pages/13-account-and-security.md) | Account & security tab | New account-management surface |
| [pages/14-connect-to-claude.md](pages/14-connect-to-claude.md) | Connect modal | Guided UI over existing flow |

## Cross-cutting stories

| Story | What it is | Pages it touches |
|---|---|---|
| [stories/01-households-and-friends.md](stories/01-households-and-friends.md) | Tenant = household; friend links; visibility lenses over one corpus; empty-corpus-on-join + curated set | People, Cookbook, Recipe detail (notes), Discovery, Retrospective (spend), Account |
| [stories/02-meal-dimension.md](stories/02-meal-dimension.md) | Breakfast/lunch/dinner as a first-class axis | Meal plan, Plan your week, Meal vibes, Preferences (cadence), Retrospective (log) |
| [stories/03-cost-and-waste-telemetry.md](stories/03-cost-and-waste-telemetry.md) | Priced line items, waste events, budget — capture → analyzers | Grocery/Order, Pantry, Retrospective, Preferences |
| [stories/04-store-adapters-and-fulfillment.md](stories/04-store-adapters-and-fulfillment.md) | Kroger / Instacart / Satellite / Offline adapters; order, walk, cart-fill fulfillment | Preferences (store card), Grocery, Order review, Satellites |
| [stories/05-ingested-data-trust.md](stories/05-ingested-data-trust.md) | How third-party data earns its way in: probe, funnel, health, quarantine, dedup/memoize | Discovery, Satellites, Cookbook (new-for-you) |
| [stories/06-dual-use-widgets.md](stories/06-dual-use-widgets.md) | One widget, two hosts: member-app component + MCP App in Claude conversations | Plan your week, Grocery, Order review, Recipe detail |

## What already exists (from the OpenSpec cross-check)

Already specced with member UI: weather strip on propose (`member-app-propose`), notes
with tags + private flag (`recipe-notes` — UI for tags is the only gap), the order
checkpoint picker and tri-state brand model (`ingredient-matching`, `member-app-grocery`),
"Recommended for you" reason rows map to existing new-for-me / trending / picked-for-you
(`member-app-differentiators`).

Already specced backend/agent-side, mockup adds member UI: store-walk (`in-store-fulfillment`
— including aisle-`layout` store notes the mockup's map editor edits), satellites
management (`satellite`, `satellite-source-audit` — admin-only today), feed probe
(`discovery-probe` behind admin API), learned SKU matches (`order-placement`).

Not specced (genuinely new): household multi-member tenants and friend links (contrary to
today's strict tenant isolation), spend & waste analytics, Instacart + Offline store
adapters, the meal-type dimension (plan rows, cadence, vibes, log), plan projects
("Baking, treats & drinks"), cookbook facet filter bar + favorites-only toggle, account
management (username change, recovery email, passkey management, export, sessions),
member feed follow/unfollow + popular-feeds pool, feed→member import attribution.

## Suggested sequencing

Dependencies, not a mandate. Each numbered band can be one or more OpenSpec changes.

**Momentum bank**: `connect-modal`, `cookbook-unified-browse` (filter bar over indexed
facets, favorites toggle, promoted panel — URL-param plumbing only), and
`recipe-detail-tweaks` (detail page only; the cook-mode widget waits for D32's change)
are zero/near-zero-backend changes that can land while band 1 is being planned, without
touching band-1 shared surfaces.

**Sidebar counts** (all three badges, defined once): grocery = the derived to-buy line
count minus checked (D28) and in-flight rows (the same read the page renders; on the
offline persist allowlist); plan = meal rows only, `meal != 'project'` (D26); people =
pending inbound requests, not friends (the mock's friend-count badge is a listed mock
bug).

1. **Foundations with no UI dependencies**: meal-type dimension on plan/log/vibes/cadence
   (story 02 — schema + tool contracts + propose engine); pantry location dimension +
   disposition capture (feeds story 03); brand tiers data model; spend-event capture on
   the existing order-commit path (feeds story 03) — snapshot/materialize contract per
   D16, banding per D25. Coupling rule (D25): a migration retiring a preference shape the
   shipped profile/vibes pages edit ships with, or is immediately followed by, its
   member-UI update.
2. **Page redesigns over existing data**: Cookbook restructure (filter bar, promoted
   panel, favorites toggle); Meal plan page (slots grid, projects); Plan-your-week widget
   alignment; Pantry page; Retrospective shell with the existing cooking log tab. Two
   named slices: `propose-orchestration-unification` (lift the hand-duplicated
   ProposeSession/buildRequest/toView orchestration from packages/app/src/lib/propose.ts
   + packages/widgets/src/ProposeCard.tsx into the shared package with host adapters;
   lands BEFORE the page-04 redesign; D25) and `profile-planning-and-vibes-ui` (page 09
   Planning card: per-meal cadence steppers, resurface/novelty sliders, weekly-budget
   control; page 10 Meal vibes tab; sequenced immediately after band 1's story-02 schema
   change; the D8 lunch-strategy/RTE → seeded-vibes migration rides this slice). The
   Preferred-brands management card ships with band 1's brand-tier model change or, at
   latest, as a band-3 sibling ordered before the order-review rework (D25).
3. **Order flow + fulfillment**: order review rework (brand decisions, broader/manual
   search, savings, honest confirm); store adapters card; offline stores + aisle maps +
   member store-walk UI (story 04). The order-review rework EXTENDS band 1's spend
   capture (impulse lines, flyer-savings tiles reading the same send-record source) and
   adds the manual-shop/walk capture + estimation path — spend capture rides the shared
   commit ops (order commit + the shop-commit/receive op), never UI wiring (D16).
4. **Analyzers**: spend analyzer, then waste analyzer (needs 1's disposition + spend
   capture).
5. **Social layer** (story 01): households (multi-member tenants), friend links,
   visibility lenses, curated public set, People page, cookbook/notes lens integration.
   Biggest change; independent of 2–4 except where recommendations read the friend lens.
   The member identity split (D10) is this band's first change; every member-scoped
   feature depends on it.
6. **Ingest surfaces**: member Discovery tab (follow relation, popular pool, test modal)
   and Satellites tab (mostly re-scoping existing admin surfaces to member sessions)
   (story 05). Household-scoped bits depend on 5.
7. **Account & security + Connect modal** — three slices (D25): **7a**
   `account-security-basics` + `connect-modal` (any time; built on tenant-as-member
   identity; session/grant records gain their member key as a band-5 follow-through —
   re-key, not rebuild); **7b** after band 5 (handle rename; export scope contract);
   **7c** `recovery-email` (blocked on an outbound email sender that does not exist —
   sender choice + magic-link security model resolved by a planning-time spike).

## Routing and config placements (per band)

1. **Invite/join links** — SPA route `/join/:token` + POST under `/api/*`: no
   `run_worker_first` entry needed; a proposal minting a Worker-rendered join page would
   need one.
2. **Export** — GET under `/api/*`: covered; no out-of-band signed URLs (D33).
3. **Recovery-email verification/magic link** — SPA route + `/api`: no entry.
4. **Instacart handoff** — session-gated `POST /api/grocery/instacart`; no OAuth callback
   or new `run_worker_first` entry.
5. **Widget resources** — MCP `resources/read`, never HTTP routes.
6. **Satellite helper freshness observation** — rides `/satellite/*`: covered (D22).
7. **Feed probe, walk/manual-shop, people, satellites member surfaces** — all `/api/*`:
   covered.
8. **The D9 deployment-profile flag** is new deploy-visible config: each proposal must
   state its channel — either the D1-config channel (discovery_config precedent,
   preferred) or a wrangler var explicitly verified to survive
   scripts/merge-wrangler-config.mjs's allowlist. Implicit friend edges are COMPUTED from
   the flag at read time, never materialized; flipping self-hosted→SaaS drops the
   implicit edges (operator may bulk-create real friendships); SaaS→self-hosted is
   refused unless the deployment has ≤1 non-empty household (consent inversion guard).

## Appendix A — MCP tool delta + /api endpoint inventory

Each band's proposal starts from this; every tool line lands in docs/TOOLS.md in the
same pass.

**New tools**: `display_grocery_list`, `display_order_review` (D18/D19); post-spike
`create_instacart_handoff` Marketplace-link operation (D7), explicitly not a flush or order.

**Renamed with alias window (D21)**: the `night_vibe` family → `meal_vibe` family; each
vibe gains `meal`; `update_night_vibe` needs explicit-null field-clearing for the inline
edit form; vibe cadence stays optional (the mock's mandatory select is a UI default).

**Changed**: `propose_meal_plan` + `display_meal_plan` (per-meal counts map, slots
grouped by meal, ProposeCardData reshape; attendance input per D29; member-UI dials cut
per D8/D20 — tool params retained); `update_meal_plan`/`read_meal_plan` (meal column,
client-mintable row ids + slug-op fan-out per D26, `meal='project'` rows); `log_cooked`
(meal param, per-(date,meal,type,recipe) dedupe, meal-aware deterministic clear +
optional row-id param per D26); `retrospective` (meal-aware cadence + household-scoped
spend/waste aggregate sections, read-only); `update_preferences` (cadence map,
weekly_budget, brands→tiers, retired keys accepted-and-dropped per D21);
`read_user_profile` (cadence/vibes/budget/brand-tier shapes; household members +
nicknames export per D10; deployment profile); `update_pantry`/`read_pantry` (location
orthogonal to category; disposition on remove); `read_recipe_notes` (tiers + author
handles per D30/D10); `search_recipes`/`read_recipe`/`display_recipe`/`list_new_for_me`/
propose pools/`recipe_site_url` (lens scoping per D11); `create_recipe` (already_exists →
visibility grant per D12); suggest-vibes op (meal classification, cron producer);
`update_feeds` (auto-follow — records the adding member as follower, TOOLS.md same
pass); `place_order` (send-record snapshot side effect per D16); store tools get
"offline adapter" copy only (D6).

**Unchanged**: `kroger_flyer`/`store_flyer`, `kroger_prices`, `match_ingredient` (rule
internals change with brand tiers), `compare_unit_price`, guidance tools, weather
(dinner-only buckets initially, story 02 q4), `report_bug`, `kroger_login_url`.

**New /api endpoints**: retrospective spend/waste aggregates; pantry disposition;
grocery check-off/manual-shop/walk-completion (D28); grocery manual/broader search;
kroger login-url + disconnect; Instacart Marketplace handoff (`POST
/api/grocery/instacart`, no connect/retailer endpoint); people
aggregate + requests CRUD + members (remove, nickname) + invites (mint/revoke); signup
join-link fork; discovery aggregate + feed test + follow/unfollow + add-feed; satellites
aggregate + key mint/revoke + disconnect + quarantine/resume + cart-fill meta (D22
fields only); account: handle change, recovery email, passkey list/remove-ceremony,
session list/revoke(+others), MCP grant list/revoke(+all), export (streamed GET, D33);
config/whoami gains `{ profile, operator }` for the connect modal + D9 gating.

## Appendix B — per-band docs/spec lockstep map

Each band's tasks.md carries its checklist; a band PR missing a listed delta is
incomplete.

- **Band 1**: TOOLS.md (vibe family, propose/display_meal_plan, read/update_meal_plan,
  log_cooked, retrospective, update_preferences, read_user_profile, read/update_pantry);
  SCHEMAS.md (night_vibes, meal_plan, cooking_log, preferences block, pantry, brand
  prefs, spend_events, ProposeCardData); ARCHITECTURE.md (menu-generation); deltas:
  night-vibe-palette, planning-cadence, weather-bucket-planning, meal-plan-proposal,
  meal-planning, menu-generation, cooking-history, meal-plan-widget, member-app-propose,
  member-app-core, profile-reconciliation, night-vibe-archetype-derivation,
  order-placement (spend snapshot).
- **Band 2**: TOOLS.md retrospective; deltas: member-app-core,
  member-app-differentiators, cookbook-search, recipe-notes (tag UI), guided-cook +
  recipe-card-widget (body annotations — SCHEMAS.md annotation grammar explicitly
  required by pages/02).
- **Band 3**: TOOLS.md (place_order, update_grocery_list, read_to_buy, matcher
  confidence, store tools copy, new display tools); SCHEMAS.md (grocery checked_at, send
  records, sku_cache, widget payload contracts); ARCHITECTURE.md (Kroger pipeline +
  fulfillment branches + Instacart Marketplace handoff adapter); deltas: member-app-core,
  store-adapter-projection, member-app-grocery,
  ingredient-matching, order-placement, in-store-fulfillment, grocery-list,
  member-app-offline (checked_at re-wording per D28 + online-only surfaces).
- **Band 4**: SCHEMAS.md event tables + avoidability derivation; ARCHITECTURE.md cron
  list; TOOLS.md retrospective.
- **Band 5**: TOOLS.md (lens notes on every corpus read, notes tools, read_user_profile,
  create_recipe dedup-to-grant); SCHEMAS.md
  (members/friendships/requests/invites/imports/handles); ARCHITECTURE.md (multi-tenant
  identity rewrite); deltas: multi-tenancy, shared-corpus (wholesale),
  member-session-auth, passkey-auth, self-service-signup, group-insights, recipe-notes,
  member-app-differentiators, claude-ai-connector, operator-admin (D10), cookbook-search,
  cookbook-similar-recipes, data-read-tools, semantic-recipe-search (D11).
- **Band 6**: TOOLS.md (update_feeds, read_satellite_rejections visibility); SCHEMAS.md
  (feeds health/follows/attribution); ARCHITECTURE.md (discovery sweep); deltas:
  recipe-discovery, discovery-sweep, discovery-calibration, satellite,
  satellite-source-audit (trust premise per D14), satellite-pull-channel.
- **Band 7**: SCHEMAS.md (session/grant metadata, export); deltas: member-session-auth,
  passkey-auth, multi-tenancy (grant metadata), operator-provisioning.

## Appendix C — persona/skills impact map

Each band's tasks include its AGENT_INSTRUCTIONS.md edit + `aubr build:plugin --check`;
grep the persona for lunch_strategy / ready_to_eat_default_action / night-vibe naming
before merging a band that retires them.

- **Band 1**: meal-plan/menu-gen flow (per-meal counts, vibe-meal binding, empty-meal
  nudge); configure-yamp-profile onboarding (per-meal cadence; lunch-strategy +
  RTE-default questions REMOVED, replaced by seeded vibe suggestions; budget capture);
  cooked/log flow (meal param); vibe-palette skills (meal-vibe naming).
- **Band 3**: shop-groceries (RTE default action gone — always offer, never auto-add;
  receive/"I placed the order" choreography routes through the D16 shared ops; "offline
  store" naming per D6); put-away/pantry flow (location field; waste-reason capture on
  spoilage mentions).
- **Band 4**: retrospective skill acts on spend/waste aggregates, reads only.
- **Band 5**: session-start profile read carries household members + nicknames; notes
  flows mention tiers (D30).
- **Widget bands**: "when to show" lines for display_grocery_list/display_order_review
  mirroring the existing display_recipe boundary text.

Per the tool/skill ownership test, new guarantees (disposition never asks value; spend
materializes at the purchase assertion; lens semantics) live in tool descriptions;
skills carry only choreography.

## Mockup fidelity warnings

The mockup is a painted door (DECISIONS.md D5): its hardcoded data, selection logic, and
unwired states demonstrate the intended *experience*, never the mechanism — sourcing
always comes from the repo's derivation doctrine. Beyond that, specific mock bugs and
vestiges the specs call out (do **not** implement literally): the propose
widget drops the meal tag at commit and hardcodes `Dinner`; commit's date allocator packs
one meal per day; the cookbook favorites-toggle control is missing from markup though its
logic exists; the People sidebar badge counts friends rather than requests; one static
invite link claims tier-specific behavior; "Disconnect all" (Claude) has no confirm;
plan-page "+ side" uses `window.prompt`; several computed-but-unrendered labels
(count labels, role labels, walk subheads) indicate intended-but-uncommitted design.
