## 1. Group-insights reader (`src/insights.ts`)

- [ ] 1.1 Define the payload types: `InsightsWindow` (`{ key: "all"|"year"|"month"|"week"; label }`), `RecipeRow` (`slug, title, cuisine, protein, sourceName, domain, favorites, cooks, lastCookedAt, combined`), `SourceRow` (`key, name, domain, isMember, isFeed, recipeCount, favorites, cooks, combined, recipes: RecipeRow[]`), `WindowView` (`{ recipes, sources, totals: { cooks, favorites, activeDays, sources } }`), `HeatDay` (`{ date, count }`), and `InsightsPayload` (`{ windows, perWindow: Record<windowKey, WindowView>, heatmap: { today, days: HeatDay[] }, generatedAt }`).
- [ ] 1.2 Write the pure `mapInsights(rows, nowMs)` (fed raw `cooking_log` / `overlay` / `recipes` / `feeds` rows, no D1): per-slug favorite counts (`overlay.favorite` truthy, across all tenants); per-window per-slug times-cooked (`type='recipe'`, slug in `recipes`, `date` ≥ lexicographic window cutoff); heatmap daily counts (`type IN ('recipe','ad_hoc')`); ranking with the `combined` tiebreak score (`fav/maxFav*50 + cooks/maxCook*50`); top-12 recipes, all sources; per-window totals. Compute all four windows.
- [ ] 1.3 Add the source-attribution helper: parse the host of `recipes.source_url` in a `try` (strip a leading `www.`), rolling a blank/malformed/absent `source_url` into the member-authored bucket; tag a domain as a discovery feed when it matches any `feeds.url` host. Never throw.
- [ ] 1.4 Add the IO wrapper `readInsights(env, nowMs = Date.now())`: four `db(env).all(...)` reads (`cooking_log`: `date,type,recipe`; `overlay`: `recipe,favorite`; `recipes`: `slug,title,cuisine,protein,status,source_url`; `feeds`: `url`) → `mapInsights`. Compute `today` (UTC `YYYY-MM-DD`) here and pass it in. Stays throw-free via `src/db.ts`.

## 2. Reader tests (`test/insights.test.ts`)

- [ ] 2.1 Window scoping: cooks fall in/out of week/month/year/all by `date`; favorite counts are identical across every window.
- [ ] 2.2 Cook-type semantics: `type='recipe'` adds to a recipe's times-cooked; `ad_hoc` adds to the heatmap/Cook-events totals only; `ready_to_eat` is excluded everywhere; a `type='recipe'` row whose slug is absent from `recipes` is ignored by the leaderboard.
- [ ] 2.3 Ranking: sort by the selected metric desc with the `combined` tiebreak; the recipe board caps at 12; `lastCookedAt` = max in-window `date` per slug.
- [ ] 2.4 Source rollup: member-authored bucket for missing/blank/malformed `source_url`; discovery-feed tag when the domain matches a feed host; `recipeCount` and the expandable per-source recipe list are correct.
- [ ] 2.5 Heatmap + empty state: daily bucketing by `date` string over the trailing 53 weeks (inclusive); an empty deployment (no cooks/favorites) yields well-formed zero-filled windows and never throws.

## 3. Presentation primitives

- [ ] 3.1 Add Lucide icons `FlameIcon`, `HeartIcon`, `TrophyIcon`, `TrendingUpIcon` to `src/admin/ui/icons.tsx` (Rss/ChevronDown/ArrowRight already exist).
- [ ] 3.2 Port the prototype's `.ins-*` (leaderboard rows/metrics/bars/source-expand) and `.cal-*` (heatmap grid/cells/legend) rules plus `.stat-value-sm` into `src/admin/styles.css`, reusing existing tokens/classes (`--accent`, `--muted`, radii/shadows, the existing `.group-label` and `.stat-*` classes) rather than the mock's raw values where a token already exists; keep the heatmap's warm `lvl-0..4` ramp.

## 4. SSR page (`src/admin/pages/insights.tsx`)

- [ ] 4.1 `InsightsPage({ payload })`: `Layout active="/admin/insights" wide`, the area head, and a correct **first-paint** render of the default view (`window="all"`, `sort="cooks"`) — tiles via `StatCardGrid`/`StatCard`, the heatmap, and both leaderboards — so the page is right before hydration.
- [ ] 4.2 Emit the props block `<script type="application/json" id="insights-props">` (via a `serializeProps(payload)` mirroring `pages/discovery.tsx`), the `#insights-island` host, and `<script type="module" src="/admin/islands/insights.js">`.

## 5. Interactive island (`src/admin/client/insights.tsx`)

- [ ] 5.1 Port `InsightsScreen.jsx` to `hono/jsx/dom`: read+parse `#insights-props`, mount into `#insights-island`, hold `window` / `sort` / `openSource` state, and render tiles + heatmap (out-of-window cells dimmed) + both boards from the seeded data — no network request. Recipe rows and the discovery-feed tag are plain `<a href>` to `/admin/data/recipes/<slug>` and `/admin/config`.
- [ ] 5.2 Confirm the island typechecks under `src/admin/client/tsconfig.json` (DOM lib, `jsxImportSource: hono/jsx/dom`).

## 6. Wiring

- [ ] 6.1 `src/admin/app.tsx`: add `app.get("/insights", …)` that calls `readInsights(c.env)` and renders `<InsightsPage payload={…} />` through `page(...)`.
- [ ] 6.2 `src/admin/ui/layout.tsx`: insert `{ href: "/admin/insights", label: "Insights" }` into `AREAS` immediately after the Data entry.

## 7. Docs

- [ ] 7.1 Update any living doc that enumerates the admin areas (grep `docs/` + `README.md` for the Status/Members/Data/Usage… area list) to include Insights; no `docs/TOOLS.md` / `docs/SCHEMAS.md` change (no tool/data-model change).

## 8. Build, typecheck, test, verify

- [ ] 8.1 `aubr build:admin` — the new `client/insights.tsx` island bundles (auto-discovered) and `styles.css` recompiles.
- [ ] 8.2 `aubr typecheck` — both the SSR (workerd) and client (DOM) passes are green.
- [ ] 8.3 `aubr test test/insights.test.ts`, then the full `aubr test` suite, all green.
- [ ] 8.4 `openspec validate group-insights --strict` passes; the change is ready to archive after apply.
- [ ] 8.5 Visual check at `/admin/insights` under `aubr dev` with a seeded local D1 (`cooking_log` + `overlay` rows): tiles, heatmap, both leaderboards, the window/sort/expand toggles, and the recipe + feed deep-links — in both light and dark themes.
