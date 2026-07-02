/* Normalization › Nodes — a fourth lens on the identity graph. A browsable list
   of canonical nodes opens a relationship detail: what a node IS (base/detail ·
   concrete-vs-concept · aliases · representative) and its directed "satisfies"
   edges laid on one left-to-right axis — what SATISFIES it (incoming) on the
   left, what IT satisfies (outgoing) on the right. Orphans (edgeless concrete
   nodes) are filterable — the operator's main under-connection signal — and can
   be LINKED: a manual, human-pinned edge editor closes the loop from audit to
   fix. Reads GA.nodes; edges are live state so links reflect immediately. */

/* Derive per-node adjacency from a live edge list ("from satisfies to"). */
function buildGraph(NG, edges) {
  const outMap = {}, inMap = {};
  NG.list.forEach((n) => { outMap[n.id] = []; inMap[n.id] = []; });
  edges.forEach((e) => {
    if (outMap[e.from]) outMap[e.from].push({ id: e.to, kind: e.kind, human: e.human });
    if (inMap[e.to]) inMap[e.to].push({ id: e.from, kind: e.kind, human: e.human });
  });
  const deg = (id) => (outMap[id] ? outMap[id].length : 0) + (inMap[id] ? inMap[id].length : 0);
  return {
    outgoing: (id) => outMap[id] || [],
    incoming: (id) => inMap[id] || [],
    degree: deg,
    isOrphan: (n) => n.concrete && !n.rep && deg(n.id) === 0,
  };
}

function NodesTab({ NZ, I, target, onClearTarget }) {
  const NG = window.GA.nodes;
  const [selId, setSelId] = React.useState(null);
  const [edges, setEdges] = React.useState(NG.edges);
  const [flashEdge, setFlashEdge] = React.useState(null);

  const G = React.useMemo(() => buildGraph(NG, edges), [edges]);

  function addEdge({ from, to, kind }) {
    setEdges((prev) => prev.some((e) => e.from === from && e.to === to) ? prev : [...prev, { from, to, kind, human: true }]);
    setFlashEdge(from + "\u2192" + to);
    setTimeout(() => setFlashEdge((f) => f === from + "\u2192" + to ? null : f), 2200);
  }
  function removeEdge(from, to) {
    setEdges((prev) => prev.filter((e) => !(e.from === from && e.to === to && e.human)));
  }

  // Deep-link in from an alias / decision row.
  React.useEffect(() => {
    if (target && NG.byId[target.id]) { setSelId(target.id); onClearTarget && onClearTarget(); }
  }, [target]);

  if (selId && NG.byId[selId]) {
    return <NodeDetail node={NG.byId[selId]} NG={NG} G={G} I={I} flashEdge={flashEdge}
      onAddEdge={addEdge} onRemoveEdge={removeEdge} onBack={() => setSelId(null)} onOpen={setSelId} />;
  }
  return <NodeList NG={NG} G={G} I={I} onOpen={setSelId} />;
}

