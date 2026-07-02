/* Normalization › Audits — the self-healing audit health surface.

   Home for the three rolling audit passes (alias · edge · sku-cache), the
   shared backlog burndown, the one-shot replay/restoration log, and the
   merge-rejection memory. Everything here tells one story: the identity graph
   continuously re-checks itself and drains its backlog to zero — and STAYS
   there. Burndown-to-zero is the good state, drawn green when reached.

   Reads window.GA.audit. Renders with au-* classes that share the reconcile
   convergence vocabulary (rk-*). A review-only toggle flips the shared store
   between converging / converged so every state is inspectable. */

/* Burndown sparkline: bars whose height tracks the REMAINING backlog per tick,
   so the series visibly falls to a flat floor. A zero tail renders as a thin
   green floor — which is exactly how "audited clean" reads. */
function BurndownSpark({ series, tone, className }) {
  const max = Math.max(1, ...series);
  return (
    <div className={"au-burn" + (className ? " " + className : "")} role="img" aria-label="un-audited rows remaining per recent sweep">
      {series.map((v, i) => {
        const h = v === 0 ? 0 : Math.max(6, Math.round((v / max) * 100));
        return (
          <div className="au-burn-col" key={i} title={v === 0 ? "clean" : v.toLocaleString() + " to go"}>
            {v === 0
              ? <span className="au-burn-floor" />
              : <span className={"au-burn-bar " + (tone || "g")} style={{ height: h + "%" }} />}
          </div>
        );
      })}
    </div>
  );
}

/* Per-pass "rows audited / tick" sparkline (work done, not backlog). Decays to
   a thin floor of no-op ticks once the pass is caught up. */
function AuditedSpark({ ticks, className }) {
  const max = Math.max(1, ...ticks.map((t) => t.audited));
  return (
    <div className={"au-spark" + (className ? " " + className : "")} role="img" aria-label="rows audited per recent tick">
      {ticks.map((t, i) => {
        const h = t.audited === 0 ? 0 : Math.max(6, Math.round((t.audited / max) * 100));
        return (
          <div className="au-spark-col" key={i} title={t.audited === 0 ? "no-op" : `${t.audited} audited · ${t.changed} changed`}>
            {t.audited === 0
              ? <span className="au-spark-zero" />
              : (
                <span className="au-spark-stack" style={{ height: h + "%" }}>
                  <span className="au-spark-seg changed" style={{ flex: Math.max(0.001, t.changed) }} />
                  <span className="au-spark-seg kept" style={{ flex: Math.max(0.001, t.audited - t.changed) }} />
                </span>
              )}
          </div>
        );
      })}
    </div>
  );
}

/* The backlog burndown hero — the primary convergence gauge. Two backlogs
   (alias, edge) draining to zero; converged is a positive terminal state. */
function AuditBurndownCard() {
  const A = window.GA.audit;
  const I = window.GA.icons;
  A.store.use();
  const s = A.store.snapshot();
  const b = s.backlog;
  const converged = b.converged;

  return (
    <section className={"au-hero " + (converged ? "converged" : "converging")}>
      <header className="rk-head">
        <span className={"rk-glyph " + (converged ? "converged" : "converging")}>
          {converged ? <I.checkCircle size={20} /> : <I.activity size={20} />}
        </span>
        <div className="rk-headline">
          <div className="rk-title-row">
            <span className="rk-title">audit backlog</span>
            <span className={"rk-badge " + (converged ? "converged" : "converging")}>{converged ? "clean" : "draining"}</span>
          </div>
          <p className="rk-sub">
            {converged
              ? "Every alias and edge row has been audited. The backlog holds at zero — new rows are swept within a tick."
              : "Un-audited alias and edge rows still to sweep. Each pass drains the backlog toward zero; the good state is empty and staying empty."}
          </p>
        </div>
      </header>

      <div className="au-hero-grid">
        <div className="au-burn-block">
          <div className="au-burn-head">
            <div className="au-burn-count">
              <span className={"au-burn-v" + (b.alias === 0 ? " zero" : "")}>{b.alias.toLocaleString()}</span>
              <span className="au-burn-k"><span className="au-dot au-dot-alias" /> alias rows</span>
            </div>
            <BurndownSpark series={b.aliasSeries} tone="g" />
          </div>
        </div>
        <div className="au-burn-block">
          <div className="au-burn-head">
            <div className="au-burn-count">
              <span className={"au-burn-v" + (b.edge === 0 ? " zero" : "")}>{b.edge.toLocaleString()}</span>
              <span className="au-burn-k"><span className="au-dot au-dot-edge" /> edge rows</span>
            </div>
            <BurndownSpark series={b.edgeSeries} tone="p" />
          </div>
        </div>
      </div>

      <p className="rk-foot">
        {converged ? (
          <><I.checkCircle size={12} /> Backlog cleared {A.relAge(b.clearedAt)}.<span className="rk-sep">·</span>Sweeps every {s.cadenceMin}m and exits immediately while there's nothing to audit.</>
        ) : (
          <><I.clock size={12} /> {b.total.toLocaleString()} rows to go.<span className="rk-sep">·</span>Sweeps every {s.cadenceMin}m<span className="rk-sep">·</span>last sweep {A.relAge(s.lastSweep)}.</>
        )}
      </p>
    </section>
  );
}

