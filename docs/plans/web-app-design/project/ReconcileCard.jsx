/* grocery/pantry key-reconcile — observability surface.

   Two renderers over one shared model (window.GA.reconcile):

     · ReconcileCard  — the primary surface, a convergence card that lives at
       the TOP of the Normalization area (the reconcile is the identity graph
       applied to member grocery/pantry rows, so it belongs beside the graph it
       reads). Two states:
         converging → accent, live counts, per-tick sparkline, backlog note.
         converged  → a POSITIVE terminal state (green check, "converged"),
                      not a dead "0" — this is the whole design point.

     · ReconcileStatusRow — the secondary surface, a sibling job row for the
       Status page's Background jobs list. Same state language, no uptime bar
       (uptime% is meaningless for a self-terminating backfill). Clicking it
       jumps to the Normalize area.

   A small review toggle (ReconcilePreviewToggle) flips the shared store between
   converging / backlog / converged so both surfaces can be seen in every state.
   Delete the toggle when translating into the real panel — the surfaces read
   the live snapshot on their own. */

/* Per-tick stacked sparkline: grocery (accent) below, pantry (deep) above.
   Bars scale to the tallest tick shown; zero ticks render as a thin floor —
   which is exactly how "converged" reads: a run of silent no-ops. */
function ReconcileSpark({ ticks, className }) {
  const RK = window.GA.reconcile;
  const max = Math.max(1, ...ticks.map(RK.tickTotal));
  return (
    <div className={"rk-spark" + (className ? " " + className : "")} role="img" aria-label="grocery and pantry rows re-keyed per recent tick">
      {ticks.map((t, i) => {
        const total = RK.tickTotal(t);
        const h = total === 0 ? 0 : Math.max(6, Math.round((total / max) * 100));
        return (
          <div className="rk-col" key={i} title={total === 0 ? "no-op" : `${t.g} grocery · ${t.p} pantry`}>
            {total === 0
              ? <span className="rk-col-zero" />
              : (
                <span className="rk-col-stack" style={{ height: h + "%" }}>
                  <span className="rk-seg rk-seg-p" style={{ flex: t.p }} />
                  <span className="rk-seg rk-seg-g" style={{ flex: t.g }} />
                </span>
              )}
          </div>
        );
      })}
    </div>
  );
}

