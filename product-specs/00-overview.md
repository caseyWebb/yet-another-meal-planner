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

1. **Foundations with no UI dependencies**: meal-type dimension on plan/log/vibes/cadence
   (story 02 — schema + tool contracts + propose engine); pantry location dimension +
   disposition capture (feeds story 03); brand tiers data model.
2. **Page redesigns over existing data**: Cookbook restructure (filter bar, promoted
   panel, favorites toggle); Meal plan page (slots grid, projects); Plan-your-week widget
   alignment; Pantry page; Retrospective shell with the existing cooking log tab.
3. **Order flow + fulfillment**: order review rework (brand decisions, broader/manual
   search, savings, honest confirm); store adapters card; offline stores + aisle maps +
   member store-walk UI (story 04). Spend capture rides the order flow (story 03).
4. **Analyzers**: spend analyzer, then waste analyzer (needs 1's disposition capture and
   3's price capture).
5. **Social layer** (story 01): households (multi-member tenants), friend links,
   visibility lenses, curated public set, People page, cookbook/notes lens integration.
   Biggest change; independent of 2–4 except where recommendations read the friend lens.
6. **Ingest surfaces**: member Discovery tab (follow relation, popular pool, test modal)
   and Satellites tab (mostly re-scoping existing admin surfaces to member sessions)
   (story 05). Household-scoped bits depend on 5.
7. **Account & security + Connect modal**: independent; can land any time.

## Mockup fidelity warnings

Mock bugs and vestiges the specs call out (do **not** implement literally): the propose
widget drops the meal tag at commit and hardcodes `Dinner`; commit's date allocator packs
one meal per day; the cookbook favorites-toggle control is missing from markup though its
logic exists; the People sidebar badge counts friends rather than requests; one static
invite link claims tier-specific behavior; "Disconnect all" (Claude) has no confirm;
plan-page "+ side" uses `window.prompt`; several computed-but-unrendered labels
(count labels, role labels, walk subheads) indicate intended-but-uncommitted design.
