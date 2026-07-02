/* Status area — "Service health", redesigned for the Basecoat design system.

   The overall Healthy/Degraded headline has MOVED OUT to the global corner
   indicator (app frame, every page). What's left here:
     1. Page-level corpus stats — recipes, members, RSS feeds, cached SKUs.
     2. The cron jobs, as Basecoat list items: status glyph, name, last-ran-at,
        healthy/unhealthy-since, a status badge, and the job's own summary counts.
     3. Live dependencies (D1 probe, admin gate) in a second item group.
   Reads the shared GA.health model. */
function StatusScreen({ onNavigate }) {
  const { Item, ItemGroup, Badge, Alert } = window.DesignSystem_959bdd;
  const I = window.GA.icons;
  const h = window.GA.health;
  const N = window.GA.ingest;
  const { show, hide, Tip } = window.GA.useTip();

  const GLYPH = { ok: I.checkCircle, fail: I.xCircle, never: I.minusCircle };

  function StatusGlyph({ state }) {
    const G = GLYPH[state] || I.minusCircle;
    return <span className={"sglyph " + state}><G /></span>;
  }

  function badgeFor(state) {
    if (state === "ok") return ["secondary", "ok"];
    if (state === "fail") return ["destructive", "failing"];
    return ["outline", "never run"];
  }

  function JobStats({ stats }) {
    return (
      <div className="jstats">
        {stats.map(([k, v]) => (
          <span className="jstat" key={k}>
            <span className="jstat-k">{k}</span>
            <span className="jstat-v">{v}</span>
          </span>
        ))}
      </div>
    );
  }

  // Recipe-backfill convergence gauge: unresolved recipe terms draining toward
  // zero as normalization catches up. `degraded` gets a calm amber note, never
  // a failure — a single bad tick just resumes next run.
  function Backfill({ b }) {
    const Spark = window.GA.AuditBurndownSpark;
    const pct = Math.round((1 - b.unresolved / b.start) * 100);
    return (
      <div className="bf-gauge">
        <div className="uptime-head">
          <span className="uptime-cap">Recipe backfill</span>
          <span className="uptime-pct">{b.unresolved} unresolved · {pct}% resolved</span>
        </div>
        {Spark && <Spark series={b.series} tone="b" className="compact" />}
        <div className="bf-foot">
          <span className="bf-note">{b.start} distinct recipe terms → {b.unresolved} not yet in the identity graph, draining over hours.</span>
          {b.degraded &&
            <span className="bf-degraded" title={b.degradedNote}>
              <I.alert size={12} /> degraded tick {h.relAge(b.degradedAt)}
            </span>}
        </div>
      </div>
    );
  }

  function Uptime({ runs }) {
    const ordered = [...runs].reverse(); // oldest → newest
    const okCount = runs.filter((r) => r.ok).length;
    const pct = Math.round((okCount / runs.length) * 100);
    return (
      <div className="uptime">
        <div className="uptime-head">
          <span className="uptime-cap">Run history</span>
          <span className="uptime-pct">{pct}% uptime · {runs.length} runs</span>
        </div>
        <div className="uptime-track">
          {ordered.map((run) => (
            <button
              type="button"
              className={"uptime-bar " + (run.ok ? "ok" : "fail")}
              key={run.id}
              onMouseEnter={(e) => show(e, { title: `${run.n} ${run.n === 1 ? "run" : "runs"} ago`, body: (run.ok ? "completed ok" : run.error) + " · click to view log", variant: run.ok ? null : "fail" })}
              onMouseLeave={hide}
              onClick={() => { hide(); window.GA.openLog && window.GA.openLog(run.id); }}
              aria-label={`run ${run.n} runs ago — ${run.ok ? "ok" : "failed"}, view log`}
            />
          ))}
        </div>
        <div className="uptime-axis">
          <span>older</span>
          <span>now</span>
        </div>
      </div>
    );
  }

  function sinceLabel(since) {
    const verb = since.state === "ok" ? "Healthy since" : "Unhealthy since";
    return { verb, at: h.fmtAt(since.at), bad: since.state !== "ok" };
  }

  const cards = [
    { icon: <I.utensils />, label: "Recipes", value: h.counts.recipes.toLocaleString(), nav: "Data" },
    { icon: <I.users />, label: "Members", value: h.counts.members.toLocaleString(), nav: "Members" },
    { icon: <I.rss />, label: "RSS feeds", value: h.counts.feeds.toLocaleString(), onClick: () => window.GA.openConfigFeeds && window.GA.openConfigFeeds() },
    { icon: <I.database />, label: "Cached SKUs", value: h.counts.skus.toLocaleString(), onClick: () => window.GA.openStores && window.GA.openStores() },
  ];

  return (
    <>
      <div className="area-head status-head">
        <button className="link-action">
          <I.refresh size={14} /> Refresh · checked {h.relAge(h.generatedAt)}
        </button>
      </div>

      {/* Page-level corpus stats */}
      <div className="stat-grid">
        {cards.map((c) => {
          const clickable = (c.nav && onNavigate) || !!c.onClick;
          const go = () => { if (c.onClick) c.onClick(); else if (onNavigate) onNavigate(c.nav); };
          return (
            <div
              className={"stat-card" + (clickable ? " stat-card-link" : "")}
              key={c.label}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable ? go : undefined}
              onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } } : undefined}
            >
              <div className="stat-top">
                <span className="stat-ico">{c.icon}</span>
                <span className="stat-label">{c.label}</span>
                {clickable && <span className="stat-go"><I.arrowRight size={14} /></span>}
              </div>
              <div className="stat-value">{c.value}</div>
            </div>
          );
        })}
      </div>

      {/* Cron jobs */}
      <p className="group-label">Background jobs</p>
      <ItemGroup className="job-list">
        {h.jobs.map((job) => {
          const [variant, word] = badgeFor(job.state);
          const s = sinceLabel(job.since);
          return (
            <Item
              key={job.name}
              variant="outline"
              className={"job-item " + job.state}
              media={<StatusGlyph state={job.state} />}
              title={<span className="job-name">{job.name}</span>}
              description={
                <span className="job-meta">
                  Ran {h.relAge(job.lastRun)}
                  <span className="job-sep">·</span>
                  <span className={s.bad ? "txt-bad" : ""}>{s.verb} {s.at}</span>
                </span>
              }
              actions={<Badge variant={variant}>{word}</Badge>}
            >
              <Uptime runs={job.runs} />
              <JobStats stats={job.stats} />
              {job.backfill && <Backfill b={job.backfill} />}
            </Item>
          );
        })}
        {window.GA.ReconcileStatusRow && <window.GA.ReconcileStatusRow onNavigate={onNavigate} />}
        {window.GA.AuditStatusRow && <window.GA.AuditStatusRow onNavigate={onNavigate} />}
      </ItemGroup>

      {/* Live dependencies */}
      <p className="group-label">Dependencies</p>
      <ItemGroup className="job-list">
        {h.deps.map((dep) => {
          const [variant, word] = badgeFor(dep.state);
          const Ico = I[dep.icon] || I.database;
          return (
            <Item
              key={dep.name}
              variant="outline"
              className={"job-item " + dep.state}
              media={<span className="dep-ico"><Ico /></span>}
              title={<span className="job-name">{dep.name}</span>}
              description={<span className="job-meta">{dep.detail}</span>}
              actions={<Badge variant={variant}>{dep.word || word}</Badge>}
            />
          );
        })}
      </ItemGroup>
      {/* Ingest scrapers — home-network boxes pushing walled-source recipes. */}
      {N && (
        <>
          <p className="group-label">Ingest scrapers</p>
          <ItemGroup className="job-list">
            {N.activeScrapers.map((s) => {
              const glyph = s.health === "fresh" ? "ok" : s.health === "stale" ? "stale" : "never";
              const G = s.health === "fresh" ? I.checkCircle : s.health === "stale" ? I.alert : I.minusCircle;
              const badge = s.health === "fresh" ? ["secondary", "fresh"] : s.health === "stale" ? ["destructive", "stale"] : ["outline", "never"];
              return (
                <Item
                  key={s.id}
                  variant="outline"
                  className={"job-item " + (s.health === "stale" ? "fail" : "")}
                  media={<span className={"sglyph " + glyph}><G /></span>}
                  title={<span className="job-name">{s.label}</span>}
                  description={
                    <span className="job-meta">
                      {s.sourceCount ? `${s.sourceCount} ${s.sourceCount === 1 ? "source" : "sources"}` : "no sources configured"}
                      <span className="job-sep">·</span>
                      {s.lastPush == null ? "no pushes yet" : <>last push {N.relAge(s.lastPush)}<span className="job-sep">·</span>{s.pushes24h} in 24h</>}
                      {s.skew && <> <span className="job-sep">·</span><span className="txt-bad">contract {s.contractVersion} → behind {N.contractVersion}</span></>}
                    </span>
                  }
                  actions={<Badge variant={badge[0]}>{badge[1]}</Badge>}
                />
              );
            })}
          </ItemGroup>
        </>
      )}

      {Tip}
    </>
  );
}
window.GA = window.GA || {};
window.GA.StatusScreen = StatusScreen;
