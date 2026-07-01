## Context

The operator panel (`src/admin/`) is a Hono app: pages are server-rendered by calling the Worker's `src/` readers directly, and interactive controls hydrate as `hono/jsx/dom` islands seeded from an emitted props block (never a fetch-on-mount). The **Usage** area (`src/usage.ts` reader + `src/admin/pages/usage.tsx`) is the closest template for a new read-only dashboard: its reader splits pure mapping from IO so the shape logic is unit-testable offline.

Every input the Insights dashboard needs is already in D1 and already read cross-tenant by the panel:

| Table (migration) | Columns used | Existing read precedent |
| --- | --- | --- |
| `cooking_log` (0003) | `date` (`YYYY-MM-DD` text), `type` (`recipe`\|`ready_to_eat`\|`ad_hoc`), `recipe` (slug) | `admin.ts` runs `SELECT tenant, COUNT(*) FROM cooking_log GROUP BY tenant` |
| `overlay` (0004) | `recipe`, `favorite` | `admin-data.recipeDetail` reads `overlay` across all tenants |
| `recipes` (0002) | `slug`, `title`, `cuisine`, `protein`, `status`, `source_url` (indexed) | `admin-data.searchRecipes` selects these columns |
| `feeds` (0006) | `url` | `corpusCounts` counts `feeds` |

"Group" = every member-tenant on this Worker deployment; the admin surface is deliberately cross-tenant (`src/admin-data.ts` header), so a group aggregate simply omits the tenant filter.

## Goals / Non-Goals

**Goals:**
- A read-only `/admin/insights` area that recreates the handoff prototype pixel-for-feel: windowed tiles, a trailing-53-week cooking heatmap, and recipe + source leaderboards rankable by cooks or favorites.
- A single group-aggregation reader (`src/insights.ts`) whose pure mapping is unit-tested like `src/usage.ts`.
- Instant window/sort/expand toggles with no server round-trip.

**Non-Goals:**
- No new D1 tables, migrations, or MCP tools; no writes of any kind.
- No per-member drill-down here (member-detail already owns that) and no new deep-link *destinations* — only links to existing routes.
- No `docs/TOOLS.md` / `docs/SCHEMAS.md` change (no tool/data-model change).

## Decisions

### 1. A new `group-insights` capability + a dedicated reader module
The Insights area is a distinct operator surface with its own aggregation rules, mirroring how `usage-observability` owns the Usage area. `src/insights.ts` is the one place the group-wide `cooking_log`/`overlay`/`recipes`/`feeds` reads and their windowing/ranking logic live, rather than scattering GROUP BY queries across `admin.ts`/`notes-tools.ts`. All D1 access goes through `src/db.ts` (throw-free `storage_error`), like every other reader.

### 2. Interactive island, not query-param SSR
*Chosen: an island.* The prototype re-scopes tiles + heatmap + both boards on every toggle; a full-page nav per pill (the Discovery/Logs `?filter=` precedent) would feel heavy. `operator-admin` §"top-level areas" already blesses this: "Within a hydrated surface, an interaction MAY update state client-side without a full navigation." *Alternative rejected:* query-param SSR — simpler and zero-JS, but loses the instant feel and re-renders the whole document per toggle.

To honor the panel's "seed from props, never fetch-on-mount" rule, the **SSR page computes all four windows' aggregates in one reader call** and emits them in a `<script type="application/json" id="insights-props">` block (the exact `discovery.tsx` → `client/discovery.tsx` pattern). The island reads the block, holds `window` / `sort` / `openSource` state, and re-renders from data already in the page. Payload is tiny — aggregate counts over a few hundred recipes plus one 53-week integer series — so inlining every window is cheaper than any refetch.

### 3. Reader payload shape (compute-once)
`readInsights(env, nowMs)` returns:
```
{ windows: [{key,label}...],
  windowStart: { all|year|month|week: "YYYY-MM-DD" },   // "" for all-time
  perWindow: { all|year|month|week: { recipes: RecipeRow[], sources: SourceRow[], totals: { cooks, favorites, activeDays } } },
  heatmap: { today: "YYYY-MM-DD", weeks, cells: { date, count, level }[], months: { label, span }[] },  // trailing 53 weeks, type IN (recipe,ad_hoc)
  generatedAt }
```
Split into a pure `mapInsights(rows, nowMs)` (fed raw `cooking_log`/`overlay`/`recipes`/`feeds` rows) + the thin IO wrapper, so windowing, ranking, rollup, and heatmap bucketing are tested without D1. `nowMs` is injected (never `Date.now()` inside the pure fn) for deterministic tests.

