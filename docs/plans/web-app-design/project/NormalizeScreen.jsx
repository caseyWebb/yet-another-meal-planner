/* Ingredient Normalization — the operator audit + override surface for the
   grocery-agent's automatic ingredient-identity system. Terms people type are
   normalized to canonical ids by a background job (embed → nearest-by-cosine →
   small-LLM classify: SAME · SPECIALIZATION · NOVEL · MERGE; below-floor terms
   skip the LLM; failures fail-safe to novel). The operator audits the decisions
   stream, expands a card to see candidates / model / edges / reason, and can
   OVERRIDE a decision — a human correction the auto job never overwrites.
   Modelled on the Discovery area. Reads GA.normalize. */
/* Resolved-id renderer: base in normal weight, ::detail as a lighter badge,
   a concept tag for abstract ids. Shared across the decisions stream, the
   override panel, and the aliases table. */
function ResolvedId({ base, detail, concept }) {
  return (
    <span className="nz-id">
      <span className="nz-id-base">{base}</span>
      {detail && <><span className="nz-id-dot">·</span><span className="nz-id-detail">{detail}</span></>}
      {concept && <span className="nz-id-tag">concept</span>}
    </span>);

}

function NormalizeScreen() {
  const { Button, Dialog, Combobox, Textarea, Field } = window.DesignSystem_959bdd;
  const I = window.GA.icons;
  const NZ = window.GA.normalize;
  const NG = window.GA.nodes;
  const RK = window.GA.reconcile;
  const AU = window.GA.audit;
  const rkMode = RK.store.use();
  const rkState = RK.deriveState(RK.store.snapshot());
  AU.store.use();
  const auConverged = AU.store.snapshot().backlog.converged;

  const [view, setView] = React.useState("decisions"); // Decisions | Audits | Queue | ...
  const [stream, setStream] = React.useState("terms");  // Decisions stream: terms | edges
  const [edgeFilter, setEdgeFilter] = React.useState("all");
  const [filter, setFilter] = React.useState("all");
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(25);
  const [open, setOpen] = React.useState(null); // expanded card id
  const [rows, setRows] = React.useState(NZ.decisions);
  const [override, setOverride] = React.useState(null); // decision being overridden
  const [requeued, setRequeued] = React.useState({}); // id -> true (flashed)
  const [nodeTarget, setNodeTarget] = React.useState(null); // deep-link into Nodes

  const nodeIdOf = (d) => d.detail ? d.base + "::" + d.detail : d.base;
  function openNode(id) { setNodeTarget({ id, n: Date.now() }); setView("nodes"); }
  function openDecisionById(id) { setView("decisions"); setStream("terms"); setFilter("all"); setPage(0); setOpen(id); }

  const FILTERS = [
  { key: "all", label: "All" },
  { key: "same", label: "Same" },
  { key: "specialization", label: "Specialization" },
  { key: "novel", label: "Novel" },
  { key: "merge", label: "Merge" },
  { key: "no_llm", label: "No-LLM" },
  { key: "failed", label: "Failed" }];

  const countFor = (k) => k === "all" ? rows.length : rows.filter((d) => d.outcome === k).length;

  const filtered = rows.filter((d) => filter === "all" || d.outcome === filter);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pg = Math.min(page, pages - 1);
  const shown = filtered.slice(pg * pageSize, pg * pageSize + pageSize);

  function switchFilter(k) {setFilter(k);setPage(0);setOpen(null);}

  function requeue(d) {
    setRequeued((r) => ({ ...r, [d.id]: true }));
    setTimeout(() => setRequeued((r) => {const n = { ...r };delete n[d.id];return n;}), 2000);
  }
  function del(d) {setRows((prev) => prev.filter((x) => x.id !== d.id));setOpen(null);}

  // Apply a human correction from the Override panel.
  function applyOverride(dec, patch) {
    setRows((prev) => prev.map((x) => x.id === dec.id ? { ...x, ...patch, source: "human" } : x));
    setOverride(null);
  }

  // ── Resolved-id renderer (module-level ResolvedId, bound to a decision).
  //    Links into the Nodes graph when a canonical node exists for the id. ──
  function DecId({ d }) {
    const id = nodeIdOf(d);
    const inner = <ResolvedId base={d.base} detail={d.detail} concept={d.concept} />;
    if (NG && NG.byId[id]) {
      return <button className="nz-resolve-link" onClick={(e) => { e.stopPropagation(); openNode(id); }} title="View in graph">{inner}</button>;
    }
    return inner;
  }

  function OutcomeBadge({ d }) {
    return <span className={"nz-badge oc-" + d.kind}>{NZ.outcomes[d.outcome].label}{d.failedSafe ? " → Novel" : ""}</span>;
  }

  // Ranked candidate list with cosine score bars; the chosen one is highlighted.
  function Candidates({ d }) {
    if (!d.candidates.length) return <p className="nz-empty muted small">No candidates — the embedder returned nothing usable.</p>;
    const anyChosen = d.candidates.some((c) => c.chosen);
    return (
      <div className="nz-cands">
        {d.candidates.map((c) =>
        <div className={"nz-cand" + (c.chosen ? " chosen" : "")} key={c.id}>
            <span className="nz-cand-id">{c.id}</span>
            <span className="nz-cand-track">
              <span className={"nz-cand-fill" + (c.chosen ? " chosen" : "") + (d.belowFloor ? " floor" : "")} style={{ width: (c.score * 100).toFixed(0) + "%" }} />
            </span>
            <span className="nz-cand-score">{c.score.toFixed(2)}</span>
            {c.chosen ? <span className="nz-cand-flag">chosen</span> : <span className="nz-cand-flag ghost" />}
          </div>
        )}
        {!anyChosen &&
        <p className="nz-cands-note muted small">
            {d.belowFloor ?
          <>All below the {NZ.floor} similarity floor — resolved as a new base with no LLM call.</> :
          d.outcome === "novel" ?
          <>None chosen — the classifier judged this a distinct product.</> :
          <>None chosen.</>}
          </p>
        }
      </div>);

  }

  const cards = [
  { icon: <I.layers />, label: "Canonical nodes", value: NZ.stats.nodes.toLocaleString() },
  { icon: <I.link />, label: "Aliases", value: NZ.stats.aliases.toLocaleString() },
  { icon: <I.gitMerge />, label: "Satisfies-edges", value: NZ.stats.satisfies.toLocaleString() },
  { icon: <I.inbox />, label: "Pending queue", value: NZ.stats.pending, warn: NZ.stats.pending > 0, sub: "awaiting a pass" },
  { icon: <I.sparkles />, label: "Decisions · 24h", value: NZ.stats.decisions24h },
  { icon: <I.alert />, label: "Needs attention", value: NZ.stats.needsAttention, bad: NZ.stats.needsAttention > 0, sub: "failed · deferred" }];


  return (
    <div className="normalize" data-comment-anchor="8f8c5b8124-div-117-5">
      <div className="area-head status-head">
        <button className="link-action"><I.refresh size={14} /> Refresh · last sweep {NZ.relAge(NZ.lastSweep)}</button>
      </div>

      <div className="stat-grid nz-stat-grid">
        {cards.map((c) =>
        <div className={"stat-card" + (c.warn ? " nz-stat-warn" : "") + (c.bad ? " nz-stat-bad" : "")} key={c.label}>
            <div className="stat-top">
              <span className="stat-ico">{c.icon}</span>
              <span className="stat-label">{c.label}</span>
            </div>
            <div className="stat-value">{c.value}</div>
            {c.sub ? <div className="stat-sub">{c.sub}</div> : null}
          </div>
        )}
      </div>

      <div className="data-nav dc-subnav">
        <button className={"pill" + (view === "decisions" ? " active" : "")} onClick={() => setView("decisions")}>Decisions</button>
        <button className={"pill" + (view === "audits" ? " active" : "")} onClick={() => setView("audits")}><span className={"rk-tab-dot " + (auConverged ? "converged" : "converging")} />Audits</button>
        <button className={"pill" + (view === "queue" ? " active" : "")} onClick={() => setView("queue")}>Queue{NZ.queue.length ? <span className="pill-count">{NZ.queue.length}</span> : null}</button>
        <button className={"pill" + (view === "aliases" ? " active" : "")} onClick={() => setView("aliases")}>Aliases{NZ.aliases.length ? <span className="pill-count">{NZ.aliases.length}</span> : null}</button>
        <button className={"pill" + (view === "nodes" ? " active" : "")} onClick={() => setView("nodes")}>Nodes{NG ? <span className="pill-count">{NG.list.length}</span> : null}</button>
        <button className={"pill" + (view === "reconcile" ? " active" : "")} onClick={() => setView("reconcile")}><span className={"rk-tab-dot " + rkState} />Reconcile</button>
      </div>

      {view === "reconcile" ?
      <div className="nz-reconcile">
          <p className="nz-queue-blurb muted small">The housekeeping pass that re-keys members' grocery-list and pantry rows onto canonical ids — the identity graph above, applied to everyone's saved rows, collapsing surface-form duplicates (a pantry “scallions” and a grocery “green onions” become one row). Idempotent and self-terminating: it does real work only while stale rows remain, then runs as a silent no-op.</p>
          {window.GA.ReconcilePreviewToggle && <window.GA.ReconcilePreviewToggle />}
          {window.GA.ReconcileCard && <window.GA.ReconcileCard />}
        </div> :
      view === "audits" ?
      <window.GA.AuditsTab onOpenDecision={openDecisionById} /> :
      view === "nodes" ?
      <window.GA.NodesTab NZ={NZ} I={I} target={nodeTarget} onClearTarget={() => setNodeTarget(null)} /> :
      view === "queue" ?
      <QueueTable NZ={NZ} I={I} /> :
      view === "aliases" ?
      <AliasesTab NZ={NZ} onOpenNode={openNode} Dialog={Dialog} Combobox={Combobox} Field={Field} Button={Button} I={I} /> :

      <>
          <div className="nz-stream-bar">
            <div className="seg nz-stream-seg">
              <button className={"seg-btn" + (stream === "terms" ? " active" : "")} onClick={() => setStream("terms")}>Terms<span className="nz-stream-n">{rows.length}</span></button>
              <button className={"seg-btn" + (stream === "edges" ? " active" : "")} onClick={() => setStream("edges")}>Edges<span className="nz-stream-n">{NZ.edgeDecisions.length}</span></button>
            </div>
            <span className="nz-stream-hint muted small">
              {stream === "terms" ? "surface term → canonical id" : "directed satisfies-edge · keep or drop"}
            </span>
          </div>

          {stream === "edges" ?
          <EdgeStream NZ={NZ} I={I} openNode={openNode} filter={edgeFilter} setFilter={setEdgeFilter} /> :
          <>
          <div className="data-nav dc-filters">
            {FILTERS.map((f) => {
            const n = countFor(f.key);
            return (
              <button key={f.key} className={"pill nz-pill oc-" + f.key + (filter === f.key ? " active" : "")} onClick={() => switchFilter(f.key)} disabled={n === 0 && f.key !== "all"}>
                  {f.label}{n > 0 ? <span className="pill-count">{n}</span> : null}
                </button>);

          })}
          </div>

          <div className="nz-list">
            {shown.map((d) => {
            const isOpen = open === d.id;
            return (
              <div className={"nz-card oc-" + d.kind + (isOpen ? " open" : "")} key={d.id}>
                  <div className="nz-main" role="button" tabIndex={0}
                onClick={() => setOpen(isOpen ? null : d.id)}
                onKeyDown={(e) => {if (e.key === "Enter" || e.key === " ") {e.preventDefault();setOpen(isOpen ? null : d.id);}}}>
                    <div className="nz-lead">
                      <div className="nz-term-wrap">
                        <div className="nz-term">{d.term}</div>
                        <div className="nz-resolve">
                          <I.arrowRight size={13} className="nz-arrow" />
                          <DecId d={d} />
                        </div>
                      </div>
                      <div className="nz-badges">
                        <OutcomeBadge d={d} />
                        <span className={"nz-src" + (d.source === "human" ? " human" : "")}>
                          {d.source === "human" ? <><I.users size={11} /> human</> : "auto"}
                        </span>
                        <span className="nz-time muted">{NZ.relAge(d.createdAt)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="nz-foot">
                    <button className="nz-expand" onClick={() => setOpen(isOpen ? null : d.id)}>
                      {isOpen ? "Hide" : "Details"} <I.chevron size={14} className={isOpen ? "up" : ""} />
                    </button>
                    <div className="nz-actions">
                      {requeued[d.id] ?
                    <span className="nz-requeued small"><I.rotate size={12} className="spin" /> re-queued</span> :
                    <button className="btn nz-act-btn" data-variant="outline" data-size="sm" onClick={(e) => {e.stopPropagation();requeue(d);}}><I.rotate size={13} /> Re-queue</button>}
                      <button className="btn nz-act-btn" data-size="sm" onClick={(e) => {e.stopPropagation();setOverride(d);}}>Override</button>
                      {d.outcome === "failed" && <button className="nz-del" title="Delete row" onClick={(e) => {e.stopPropagation();del(d);}}><I.trash size={14} /></button>}
                    </div>
                  </div>

                  {isOpen &&
                <div className="nz-detail">
                      <div className="nz-detail-block">
                        <p className="nz-detail-label">Candidates <span className="muted">· nearest by cosine</span></p>
                        <Candidates d={d} />
                      </div>

                      <div className="nz-detail-meta">
                        <div className="nz-meta-item">
                          <span className="nz-meta-k">Model</span>
                          {d.model ?
                      <code className="nz-meta-model">{d.model}</code> :
                      <span className="nz-chip-floor"><I.minusCircle size={12} /> below floor — no LLM</span>}
                        </div>
                        {d.mergeInto &&
                    <div className="nz-meta-item">
                            <span className="nz-meta-k">Merge</span>
                            <span className="nz-edge"><code>{d.term}</code><I.arrowRight size={12} /><code>{d.mergeInto}</code><span className="nz-edge-rel">same-as</span></span>
                          </div>
                    }
                      </div>

                      {(d.edges.length > 0 || d.members.length > 0) &&
                  <div className="nz-detail-block">
                          <p className="nz-detail-label">{d.concept ? "Membership edges" : "Proposed edges"}</p>
                          <div className="nz-edges">
                            {d.edges.map((e, i) =>
                      <span className="nz-edge" key={i}>
                                <code>{e.from}</code><I.arrowRight size={12} /><code>{e.to}</code>
                                <span className="nz-edge-rel">{e.rel}</span>
                              </span>
                      )}
                            {d.members.map((m, i) =>
                      <span className="nz-edge member" key={"m" + i}>
                                <code>{m}</code><I.arrowRight size={12} /><code>{d.base}</code>
                                <span className="nz-edge-rel">member-of</span>
                              </span>
                      )}
                          </div>
                        </div>
                  }

                      <div className="nz-reason">
                        <span className="nz-reason-k">Reason</span>
                        <span className="nz-reason-v">"{d.reason}"</span>
                      </div>
                    </div>
                }
                </div>);

          })}
          </div>

          {filtered.length > 0 &&
        <window.GA.ListFooter
          page={pg} pageSize={pageSize} total={filtered.length}
          onPage={setPage} onPageSize={(n) => {setPageSize(n);setPage(0);}}
          noun="decision" />

        }
          </>
          }
        </>
      }

      {override &&
      <OverridePanel
        dec={override}
        NZ={NZ}
        onClose={() => setOverride(null)}
        onSave={applyOverride}
        Dialog={Dialog} Combobox={Combobox} Textarea={Textarea} Field={Field} Button={Button} I={I} />

      }
    </div>);

}

/* The Decisions › Edges segment — verdicts on directed satisfies-edges. Shaped
   differently from term decisions: a from→to edge, KEEP/DROP, a direction
   verdict, a reason, and (for DROPs later revisited) a pointer to Restorations. */
function EdgeStream({ NZ, I, openNode, filter, setFilter }) {
  const NG = window.GA.nodes;
  const FILTERS = [
    { key: "all", label: "All" },
    { key: "edge_keep", label: "Kept" },
    { key: "edge_drop", label: "Dropped" },
  ];
  const countFor = (k) => k === "all" ? NZ.edgeDecisions.length : NZ.edgeDecisions.filter((d) => d.outcome === k).length;
  const shown = NZ.edgeDecisions.filter((d) => filter === "all" || d.outcome === filter);

  function EndId({ id }) {
    if (NG && NG.byId[id]) {
      return <button className="nz-edge-idlink" onClick={() => openNode(id)} title="View in graph"><code>{id}</code></button>;
    }
    return <code>{id}</code>;
  }

  return (
    <>
      <div className="data-nav dc-filters">
        {FILTERS.map((f) => {
          const n = countFor(f.key);
          return (
            <button key={f.key} className={"pill nz-pill oc-" + f.key + (filter === f.key ? " active" : "")} onClick={() => setFilter(f.key)} disabled={n === 0 && f.key !== "all"}>
              {f.label}{n > 0 ? <span className="pill-count">{n}</span> : null}
            </button>);
        })}
      </div>

      <div className="nz-list">
        {shown.map((d) => (
          <div className={"nz-card ec-card oc-" + d.kind} key={d.id}>
            <div className="ec-main">
              <div className="ec-lead">
                <div className="ec-edge">
                  <EndId id={d.from} />
                  <I.arrowRight size={14} className="ec-arrow" />
                  <EndId id={d.to} />
                  <span className="ec-rel">{d.rel}</span>
                </div>
                <div className="nz-badges">
                  <span className={"nz-badge oc-" + d.kind}>{NZ.edgeOutcomes[d.outcome].label}</span>
                  {d.flag && <span className={"ec-flag " + d.flag.replace("-", "")}>{d.flag}</span>}
                  <span className={"nz-src" + (d.source === "human" ? " human" : "")}>{d.source === "human" ? <><I.users size={11} /> human</> : "auto"}</span>
                  <span className="nz-time muted">{NZ.relAge(d.createdAt)}</span>
                </div>
              </div>
              <div className="ec-verdict">
                <span className={"ec-verdict-glyph oc-" + d.kind}>{d.outcome === "edge_keep" ? <I.checkCircle size={13} /> : <I.ban size={13} />}</span>
                {d.verdict}
              </div>
              <div className="ec-reason">"{d.reason}"</div>
              {d.restoredBy &&
              <div className="ec-restored">
                <I.rotate size={12} /> later revisited by the edge audit — see Restorations (<code>{d.restoredBy}</code>)
              </div>}
            </div>
          </div>
        ))}
      </div>
    </>);
}

/* The pending-queue table — novel terms awaiting a processing pass. */
function QueueTable({ NZ, I }) {
  return (
    <div className="nz-queue">
      <p className="nz-queue-blurb muted small">Novel terms seen in member input, waiting for the next normalization pass. Each is embedded, matched, and classified when its retry window opens.</p>
      <div className="cfg-table-wrap">
        <table className="cfg-table nz-queue-table">
          <thead>
            <tr>
              <th>Term</th>
              <th>First seen</th>
              <th className="ig-th-num">Attempts</th>
              <th>Next retry</th>
            </tr>
          </thead>
          <tbody>
            {NZ.queue.map((q) =>
            <tr key={q.id}>
                <td><code className="nz-queue-term">{q.term}</code></td>
                <td className="muted small">{NZ.relAge(q.firstSeenAt)}</td>
                <td className="ig-th-num cfg-num">{q.attempts}<span className="muted">/5</span></td>
                <td className="small"><span className="nz-queue-next"><I.clock size={12} /> {NZ.relFuture(q.nextRetryAt)}</span></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>);

}

/* Override panel — re-map a term to a human-pinned correction. Three modes:
   an existing id (typeahead), a new base, or a merge of two ids. */
function OverridePanel({ dec, NZ, onClose, onSave, Dialog, Combobox, Textarea, Field, Button, I }) {
  const [mode, setMode] = React.useState("existing"); // existing | new | merge
  const [existingId, setExistingId] = React.useState(dec.detail ? dec.base + "::" + dec.detail : dec.base);
  const [newBase, setNewBase] = React.useState("");
  const [mergeA, setMergeA] = React.useState(dec.base);
  const [mergeB, setMergeB] = React.useState("");
  const [note, setNote] = React.useState("");

  const idOptions = NZ.knownIds.map((id) => ({ value: id, label: id }));

  const currentId = dec.detail ? dec.base + "::" + dec.detail : dec.base + (dec.concept ? " (concept)" : "");

  function save() {
    let patch = {};
    if (mode === "existing" && existingId) {
      const [base, detail] = existingId.split("::");
      patch = { base, detail: detail || null, concept: false, outcome: detail ? "specialization" : "same" };
    } else if (mode === "new") {
      patch = { base: newBase.trim() || dec.base, detail: null, concept: false, outcome: "novel" };
    } else if (mode === "merge") {
      patch = { base: mergeB.trim() || dec.base, detail: null, concept: false, outcome: "merge", mergeInto: mergeB.trim() || dec.base };
    }
    onSave(dec, patch);
  }

  const canSave = mode === "existing" && existingId || mode === "new" && newBase.trim() || mode === "merge" && mergeB.trim();

  const MODES = [
  { key: "existing", label: "Existing id" },
  { key: "new", label: "New base" },
  { key: "merge", label: "Merge" }];


  return (
    <Dialog
      open={true}
      onClose={onClose}
      title="Override normalization"
      description="Pin this term to a canonical id yourself. A human correction is authoritative — the automatic system will not overwrite it."
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={!canSave}>Save as human correction</Button>
      </>}>
      
      <div className="nz-ov">
        <div className="nz-ov-current">
          <div className="nz-ov-row">
            <span className="nz-ov-k">Term</span>
            <code className="nz-ov-term">{dec.term}</code>
          </div>
          <div className="nz-ov-row">
            <span className="nz-ov-k">Currently</span>
            <span className="nz-ov-cur"><code>{currentId}</code><span className={"nz-badge oc-" + dec.kind}>{NZ.outcomes[dec.outcome].label}</span></span>
          </div>
        </div>

        <div className="nz-ov-field">
          <span className="nz-ov-label">Re-map to</span>
          <div className="seg nz-ov-seg">
            {MODES.map((m) =>
            <button key={m.key} className={"seg-btn" + (mode === m.key ? " active" : "")} onClick={() => setMode(m.key)}>{m.label}</button>
            )}
          </div>
        </div>

        {mode === "existing" &&
        <Field label="Canonical id" hint="Search known ids — base or base::detail.">
            <Combobox options={idOptions} value={existingId} onChange={setExistingId} placeholder="Search ids…" searchPlaceholder="e.g. green onion" />
          </Field>
        }
        {mode === "new" &&
        <Field label="New base id" hint="Minted as a fresh canonical node. Use lowercase; add a ::detail spec only if it's a specialization.">
            <input className="input" type="text" placeholder="e.g. ras el hanout" value={newBase} onChange={(e) => setNewBase(e.target.value)} />
          </Field>
        }
        {mode === "merge" &&
        <div className="nz-ov-merge">
            <Field label="Merge this id" hint="The id retired by the merge.">
              <Combobox options={idOptions} value={mergeA} onChange={setMergeA} placeholder="Search ids…" />
            </Field>
            <span className="nz-ov-into"><I.arrowRight size={16} /></span>
            <Field label="Into" hint="The surviving canonical id.">
              <input className="input" type="text" placeholder="e.g. zucchini" value={mergeB} onChange={(e) => setMergeB(e.target.value)} />
            </Field>
          </div>
        }

        <Field label="Note" hint="Optional — recorded with the correction for the audit trail.">
          <Textarea rows={2} placeholder="Why this mapping is correct…" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        <div className="nz-ov-pin"><I.shield size={13} /> Saved as a human correction — pinned, and the auto job won't overwrite it.</div>
      </div>
    </Dialog>);

}

/* Aliases tab — the live surface-form → canonical id map the matcher reads.
   Unlike the Decisions history (pruned over time), this is current state: browse
   the whole mapping, add one proactively, or prune a bad one. Replaces the
   retired Config › Aliases editor. */
function AliasesTab({ NZ, onOpenNode, Dialog, Combobox, Field, Button, I }) {
  const NG = window.GA.nodes;
  const [rows, setRows] = React.useState(NZ.aliases);
  const [q, setQ] = React.useState("");
  const [src, setSrc] = React.useState("all"); // all | human | auto
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(25);
  const [addOpen, setAddOpen] = React.useState(false);
  const [flash, setFlash] = React.useState(null); // id of a just-added row

  const srcCount = (k) => k === "all" ? rows.length : rows.filter((r) => r.source === k).length;
  const SRC = [
  { key: "all", label: "All" },
  { key: "human", label: "Human" },
  { key: "auto", label: "Auto" }];


  const needle = q.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (src !== "all" && r.source !== src) return false;
    if (!needle) return true;
    const idStr = r.base + (r.detail ? "::" + r.detail : "");
    return (r.variant + " " + idStr).toLowerCase().includes(needle);
  });
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pg = Math.min(page, pages - 1);
  const shown = filtered.slice(pg * pageSize, pg * pageSize + pageSize);

  function prune(r) {setRows((prev) => prev.filter((x) => x.id !== r.id));}
  function addMapping(variant, canonicalId) {
    const [base, detail] = canonicalId.split("::");
    const row = { id: "al_new_" + Date.now(), variant: variant.trim(), base: base.trim(), detail: detail || null, source: "human" };
    setRows((prev) => [row, ...prev]);
    setSrc("all");setQ("");setPage(0);
    setFlash(row.id);
    setTimeout(() => setFlash(null), 2000);
    setAddOpen(false);
  }

  return (
    <div className="nz-aliases">
      <p className="nz-queue-blurb muted small">The live surface-form → canonical id map the matcher reads. The cron grows it automatically; edit here only to pin a synonym it hasn't found or prune a bad one.</p>

      <div className="nz-al-toolbar">
        <div className="recipe-search nz-al-search">
          <I.search size={15} />
          <input className="recipe-search-input" type="text" placeholder="Filter variants or ids…" value={q} onChange={(e) => {setQ(e.target.value);setPage(0);}} />
          {q && <button className="recipe-search-clear" onClick={() => setQ("")} aria-label="Clear"><I.xCircle size={15} /></button>}
        </div>
        <div className="data-nav nz-al-srcpills">
          {SRC.map((s) => {
            const n = srcCount(s.key);
            return (
              <button key={s.key} className={"pill" + (src === s.key ? " active" : "")} onClick={() => {setSrc(s.key);setPage(0);}}>
                {s.label}{n > 0 ? <span className="pill-count">{n}</span> : null}
              </button>);

          })}
        </div>
        <Button size="sm" className="nz-al-add" onClick={() => setAddOpen(true)}><I.plus size={14} /> Add mapping</Button>
      </div>

      <div className="cfg-table-wrap">
        <table className="cfg-table nz-al-table">
          <thead>
            <tr>
              <th>Variant</th>
              <th className="nz-al-th-arrow" aria-label="maps to"></th>
              <th>Canonical id</th>
              <th>Source</th>
              <th className="cfg-th-act">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) =>
            <tr key={r.id} className={flash === r.id ? "nz-al-flash" : ""}>
                <td><code className="nz-al-variant">{r.variant}</code></td>
                <td className="nz-al-arrow"><I.arrowRight size={13} /></td>
                <td>
                  <span className="nz-al-id">
                    {(() => {
                      const idStr = r.base + (r.detail ? "::" + r.detail : "");
                      const inner = <ResolvedId base={r.base} detail={r.detail} concept={r.concept} />;
                      return NG && NG.byId[idStr]
                        ? <button className="nz-al-idlink" onClick={() => onOpenNode(idStr)} title="View in graph">{inner}</button>
                        : inner;
                    })()}
                    {r.merged && <span className="nz-al-merged">merged</span>}
                  </span>
                </td>
                <td>
                  <span className={"nz-src" + (r.source === "human" ? " human" : "")}>
                    {r.source === "human" ? <><I.shield size={11} /> human</> : "auto"}
                  </span>
                </td>
                <td className="cfg-row-act">
                  <button className="cfg-remove" onClick={() => prune(r)}
                title={r.source === "human" ? "Prune this pinned mapping" : "Prune — the cron may re-derive this"}
                aria-label="Delete mapping">
                    <I.trash size={15} />
                  </button>
                </td>
              </tr>
            )}
            {shown.length === 0 &&
            <tr><td colSpan={5} className="nz-al-empty muted small">No mappings match this filter.</td></tr>
            }
          </tbody>
        </table>
      </div>

      {filtered.length > 0 &&
      <window.GA.ListFooter
        page={pg} pageSize={pageSize} total={filtered.length}
        onPage={setPage} onPageSize={(n) => {setPageSize(n);setPage(0);}}
        noun="mapping" />

      }

      {addOpen &&
      <AddMappingDialog NZ={NZ} onClose={() => setAddOpen(false)} onSave={addMapping}
      Dialog={Dialog} Combobox={Combobox} Field={Field} Button={Button} I={I} />
      }
    </div>);

}

