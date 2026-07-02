/* grocery/pantry key-reconcile dataset for the grocery-agent admin.

   The reconcile is a housekeeping/backfill cron on the Worker: it re-keys a
   member's grocery-list and pantry rows onto the canonical ingredient id (the
   same identity graph the Normalization area manages), merging surface-form
   duplicates as the graph learns them (a pantry "scallions" and a grocery
   "green onions" collapse into one row once they're known to be the same
   thing). It is idempotent and self-terminating: it does real work only while
   stale/duplicate rows exist to converge, then runs as a silent no-op forever.

   Per tick it emits: grocery_rekeyed, pantry_rekeyed, truncated (hit the 500/
   tick cap → backlog remains). Derived state:
     · converged / idle  — last tick did 0 and wasn't truncated.
     · converging        — recent re-keys and/or a backlog (truncated).

   This module ships THREE review snapshots (converging · backlog · converged)
   and a tiny shared store so the Normalize card and the Status row show the
   same state, flippable from the review toggle. Illustrative values. */
(function () {
  window.GA = window.GA || {};
  const MIN = 60_000, HR = 3_600_000, DAY = 86_400_000;
  const now = Date.now();

  const CAP = 500; // per-tick re-key cap; hitting it sets truncated=true.

  // Per-tick series (oldest → newest) of { g: grocery_rekeyed, p: pantry_rekeyed }.
  // The shape tells the convergence story visually: a decay toward zero.
  const CONVERGING_TICKS = [
    { g: 96, p: 61 }, { g: 74, p: 52 }, { g: 88, p: 40 }, { g: 61, p: 44 },
    { g: 52, p: 33 }, { g: 60, p: 28 }, { g: 41, p: 30 }, { g: 44, p: 22 },
    { g: 33, p: 24 }, { g: 38, p: 19 }, { g: 29, p: 20 }, { g: 31, p: 16 },
    { g: 40, p: 25 }, { g: 27, p: 18 }, { g: 34, p: 21 },
  ];
  // Early phase: every tick slams the 500 cap, so a large backlog remains.
  const BACKLOG_TICKS = [
    { g: 300, p: 200 }, { g: 288, p: 212 }, { g: 306, p: 194 }, { g: 292, p: 208 },
    { g: 300, p: 200 }, { g: 284, p: 216 }, { g: 312, p: 188 }, { g: 296, p: 204 },
    { g: 300, p: 200 }, { g: 290, p: 210 }, { g: 308, p: 192 }, { g: 300, p: 200 },
    { g: 294, p: 206 }, { g: 302, p: 198 }, { g: 312, p: 188 },
  ];
  // Converged: work tailed off days ago; recent ticks are all silent no-ops.
  const CONVERGED_TICKS = [
    { g: 22, p: 14 }, { g: 15, p: 9 }, { g: 11, p: 7 }, { g: 8, p: 4 },
    { g: 5, p: 3 }, { g: 3, p: 1 }, { g: 1, p: 1 }, { g: 0, p: 0 },
    { g: 0, p: 0 }, { g: 0, p: 0 }, { g: 0, p: 0 }, { g: 0, p: 0 },
    { g: 0, p: 0 }, { g: 0, p: 0 }, { g: 0, p: 0 },
  ];

  function tickTotal(t) { return t.g + t.p; }

  // Build a snapshot: last tick's counts are the newest entry in the series.
  function snapshot(ticks, extra) {
    const last = ticks[ticks.length - 1];
    return Object.assign({
      grocery_rekeyed: last.g,
      pantry_rekeyed: last.p,
      truncated: false,
      cap: CAP,
      ticks,
      cadenceMin: 30,          // reconcile runs every 30 min on cron
    }, extra);
  }

  const SNAPSHOTS = {
    converging: snapshot(CONVERGING_TICKS, {
      lastTick: now - 6 * MIN,
      lifetimeMerged: 1863,          // rows re-keyed since the backfill began
      startedAt: now - 5 * DAY,      // when this backfill wave began
    }),
    backlog: snapshot(BACKLOG_TICKS, {
      truncated: true,               // hit the 500 cap this tick → backlog remains
      lastTick: now - 4 * MIN,
      lifetimeMerged: 6120,
      startedAt: now - 9 * HR,       // a fresh graph merge kicked off a big wave
      backlogEst: 3400,              // rough rows still to converge
    }),
    converged: snapshot(CONVERGED_TICKS, {
      lastTick: now - 2 * MIN,       // it still RAN 2m ago — it just did nothing
      lastMerge: now - 2 * DAY - 4 * HR, // last tick that actually re-keyed a row
      lifetimeMerged: 1204,
      startedAt: now - 21 * DAY,
      convergedAt: now - 2 * DAY - 3 * HR,
    }),
  };

  // Derived state from a snapshot: converged iff last tick did 0 and wasn't truncated.
  function deriveState(s) {
    const idle = s.grocery_rekeyed === 0 && s.pantry_rekeyed === 0 && !s.truncated;
    return idle ? "converged" : "converging";
  }

  function relAge(ms) {
    const s = Math.max(0, Math.floor((now - ms) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }
  function fmtDate(ms) {
    return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  // ── Tiny shared store so both surfaces reflect one review state. ──
  const store = {
    mode: "converging",             // "converging" | "backlog" | "converged"
    _subs: new Set(),
    get() { return this.mode; },
    set(m) { this.mode = m; this._subs.forEach((f) => f(m)); },
    snapshot() { return SNAPSHOTS[this.mode]; },
    // React hook: returns the current mode and re-renders on change.
    use() {
      const [m, setM] = React.useState(this.mode);
      React.useEffect(() => {
        const f = (x) => setM(x);
        this._subs.add(f);
        return () => this._subs.delete(f);
      }, []);
      return m;
    },
  };

  window.GA.reconcile = {
    CAP,
    snapshots: SNAPSHOTS,
    deriveState,
    tickTotal,
    relAge,
    fmtDate,
    store,
    // Review presets exposed for the toggle.
    presets: [
      { key: "converging", label: "Converging" },
      { key: "backlog", label: "Backlog" },
      { key: "converged", label: "Converged" },
    ],
  };
})();