### 4. What counts as a cook
- **Leaderboards** count only in-corpus recipe cooks: a recipe's *times cooked* in a window = its `cooking_log` rows with `type='recipe'` and `date` in-window; a slug absent from `recipes` is ignored.
- **Heatmap + "Cook events" tile** count `type IN ('recipe','ad_hoc')` — actual home cooking, excluding `ready_to_eat` (leftovers/takeout aren't cooking).
- **Favorites are current state.** `overlay` carries no timestamp, so a recipe's favorite count (`COUNT(favorite=1)` across tenants) and the Favorites tile are identical in every window; only cook-derived numbers move. This is a data fact, not a toggle.

### 5. Day-granular time
`cooking_log.date` is `YYYY-MM-DD` text. Windows are lexicographic string cutoffs (`date >= todayMinus(365|30|7)`), the heatmap buckets by the date string directly (no ms math), and "last cooked" is `MAX(date)` per slug. `today` is computed server-side (UTC) and passed into the reader; sub-day ordering and time-of-day are irrelevant to a day-granular heatmap.

### 6. Source attribution
Recipes roll up by the **domain of `source_url`** (`new URL(source_url).host`, `www.` stripped; a malformed/empty `source_url` → the *Member submissions* bucket, badged "authored in-group"). A domain that matches any `feeds.url` host is tagged **"discovery feed"** and links to the Config Discovery group (`/admin/config`, whose default group hosts the Feeds editor). Domain/feed matching is membership over parsed hosts — no new `feeds` tag convention.

### 7. Deep-link targets (existing routes only)
Recipe rows → `/admin/data/recipes/<slug>` (confirmed `app.get("/data/recipes/:slug")`). Discovery-feed source → `/admin/config` (the Discovery group's Feeds editor). Both are plain `<a href>` in the island — no new routes.

### 8. Ranking
Rows sort by the selected metric (`cooks` or `favorites`) descending, tie-broken by a `combined` score (`fav/maxFav*50 + cooks/maxCook*50`, per the prototype). Recipes show the top 12; sources show all, each expandable to its recipes (native island state, not a `<details>`, since the island already renders).

### 9. Presentation port
New Lucide icons `flame`/`heart`/`trophy`/`trending-up` join `src/admin/ui/icons.tsx` (Rss/ChevronDown/ArrowRight already exist). The prototype's `.ins-*` (leaderboard/metric/source-expand) and `.cal-*` (heatmap) rules port into `src/admin/styles.css`; the operator theme + Basecoat tokens (`--accent`, `--muted`, radii, shadows) already cover the rest. Islands are auto-discovered from `client/*.tsx`, so `scripts/build-admin.mjs` is untouched.

## Risks / Trade-offs

- **An island on a read-only page** cuts against the panel's "reads are pure SSR" default → mitigated by seeding entirely from the props block (no client fetch, no new API route), keeping all logic in the tested pure reader, and the explicit §top-level-areas allowance for in-surface client state. The page still renders a correct first paint before hydration.
- **Unfiltered `cooking_log` / `overlay` scans** (group-wide, no tenant predicate) → these are small at a friend-group's scale and the aggregation is in-memory; the tables are indexed and the panel already does cross-tenant scans elsewhere. If a deployment ever grows, the aggregation can move to GROUP BY SQL without changing the payload contract.
- **`source_url` domain parsing** on malformed URLs → `new URL()` in a `try` that degrades to the *Member submissions* bucket rather than throwing into the read path (the reader stays throw-free like its siblings).
- **Heatmap day-boundary timezone**: `today` is UTC while `cooking_log.date` was logged in the member's local frame → at most a one-day edge fuzz on the most recent cell; acceptable for an activity heatmap and consistent with `usage.ts`'s UTC-day convention.
- **Empty deployment** (no cooks/favorites yet) → tiles show `0` / "—", the heatmap renders all level-0 cells, and each board shows an empty message; the reader returns well-formed zero-filled windows, never a partial/`null` shape.
