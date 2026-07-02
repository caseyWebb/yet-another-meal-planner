/* Logs — the cron job run log. Every tick on the Status "run history" sparkline
   is a row here (linked by run id via window.GA.openLog). Filter by job; each run
   expands to its job_health summary, duration, and (on failure) the error. Reads
   GA.health.jobRuns. */
function LogsScreen({ logTarget }) {
  const I = window.GA.icons;
  const h = window.GA.health;
  const PrettyKV = window.GA.PrettyKV;
  const all = h.jobRuns; // newest first
  const jobNames = [];
  all.forEach((r) => { if (!jobNames.includes(r.job)) jobNames.push(r.job); });

  const [job, setJob] = React.useState("All");
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(25);
  const PAGE = pageSize;
  const [open, setOpen] = React.useState(null);
  const [hl, setHl] = React.useState(null);

  React.useEffect(() => {
    if (!logTarget || !logTarget.id) return;
    const run = h.jobRunsById[logTarget.id];
    if (!run) return;
    setJob(run.job);
    setOpen(run.id);
    setHl(run.id);
    const filtered = all.filter((r) => r.job === run.job);
    const idx = filtered.findIndex((r) => r.id === run.id);
    setPage(Math.max(0, Math.floor(idx / PAGE)));
    const t = setTimeout(() => setHl(null), 2600);
    return () => clearTimeout(t);
  }, [logTarget]);

  const fmtDur = (ms) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
  const filtered = job === "All" ? all : all.filter((r) => r.job === job);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pg = Math.min(page, pages - 1);
  const shown = filtered.slice(pg * PAGE, pg * PAGE + PAGE);
  const okN = filtered.filter((r) => r.ok).length;

  const switchJob = (j) => { setJob(j); setPage(0); setOpen(null); };

  return (
    <div className="logs">
      <div className="area-head status-head">
        <button className="link-action"><I.refresh size={14} /> Refresh · last run {h.relAge(all[0].at)}</button>
      </div>

      <div className="data-nav">
        <button className={"pill" + (job === "All" ? " active" : "")} onClick={() => switchJob("All")}>All jobs</button>
        {jobNames.map((j) => (
          <button key={j} className={"pill" + (job === j ? " active" : "")} onClick={() => switchJob(j)}>{j}</button>
        ))}
      </div>

      <p className="recipe-hint muted small">
        {filtered.length} runs · {okN} ok · {filtered.length - okN} failed — every tick on the Status sparkline links here.
      </p>

      <div className="log-list">
        {shown.map((run) => {
          const Ico = I[run.icon] || I.activity;
          const isOpen = open === run.id;
          return (
            <div className={"log-entry" + (hl === run.id ? " hl" : "")} key={run.id}>
              <button className="log-row" onClick={() => setOpen(isOpen ? null : run.id)}>
                <span className={"dot " + (run.ok ? "ok" : "fail")} />
                <span className="log-job"><Ico size={14} /> {run.job}</span>
                <span className={"log-outcome " + (run.ok ? "ok" : "fail")}>{run.ok ? "ok" : "failed"}</span>
                <span className="log-time muted small" title={h.fmtAt(run.at)}>{h.relAge(run.at)}</span>
                <span className="log-dur muted small">{fmtDur(run.durationMs)}</span>
                <I.chevron size={15} className={"log-caret" + (isOpen ? " up" : "")} />
              </button>
              {isOpen && (
                <div className="log-detail">
                  <div className="log-meta">
                    <span><span className="muted small">ran</span> {h.fmtAt(run.at)}</span>
                    <span><span className="muted small">duration</span> {fmtDur(run.durationMs)}</span>
                    <span><span className="muted small">age</span> {run.n} {run.n === 1 ? "run" : "runs"} ago</span>
                  </div>
                  <p className="log-summary-label">job_health summary</p>
                  <PrettyKV obj={run.summary} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length > 0 && (
        <window.GA.ListFooter
          page={pg}
          pageSize={pageSize}
          total={filtered.length}
          onPage={setPage}
          onPageSize={(n) => { setPageSize(n); setPage(0); }}
          noun="run"
        />
      )}
    </div>
  );
}
window.GA = window.GA || {};
window.GA.LogsScreen = LogsScreen;