/* ── Browsable node list ─────────────────────────────────────────────── */
function NodeList({ NG, G, I, onOpen }) {
  const ResolvedId = window.GA.ResolvedId;
  const [q, setQ] = React.useState("");
  const [facet, setFacet] = React.useState("all");
  const [sort, setSort] = React.useState("az"); // az | degree
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(25);

  const FACETS = [
    { key: "all", label: "All", test: () => true },
    { key: "base", label: "Bases", test: (n) => n.concrete && !n.detail && !n.rep },
    { key: "detail", label: "Specializations", test: (n) => !!n.detail },
    { key: "concept", label: "Concepts", test: (n) => n.concept },
    { key: "orphan", label: "Orphans", test: (n) => G.isOrphan(n) },
  ];
  const facetCount = (k) => NG.list.filter(FACETS.find((f) => f.key === k).test).length;

  const needle = q.trim().toLowerCase();
  let rows = NG.list.filter((n) => {
    if (!FACETS.find((f) => f.key === facet).test(n)) return false;
    if (!needle) return true;
    return (n.id + " " + n.aliases.join(" ")).toLowerCase().includes(needle);
  });
  rows = rows.slice().sort((a, b) =>
    sort === "degree" ? G.degree(a.id) - G.degree(b.id) || a.id.localeCompare(b.id)
                      : a.id.localeCompare(b.id));

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pg = Math.min(page, pages - 1);
  const shown = rows.slice(pg * pageSize, pg * pageSize + pageSize);

  function switchFacet(k) { setFacet(k); setPage(0); }

  return (
    <div className="nodes">
      <p className="nz-queue-blurb muted small">
        Every canonical node in the identity graph — <code>base</code> or <code>base::detail</code>,
        concrete products and abstract concept classes — with its directed satisfies-edges. Pick a node
        to audit what it is and how it’s connected, or link an under-connected one. Edgeless concrete
        nodes surface under
        <button className="ng-inline-filter" onClick={() => switchFacet("orphan")}> Orphans</button>.
      </p>

      <div className="nz-al-toolbar">
        <div className="recipe-search nz-al-search">
          <I.search size={15} />
          <input className="recipe-search-input" type="text" placeholder="Filter nodes or aliases…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
          {q && <button className="recipe-search-clear" onClick={() => setQ("")} aria-label="Clear"><I.xCircle size={15} /></button>}
        </div>
        <div className="seg ng-sort">
          <button className={"seg-btn" + (sort === "az" ? " active" : "")} onClick={() => setSort("az")}>A–Z</button>
          <button className={"seg-btn" + (sort === "degree" ? " active" : "")} onClick={() => setSort("degree")}>Least linked</button>
        </div>
      </div>

      <div className="data-nav dc-filters ng-facets">
        {FACETS.map((f) => {
          const n = facetCount(f.key);
          return (
            <button key={f.key} className={"pill" + (f.key === "orphan" ? " ng-pill-orphan" : "") + (facet === f.key ? " active" : "")}
              onClick={() => switchFacet(f.key)} disabled={n === 0 && f.key !== "all"}>
              {f.key === "orphan" && <I.alert size={12} className="ng-facet-ico" />}{f.label}{n > 0 ? <span className="pill-count">{n}</span> : null}
            </button>);
        })}
      </div>

      <div className="ng-list">
        {shown.map((n) => {
          const orphan = G.isOrphan(n);
          const inc = G.incoming(n.id).length, out = G.outgoing(n.id).length;
          return (
            <button className={"ng-row" + (orphan ? " orphan" : "")} key={n.id} onClick={() => onOpen(n.id)}>
              <span className={"ng-row-glyph" + (n.concept ? " concept" : orphan ? " orphan" : "")}>
                {n.concept ? <I.layers size={15} /> : n.rep ? <I.gitMerge size={15} /> : <I.target size={15} />}
              </span>
              <span className="ng-row-main">
                <span className="ng-row-id"><ResolvedId base={n.base} detail={n.detail} concept={n.concept} /></span>
                <span className="ng-row-sub">
                  <span className="ng-row-kind">{n.concept ? "concept class" : n.detail ? "specialization" : "base"}</span>
                  <span className="dimsep">·</span>
                  <span>{n.aliases.length} {n.aliases.length === 1 ? "alias" : "aliases"}</span>
                  {n.rep && <><span className="dimsep">·</span><span className="ng-row-merged"><I.gitMerge size={11} /> merged → <code>{n.rep}</code></span></>}
                </span>
              </span>
              <span className="ng-row-trail">
                {orphan ? (
                  <span className="ng-orphan-chip"><I.alert size={11} /> orphan</span>
                ) : (
                  <span className="ng-deg">
                    <span className="ng-deg-part" title="satisfied by (incoming)"><I.chevronRight size={12} className="ng-deg-in" />{inc}</span>
                    <span className="ng-deg-part" title="satisfies (outgoing)">{out}<I.chevronRight size={12} className="ng-deg-out" /></span>
                  </span>
                )}
                <I.chevronRight size={16} className="ng-row-chev" />
              </span>
            </button>);
        })}
        {shown.length === 0 && <p className="nz-al-empty muted small">No nodes match this filter.</p>}
      </div>

      {rows.length > 0 &&
        <window.GA.ListFooter page={pg} pageSize={pageSize} total={rows.length}
          onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(0); }} noun="node" />}
    </div>);
}

