/* Insights — group popularity over the recipe corpus. A window toggle
   (All time · Year · Month · Week) scopes the whole page: the summary tiles, a
   GitHub-style cooking-activity heatmap (trailing year, with out-of-window days
   dimmed), and two leaderboards (recipes, sources) ranked by favorites, times
   cooked, or a combined score. Recipe rows deep-link to Data › Recipes; feed
   sources link to the discovery feed config. Reads GA.insights. */
function InsightsScreen() {
  const { Badge } = window.DesignSystem_959bdd;
  const I = window.GA.icons;
  const D = window.GA.insights;
  const [win, setWin] = React.useState("all");
  const [sort, setSort] = React.useState("cooks");
  const [openSource, setOpenSource] = React.useState(null);

  const SORTS = [
    { key: "cooks", label: "Times cooked" },
    { key: "favorites", label: "Favorites" },
  ];

  const recipeData = D.recipeRowsForWindow(win);
  const sourceData = D.sourceRowsForWindow(win);
  const totals = D.totalsForWindow(win);
  const winLabel = D.windows.find((w) => w.key === win).label;

  function rank(rows) {
    return [...rows].sort((a, b) => (b[sort] !== a[sort] ? b[sort] - a[sort] : b.combined - a.combined));
  }
  const metricMax = (which) => ({
    favorites: which.maxFav, cooks: which.maxCook,
  })[sort];
  const barValue = (row) => row[sort];
  const tone = sort === "favorites" ? "fav" : "cook";

  function Metric({ icon, value, label, active }) {
    return (
      <span className={"ins-metric" + (active ? " active" : "")}>
        {icon}<span className="ins-metric-val">{value}</span><span className="ins-metric-label">{label}</span>
      </span>
    );
  }
  function Bar({ value, max }) {
    const pct = max > 0 ? Math.max(value > 0 ? 4 : 0, Math.round((value / max) * 100)) : 0;
    return <div className="ins-bar"><span className={"ins-bar-fill " + tone} style={{ width: pct + "%" }} /></div>;
  }

  // ── GitHub-style cooking-activity heatmap (trailing 53 weeks) ──
  function Heatmap() {
    const WEEKS = 53;
    const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const end = D.today0;
    const endDow = new Date(end).getDay();
    const gridEnd = end + (6 - endDow) * D.DAY;          // Saturday of this week
    const gridStart = gridEnd - (WEEKS * 7 - 1) * D.DAY; // Sunday, 53 weeks back
    const level = (c) => (c === 0 ? 0 : c === 1 ? 1 : c === 2 ? 2 : c <= 4 ? 3 : 4);

    // Cells in column-major order (week by week, each week Sun→Sat). Future days
    // (past today) are omitted entirely — they're the tail of the final column.
    const cells = [];
    for (let c = 0; c < WEEKS; c++) {
      for (let r = 0; r < 7; r++) {
        const at = gridStart + (c * 7 + r) * D.DAY;
        if (at > end) continue;
        const count = D.countOnDay(at);
        const d = new Date(at);
        cells.push({
          key: c + "-" + r,
          lvl: level(count),
          inWin: D.inWindow(at, win),
          title: `${count} ${count === 1 ? "cook" : "cooks"} · ${DOW[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`,
        });
      }
    }

    // Month header segments — group consecutive week-columns by month, each header
    // spans exactly its weeks so labels stay locked to the columns below.
    const segs = [];
    for (let c = 0; c < WEEKS; c++) {
      const m = new Date(gridStart + (c * 7 + 3) * D.DAY).getMonth(); // mid-week month
      const last = segs[segs.length - 1];
      if (last && last.m === m) last.span += 1;
      else segs.push({ m, span: 1 });
    }

    return (
      <div className="cal-wrap">
        <div className="cal-figure">
          <div className="cal-corner" />
          <div className="cal-months">
            {segs.map((s, i) => (
              <span className="cal-month" style={{ gridColumn: "span " + s.span }} key={i}>
                {s.span >= 2 || i > 0 ? MON[s.m] : ""}
              </span>
            ))}
          </div>
          <div className="cal-days">
            <span /><span>Mon</span><span /><span>Wed</span><span /><span>Fri</span><span />
          </div>
          <div className="cal-cells">
            {cells.map((cell) => (
              <span key={cell.key} className={"cal-cell lvl-" + cell.lvl + (cell.inWin ? "" : " out")} title={cell.title} />
            ))}
          </div>
        </div>
        <div className="cal-legend">
          <span className="muted small">{totals.cooks} cooks · {totals.activeDays} active days{win !== "all" && win !== "year" ? " in window" : ""}</span>
          <span className="cal-scale">
            <span className="muted small">Less</span>
            <span className="cal-cell lvl-0" /><span className="cal-cell lvl-1" /><span className="cal-cell lvl-2" /><span className="cal-cell lvl-3" /><span className="cal-cell lvl-4" />
            <span className="muted small">More</span>
          </span>
        </div>
      </div>
    );
  }

  function RecipeBoard() {
    const rows = rank(recipeData.rows).slice(0, 12);
    return (
      <div className="ins-board">
        {rows.map((r, i) => (
          <button className="ins-row" key={r.slug} onClick={() => window.GA.openRecipe && window.GA.openRecipe(r.slug)}>
            <span className={"ins-rank" + (i < 3 ? " top" : "")}>{i + 1}</span>
            <div className="ins-main">
              <div className="ins-titlerow">
                <span className="ins-title">{r.title}</span>
                <span className="ins-sub muted">{r.cuisine} · {r.sourceName}</span>
              </div>
              <Bar value={barValue(r)} max={metricMax(recipeData)} />
            </div>
            <div className="ins-metrics">
              <Metric icon={<I.heart size={13} />} value={r.favorites} label="favorited" active={sort === "favorites"} />
              <Metric icon={<I.flame size={13} />} value={r.cooks} label="cooked" active={sort === "cooks"} />
              <span className="ins-last muted small">last {D.relAge(r.lastCookedAt)}</span>
            </div>
          </button>
        ))}
      </div>
    );
  }

  function SourceBoard() {
    const rows = rank(sourceData.rows);
    return (
      <div className="ins-board">
        {rows.map((s, i) => {
          const isOpen = openSource === s.key;
          const recipes = rank(s.recipes || []);
          return (
            <div className={"ins-source-wrap" + (isOpen ? " open" : "")} key={s.key}>
              <button
                className="ins-row ins-source clickable"
                aria-expanded={isOpen}
                onClick={() => setOpenSource(isOpen ? null : s.key)}
              >
                <span className={"ins-rank" + (i < 3 ? " top" : "")}>{i + 1}</span>
                <div className="ins-main">
                  <div className="ins-titlerow">
                    <span className="ins-title">{s.name}</span>
                    {s.isMember
                      ? <Badge variant="outline">authored in-group</Badge>
                      : s.isFeed
                        ? <span className="ins-feed-tag" role="link" tabIndex={0} title="Open discovery feed config"
                            onClick={(e) => { e.stopPropagation(); window.GA.openConfigFeeds && window.GA.openConfigFeeds(); }}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); window.GA.openConfigFeeds && window.GA.openConfigFeeds(); } }}>
                            <I.rss size={11} /> discovery feed</span>
                        : <span className="ins-sub muted">{s.domain}</span>}
                    <span className="ins-count muted small">{s.recipeCount} {s.recipeCount === 1 ? "recipe" : "recipes"}</span>
                  </div>
                  <Bar value={barValue(s)} max={metricMax(sourceData)} />
                </div>
                <div className="ins-metrics">
                  <Metric icon={<I.heart size={13} />} value={s.favorites} label="favorited" active={sort === "favorites"} />
                  <Metric icon={<I.flame size={13} />} value={s.cooks} label="cooked" active={sort === "cooks"} />
                </div>
                <I.chevron size={16} className={"ins-caret" + (isOpen ? " up" : "")} />
              </button>
              {isOpen && (
                <div className="ins-sub-recipes">
                  {recipes.map((r) => (
                    <button className="ins-subrecipe" key={r.slug} onClick={() => window.GA.openRecipe && window.GA.openRecipe(r.slug)}>
                      <span className="ins-subrecipe-title">{r.title}</span>
                      <span className="ins-subrecipe-cuisine muted small">{r.cuisine}</span>
                      <span className="ins-subrecipe-metrics">
                        <span className="ins-submetric"><I.heart size={12} />{r.favorites}</span>
                        <span className="ins-submetric"><I.flame size={12} />{r.cooks}</span>
                      </span>
                      <I.arrowRight size={13} className="ins-subrecipe-go" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  const topRecipe = rank(recipeData.rows)[0];
  const topSource = rank(sourceData.rows)[0];
  const cards = [
    { icon: <I.flame />, label: "Cook events", value: totals.cooks },
    { icon: <I.heart />, label: "Favorites", value: totals.favorites },
    { icon: <I.trophy />, label: "Top recipe", value: topRecipe ? topRecipe.title : "—", small: true },
    { icon: <I.trendingUp />, label: "Top source", value: topSource ? topSource.name : "—", small: true },
  ];

  return (
    <div className="insights">
      <div className="area-head status-head">
        <div className="data-nav ins-window">
          {D.windows.map((w) => (
            <button key={w.key} className={"pill" + (win === w.key ? " active" : "")} onClick={() => setWin(w.key)}>{w.label}</button>
          ))}
        </div>
        <span className="muted small">Group activity · {winLabel.toLowerCase()}</span>
      </div>

      <div className="stat-grid">
        {cards.map((c) => (
          <div className="stat-card" key={c.label}>
            <div className="stat-top">
              <span className="stat-ico">{c.icon}</span>
              <span className="stat-label">{c.label}</span>
            </div>
            <div className={"stat-value" + (c.small ? " stat-value-sm" : "")}>{c.value}</div>
          </div>
        ))}
      </div>

      <p className="group-label">Cooking activity</p>
      <Heatmap />

      <div className="ins-sortbar ins-gap">
        <span className="ins-sort-label muted small">Rank by</span>
        <div className="data-nav ins-sort">
          {SORTS.map((s) => (
            <button key={s.key} className={"pill" + (sort === s.key ? " active" : "")} onClick={() => setSort(s.key)}>{s.label}</button>
          ))}
        </div>
      </div>

      <p className="group-label">Most popular recipes</p>
      <RecipeBoard />

      <p className="group-label ins-gap">Top sources</p>
      <SourceBoard />
    </div>
  );
}
window.GA = window.GA || {};
window.GA.InsightsScreen = InsightsScreen;