function ReconcileCard() {
  const RK = window.GA.reconcile;
  const I = window.GA.icons;
  const mode = RK.store.use();
  const s = RK.snapshot ? RK.snapshot() : RK.store.snapshot();
  const state = RK.deriveState(s);
  const thisTick = s.grocery_rekeyed + s.pantry_rekeyed;

  const converged = state === "converged";

  return (
    <section className={"rk-card " + state}>
      <header className="rk-head">
        <span className={"rk-glyph " + state}>
          {converged ? <I.checkCircle size={20} /> : <I.gitMerge size={20} />}
        </span>
        <div className="rk-headline">
          <div className="rk-title-row">
            <span className="rk-title">grocery / pantry reconcile</span>
            <span className={"rk-badge " + state}>{converged ? "converged" : "converging"}</span>
          </div>
          <p className="rk-sub">
            {converged
              ? "Every grocery & pantry row resolves to a canonical id. Nothing left to re-key."
              : "Re-keying grocery & pantry rows onto canonical ids — merging surface-form duplicates as the identity graph learns them."}
          </p>
        </div>
      </header>

      {converged ? (
        <div className="rk-done">
          <dl className="rk-facts">
            <div className="rk-fact">
              <dt>Rows re-keyed to date</dt>
              <dd>{s.lifetimeMerged.toLocaleString()}</dd>
            </div>
            <div className="rk-fact">
              <dt>Converged</dt>
              <dd>{RK.relAge(s.convergedAt)}</dd>
            </div>
            <div className="rk-fact">
              <dt>Last tick</dt>
              <dd className="rk-noop">{RK.relAge(s.lastTick)} · no-op</dd>
            </div>
          </dl>
          <ReconcileSpark ticks={s.ticks} />
          <p className="rk-foot">
            <I.clock size={12} /> Runs every {s.cadenceMin}m and exits immediately while there's nothing to do.
            <span className="rk-sep">·</span>
            Last merge {RK.relAge(s.lastMerge)}.
          </p>
        </div>
      ) : (
        <div className="rk-live">
          <div className="rk-counts">
            <div className="rk-count">
              <div className="rk-count-v">{s.grocery_rekeyed.toLocaleString()}</div>
              <div className="rk-count-k"><span className="rk-dot rk-dot-g" /> grocery re-keyed</div>
            </div>
            <div className="rk-count">
              <div className="rk-count-v">{s.pantry_rekeyed.toLocaleString()}</div>
              <div className="rk-count-k"><span className="rk-dot rk-dot-p" /> pantry re-keyed</div>
            </div>
            <div className="rk-count rk-count-tot">
              <div className="rk-count-v">{thisTick.toLocaleString()}</div>
              <div className="rk-count-k">this tick</div>
            </div>
          </div>

          <div className="rk-spark-wrap">
            <div className="rk-spark-cap">
              <span>rows re-keyed / tick</span>
              <span className="rk-spark-axis">last {s.ticks.length} runs →</span>
            </div>
            <ReconcileSpark ticks={s.ticks} />
          </div>

          {s.truncated ? (
            <div className="rk-backlog">
              <I.alert size={14} />
              <span>
                <strong>Backlog remaining.</strong> Hit the {s.cap}/tick cap — the rest converges next run
                {typeof s.backlogEst === "number" ? <> (~{s.backlogEst.toLocaleString()} rows to go)</> : null}.
              </span>
            </div>
          ) : (
            <p className="rk-foot">
              <I.clock size={12} /> Last tick {RK.relAge(s.lastTick)}.
              <span className="rk-sep">·</span>
              {s.lifetimeMerged.toLocaleString()} rows re-keyed since {RK.fmtDate(s.startedAt)}.
              <span className="rk-sep">·</span>
              Self-terminates once every row is canonical.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/* Status › Background jobs — the reconcile as a sibling of the recurring crons.
   Returns a DS <Item>. No uptime sparkline: a self-terminating backfill has no
   meaningful uptime%. Converged reads as a calm positive state, never "failing"
   or "never run". */
function ReconcileStatusRow({ onNavigate }) {
  const { Item, Badge } = window.DesignSystem_959bdd;
  const RK = window.GA.reconcile;
  const I = window.GA.icons;
  const mode = RK.store.use();
  const s = RK.snapshot ? RK.snapshot() : RK.store.snapshot();
  const state = RK.deriveState(s);
  const converged = state === "converged";
  const thisTick = s.grocery_rekeyed + s.pantry_rekeyed;

  const go = () => onNavigate && onNavigate("Normalize");

  const stats = converged
    ? [["state", "idle"], ["to date", s.lifetimeMerged.toLocaleString()]]
    : [["grocery", s.grocery_rekeyed], ["pantry", s.pantry_rekeyed], ["truncated", String(s.truncated)]];

  return (
    <Item
      variant="outline"
      className={"job-item rk-job " + state}
      media={
        <span className={"sglyph " + (converged ? "ok" : "rk-run")}>
          {converged ? <I.checkCircle /> : <I.gitMerge />}
        </span>
      }
      title={
        <button className="rk-job-name" onClick={go}>
          grocery-reconcile <I.arrowRight size={12} />
        </button>
      }
      description={
        <span className="job-meta">
          {converged ? (
            <>Caught up — nothing to re-key<span className="job-sep">·</span>last merge {RK.relAge(s.lastMerge)}</>
          ) : (
            <>Ran {RK.relAge(s.lastTick)}<span className="job-sep">·</span>{thisTick} rows re-keyed this tick
              {s.truncated ? <><span className="job-sep">·</span><span className="txt-bad">backlog remaining</span></> : null}</>
          )}
        </span>
      }
      actions={<Badge variant="secondary">{converged ? "converged" : "converging"}</Badge>}
    >
      <div className="rk-status-spark">
        <div className="uptime-head">
          <span className="uptime-cap">Re-key history</span>
          <span className="uptime-pct">last {s.ticks.length} runs</span>
        </div>
        <ReconcileSpark ticks={s.ticks} className="compact" />
      </div>
      <div className="jstats">
        {stats.map(([k, v]) => (
          <span className="jstat" key={k}>
            <span className="jstat-k">{k}</span>
            <span className="jstat-v">{v}</span>
          </span>
        ))}
      </div>
    </Item>
  );
}

/* Review-only affordance: flip the shared store between review states so both
   surfaces can be inspected in every state. Not part of the product — drop it
   on translate. */
function ReconcilePreviewToggle() {
  const RK = window.GA.reconcile;
  const mode = RK.store.use();
  return (
    <div className="rk-preview">
      <span className="rk-preview-cap">Preview state</span>
      <div className="seg rk-preview-seg">
        {RK.presets.map((p) => (
          <button key={p.key} className={"seg-btn" + (mode === p.key ? " active" : "")} onClick={() => RK.store.set(p.key)}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

window.GA = window.GA || {};
window.GA.ReconcileCard = ReconcileCard;
window.GA.ReconcileStatusRow = ReconcileStatusRow;
window.GA.ReconcilePreviewToggle = ReconcilePreviewToggle;