/* ── Relationship detail — audit + link one node ─────────────────────── */
function NodeDetail({ node, NG, G, I, flashEdge, onAddEdge, onRemoveEdge, onBack, onOpen }) {
  const ResolvedId = window.GA.ResolvedId;
  const inc = G.incoming(node.id);   // what satisfies THIS
  const out = G.outgoing(node.id);   // what THIS satisfies
  const orphan = G.isOrphan(node);
  const K = NG.kinds;
  const [addDir, setAddDir] = React.useState(null); // "out" | "in" | null → dialog open

  // One directed edge chip; `dir` orients the arrow but it always points right
  // (the global "satisfies" axis), so asymmetry reads consistently.
  function EdgeChip({ e, dir }) {
    const other = NG.byId[e.id];
    const key = dir === "in" ? e.id + "\u2192" + node.id : node.id + "\u2192" + e.id;
    const flash = flashEdge === key;
    const arrow = <span className="ng-arrow-wire"><span className={"ng-kind k-" + e.kind}>{K[e.kind].label}</span><I.arrowRight size={13} className="ng-arrow-glyph" /></span>;
    const pill = (
      <span className="ng-edge-node">
        {other ? <ResolvedId base={other.base} detail={other.detail} concept={other.concept} /> : <code>{e.id}</code>}
        {e.human && <span className="ng-edge-human" title="human-pinned edge"><I.shield size={11} /></span>}
      </span>);
    return (
      <span className={"ng-edge-wrap" + (flash ? " flash" : "")}>
        <button className={"ng-edge" + (e.human ? " human" : "")} onClick={() => other && onOpen(other.id)} disabled={!other} title={K[e.kind].gloss}>
          {dir === "in" ? <>{pill}{arrow}</> : <>{arrow}{pill}</>}
        </button>
        {e.human &&
          <button className="ng-edge-del" title="Remove this human edge"
            onClick={() => onRemoveEdge(dir === "in" ? e.id : node.id, dir === "in" ? node.id : e.id)}>
            <I.xCircle size={13} />
          </button>}
      </span>);
  }

  const facts = [
    { k: "Kind", v: node.concept ? <span className="ng-fact-concept"><I.layers size={13} /> concept class</span> : <span className="ng-fact-concrete"><I.target size={13} /> concrete product</span> },
    { k: "Base", v: <code>{node.base}</code> },
    { k: "Detail", v: node.detail ? <code>{node.detail}</code> : <span className="pv-null">—</span> },
    { k: "Aliases", v: String(node.aliases.length) },
    { k: "Edges", v: <span className="ng-fact-edges">{inc.length} in <span className="dimsep">·</span> {out.length} out</span> },
  ];
  if (node.rep) facts.push({ k: "Merged into", v: <code>{node.rep}</code> });

  const canEdit = !node.rep; // merged nodes re-key to their representative — edit that instead

  return (
    <div className="node-detail">
      <button className="btn rd-back" data-variant="outline" data-size="sm" onClick={onBack}><I.chevronLeft size={15} /> Nodes</button>

      <div className="nd-head">
        <div className="nd-id">
          <span className={"ng-row-glyph big" + (node.concept ? " concept" : orphan ? " orphan" : "")}>
            {node.concept ? <I.layers size={20} /> : node.rep ? <I.gitMerge size={20} /> : <I.target size={20} />}
          </span>
          <div className="nd-id-text">
            <div className="nd-id-main"><ResolvedId base={node.base} detail={node.detail} concept={node.concept} /></div>
            <div className="nd-id-sub">{node.concept ? "abstract concept class" : node.detail ? "specialization of " : "canonical base"}{node.detail && <code>{node.base}</code>}</div>
          </div>
        </div>
        {orphan && <span className="ng-orphan-chip big"><I.alert size={13} /> orphan</span>}
      </div>

      <dl className="nd-facts">
        {facts.map((f) => <div className="nd-fact" key={f.k}><dt>{f.k}</dt><dd>{f.v}</dd></div>)}
      </dl>

      {node.rep &&
        <div className="nd-rep">
          <I.gitMerge size={14} />
          <span>Merged into <button className="nd-rep-link" onClick={() => onOpen(node.rep)}><code>{node.rep}</code></button> — requests for this id re-key to the representative.{node.note ? " " + node.note : ""}</span>
        </div>}

      {node.aliases.length > 0 &&
        <div className="nd-block">
          <p className="nz-detail-label">Aliases <span className="muted">· surface forms that resolve here</span></p>
          <div className="nd-aliases">
            {node.aliases.map((a) => <code className="nd-alias" key={a}>{a}</code>)}
          </div>
        </div>}

      <div className="nd-block">
        <div className="nd-rel-head">
          <p className="nz-detail-label">Relationships <span className="muted">· directed “satisfies” edges — left to right</span></p>
          {canEdit && !orphan &&
            <button className="btn nd-addedge" data-variant="outline" data-size="sm" onClick={() => setAddDir("out")}><I.plus size={14} /> Add edge</button>}
        </div>

        {orphan ? (
          <div className="nd-orphan-note">
            <I.alert size={16} />
            <div>
              <strong>No satisfies-edges — this node is orphaned.</strong>
              <p>{node.note || "A concrete node with zero edges. Nothing satisfies it and it satisfies nothing, so it can’t be matched through the graph — a candidate for linking."}</p>
              {node.seenAt && <span className="nd-orphan-seen">{node.seenAt}</span>}
              {canEdit &&
                <div className="nd-orphan-actions">
                  <button className="btn" data-size="sm" onClick={() => setAddDir("out")}><I.link size={14} /> Link this node</button>
                </div>}
            </div>
          </div>
        ) : (
          <div className="ng-axis">
            <div className="ng-axis-col in">
              <div className="ng-axis-cap"><I.chevronRight size={12} className="ng-cap-in" /> Satisfied by<span className="ng-axis-n">{inc.length}</span></div>
              {inc.length ? inc.map((e, i) => <EdgeChip key={e.id + i} e={e} dir="in" />)
                : <span className="ng-axis-empty">nothing points in</span>}
            </div>

            <div className="ng-axis-center">
              <div className="ng-center-node">
                <ResolvedId base={node.base} detail={node.detail} concept={node.concept} />
              </div>
              <span className="ng-axis-flow">satisfies →</span>
            </div>

            <div className="ng-axis-col out">
              <div className="ng-axis-cap">Satisfies<span className="ng-axis-n">{out.length}</span><I.chevronRight size={12} className="ng-cap-out" /></div>
              {out.length ? out.map((e, i) => <EdgeChip key={e.id + i} e={e} dir="out" />)
                : <span className="ng-axis-empty">points to nothing</span>}
            </div>
          </div>
        )}

        <div className="nd-legend">
          {Object.keys(K).map((k) =>
            <span className="nd-legend-item" key={k}><span className={"ng-kind k-" + k}>{K[k].label}</span><span className="muted small">{K[k].gloss}</span></span>)}
        </div>
      </div>

      {addDir &&
        <NodeEdgeDialog node={node} NG={NG} G={G} I={I} initialDir={addDir}
          onClose={() => setAddDir(null)}
          onSave={(edge) => { onAddEdge(edge); setAddDir(null); }} />}
    </div>);
}

