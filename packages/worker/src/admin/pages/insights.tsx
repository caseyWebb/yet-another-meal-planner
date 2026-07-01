// The Insights area (group-insights): a group-wide popularity dashboard over the recipe corpus,
// server-rendered for first paint and hydrated into an interactive island. A window toggle
// (All time · Year · Month · Week) scopes the summary tiles, a GitHub-style cooking-activity
// heatmap, and two leaderboards (recipes · sources), each rankable by Times cooked or Favorites.
//
// `InsightsView` is the ONE presentational component, rendered both by this SSR page (default
// state, for a correct first paint inside the island host) and by client/insights.tsx (re-rendered
// from `useState` — window / sort / expanded-source). It stays SSR-safe by taking its interactivity
// as OPTIONAL callback props (admin/CLAUDE.md rule 8 precedent: kit primitives' optional handlers):
// the SSR pass passes none (static pills), the island passes real ones. All data for every window
// is precomputed by `readInsights` and seeded via the `<script type="application/json">` props
// block, so the toggles re-render with no refetch (never a fetch-on-mount).

import type { Child } from "hono/jsx";
import { Layout } from "../ui/layout.js";
import { Badge } from "../ui/kit.js";
import { FlameIcon, HeartIcon, TrophyIcon, TrendingUpIcon, RssIcon, ChevronDownIcon, ArrowRightIcon } from "../ui/icons.js";
import {
  rankRows,
  type InsightsPayload,
  type InsightsRecipeRow,
  type InsightsSourceRow,
  type InsightsHeatmap,
  type InsightsTotals,
  type WindowKey,
  type SortKey,
} from "../../insights.js";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "cooks", label: "Times cooked" },
  { key: "favorites", label: "Favorites" },
];

/** The metric a row is currently ranked/scaled by. */
const metricOf = (row: { favorites: number; cooks: number }, sort: SortKey): number =>
  sort === "favorites" ? row.favorites : row.cooks;

const Metric = ({ icon, value, label, active }: { icon: Child; value: number; label: string; active: boolean }) => (
  <span class={active ? "ins-metric active" : "ins-metric"}>
    {icon}
    <span class="ins-metric-val">{value}</span>
    <span class="ins-metric-label">{label}</span>
  </span>
);

const Bar = ({ value, max, tone }: { value: number; max: number; tone: string }) => {
  const pct = max > 0 ? Math.max(value > 0 ? 4 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <div class="ins-bar">
      <span class={`ins-bar-fill ${tone}`} style={`width:${pct}%`} />
    </div>
  );
};

/** The trailing-53-week cooking-activity heatmap. Cells are precomputed (column-major, Sun→Sat);
 *  the only per-render decision is dimming days outside the selected window (`windowStart`). */
const Heatmap = ({
  heatmap,
  windowStart,
  totals,
  win,
}: {
  heatmap: InsightsHeatmap;
  windowStart: string;
  totals: InsightsTotals;
  win: WindowKey;
}) => (
  <div class="cal-wrap">
    <div class="cal-figure">
      <div class="cal-corner" />
      <div class="cal-months">
        {heatmap.months.map((m) => (
          <span class="cal-month" style={`grid-column: span ${m.span}`}>
            {m.label}
          </span>
        ))}
      </div>
      <div class="cal-days">
        <span />
        <span>Mon</span>
        <span />
        <span>Wed</span>
        <span />
        <span>Fri</span>
        <span />
      </div>
      <div class="cal-cells">
        {heatmap.cells.map((cell) => (
          <span
            class={`cal-cell lvl-${cell.level}${cell.date >= windowStart ? "" : " out"}`}
            title={`${cell.count} ${cell.count === 1 ? "cook" : "cooks"} · ${cell.date}`}
          />
        ))}
      </div>
    </div>
    <div class="cal-legend">
      <span class="muted small">
        {totals.cooks} cooks · {totals.activeDays} active days
        {win !== "all" ? " in window" : ""}
      </span>
      <span class="cal-scale">
        <span class="muted small">Less</span>
        <span class="cal-cell lvl-0" />
        <span class="cal-cell lvl-1" />
        <span class="cal-cell lvl-2" />
        <span class="cal-cell lvl-3" />
        <span class="cal-cell lvl-4" />
        <span class="muted small">More</span>
      </span>
    </div>
  </div>
);