/* One audit pass as a compact convergence card: state, this-tick summary chips,
   and an audited/tick sparkline. */
function AuditPassCard({ pass }) {
  const A = window.GA.audit;
  const I = window.GA.icons;
  const Ico = I[pass.icon] || I.activity;
  const converged = pass.converged;

  return (
    <div className={"au-pass " + (converged ? "converged" : "converging")}>
      <div className="au-pass-head">
        <span className={"au-pass-ico " + (converged ? "converged" : "converging")}><Ico size={16} /></span>
        <span className="au-pass-name">{pass.label}</span>
        <span className={"au-pass-badge " + (converged ? "converged" : "converging")}>
          {converged ? "settled" : "auditing"}
        </span>
      </div>
      <p className="au-pass-blurb">{pass.blurb}</p>

      <div className="au-pass-spark">
        <div className="au-pass-spark-cap">
          <span>{converged ? "no-op" : pass.auditedThisTick + " audited · " + pass.changedThisTick + " changed"} / tick</span>
          <span className="au-pass-axis">last {pass.ticks.length} →</span>
        </div>
        <AuditedSpark ticks={pass.ticks} />
      </div>

      <div className="jstats au-pass-stats">
        {pass.summary.map(([k, v]) => (
          <span className="jstat" key={k}>
            <span className="jstat-k">{k}</span>
            <span className="jstat-v">{typeof v === "number" ? v.toLocaleString() : v}</span>
          </span>
        ))}
      </div>

      <p className="au-pass-foot">
        <I.clock size={11} /> ran {A.relAge(pass.lastRun)}
        <span className="rk-sep">·</span>
        {converged
          ? <>clean since {A.fmtDate(pass.sinceClean)}</>
          : <>{pass.lifetime.toLocaleString()} audited since {A.fmtDate(pass.startedAt)}</>}
      </p>
    </div>
  );
}

/* Replay / restoration log — one-shot events where a later pass re-decided a
   past edge drop. Each links back to the decision it revisits. */