/* ── Add-edge dialog — a manual, human-pinned satisfies-edge ──────────── */
function NodeEdgeDialog({ node, NG, G, I, initialDir, onClose, onSave }) {
  const { Dialog, Combobox, Button } = window.DesignSystem_959bdd;
  const ResolvedId = window.GA.ResolvedId;
  const K = NG.kinds;
  const [dir, setDir] = React.useState(initialDir || "out"); // out: node satisfies target · in: target satisfies node
  const [kind, setKind] = React.useState("general");
  const [targetId, setTargetId] = React.useState("");

  // Exclude self + nodes already adjacent in this direction.
  const existing = new Set((dir === "out" ? G.outgoing(node.id) : G.incoming(node.id)).map((e) => e.id));
  const options = NG.list
    .filter((n) => n.id !== node.id && !existing.has(n.id) && !n.rep)
    .map((n) => ({ value: n.id, label: n.id + (n.concept ? "  · concept" : "") }));

  const target = targetId ? NG.byId[targetId] : null;
  const canSave = !!target;
  const [from, to] = dir === "out" ? [node.id, targetId] : [targetId, node.id];

  const DIRS = [
    { key: "out", label: "This satisfies →" },
    { key: "in", label: "← Satisfied by" },
  ];
  const KINDS = Object.keys(K).map((k) => ({ key: k, label: K[k].label }));

  const NodePill = ({ id }) => {
    const n = id && NG.byId[id];
    return n ? <span className="ne-pill"><ResolvedId base={n.base} detail={n.detail} concept={n.concept} /></span>
             : <span className="ne-pill ne-node-ph">choose a node…</span>;
  };

  return (
    <Dialog
      open={true}
      onClose={onClose}
      title="Add satisfies-edge"
      description="Manually link this node into the identity graph. A human-pinned edge is authoritative — the automatic system won’t overwrite or prune it."
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => canSave && onSave({ from, to, kind })} disabled={!canSave}>Save as human edge</Button>
      </>}>

      <div className="nz-ov">
        <div className="ne-field">
          <span className="ne-label">Direction</span>
          <div className="seg ne-seg">
            {DIRS.map((d) => <button key={d.key} className={"seg-btn" + (dir === d.key ? " active" : "")} onClick={() => setDir(d.key)}>{d.label}</button>)}
          </div>
        </div>

        <div className="ne-field">
          <span className="ne-label">Kind</span>
          <div className="seg ne-seg">
            {KINDS.map((k) => <button key={k.key} className={"seg-btn" + (kind === k.key ? " active" : "")} onClick={() => setKind(k.key)}>{k.label}</button>)}
          </div>
          <p className="ne-kind-hint">{K[kind].gloss} — e.g. {kind === "general" ? "kielbasa → sausage" : kind === "containment" ? "chicken::whole → chicken::thighs" : "mozzarella::fresh → ⟨fresh-soft-cheese⟩"}.</p>
        </div>

        <div className="ne-field">
          <span className="ne-label">{dir === "out" ? "Target — the node this satisfies" : "Source — the node that satisfies this"}</span>
          <Combobox options={options} value={targetId} onChange={setTargetId} placeholder="Search nodes…" searchPlaceholder="e.g. sausage" />
        </div>

        <div className="ne-field">
          <span className="ne-label">Preview</span>
          <div className="ne-preview">
            <NodePill id={from} />
            <span className="ng-arrow-wire"><span className={"ng-kind k-" + kind}>{K[kind].label}</span><I.arrowRight size={14} className="ng-arrow-glyph" /></span>
            <NodePill id={to} />
          </div>
        </div>

        <div className="nz-ov-pin"><I.shield size={13} /> Saved as a human edge — pinned, and the auto job won’t overwrite it.</div>
      </div>
    </Dialog>);
}

window.GA = window.GA || {};
window.GA.NodesTab = NodesTab;