/* Add-mapping dialog — standalone pin of a surface form to a canonical id.
   Reuses the Override dialog's look. */
function AddMappingDialog({ NZ, onClose, onSave, Dialog, Combobox, Field, Button, I }) {
  const [variant, setVariant] = React.useState("");
  const [canonicalId, setCanonicalId] = React.useState("");
  const idOptions = NZ.knownIds.map((id) => ({ value: id, label: id }));
  const canSave = variant.trim() && canonicalId.trim();

  return (
    <Dialog
      open={true}
      onClose={onClose}
      title="Add alias mapping"
      description="Pin a surface form to a canonical id. Saved as a human mapping — authoritative, and the automatic system won't overwrite it."
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onSave(variant, canonicalId)} disabled={!canSave}>Save as human mapping</Button>
      </>}>
      
      <div className="nz-ov">
        <Field label="Variant" hint="The surface form to map — what a member might type.">
          <input className="input" type="text" placeholder="e.g. EVOO" value={variant} onChange={(e) => setVariant(e.target.value)} />
        </Field>
        <Field label="Canonical id" hint="Search known ids — base or base::detail. A brand-new id is allowed too.">
          <Combobox options={idOptions} value={canonicalId} onChange={setCanonicalId} placeholder="Search ids…" searchPlaceholder="e.g. olive oil" />
        </Field>
        <div className="nz-ov-pin"><I.shield size={13} /> Saved as a human mapping — pinned, and the auto job won't overwrite it.</div>
      </div>
    </Dialog>);

}

window.GA = window.GA || {};
window.GA.NormalizeScreen = NormalizeScreen;
window.GA.ResolvedId = ResolvedId;