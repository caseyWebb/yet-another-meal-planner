/* Discovery — the autonomous candidate pipeline (background-discovery-sweep).
   The page answers, per candidate: what steps has it been through, what's left,
   or where/why did it stop. The hero is a 7-stage progression track
   (triage → acquire → classify → describe → dedup → match → import); a candidate
   shows its furthest stage and the halt point coloured by outcome. Failed/parked
   candidates with a live retry clock can be retried manually. Filter + paginate.
   Reads GA.discovery. */
function DiscoveryScreen() {
  const { Button, Badge } = window.DesignSystem_959bdd;
  const I = window.GA.icons;
  const D = window.GA.discovery;
  const N = window.GA.ingest;
  const PrettyKV = window.GA.PrettyKV;
  const STAGES = D.stages;

  const [filter, setFilter] = React.useState("all");
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(25);
  const PAGE = pageSize;
  const [open, setOpen] = React.useState(null);
  const [view, setView] = React.useState("candidates"); // Candidates | Scrapers sub-tab
  const [cands, setCands] = React.useState(D.candidates);
  const [retried, setRetried] = React.useState({}); // id -> "running" | outcome

  const KIND_LABEL = {
    accepted: "accepted", dup: "duplicate", reject: "rejected", park: "parked", fail: "failed", defer: "deferred",
  };
  const FILTERS = [
    { key: "all", label: "All" },
    { key: "imported", label: "Imported" },
    { key: "retrying", label: "Retrying" },
    { key: "error", label: "Parked" },
    { key: "failed", label: "Failed" },
    { key: "no_match", label: "No match" },
    { key: "duplicate", label: "Duplicate" },
    { key: "dietary_gated", label: "Dietary" },
    { key: "deferred", label: "Deferred" },
  ];
  function countFor(k) {
    if (k === "all") return cands.length;
    if (k === "retrying") return cands.filter((c) => c.retryable).length;
    return cands.filter((c) => c.outcome === k).length;
  }

  const filtered = cands.filter((c) => {
    if (filter === "all") return true;
    if (filter === "retrying") return c.retryable || !!retried[c.id];
    return c.outcome === filter;
  });
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pg = Math.min(page, pages - 1);
  const shown = filtered.slice(pg * PAGE, pg * PAGE + PAGE);

  function switchFilter(k) { setFilter(k); setPage(0); setOpen(null); }

  function retry(c) {
    setRetried((r) => ({ ...r, [c.id]: "running" }));
    setTimeout(() => {
      // Manual retry is a single operator pass (bypassCap). Model a plausible resolve.
      const resolved = c.detail && c.detail.reason === "unreachable" ? "imported" : c.outcome;
      setRetried((r) => ({ ...r, [c.id]: resolved }));
      if (resolved === "imported") {
        setCands((prev) => prev.map((x) => x.id === c.id
          ? { ...x, outcome: "imported", kind: "accepted", haltKey: "import", haltIx: 6, retryable: false, nextRetryAt: null, slug: x.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), detail: { attribution: [{ tenant: "casey", score: 0.66 }], note: "resolved via manual retry" } }
          : x));
      }
    }, 1400);
  }

  // ── The pipeline progression track ──────────────────────────────────────
  const ACQUIRE_IX = D.stageIx.acquire;
  function PipelineTrack({ c }) {
    const haltIx = c.haltIx;
    const imported = c.outcome === "imported";
    return (
      <div className="pl-track" role="list" aria-label="pipeline progression">
        {STAGES.map((s, i) => {
          const Ico = I[s.icon] || I.compass;
          let state;
          if (i < haltIx) state = "done";
          else if (i === haltIx) state = imported ? "done" : c.kind; // halt node carries the outcome colour
          else state = "todo";
          const isHalt = i === haltIx && !imported;
          // Acquire is satisfied-by-push for scraped candidates: content arrived
          // pre-parsed, so it's not a fetch tick but a distinct "push" state.
          const isPush = c.pushed && i === ACQUIRE_IX && state === "done";
          return (
            <div className={"pl-stage " + state + (isHalt ? " halt" : "") + (isPush ? " push" : "")} role="listitem" key={s.key}>
              <div className="pl-node">
                {isPush
                  ? <I.inbox size={14} />
                  : state === "done"
                    ? <I.checkCircle size={15} />
                    : isHalt
                      ? (c.kind === "park" || c.kind === "fail" ? <I.xCircle size={15} /> : <I.minusCircle size={15} />)
                      : <Ico size={14} />}
              </div>
              <span className="pl-label">{isPush ? "Pushed" : s.label}</span>
              {i < STAGES.length - 1 && <span className={"pl-seg " + (i < haltIx ? "done" : "todo")} />}
            </div>
          );
        })}
      </div>
    );
  }

  // One-line plain-language summary of where/why the candidate stands.
  function summaryLine(c) {
    const d = c.detail || {};
    switch (c.outcome) {
      case "imported": {
        const who = (d.attribution || []).map((a) => "@" + a.tenant).join(", ");
        return <>Imported{who ? <> → tagged for {who}</> : null}{c.slug ? <> · <button className="rd-slug-link" onClick={(e) => { e.stopPropagation(); window.GA.openRecipe && window.GA.openRecipe(c.slug); }}>{c.slug}</button></> : null}</>;
      }
      case "duplicate":
        return <>Near-duplicate of <button className="rd-slug-link" onClick={(e) => { e.stopPropagation(); window.GA.openRecipe && window.GA.openRecipe(d.duplicate_of); }}>{d.duplicate_of}</button> (cosine {d.cosine})</>;
      case "no_match":
        return d.stage === "triage"
          ? <>Stopped at triage — no member near in taste (best {d.bestCosine})</>
          : d.stage === "confirm"
            ? <>Cleared cosine, but the LLM confirm declined all candidates</>
            : <>No member cleared the taste threshold (best {d.bestCosine})</>;
      case "dietary_gated":
        return <>Gated by a hard dietary restriction — {d.restriction} (@{d.tenant})</>;
      case "rejected_source":
        return <>Source on the member reject list (@{d.tenant})</>;
      case "error":
        return <>Parked at {STAGES[c.haltIx].label} — {D.reasons[d.reason] || d.reason}{d.status ? ` (${d.status})` : ""}</>;
      case "failed":
        return <>Infrastructure failure at {STAGES[c.haltIx].label} — {d.reason}</>;
      case "deferred":
        return <>Passed match; deferred at import — {d.note}</>;
      default:
        return c.outcome;
    }
  }

  function retryClock(c) {
    const st = retried[c.id];
    if (st === "running") return <span className="dc-retry-state muted small"><I.rotate size={12} className="spin" /> retrying…</span>;
    if (st === "imported") return <span className="dc-retry-state ok small"><I.checkCircle size={12} /> resolved → imported</span>;
    if (st && st !== "running") return <span className="dc-retry-state small"><I.minusCircle size={12} /> still {KIND_LABEL[c.kind]}</span>;
    if (!c.retryable) {
      if (c.detail && c.detail.terminal) return <span className="dc-terminal muted small">terminal · {c.detail.terminal}</span>;
      return null;
    }
    return (
      <div className="dc-retry">
        <span className="muted small">attempt {c.attempts}/5 · auto-retry {D.relFuture(c.nextRetryAt)}</span>
        <button className="btn dc-retry-btn" data-variant="outline" data-size="sm" onClick={(e) => { e.stopPropagation(); retry(c); }}>
          <I.rotate size={13} /> Retry now
        </button>
      </div>
    );
  }

  const cards = [
    { icon: <I.compass />, label: "Candidates", value: D.stats.total },
    { icon: <I.checkCircle />, label: "Imported", value: D.stats.imported, sub: D.stats.importRate + "%" },
    { icon: <I.alert />, label: "Parked / failed", value: D.stats.parked },
    { icon: <I.rotate />, label: "In retry queue", value: cands.filter((c) => c.retryable).length },
  ];

  const Scrapers = window.GA.ScrapersView;
  const strip = N ? N.stats : null;
  return (
    <div className="discovery">
      <div className="data-nav dc-subnav">
        <button className={"pill" + (view === "candidates" ? " active" : "")} onClick={() => setView("candidates")}>Candidates</button>
        <button className={"pill" + (view === "scrapers" ? " active" : "")} onClick={() => setView("scrapers")}>Scrapers</button>
      </div>

      {view === "scrapers" ? <Scrapers /> : (
      <>
      <div className="area-head status-head">
        <button className="link-action"><I.refresh size={14} /> Refresh · last sweep {D.relAge(D.lastSweep)}</button>
      </div>

      {strip && (
        <button className={"dc-ingest-strip" + ((strip.stale || N.activeScrapers.some((s) => s.skew)) ? " warn" : "")} onClick={() => setView("scrapers")}>
          <span className="dc-strip-ico"><I.inbox size={15} /></span>
          <span className="dc-strip-main">
            <strong>{strip.activeScrapers} scrapers</strong> · {strip.fresh} fresh{strip.stale ? <> · <span className="dc-strip-warn">{strip.stale} stale</span></> : null} · {strip.pushedToday} recipes pushed today
          </span>
          <span className="dc-strip-go">Scrapers <I.arrowRight size={13} /></span>
        </button>
      )}

      <div className="stat-grid">
        {cards.map((c) => (
          <div className="stat-card" key={c.label}>
            <div className="stat-top">
              <span className="stat-ico">{c.icon}</span>
              <span className="stat-label">{c.label}</span>
            </div>
            <div className="stat-value">{c.value}</div>
            {c.sub ? <div className="stat-sub">{c.sub} of intake</div> : null}
          </div>
        ))}
      </div>

      <div className="data-nav dc-filters">
        {FILTERS.map((f) => {
          const n = countFor(f.key);
          return (
            <button key={f.key} className={"pill" + (filter === f.key ? " active" : "")} onClick={() => switchFilter(f.key)} disabled={n === 0 && f.key !== "all"}>
              {f.label}{n > 0 ? <span className="pill-count">{n}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="dc-list">
        {shown.map((c) => {
          const isOpen = open === c.id;
          const SrcIco = c.sourceType === "email" ? I.mail : c.sourceType === "scraper" ? I.inbox : I.rss;
          return (
            <div className={"dc-card kind-" + c.kind + (isOpen ? " open" : "")} key={c.id}>
              <div className="dc-main" role="button" tabIndex={0} onClick={() => setOpen(isOpen ? null : c.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(isOpen ? null : c.id); } }}>
                <div className="dc-headrow">
                  <span className="dc-title">{c.title}</span>
                  {c.pushed && <span className="dc-origin"><I.inbox size={11} /> scraper: {c.origin}</span>}
                  <Badge variant={c.kind === "accepted" ? "secondary" : c.kind === "park" || c.kind === "fail" ? "destructive" : "outline"}>
                    {D.outcomes[c.outcome].label}
                  </Badge>
                </div>
                <div className="dc-src">
                  <SrcIco size={13} />
                  <span className="dc-src-name">{c.source}</span>
                  <span className="dimsep">·</span>
                  <span className="muted">{D.relAge(c.createdAt)}</span>
                  <span className="dc-url muted">{c.url.replace(/^https?:\/\//, "").slice(0, 46)}</span>
                </div>

                <PipelineTrack c={c} />

                <div className="dc-summary">{summaryLine(c)}</div>
              </div>

              <div className="dc-foot">
                {retryClock(c)}
                <button className="dc-expand" onClick={() => setOpen(isOpen ? null : c.id)}>
                  {isOpen ? "Hide" : "Details"} <I.chevron size={14} className={isOpen ? "up" : ""} />
                </button>
              </div>

              {isOpen && (
                <div className="dc-detail">
                  <div className="dc-stages">
                    {STAGES.map((s, i) => {
                      const imported = c.outcome === "imported";
                      const done = i < c.haltIx || (i === c.haltIx && imported);
                      const halt = i === c.haltIx && !imported;
                      const todo = i > c.haltIx;
                      const Ico = I[s.icon] || I.compass;
                      const isPush = c.pushed && i === ACQUIRE_IX && done;
                      return (
                        <div className={"dcs-row " + (done ? "done" : halt ? "halt " + c.kind : "todo") + (isPush ? " push" : "")} key={s.key}>
                          <span className="dcs-ico">
                            {isPush ? <I.inbox size={15} /> : done ? <I.checkCircle size={15} /> : halt ? (c.kind === "park" || c.kind === "fail" ? <I.xCircle size={15} /> : <I.minusCircle size={15} />) : <Ico size={14} />}
                          </span>
                          <div className="dcs-body">
                            <div className="dcs-name">{s.label}{isPush ? <span className="dcs-tag push">arrived via push</span> : done ? <span className="dcs-tag ok">passed</span> : halt ? <span className="dcs-tag halt">stopped here</span> : <span className="dcs-tag todo">not reached</span>}</div>
                            <div className="dcs-blurb muted small">{isPush ? "Content arrived pre-parsed from the scraper — fetch + parse skipped." : s.blurb}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="dc-rawwrap">
                    <p className="log-summary-label">discovery_log detail</p>
                    <PrettyKV obj={{ id: c.id, url: c.url, outcome: c.outcome, slug: c.slug, attempts: c.attempts, next_retry_at: c.nextRetryAt ? D.relFuture(c.nextRetryAt) : null, ...c.detail }} />
                  </div>
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
          noun="candidate"
        />
      )}
      </>
      )}
    </div>
  );
}
window.GA = window.GA || {};
window.GA.DiscoveryScreen = DiscoveryScreen;
