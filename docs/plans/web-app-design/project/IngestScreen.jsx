/* Discovery › Scrapers — the read-only operator view of walled-source ingest.
   Rendered as a sub-tab of Discovery (ingest is the input funnel to the sweep).
   Pure SSR, like Status/Usage: no mutations — key management lives in
   Config › Ingest Keys. One card per SCRAPER (machine): its overall liveness in
   the /health posture language (fresh · stale · never), the reported scraper +
   contract version (with a skew chip when the machine's contract is behind the
   Worker's), and a per-source breakdown. Then the throughput funnel and a recent
   -pushes log. Reads GA.ingest. Exposed as GA.ScrapersView (alias GA.IngestScreen). */
function ScrapersView() {
  const I = window.GA.icons;
  const N = window.GA.ingest;

  const HEALTH = { fresh: "fresh", stale: "stale", never: "never" };
  function HealthBadge({ state }) {
    return (
      <span className={"ig-health ig-h-" + state}>
        <span className="ig-hdot" />
        {HEALTH[state] || "never"}
      </span>
    );
  }

  const cards = [
    { icon: <I.inbox />, label: "Scrapers", value: N.stats.activeScrapers, sub: N.stats.sources + " sources" },
    { icon: <I.activity />, label: "Fresh", value: N.stats.fresh, sub: N.stats.stale ? N.stats.stale + " stale" : "all live" },
    { icon: <I.download />, label: "Pushes · 24h", value: N.stats.pushes24h },
    { icon: <I.shield />, label: "Contract", value: N.contractVersion, sub: "worker" },
  ];

  // ── Throughput funnel ──────────────────────────────────────────────────
  const arrivalMax = Math.max(...N.funnel.arrival.map((s) => s.value));
  function Funnel() {
    return (
      <div className="ig-funnel">
        <div className="ig-arrival">
          {N.funnel.arrival.map((s, i) => (
            <React.Fragment key={s.key}>
              <div className={"ig-fstep tone-" + s.tone}>
                <div className="ig-fval">{s.value}</div>
                <div className="ig-flabel">{s.label}</div>
                <div className="ig-fbar"><span style={{ width: (s.value / arrivalMax * 100) + "%" }} /></div>
                <div className="ig-fnote muted small">{s.note}</div>
              </div>
              {i < N.funnel.arrival.length - 1 && <span className="ig-farrow"><I.chevronRight size={18} /></span>}
            </React.Fragment>
          ))}
        </div>
        <div className="ig-down-head">
          <span className="ig-down-cap">Downstream outcomes</span>
          <span className="muted small">of the {N.funnel.arrival[3].value} handed to the sweep</span>
        </div>
        <div className="ig-down">
          {N.funnel.downstream.map((o) => (
            <div className={"ig-out kind-" + o.kind} key={o.key}>
              <span className="ig-out-val">{o.value}</span>
              <span className="ig-out-label">{o.label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="scrapers">
      <div className="area-head status-head">
        <button className="link-action"><I.refresh size={14} /> Refresh · last push {N.relAge(N.lastPush)}</button>
      </div>

      <div className="stat-grid">
        {cards.map((c) => (
          <div className="stat-card" key={c.label}>
            <div className="stat-top">
              <span className="stat-ico">{c.icon}</span>
              <span className="stat-label">{c.label}</span>
            </div>
            <div className="stat-value">{c.value}</div>
            {c.sub ? <div className="stat-sub">{c.sub}</div> : null}
          </div>
        ))}
      </div>

      {/* Scraper liveness — the hero. One card per machine. */}
      <p className="group-label">Scraper liveness</p>
      <div className="ig-live-grid">
        {N.activeScrapers.map((s) => {
          const never = s.health === "never";
          return (
            <div className={"ig-live-card" + (never ? " never" : "")} key={s.id}>
              <div className="ig-live-head">
                <div className="ig-live-id">
                  <span className="ig-live-source">{s.label}</span>
                  <span className="ig-live-label">{s.sourceCount ? s.sourceCount + (s.sourceCount === 1 ? " source" : " sources") : "no sources configured"}</span>
                </div>
                <HealthBadge state={s.health} />
              </div>

              <div className="ig-live-when">
                <span className={"ig-live-ago" + (never ? " none" : "")}>{never ? "no pushes yet" : N.relAge(s.lastPush)}</span>
                {!never && <span className="ig-live-ago-sub muted small">last push · {N.fmtAt(s.lastPush)} · {s.pushes24h} in 24h</span>}
              </div>

              {s.sources.length > 0 && (
                <div className="ig-src-list">
                  {s.sources.map((src) => (
                    <div className="ig-src" key={src.name}>
                      <span className={"ig-src-dot ig-h-" + src.health}><span className="ig-hdot" /></span>
                      <span className="ig-src-name">{src.name}</span>
                      <span className="ig-src-meta muted small">{N.relAge(src.lastPush)} · {src.pushes24h}/24h</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="ig-live-foot">
                {s.scraperVersion ? (
                  <>
                    <span className="ig-ver">scraper <code>{"v" + s.scraperVersion}</code></span>
                    <span className="dimsep">·</span>
                    <span className="ig-ver">contract <code>{s.contractVersion}</code></span>
                    {s.skew && (
                      <span className="ig-skew" title={"Worker is on contract " + N.contractVersion}>
                        <I.alert size={11} /> behind {N.contractVersion}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="muted small">key minted — no scraper has authenticated</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Throughput funnel */}
      <p className="group-label ig-gap">Throughput · last 24h</p>
      <Funnel />

      {/* Recent pushes */}
      <p className="group-label ig-gap">Recent pushes</p>
      <div className="cfg-table-wrap">
        <table className="cfg-table ig-push-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Scraper</th>
              <th>Source</th>
              <th className="ig-th-num">Batch</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {N.pushes.map((p) => {
              const r = N.results[p.result];
              return (
                <tr key={p.id}>
                  <td className="ig-push-when"><span className="ig-push-ago">{N.relAge(p.at)}</span><span className="muted small ig-push-abs">{N.fmtAt(p.at)}</span></td>
                  <td className="cfg-mono">{p.scraper}</td>
                  <td>{p.source === "unknown" ? <span className="muted">unknown</span> : p.source}</td>
                  <td className="ig-th-num cfg-num">{p.count || <span className="muted">0</span>}</td>
                  <td>
                    <span className={"ig-result ig-r-" + r.kind}>{r.label}</span>
                    {p.result === "partial" && <span className="muted small ig-push-note">{p.detail.deduped} deduped</span>}
                    {(p.result === "bad_payload" || p.result === "bad_key") && <span className="muted small ig-push-note">{p.detail.reason}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
window.GA = window.GA || {};
window.GA.ScrapersView = ScrapersView;
window.GA.IngestScreen = ScrapersView; // back-compat alias
