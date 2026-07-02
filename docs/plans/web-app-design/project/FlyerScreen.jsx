/* Data › Flyer — the current weekly Kroger flyer, per store, as pulled and
   embedded by the flyer-warm job. Pick a Kroger location, then browse its live
   circular: search + category filter over the deals, each row showing the sale
   price, the markdown-off regular price, the discount, and any taste match
   (members whose vector is near the item, recipes that use it). Clicking a deal
   opens its detail — the cached identity plus who/what it matched. Non-Kroger
   stores have no circular API, so they don't appear here. Reads GA.flyer. */
function FlyerScreen({ onDetailChange }) {
  const { Item, ItemGroup, Badge, Select } = window.DesignSystem_959bdd;
  const I = window.GA.icons;
  const F = window.GA.flyer;
  const PrettyKV = window.GA.PrettyKV;
  const ListFooter = window.GA.ListFooter;

  const [storeSlug, setStoreSlug] = React.useState(F.stores[0].slug);
  const [query, setQuery] = React.useState("");
  const [cat, setCat] = React.useState("All");
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(25);
  const [selected, setSelected] = React.useState(null);
  React.useEffect(() => { if (onDetailChange) onDetailChange(!!selected); }, [selected]);
  React.useEffect(() => { setPage(0); }, [query, cat, storeSlug]);

  const store = F.stores.find((s) => s.slug === storeSlug);

  function switchStore(slug) { setSelected(null); setStoreSlug(slug); setQuery(""); setCat("All"); }

  // ── Deal detail ──────────────────────────────────────────────────────────
  if (selected) {
    const d = store.items.find((x) => x.id === selected);
    if (d) {
      const identity = {
        sku: d.sku || "\u2014",
        category: d.category,
        unit: d.unit,
        regular_price: F.money(d.reg),
        sale_price: F.money(d.sale),
        discount: Math.round(d.discount * 100) + "%",
        flyer_term: d.term || "\u2014",
        valid_through: F.fmtDate(store.validTo),
      };
      return (
        <div className="recipe-detail">
          <button className="link-action rd-back" onClick={() => setSelected(null)}><I.chevronLeft size={15} /> All deals</button>

          <div className="rd-head">
            <div>
              <h2 className="rd-title">{d.name}</h2>
              <div className="rd-slug">{d.brand} · {store.name}</div>
            </div>
            <Badge variant="secondary">{d.category}</Badge>
          </div>

          <div className="fl-hero card"><section>
            <div className="fl-hero-price">
              <span className="fl-sale">{F.money(d.sale)}</span>
              <span className="fl-was">{F.money(d.reg)}</span>
              <span className="fl-unit muted small">{d.unit}</span>
            </div>
            <div className="fl-hero-trail">
              {d.tag && <span className={"fl-tag " + (d.tag === "mega deal" ? "hot" : "")}>{d.tag}</span>}
              <Badge variant="destructive">{Math.round(d.discount * 100)}% off</Badge>
              <span className="muted small">valid through {F.fmtDate(store.validTo)}</span>
            </div>
          </section></div>

          <p className="group-label">Flyer entry <span className="muted small">flyer_cache · location {store.location_id}</span></p>
          <div className="card"><section><PrettyKV obj={identity} /></section></div>

          <p className="group-label">Taste match</p>
          {d.members.length === 0 && d.recipes.length === 0 ? (
            <p className="muted" style={{ marginTop: 0 }}>No taste match — surfaced by the flyer term “{d.term}”, but no member vector cleared the threshold this week.</p>
          ) : (
            <div className="fl-match">
              {d.members.length > 0 && (
                <div className="fl-match-block">
                  <div className="fl-match-label">Members ({d.members.length})</div>
                  <div className="fl-members">
                    {d.members.map((m) => (
                      <div className="fl-member" key={m.tenant}>
                        <span className="fl-member-name">@{m.tenant}</span>
                        <span className="relbar" title={`cosine ${(m.score * 100).toFixed(0)}%`}>
                          <span className="relbar-fill" style={{ width: Math.round(m.score * 100) + "%" }} />
                        </span>
                        <span className="muted small">{(m.score).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {d.recipes.length > 0 && (
                <div className="fl-match-block">
                  <div className="fl-match-label">Recipes ({d.recipes.length})</div>
                  <div className="fl-recipes">
                    {d.recipes.map((slug) => (
                      <button className="fl-recipe" key={slug} onClick={() => window.GA.openRecipe && window.GA.openRecipe(slug)}>
                        <I.utensils size={14} />
                        <span className="fl-recipe-slug">{slug}</span>
                        <I.chevronRight size={14} className="rchev" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      );
    }
  }

  // ── Deal list ──────────────────────────────────────────────────────────
  const filtered = store.items.filter((d) => {
    if (cat !== "All" && d.category !== cat) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return d.name.toLowerCase().includes(q) || d.brand.toLowerCase().includes(q) || (d.term || "").toLowerCase().includes(q);
  });

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pg = Math.min(page, pages - 1);
  const shown = filtered.slice(pg * pageSize, pg * pageSize + pageSize);

  const catsPresent = ["All", ...F.categories.filter((c) => store.items.some((d) => d.category === c))];

  return (
    <div className="recipes flyer">
      <div className="fl-storebar">
        <div className="seg" role="tablist" aria-label="Store">
          {F.stores.map((s) => (
            <button key={s.slug} className={"seg-btn" + (s.slug === storeSlug ? " active" : "")} onClick={() => switchStore(s.slug)}>{s.name}</button>
          ))}
        </div>
        <div className="fl-window muted small">
          <I.calendar size={14} /> {F.fmtDate(store.validFrom)}–{F.fmtDate(store.validTo)}
          <span className="dimsep">·</span> warmed {F.relAge(store.warmedAt)}
        </div>
      </div>

      <div className="fl-statline">
        <span><strong>{store.stats.total}</strong> deals</span>
        <span className="dimsep">·</span>
        <span><strong>{store.stats.matched}</strong> taste-matched</span>
        <span className="dimsep">·</span>
        <span><strong>{store.stats.termHits}</strong> on flyer terms</span>
        <span className="dimsep">·</span>
        <span>best <strong>{Math.round(store.stats.bestDiscount * 100)}%</strong> off</span>
      </div>

      <div className="recipe-toolbar">
        <div className="recipe-search">
          <I.search size={15} />
          <input
            className="recipe-search-input"
            type="text"
            placeholder="Search deals…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && <button className="recipe-search-clear" onClick={() => setQuery("")} aria-label="Clear"><I.xCircle size={15} /></button>}
        </div>
        <label className="fl-catsel">
          <span className="muted small">Category</span>
          <Select size="sm" value={cat} onChange={(e) => setCat(e.target.value)} options={catsPresent} />
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="muted">No deals match “{query}”{cat !== "All" ? ` in ${cat}` : ""}.</p>
      ) : (
        <ItemGroup className="recipe-list">
          {shown.map((d) => {
            const matched = d.members.length > 0 || d.recipes.length > 0;
            return (
              <Item
                key={d.id}
                variant="outline"
                className="recipe-item fl-item"
                onClick={() => setSelected(d.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter") setSelected(d.id); }}
                media={
                  <span className="fl-price">
                    <span className="fl-sale-sm">{F.money(d.sale)}</span>
                    <span className="fl-was-sm">{F.money(d.reg)}</span>
                  </span>
                }
                title={
                  <span className="rtitle">
                    {d.name}
                    {d.tag && <span className={"fl-tag " + (d.tag === "mega deal" ? "hot" : "")}>{d.tag}</span>}
                  </span>
                }
                actions={
                  <div className="ritem-trail">
                    <Badge variant="destructive">{Math.round(d.discount * 100)}% off</Badge>
                    <I.chevronRight size={16} className="rchev" />
                  </div>
                }
              >
                <div className="rsub">
                  <span className="rslug">{d.brand} · {d.unit}</span>
                  <span className="rfacets">
                    <span className="rfacet">{d.category}</span>
                    {d.term && <span className="rfacet">term: {d.term}</span>}
                    {matched && (
                      <span className="fl-match-chip" title="Taste-matched this week">
                        <I.sparkles size={12} />
                        {d.members.length > 0 && `${d.members.length} ${d.members.length === 1 ? "member" : "members"}`}
                        {d.members.length > 0 && d.recipes.length > 0 && " · "}
                        {d.recipes.length > 0 && `${d.recipes.length} ${d.recipes.length === 1 ? "recipe" : "recipes"}`}
                      </span>
                    )}
                  </span>
                </div>
              </Item>
            );
          })}
        </ItemGroup>
      )}

      {filtered.length > 0 && (
        <ListFooter
          page={pg}
          pageSize={pageSize}
          total={filtered.length}
          onPage={setPage}
          onPageSize={(n) => { setPageSize(n); setPage(0); }}
          noun="deal"
        />
      )}
    </div>
  );
}
window.GA = window.GA || {};
window.GA.FlyerScreen = FlyerScreen;
