## Why

The admin panel lets an operator inspect the corpus and each member one at a time, but nothing shows what the **group** actually cooks and loves. The signal already exists in D1 — every cook is a `cooking_log` row, every favorite an `overlay` flag — yet it is only ever read per-member (member-detail) or as a bare count. A design handoff (`Admin Panel.html` + `InsightsScreen.jsx`) supplies a group-popularity dashboard; because the underlying data is already there and already read cross-tenant, this is a contained, read-only, additive area.

## What Changes

- **New `/admin/insights` area**, inserted in the top-level nav after **Data** (Status · Members · Data · **Insights** · Usage · Discovery · Logs · Config). Read-only.
- A **window toggle** (All time · Year · Month · Week) that scopes:
  - **Four summary tiles** — Cook events, Favorites, Top recipe, Top source.
  - A **GitHub-style cooking-activity heatmap** — a trailing 53 weeks of daily cook counts, with days outside the selected window dimmed.
  - **Two leaderboards** — *Most popular recipes* (top 12) and *Top sources* (each expandable to its recipes) — each **rankable** by *Times cooked* or *Favorites*.
- **Deep links**: a recipe row opens `/admin/data/recipes/<slug>`; a source recognized as a discovery feed links to the Config Discovery group's Feeds editor.
- **Aggregation semantics** (group = all member-tenants on the deployment; the panel is already cross-tenant):
  - *Times cooked* per recipe = its `cooking_log` rows of `type='recipe'` within the window.
  - The heatmap and the **Cook events** tile count `type IN ('recipe','ad_hoc')` — every home-cooked meal, excluding ready-to-eat/leftovers.
  - **Favorites are current state** (`overlay` has no timestamp), so favorite counts do **not** vary by window; only cook-derived numbers do.
- **Interaction model**: the page is server-rendered and seeds an **island** with every window's precomputed aggregates in a props block; the window/sort/expand toggles re-render client-side with no refetch (consistent with operator-admin's "interaction within a hydrated surface MAY update state client-side").
- **No new D1 tables, no migrations, no MCP tool changes** — purely a new reader + a new admin page/island over existing tables (`cooking_log`, `overlay`, `recipes`, `feeds`).

## Capabilities

### New Capabilities
- `group-insights`: the operator Insights area — group-wide popularity over the recipe corpus. Owns the windowed summary tiles, the cooking-activity heatmap, the recipe and source leaderboards (ranking + expandable sources), the deep-link targets, and the group-wide aggregation rules over `cooking_log` / `overlay` / `recipes` / `feeds`.

### Modified Capabilities
- `operator-admin`: the "Admin panel is organized into top-level areas" requirement adds an **Insights** area (routed at `/admin/insights`) to the enumerated areas and area nav.

## Impact

- **New code**: `src/insights.ts` (group-aggregation reader, pure mapping split from IO like `src/usage.ts`); `src/admin/pages/insights.tsx` (SSR page + props block); `src/admin/client/insights.tsx` (interactive island); `test/insights.test.ts`.
- **Edited code**: `src/admin/app.tsx` (a `GET /admin/insights` route); `src/admin/ui/layout.tsx` (nav entry); `src/admin/ui/icons.tsx` (flame · heart · trophy · trending-up — Rss/ChevronDown/ArrowRight already exist); `src/admin/styles.css` (the `.ins-*` leaderboard + `.cal-*` heatmap classes).
- **Unaffected**: no migrations, no `docs/TOOLS.md` / `docs/SCHEMAS.md` change (no tool or data-model change), no `scripts/build-admin.mjs` change (islands are auto-discovered from `client/*.tsx`).
- **Reads** existing tables owned by other capabilities (`cooking-history` → `cooking_log`; `data-write-tools`/overlay → `overlay`; `recipe-index` → `recipes`; `shared-corpus` → `feeds`); changes none of their requirements.
