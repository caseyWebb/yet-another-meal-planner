/* Global service-health indicator — lives in the app frame, fixed to a screen
   corner, visible on EVERY admin page (moved out of the Status screen, where the
   overall Healthy/Degraded headline used to sit). Reads the shared GA.health
   model. Click to expand a rollup popover; "Open status" jumps to the Status
   area. */
function HealthIndicator({ onOpenStatus }) {
  const I = window.GA.icons;
  const h = window.GA.health;
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const ok = h.overallOk;
  const word = ok ? "All systems healthy" : "Service degraded";
  const failing = h.jobs.filter((j) => j.state === "fail");

  return (
    <div className="health-dock" ref={ref}>
      {open && (
        <div className="health-pop" role="dialog" aria-label="Service health">
          <div className="hp-head">
            <span className={"dot " + (ok ? "ok" : "fail")} />
            <span className={"status-word " + (ok ? "ok" : "fail")}>{ok ? "Healthy" : "Degraded"}</span>
            <span className="muted small hp-ts">checked {h.relAge(h.generatedAt)}</span>
          </div>

          <div className="hp-rollup">
            <span className="hp-roll-ico"><I.checkCircle /></span>
            <span>
              <strong>{h.okCount}/{h.jobs.length}</strong> background jobs healthy
            </span>
          </div>

          {failing.length > 0 && (
            <ul className="hp-fail-list">
              {failing.map((j) => (
                <li key={j.name}>
                  <span className="dot fail" />
                  <span className="hp-fail-name">{j.name}</span>
                  <span className="muted small">unhealthy {h.relAge(j.since.at)}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="hp-deps">
            {h.deps.map((d) => (
              <div className="hp-dep" key={d.name}>
                <span className={"dot " + d.state} />
                <span className="hp-dep-name">{d.name}</span>
                <span className={"status-word " + d.state}>{d.word}</span>
              </div>
            ))}
          </div>

          <button
            className="btn hp-link"
            data-variant="outline"
            data-size="sm"
            onClick={() => { setOpen(false); onOpenStatus && onOpenStatus(); }}
          >
            Open status <I.external size={13} />
          </button>
        </div>
      )}

      <button
        className={"health-pill " + (ok ? "ok" : "fail")}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={"pulse-dot " + (ok ? "ok" : "fail")} />
        <span className="hp-word">{word}</span>
        {!ok && <span className="hp-count">{h.failingCount}</span>}
        <I.chevron size={13} className={"hp-caret" + (open ? " up" : "")} />
      </button>
    </div>
  );
}
window.GA = window.GA || {};
window.GA.HealthIndicator = HealthIndicator;