function RestorationsSection({ onOpenDecision }) {
  const A = window.GA.audit;
  const I = window.GA.icons;
  const KIND = A.replayKinds;
  const KIND_ICON = { restored: I.rotate, "pair-re-decided": I.gitMerge, immune: I.shield };

  return (
    <div className="au-restore">
      {A.restorations.map((r) => {
        const meta = KIND[r.kind];
        const KIco = KIND_ICON[r.kind] || I.rotate;
        return (
          <div className={"au-rst tone-" + meta.tone} key={r.id}>
            <span className="au-rst-ico"><KIco size={15} /></span>
            <div className="au-rst-main">
              <div className="au-rst-top">
                <span className={"au-rst-kind tone-" + meta.tone}>{meta.label}</span>
                <span className="au-rst-edge">
                  <code>{r.from}</code><I.arrowRight size={12} /><code>{r.to}</code>
                  <span className="au-rst-rel">{r.rel}</span>
                </span>
                <span className="au-rst-time muted">{A.relAge(r.at)}</span>
              </div>
              <div className="au-rst-verdict">{r.verdict}</div>
              <div className="au-rst-origin">
                revisits
                <button className="au-rst-link" onClick={() => onOpenDecision && onOpenDecision(r.origin)} title="Open the original decision">
                  <span className="au-rst-was">{r.was}</span> <code>{r.origin}</code>
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* Merge-rejection memory — co-resolution pairs held under a 30-day backoff. */
function RejectionsSection() {
  const A = window.GA.audit;
  const I = window.GA.icons;
  return (
    <div className="cfg-table-wrap au-rej-wrap">
      <table className="cfg-table au-rej-table">
        <thead>
          <tr>
            <th>Rejected pair</th>
            <th>Reason</th>
            <th>Rejected</th>
            <th>Backoff ends</th>
          </tr>
        </thead>
        <tbody>
          {A.rejections.map((r) => (
            <tr key={r.id}>
              <td>
                <span className="au-rej-pair">
                  <code>{r.a}</code><span className="au-rej-x"><I.ban size={12} /></span><code>{r.b}</code>
                </span>
              </td>
              <td className="au-rej-reason muted small">{r.reason}</td>
              <td className="small muted">{A.relAge(r.rejectedAt)}</td>
              <td className="small">
                <span className="au-rej-until"><I.clock size={12} /> {A.relFuture(r.expiresAt)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* Review-only affordance: flip the shared audit store between states. Drop on
   translate — the real surfaces read the live snapshot on their own. */
function AuditPreviewToggle() {
  const A = window.GA.audit;
  A.store.use();
  const mode = A.store.get();
  return (
    <div className="rk-preview">
      <span className="rk-preview-cap">Preview state</span>
      <div className="seg rk-preview-seg">
        {A.presets.map((p) => (
          <button key={p.key} className={"seg-btn" + (mode === p.key ? " active" : "")} onClick={() => A.store.set(p.key)}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* The Audits tab. */
function AuditsTab({ onOpenDecision }) {
  const A = window.GA.audit;
  A.store.use();
  const s = A.store.snapshot();

  return (
    <div className="au-tab">
      <p className="nz-queue-blurb muted small">
        The identity graph re-checks itself continuously. Three rolling passes drain a backlog of un-audited rows
        to zero and hold it there — repointing bad aliases, dropping unsound edges, and re-keying the SKU cache.
        Empty is healthy.
      </p>

      <AuditPreviewToggle />
      <AuditBurndownCard />

      <p className="group-label">Audit passes</p>
      <div className="au-pass-grid">
        {s.passes.map((p) => <AuditPassCard pass={p} key={p.id} />)}
      </div>

      <p className="group-label">Restorations · replay log</p>
      <p className="au-section-note muted small">
        One-shot events where a smarter pass revisited a past edge drop. Restored edges are back; immune drops are
        confirmed and won't be re-litigated.
      </p>
      <RestorationsSection onOpenDecision={onOpenDecision} />

      <p className="group-label">Merge-rejection memory</p>
      <p className="au-section-note muted small">
        Co-resolution pairs the classifier declined to merge, held under a {A.backoffDays}-day backoff so the same
        pair isn't re-litigated every sweep.
      </p>
      <RejectionsSection />
    </div>
  );
}

/* Status › Background jobs — the audit as a single self-terminating sibling job
   (like reconcile). No uptime%: a draining backfill has no meaningful uptime.
   Expands to the three passes' this-tick counts. Clicking jumps to Audits. */
function AuditStatusRow({ onNavigate }) {
  const { Item, Badge } = window.DesignSystem_959bdd;
  const A = window.GA.audit;
  const I = window.GA.icons;
  A.store.use();
  const s = A.store.snapshot();
  const b = s.backlog;
  const converged = b.converged;
  const go = () => onNavigate && onNavigate("Normalize");

  return (
    <Item
      variant="outline"
      className={"job-item au-job " + (converged ? "converged" : "converging")}
      media={<span className={"sglyph " + (converged ? "ok" : "rk-run")}>{converged ? <I.checkCircle /> : <I.activity />}</span>}
      title={<button className="rk-job-name" onClick={go}>identity-audit <I.arrowRight size={12} /></button>}
      description={
        <span className="job-meta">
          {converged
            ? <>Audited clean — backlog at zero<span className="job-sep">·</span>cleared {A.relAge(b.clearedAt)}</>
            : <>Ran {A.relAge(s.lastSweep)}<span className="job-sep">·</span>{b.total.toLocaleString()} rows to audit<span className="job-sep">·</span>draining</>}
        </span>
      }
      actions={<Badge variant="secondary">{converged ? "clean" : "draining"}</Badge>}
    >
      <div className="rk-status-spark">
        <div className="uptime-head">
          <span className="uptime-cap">Backlog burndown</span>
          <span className="uptime-pct">{converged ? "holding at zero" : b.total.toLocaleString() + " remaining"}</span>
        </div>
        <div className="au-status-burns">
          <div className="au-status-burn"><BurndownSpark series={b.aliasSeries} tone="g" className="compact" /><span className="au-status-lab">alias</span></div>
          <div className="au-status-burn"><BurndownSpark series={b.edgeSeries} tone="p" className="compact" /><span className="au-status-lab">edge</span></div>
        </div>
      </div>
      <div className="jstats">
        {s.passes.map((p) => (
          <span className="jstat" key={p.id}>
            <span className="jstat-k">{p.label.replace(" audit", "").replace("-cache re-key", " cache")}</span>
            <span className="jstat-v">{p.converged ? "0" : p.auditedThisTick}</span>
          </span>
        ))}
      </div>
    </Item>
  );
}

window.GA = window.GA || {};
window.GA.AuditsTab = AuditsTab;
window.GA.AuditStatusRow = AuditStatusRow;
window.GA.AuditBurndownSpark = BurndownSpark;
