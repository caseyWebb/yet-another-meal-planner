/* Data › Recipes detail — assembles every tier for one slug. */
function RdValue({ v }) {
  const I = window.GA.icons;
  if (v === null || v === undefined) return <span className="pv-null">—</span>;
  if (typeof v === "boolean") return <span className="pv-bool">{String(v)}</span>;
  if (typeof v === "number") return <span className="pv-num">{v.toLocaleString()}</span>;
  if (Array.isArray(v)) {
    return v.length ? (
      <span className="pv-chips">{v.map((x, i) => <span className="pv-chip" key={i}>{String(x)}</span>)}</span>
    ) : <span className="pv-null">empty</span>;
  }
  if (typeof v === "object") return <RdKV obj={v} nested />;
  if (/^https?:\/\//.test(v)) return <a className="pv-link" href={v} target="_blank" rel="noreferrer">{v}</a>;
  return <span className="pv-str">{v}</span>;
}

function RdKV({ obj, nested }) {
  return (
    <div className={"pkv" + (nested ? " pkv-nested" : "")}>
      {Object.entries(obj).map(([k, v]) => (
        <div className="pkv-row" key={k}>
          <span className="pkv-k">{k}</span>
          <span className="pkv-v"><RdValue v={v} /></span>
        </div>
      ))}
    </div>
  );
}

function RecipeDetail({ r, onBack }) {
  const { Badge } = window.DesignSystem_959bdd;
  const I = window.GA.icons;
  const api = window.GA.recipesApi;

  const STATUS = {
    indexed: { dot: "ok", variant: "secondary", word: "indexed" },
    skipped: { dot: "fail", variant: "destructive", word: "skipped" },
    pending: { dot: "never", variant: "outline", word: "pending" },
    orphaned: { dot: "muted", variant: "outline", word: "orphaned" },
  };
  const st = STATUS[r.status];

  const fm = api.frontmatterOf(r);
  const proj = api.projectionOf(r);
  const raw = api.rawMarkdownOf(r);
  const body = r.status === "orphaned" ? null : api.bodyOf(r);

  function mdHtml(src) {
    if (window.marked && window.marked.parse) return window.marked.parse(src);
    return "<pre>" + src.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])) + "</pre>";
  }

  // A logical step-by-step progression (index → description → embedding), each
  // step proceeding the next — rendered with the same connected track as Discovery.
  const pipeSteps = [
    { key: "index", label: "Index", value: st.word, on: r.status === "indexed" || r.status === "orphaned" },
    { key: "description", label: "Description", value: r.described ? "generated" : "pending", on: !!r.described },
    { key: "embedding", label: "Embedding", value: r.embedding ? "present" : "pending", on: !!r.embedding },
  ];

  return (
    <div className="recipe-detail">
      <button className="link-action rd-back" onClick={onBack}><I.chevronLeft size={15} /> All recipes</button>

      <div className="rd-head">
        <div>
          <h2 className="rd-title">{r.title}</h2>
          <div className="rd-slug">{r.slug}</div>
        </div>
        <Badge variant={st.variant}>{st.word}</Badge>
      </div>

      {r.reconcile_message && (
        <div className="alert" data-variant="destructive">
          <I.alert />
          <h2>Skipped at reconcile</h2>
          <section>{r.reconcile_message}</section>
        </div>
      )}

      {/* Pipeline state — a connected step-by-step progression */}
      <div className="rd-pipeline">
        <div className="pl-track" role="list" aria-label="recipe pipeline progression">
          {pipeSteps.map((s, i) => (
            <div className={"pl-stage " + (s.on ? "done" : "todo")} role="listitem" key={s.key}>
              <div className="pl-node">{s.on ? <I.checkCircle size={15} /> : <I.clock size={13} />}</div>
              <span className="pl-label">{s.label}</span>
              {i < pipeSteps.length - 1 && <span className={"pl-seg " + (s.on ? "done" : "todo")} />}
            </div>
          ))}
        </div>
      </div>

      {/* Derived description */}
      <p className="group-label">Derived description</p>
      <div className="card"><section>
        {r.description
          ? <p className="rd-desc">{r.description}</p>
          : <p className="muted" style={{ margin: 0 }}>Not yet generated — the recipe-embed cron writes the AI description on its next pass.</p>}
      </section></div>

      {/* Rendered markdown */}
      <p className="group-label">Recipe</p>
      <div className="card"><section>
        {body
          ? <div className="md" dangerouslySetInnerHTML={{ __html: mdHtml(body) }} />
          : <p className="muted" style={{ margin: 0 }}>The R2 source object is gone — this is a stale projection (orphaned). The recipe-index cron will prune the row on its next pass.</p>}
      </section></div>

      {/* Attributed notes */}
      <p className="group-label">Notes <span className="muted small">({r.notes.length})</span></p>
      {r.notes.length === 0 ? (
        <p className="muted" style={{ marginTop: 0 }}>No attributed notes yet.</p>
      ) : (
        <div className="rd-notes">
          {r.notes.map((n, i) => (
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
      )}

      {/* R2 frontmatter (pretty) */}
      <p className="group-label">R2 frontmatter <span className="muted small">recipes/{r.slug}.md</span></p>
      <div className="card"><section><RdKV obj={fm} /></section></div>

      {/* D1 index row (pretty) */}
      <p className="group-label">D1 index row <span className="muted small">recipes</span></p>
      <div className="card"><section>
        {proj
          ? <RdKV obj={proj} />
          : <p className="muted" style={{ margin: 0 }}>Not in the index — {r.status === "pending" ? "reconcile hasn’t run yet." : "skipped at reconcile (see the reason above)."}</p>}
      </section></div>

      {/* Raw R2 markdown (collapsible) */}
      {raw && (
        <details className="rd-raw">
          <summary>
            <I.chevronRight size={14} className="rd-raw-caret" />
            View raw R2 markdown
            <span className="muted small">recipes/{r.slug}.md</span>
          </summary>
          <pre className="rd-raw-pre">{raw}</pre>
        </details>
      )}
    </div>
  );
}
window.GA = window.GA || {};
window.GA.RecipeDetail = RecipeDetail;