const RecipeBoard = ({ recipes, sort }: { recipes: InsightsRecipeRow[]; sort: SortKey }) => {
  const tone = sort === "favorites" ? "fav" : "cook";
  const max = Math.max(1, ...recipes.map((r) => metricOf(r, sort)));
  const rows = rankRows(recipes, sort).slice(0, 12);
  if (rows.length === 0) return <p class="muted">No cooks or favorites logged yet.</p>;
  return (
    <div class="ins-board">
      {rows.map((r, i) => (
        <a class="ins-row clickable" href={`/admin/data/recipes/${encodeURIComponent(r.slug)}`}>
          <span class={"ins-rank" + (i < 3 ? " top" : "")}>{i + 1}</span>
          <div class="ins-main">
            <div class="ins-titlerow">
              <span class="ins-title">{r.title}</span>
              <span class="ins-sub muted">
                {r.cuisine ? `${r.cuisine} · ` : ""}
                {r.sourceName}
              </span>
            </div>
            <Bar value={metricOf(r, sort)} max={max} tone={tone} />
          </div>
          <div class="ins-metrics">
            <Metric icon={<HeartIcon size={13} />} value={r.favorites} label="favorited" active={sort === "favorites"} />
            <Metric icon={<FlameIcon size={13} />} value={r.cooks} label="cooked" active={sort === "cooks"} />
            <span class="ins-last muted small">last {r.lastCookedLabel}</span>
          </div>
        </a>
      ))}
    </div>
  );
};

