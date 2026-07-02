/* Data › Stores — the shared store registry. A list of stores, each clicking
   through to identity (chain/label/address/location_id), its Kroger SKU cache
   (only for Kroger-chain locations), and its attributed store notes grouped by
   the tag convention (layout / location / stock / general). Reads GA.stores. */
function StoreDetail({ s, onBack }) {
  const { Badge, Table } = window.DesignSystem_959bdd;
  const I = window.GA.icons;
  const api = window.GA.storesApi;
  const PrettyKV = window.GA.PrettyKV;

  const identity = { chain: s.chain, label: s.label, domain: s.domain, address: s.address, location_id: s.location_id };

  const groups = { layout: [], location: [], stock: [], general: [] };
  s.notes.forEach((n) => { const t = n.tags[0] || "general"; (groups[t] || groups.general).push(n); });
  const GROUP_LABEL = { layout: "Layout", location: "Where-it-hides", stock: "Stock", general: "General" };

  return (
    <div className="recipe-detail">
      <button className="link-action rd-back" onClick={onBack}><I.chevronLeft size={15} /> All stores</button>

      <div className="rd-head">
        <div>
          <h2 className="rd-title">{s.name}</h2>
          <div className="rd-slug">{s.slug}</div>
        </div>
        <Badge variant="secondary">{s.chain}</Badge>
      </div>

      <p className="group-label">Identity</p>
      <div className="card"><section><PrettyKV obj={identity} /></section></div>

      <p className="group-label">Cached SKUs <span className="muted small">sku_cache · location {s.location_id || "—"}</span></p>
      {s.skus.length > 0 ? (
        <div className="card usage-card"><section>
          <Table
            columns={["Ingredient", { key: "brand", label: "Brand" }, { key: "size", label: "Size", align: "right" }, { key: "sku", label: "SKU" }, { key: "last_used", label: "Last used", align: "right" }]}
            rows={s.skus.map((k) => ({
              Ingredient: k.ingredient,
              brand: k.brand,
              size: k.size,
              sku: <span className="sku-code">{k.sku}</span>,
              last_used: <span className="muted small">{k.last_used}</span>,
            }))}
          />
        </section></div>
      ) : (
        <p className="muted" style={{ marginTop: 0 }}>No cached SKUs — {s.location_id ? "none looked up yet at this location." : "not a Kroger location, so SKU lookups don't apply here."}</p>
      )}

      <p className="group-label">Store notes <span className="muted small">({s.notes.length})</span></p>
      {["layout", "location", "stock", "general"].map((g) => groups[g].length === 0 ? null : (
        <div className="store-note-group" key={g}>
          <div className="store-note-label">{GROUP_LABEL[g]}</div>
          <div className="rd-notes">
            {groups[g].map((n, i) => (
              <div className="rd-note" key={i}>
                <div className="rd-note-head">
                  <span className="rd-note-author">@{n.author}</span>
                  {n.private && <Badge variant="outline">private</Badge>}
                  {n.tags.map((t) => <span className="rfacet" key={t}>{t}</span>)}
                  <span className="rd-note-time muted small">{api.relAge(n.at)}</span>
                </div>
                <div className="rd-note-body">{n.body}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function StoresScreen({ onDetailChange }) {
  const { Item, ItemGroup, Badge } = window.DesignSystem_959bdd;
  const I = window.GA.icons;
  const [selected, setSelected] = React.useState(null);
  React.useEffect(() => { if (onDetailChange) onDetailChange(!!selected); }, [selected]);

  if (selected) {
    const s = window.GA.stores.find((x) => x.slug === selected);
    if (s) return <StoreDetail s={s} onBack={() => setSelected(null)} />;
  }

  return (
    <>
      <p className="recipe-hint muted small">{window.GA.stores.length} stores in the shared registry</p>
      <ItemGroup className="recipe-list">
        {window.GA.stores.map((s) => (
          <Item
            key={s.slug}
            variant="outline"
            className="recipe-item"
            onClick={() => setSelected(s.slug)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter") setSelected(s.slug); }}
            media={<span className="store-ico"><I.store /></span>}
            title={<span className="rtitle">{s.name}</span>}
            actions={
              <div className="ritem-trail">
                <Badge variant="secondary">{s.chain}</Badge>
                <I.chevronRight size={16} className="rchev" />
              </div>
            }
          >
            <div className="rsub">
              <span className="rslug">{s.slug}</span>
              <span className="rfacets">
                <span className="rfacet">{s.domain}</span>
                <span className="rfacet">{s.notes.length} notes</span>
                {s.skus.length > 0 && <span className="rfacet">{s.skus.length} SKUs</span>}
              </span>
            </div>
          </Item>
        ))}
      </ItemGroup>
    </>
  );
}
window.GA = window.GA || {};
window.GA.StoresScreen = StoresScreen;
