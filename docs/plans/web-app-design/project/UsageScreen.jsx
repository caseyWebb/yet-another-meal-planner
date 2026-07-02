/* Usage area — three observability surfaces, redesigned for Basecoat:
     1. Headline tiles (KV ops today, AI neurons, MCP calls 30d, error rate).
     2. Account resources — KV-operation + Workers AI meters against the
        Cloudflare daily free tier (Progress bars, recolored as they approach
        the cap).
     3. Per-job run trends — a 30-day runs/day sparkline per cron job.
     4. Tool usage — a table of MCP calls, error rate, and p50/p95 latency.
   Reads the shared GA.usage dataset. */
function UsageScreen() {
  const { Progress, Table, Badge } = window.DesignSystem_959bdd;
  const I = window.GA.icons;
  const u = window.GA.usage;

  const fmt = (n) => n.toLocaleString();
  const fmtK = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n));
  const KV_ROWS = ["read", "write", "delete", "list"];
  const { show, hide, Tip } = window.GA.useTip();

  // Map a bar index in a 30-day window to a compact date (oldest → newest, ending today).
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function dayLabel(i, len) {
    const d = new Date(Date.now() - (len - 1 - i) * 86400000);
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  }

  const kvTotal = KV_ROWS.reduce((n, k) => n + u.kv.totals[k], 0);
  const toolCalls = u.tools.reduce((n, t) => n + t.calls, 0);
  const toolErrors = u.tools.reduce((n, t) => n + t.errors, 0);
  const errRate = toolCalls ? (toolErrors / toolCalls) * 100 : 0;

  const tiles = [
    { icon: <I.database />, label: "KV ops · today", value: fmt(kvTotal) },
    { icon: <I.sparkles />, label: "AI neurons · today", value: fmt(u.ai.neuronsUsed), sub: `of ${fmt(u.ai.neuronsLimit)}` },
    { icon: <I.activity />, label: "MCP calls · 30d", value: fmt(toolCalls) },
    { icon: <I.checkCircle />, label: "Error rate · 30d", value: errRate.toFixed(1) + "%" },
  ];

  function Meter({ label, used, limit, history }) {
    const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
    const level = used >= limit ? "fail" : pct >= 80 ? "warn" : "ok";
    const peak = history ? Math.max(...history) : 0;
    return (
      <div className={"meter " + level}>
        <div className="meter-head">
          <span className="meter-label">{label}</span>
          <span className="meter-val">
            {fmt(used)} <span className="meter-lim">/ {fmt(limit)}</span>
          </span>
        </div>
        <Progress value={pct} />
        {history && (
          <div className="meter-trend">
            <Spark runs={history} flat unit={label} />
            <span className="meter-peak">peak {fmtK(peak)}</span>
          </div>
        )}
      </div>
    );
  }

  function Spark({ runs, flat, unit }) {
    const max = Math.max(1, ...runs);
    return (
      <div className={"spark" + (flat ? " meter-spark" : "")}>
        {runs.map((r, i) => (
          <span
            className="spark-bar"
            key={i}
            style={{ height: Math.max(8, Math.round((r / max) * 100)) + "%" }}
            onMouseEnter={(e) => show(e, { title: dayLabel(i, runs.length), body: `${fmt(r)} ${unit}` })}
            onMouseLeave={hide}
          />
        ))}
      </div>
    );
  }

  // Tooltip body: a per-namespace breakdown with a total line.
  function nsBreakdown(getVal, total, unit) {
    return (
      <>
        {u.kv.namespaces.map((x) => (
          <span className="tip-ns" key={x.id}>
            <span className="tip-dot" style={{ background: x.color }} />
            <span className="tip-ns-name">{x.id}</span>
            <span className="tip-ns-val">{fmt(getVal(x))}</span>
          </span>
        ))}
        <span className="tip-total">{fmt(total)} {unit}</span>
      </>
    );
  }

  // A KV-operation meter: a stacked bar (per namespace, against the daily limit)
  // plus a stacked 30-day sparkline split into the same namespace segments.
  function KvMeter({ op }) {
    const o = u.kv.ops[op];
    const ns = u.kv.namespaces;
    const limit = o.limit;
    const total = ns.reduce((n, x) => n + o.byNs[x.id], 0);
    const level = total >= limit ? "fail" : total / limit >= 0.8 ? "warn" : "ok";
    const len = o.history[ns[0].id].length;
    const dayTotals = Array.from({ length: len }, (_, i) => ns.reduce((n, x) => n + o.history[x.id][i], 0));
    const max = Math.max(1, ...dayTotals);
    return (
      <div className={"meter " + level}>
        <div className="meter-head">
          <span className="meter-label">{op}s</span>
          <span className="meter-val">{fmt(total)} <span className="meter-lim">/ {fmt(limit)}</span></span>
        </div>
        <div className="kv-bar">
          {ns.map((x) => (
            <span
              key={x.id}
              className="kv-seg"
              style={{ width: (o.byNs[x.id] / limit) * 100 + "%", background: x.color }}
              onMouseEnter={(e) => show(e, { title: x.id, body: `${fmt(o.byNs[x.id])} ${op}s today` })}
              onMouseLeave={hide}
            />
          ))}
        </div>
        <div className="meter-trend">
          <div className="spark meter-spark kv-spark">
            {dayTotals.map((dt, i) => (
              <span
                key={i}
                className="spark-col"
                style={{ height: Math.max(6, (dt / max) * 100) + "%" }}
                onMouseEnter={(e) => show(e, { title: dayLabel(i, len), body: nsBreakdown((x) => o.history[x.id][i], dt, op + "s") })}
                onMouseLeave={hide}
              >
                {ns.map((x) => (
                  <span key={x.id} className="spark-seg" style={{ height: (dt ? (o.history[x.id][i] / dt) * 100 : 0) + "%", background: x.color }} />
                ))}
              </span>
            ))}
          </div>
          <span className="meter-peak">peak {fmtK(max)}</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="area-head status-head">
        <button className="link-action">
          <I.refresh size={14} /> Refresh · as of {u.day} UTC
        </button>
      </div>

      {/* Headline tiles */}
      <div className="stat-grid">
        {tiles.map((t) => (
          <div className="stat-card" key={t.label}>
            <div className="stat-top">
              <span className="stat-ico">{t.icon}</span>
              <span className="stat-label">{t.label}</span>
            </div>
            <div className="stat-value">{t.value}</div>
            {t.sub && <div className="stat-sub">{t.sub}</div>}
          </div>
        ))}
      </div>

      {/* Account resources */}
      <p className="group-label">Account resources · daily free tier</p>
      <div className="card usage-card">
        <section>
          <div className="usage-sub">KV operations</div>
          <div className="kv-legend">
            {u.kv.namespaces.map((x) => (
              <span className="kv-leg" key={x.id}>
                <span className="kv-leg-dot" style={{ background: x.color }} />
                <span className="kv-leg-name">{x.id}</span>
                <span className="kv-leg-note muted">{x.note}</span>
              </span>
            ))}
          </div>
          <div className="meter-list">
            {KV_ROWS.map((k) => (
              <KvMeter key={k} op={k} />
            ))}
          </div>
          <div className="usage-sep" />
          <div className="usage-sub">Workers AI</div>
          <div className="meter-list">
            <Meter label="neurons" used={u.ai.neuronsUsed} limit={u.ai.neuronsLimit} history={u.ai.history} />
          </div>
          <div className="jstats" style={{ marginTop: ".7rem" }}>
            {u.ai.byModel.map((m) => (
              <span className="jstat" key={m.model}>
                <span className="jstat-k">{m.model}</span>
                <span className="jstat-v">{fmt(m.neurons)}</span>
              </span>
            ))}
          </div>
        </section>
      </div>

      {/* Per-job trends */}
      <p className="group-label">Per-job runs · last {u.windowDays} days</p>
      <div className="card usage-card">
        <section className="trend-list">
          {u.jobs.map((j) => (
            <div className="trend-row" key={j.job}>
              <span className="trend-name">{j.job}</span>
              <Spark runs={j.runs} unit="runs" />
              <span className="trend-stat">{fmt(j.total)} runs</span>
              <span className="trend-stat muted">{j.avgMs} ms avg</span>
            </div>
          ))}
        </section>
      </div>

      {/* Tool usage */}
      <p className="group-label">Tool usage · last {u.windowDays} days</p>
      <div className="card usage-card">
        <section>
          <Table
            columns={[
              "Tool",
              { key: "calls", label: "Calls", align: "right" },
              { key: "err", label: "Errors", align: "right" },
              { key: "p50", label: "p50", align: "right" },
              { key: "p95", label: "p95", align: "right" },
            ]}
            rows={u.tools.map((t) => {
              const pct = t.calls ? (t.errors / t.calls) * 100 : 0;
              return {
                Tool: <span className="tool-name">{t.tool}</span>,
                calls: fmt(t.calls),
                err: t.errors === 0
                  ? <span className="muted">0</span>
                  : <span className="tool-err">{t.errors} · {pct.toFixed(1)}%</span>,
                p50: t.p50 + " ms",
                p95: t.p95 + " ms",
              };
            })}
          />
        </section>
      </div>
      {Tip}
    </>
  );
}
window.GA = window.GA || {};
window.GA.UsageScreen = UsageScreen;