const SourceBoard = ({
  sources,
  sort,
  openSource,
  onToggleSource,
  onFeedLink,
}: {
  sources: InsightsSourceRow[];
  sort: SortKey;
  openSource: string | null;
  onToggleSource?: (key: string) => void;
  onFeedLink?: () => void;
}) => {
  const tone = sort === "favorites" ? "fav" : "cook";
  const max = Math.max(1, ...sources.map((s) => metricOf(s, sort)));
  const rows = rankRows(sources, sort);
  if (rows.length === 0) return <p class="muted">No sources yet.</p>;
  return (
    <div class="ins-board">
      {rows.map((s, i) => {
        const isOpen = openSource === s.key;
        const recipes = rankRows(s.recipes, sort);
        return (
          <div class={"ins-source-wrap" + (isOpen ? " open" : "")}>
            <button
              type="button"
              class="ins-row ins-source clickable"
              aria-expanded={isOpen}
              onClick={onToggleSource ? () => onToggleSource(s.key) : undefined}
            >
              <span class={"ins-rank" + (i < 3 ? " top" : "")}>{i + 1}</span>
              <div class="ins-main">
                <div class="ins-titlerow">
                  <span class="ins-title">{s.name}</span>
                  {s.isMember ? (
                    <Badge variant="outline">authored in-group</Badge>
                  ) : s.isFeed ? (
                    <span class="ins-feed-tag" role="link" tabIndex={0} title="Open discovery feed config" onClick={onFeedLink}>
                      <RssIcon size={11} /> discovery feed
                    </span>
                  ) : (
                    <span class="ins-sub muted">{s.domain}</span>
                  )}
                  <span class="ins-count muted small">
                    {s.recipeCount} {s.recipeCount === 1 ? "recipe" : "recipes"}
                  </span>
                </div>
                <Bar value={metricOf(s, sort)} max={max} tone={tone} />
              </div>
              <div class="ins-metrics">
                <Metric icon={<HeartIcon size={13} />} value={s.favorites} label="favorited" active={sort === "favorites"} />
                <Metric icon={<FlameIcon size={13} />} value={s.cooks} label="cooked" active={sort === "cooks"} />
              </div>
              <span class={"ins-caret" + (isOpen ? " up" : "")}>
                <ChevronDownIcon size={16} />
              </span>
            </button>
            {isOpen ? (
              <div class="ins-sub-recipes">
                {recipes.map((r) => (
                  <a class="ins-subrecipe" href={`/admin/data/recipes/${encodeURIComponent(r.slug)}`}>
                    <span class="ins-subrecipe-title">{r.title}</span>
                    <span class="ins-subrecipe-cuisine muted small">{r.cuisine ?? ""}</span>
                    <span class="ins-subrecipe-metrics">
                      <span class="ins-submetric">
                        <HeartIcon size={12} />
                        {r.favorites}
                      </span>
                      <span class="ins-submetric">
                        <FlameIcon size={12} />
                        {r.cooks}
                      </span>
                    </span>
                    <span class="ins-subrecipe-go">
                      <ArrowRightIcon size={13} />
                    </span>
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

/** The Insights area's content — shared by the SSR first paint and the hydrated island. Its
 *  interactivity (window / sort pills, source expand, feed-tag link) is OPTIONAL callback props:
 *  SSR passes none (static default view), the island passes real handlers. */
export const InsightsView = ({
  payload,
  win,
  sort,
  openSource,
  onWin,
  onSort,
  onToggleSource,
  onFeedLink,
}: {
  payload: InsightsPayload;
  win: WindowKey;
  sort: SortKey;
  openSource: string | null;
  onWin?: (w: WindowKey) => void;
  onSort?: (s: SortKey) => void;
  onToggleSource?: (key: string) => void;
  onFeedLink?: () => void;
}) => {
  const view = payload.perWindow[win];
  const winLabel = payload.windows.find((w) => w.key === win)?.label ?? "All time";
  const topRecipe = rankRows(view.recipes, sort)[0];
  const topSource = rankRows(view.sources, sort)[0];
  const cards: { icon: Child; label: string; value: Child; small?: boolean }[] = [
    { icon: <FlameIcon size={15} />, label: "Cook events", value: view.totals.cooks },
    { icon: <HeartIcon size={15} />, label: "Favorites", value: view.totals.favorites },
    { icon: <TrophyIcon size={15} />, label: "Top recipe", value: topRecipe ? topRecipe.title : "—", small: true },
    { icon: <TrendingUpIcon size={15} />, label: "Top source", value: topSource ? topSource.name : "—", small: true },
  ];

  return (
    <div class="insights">
      <div class="area-head status-head">
        <div class="data-nav ins-window">
          {payload.windows.map((w) => (
            <button
              type="button"
              class={"pill" + (win === w.key ? " active" : "")}
              onClick={onWin ? () => onWin(w.key) : undefined}
            >
              {w.label}
            </button>
          ))}
        </div>
        <span class="muted small">Group activity · {winLabel.toLowerCase()}</span>
      </div>

      <div class="stat-grid">
        {cards.map((c) => (
          <div class="stat-card">
            <div class="stat-top">
              <span class="stat-ico">{c.icon}</span>
              <span class="stat-label">{c.label}</span>
            </div>
            <div class={"stat-value" + (c.small ? " stat-value-sm" : "")}>{c.value}</div>
          </div>
        ))}
      </div>

      <p class="group-label">Cooking activity</p>
      <Heatmap heatmap={payload.heatmap} windowStart={payload.windowStart[win]} totals={view.totals} win={win} />

      <div class="ins-sortbar ins-gap">
        <span class="ins-sort-label muted small">Rank by</span>
        <div class="data-nav ins-sort">
          {SORTS.map((s) => (
            <button
              type="button"
              class={"pill" + (sort === s.key ? " active" : "")}
              onClick={onSort ? () => onSort(s.key) : undefined}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <p class="group-label">Most popular recipes</p>
      <RecipeBoard recipes={view.recipes} sort={sort} />

      <p class="group-label ins-gap">Top sources</p>
      <SourceBoard sources={view.sources} sort={sort} openSource={openSource} onToggleSource={onToggleSource} onFeedLink={onFeedLink} />
    </div>
  );
};

/** Serialize the payload for the island props block (`<` escaped so it can't break out of the
 *  `<script>`). Mirrors pages/discovery.tsx's `serializeProps`. */
function serializeProps(payload: InsightsPayload): string {
  return JSON.stringify({ payload }).replace(/</g, "\\u003c");
}

/** The `/admin/insights` page shell: the dashboard SSR'd for first paint inside the island host,
 *  plus the island's hydration props + script. */
export const InsightsPage = ({ payload }: { payload: InsightsPayload }) => (
  <Layout title="Insights · grocery-agent admin" active="/admin/insights" wide>
    <div id="insights-island">
      <InsightsView payload={payload} win="all" sort="cooks" openSource={null} />
    </div>
    <script type="application/json" id="insights-props" dangerouslySetInnerHTML={{ __html: serializeProps(payload) }} />
    <script type="module" src="/admin/islands/insights.js" />
  </Layout>
);
