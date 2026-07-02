/* Data › Recipes — the cross-tier recipe explorer. A searchable, paginated list
   (keyword, or hybrid semantic+keyword) over the corpus, and a clicked-through
   detail view that assembles every tier for one slug: the AI-derived description,
   the index/embedding pipeline state, the rendered markdown body, attributed
   notes, a pretty render of the R2 frontmatter and the D1 index row, and a
   collapsible raw-markdown panel. Reads GA.recipes + GA.recipesApi. */
function RecipesScreen({ onDetailChange, openSlug }) {
  const { Item, ItemGroup, Badge, Button, Input } = window.DesignSystem_959bdd;
  const I = window.GA.icons;
  const api = window.GA.recipesApi;
  const RecipeDetail = window.GA.RecipeDetail;
  const ListFooter = window.GA.ListFooter;

  const [query, setQuery] = React.useState("");
  const [mode, setMode] = React.useState("keyword");
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(25);
  const [selected, setSelected] = React.useState(null);
  React.useEffect(() => { if (onDetailChange) onDetailChange(!!selected); }, [selected]);
  React.useEffect(() => { if (openSlug && openSlug.slug) setSelected(openSlug.slug); }, [openSlug]);

  const PAGE = pageSize;
  const results = React.useMemo(() => api.searchRecipes(query, mode), [query, mode]);
  React.useEffect(() => { setPage(0); }, [query, mode]);

  const STATUS = {
    indexed: { dot: "ok", variant: "secondary", word: "indexed" },
    skipped: { dot: "fail", variant: "destructive", word: "skipped" },
    pending: { dot: "never", variant: "outline", word: "pending" },
    orphaned: { dot: "muted", variant: "outline", word: "orphaned" },
  };

  if (selected) {
    const r = window.GA.recipes.find((x) => x.slug === selected);
    return <RecipeDetail r={r} onBack={() => setSelected(null)} />;
  }

  const pages = Math.max(1, Math.ceil(results.length / PAGE));
  const pg = Math.min(page, pages - 1);
  const shown = results.slice(pg * PAGE, pg * PAGE + PAGE);

  function facetChips(r) {
    const items = [r.protein, r.cuisine, `${r.time} min`].filter(Boolean);
    return (
      <span className="rfacets">
        {items.map((f, i) => <span className="rfacet" key={i}>{f}</span>)}
      </span>
    );
  }

  return (
    <div className="recipes">
      <div className="recipe-toolbar">
        <div className="recipe-search">
          <I.search size={15} />
          <input
            className="recipe-search-input"
            type="text"
            placeholder="Search recipes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && <button className="recipe-search-clear" onClick={() => setQuery("")} aria-label="Clear"><I.xCircle size={15} /></button>}
        </div>
        <div className="seg" role="tablist" aria-label="Search mode">
          <button className={"seg-btn" + (mode === "keyword" ? " active" : "")} onClick={() => setMode("keyword")}>Keyword</button>
          <button className={"seg-btn" + (mode === "hybrid" ? " active" : "")} onClick={() => setMode("hybrid")}>Hybrid</button>
        </div>
      </div>

      <p className="recipe-hint muted small">
        {results.length} {results.length === 1 ? "recipe" : "recipes"}
        {query && mode === "hybrid" && " · ranked by relevance — hybrid surfaces semantically-related dishes"}
        {query && mode === "keyword" && " · keyword match over indexed metadata"}
        {!query && " in the corpus and index"}
      </p>

      {shown.length === 0 ? (
        <p className="muted">No recipes match “{query}”. {mode === "keyword" && "Try Hybrid for related dishes."}</p>
      ) : (
        <ItemGroup className="recipe-list">
          {shown.map(({ r, score, semantic }) => {
            const st = STATUS[r.status];
            return (
              <Item
                key={r.slug}
                variant="outline"
                className="recipe-item"
                onClick={() => setSelected(r.slug)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter") setSelected(r.slug); }}
                media={<span className={"rdot dot " + st.dot} />}
                title={
                  <span className="rtitle">
                    {r.title}
                    {semantic && <span className="rsem" title="Surfaced semantically">semantic</span>}
                  </span>
                }
                actions={
                  <div className="ritem-trail">
                    {score != null && (
                      <span className="relbar" title={`relevance ${(score * 100).toFixed(0)}%`}>
                        <span className="relbar-fill" style={{ width: Math.round(score * 100) + "%" }} />
                      </span>
                    )}
                    <Badge variant={st.variant}>{st.word}</Badge>
                    <I.chevronRight size={16} className="rchev" />
                  </div>
                }
              >
                <div className="rsub">
                  <span className="rslug">{r.slug}</span>
                  {facetChips(r)}
                </div>
              </Item>
            );
          })}
        </ItemGroup>
      )}

      {results.length > 0 && (
        <ListFooter
          page={pg}
          pageSize={pageSize}
          total={results.length}
          onPage={setPage}
          onPageSize={(n) => { setPageSize(n); setPage(0); }}
          noun="recipe"
        />
      )}
    </div>
  );
}
window.GA = window.GA || {};
window.GA.RecipesScreen = RecipesScreen;
