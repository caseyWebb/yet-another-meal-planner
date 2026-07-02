/* Self-healing audit dataset for the grocery-agent admin.

   The identity graph (canonical ingredient ids + satisfies-edges + the alias
   map + the sku cache) is now continuously re-checked by three rolling audit
   passes on the Worker. Each is a self-terminating convergence job in the exact
   mould of grocery/pantry reconcile: it does real work only while un-audited
   rows remain, draining a backlog toward zero, then runs as a silent no-op.
   Burndown-to-zero is the GOOD state — "clean" is a positive terminal state,
   drawn green, never a dead gray "0".

     · alias audit    — re-reads every alias row: stamps it audited, keeps good
                        maps, repoints wrong ones, mints missing ids, merges
                        duplicates, skips ones out of scope.
                        summary {audited, self_stamped, kept, repointed, minted, merged, skipped}
     · edge audit     — re-reads every satisfies-edge: drops self-loops and the
                        edges that close a cycle, keeps the sound ones.
                        summary {audited, self_loops, cycles, dropped, kept, skipped}
     · sku-cache re-key — re-keys cached Kroger SKU rows onto canonical ids and
                        collapses duplicate cache entries.
                        summary {rekeyed, merged}

   Plus a shared BACKLOG BURNDOWN: the count of un-audited alias + edge rows,
   draining to zero and staying there.

   The audit also produces one-shot REPLAY / RESTORATION events — past wrong
   edge drops that a later, smarter pass re-decides (restored · pair-re-decided ·
   immune), each pointing back at the original decision it revisits.

   And a MERGE-REJECTION MEMORY: co-resolution pairs the classifier declined to
   merge, held under a 30-day backoff so the same pair isn't re-litigated every
   sweep.

   Ships two review snapshots (converging · converged) behind a shared store so
   every surface reads one state, flippable from the review toggle. Illustrative
   values. */
(function () {
  window.GA = window.GA || {};
  const MIN = 60_000, HR = 3_600_000, DAY = 86_400_000;
  const now = Date.now();

  // ── Per-tick "rows audited / tick" series (oldest → newest). Shape tells the
  //    convergence story: a decay toward zero as the backlog drains. ──
  const CONVERGING = {
    alias: [
      { audited: 480, changed: 96 }, { audited: 500, changed: 88 }, { audited: 500, changed: 71 },
      { audited: 462, changed: 60 }, { audited: 410, changed: 52 }, { audited: 366, changed: 41 },
      { audited: 300, changed: 38 }, { audited: 244, changed: 30 }, { audited: 190, changed: 25 },
      { audited: 150, changed: 19 }, { audited: 120, changed: 16 }, { audited: 88, changed: 12 },
      { audited: 60, changed: 9 }, { audited: 44, changed: 6 }, { audited: 31, changed: 4 },
    ],
    edge: [
      { audited: 210, changed: 22 }, { audited: 198, changed: 18 }, { audited: 176, changed: 15 },
      { audited: 150, changed: 14 }, { audited: 132, changed: 11 }, { audited: 118, changed: 9 },
      { audited: 96, changed: 8 }, { audited: 74, changed: 6 }, { audited: 60, changed: 5 },
      { audited: 44, changed: 4 }, { audited: 33, changed: 3 }, { audited: 22, changed: 2 },
      { audited: 18, changed: 2 }, { audited: 12, changed: 1 }, { audited: 9, changed: 1 },
    ],
    sku: [
      { audited: 120, changed: 30 }, { audited: 110, changed: 24 }, { audited: 96, changed: 19 },
      { audited: 80, changed: 16 }, { audited: 66, changed: 12 }, { audited: 54, changed: 10 },
      { audited: 40, changed: 7 }, { audited: 30, changed: 5 }, { audited: 22, changed: 4 },
      { audited: 15, changed: 3 }, { audited: 11, changed: 2 }, { audited: 7, changed: 1 },
      { audited: 5, changed: 1 }, { audited: 3, changed: 0 }, { audited: 2, changed: 0 },
    ],
  };
  const CONVERGED = {
    alias: [
      { audited: 44, changed: 6 }, { audited: 31, changed: 4 }, { audited: 20, changed: 3 },
      { audited: 12, changed: 2 }, { audited: 7, changed: 1 }, { audited: 4, changed: 1 },
      { audited: 2, changed: 0 }, { audited: 1, changed: 0 }, { audited: 0, changed: 0 },
      { audited: 0, changed: 0 }, { audited: 0, changed: 0 }, { audited: 0, changed: 0 },
      { audited: 0, changed: 0 }, { audited: 0, changed: 0 }, { audited: 0, changed: 0 },
    ],
    edge: [
      { audited: 18, changed: 2 }, { audited: 11, changed: 1 }, { audited: 6, changed: 1 },
      { audited: 3, changed: 0 }, { audited: 2, changed: 0 }, { audited: 1, changed: 0 },
      { audited: 0, changed: 0 }, { audited: 0, changed: 0 }, { audited: 0, changed: 0 },
      { audited: 0, changed: 0 }, { audited: 0, changed: 0 }, { audited: 0, changed: 0 },
      { audited: 0, changed: 0 }, { audited: 0, changed: 0 }, { audited: 0, changed: 0 },
    ],
    sku: [
      { audited: 8, changed: 1 }, { audited: 4, changed: 1 }, { audited: 2, changed: 0 },
      { audited: 1, changed: 0 }, { audited: 0, changed: 0 }, { audited: 0, changed: 0 },
      { audited: 0, changed: 0 }, { audited: 0, changed: 0 }, { audited: 0, changed: 0 },
      { audited: 0, changed: 0 }, { audited: 0, changed: 0 }, { audited: 0, changed: 0 },
      { audited: 0, changed: 0 }, { audited: 0, changed: 0 }, { audited: 0, changed: 0 },
    ],
  };

  // Backlog burndown (un-audited rows still to sweep), oldest → newest.
  const BACKLOG = {
    converging: {
      alias: [4200, 3720, 3220, 2758, 2348, 1982, 1682, 1438, 1248, 1098, 978, 890, 830, 786, 755],
      edge: [1840, 1642, 1466, 1316, 1184, 1066, 970, 896, 836, 792, 759, 737, 719, 707, 698],
    },
    converged: {
      alias: [420, 260, 150, 78, 34, 12, 4, 0, 0, 0, 0, 0, 0, 0, 0],
      edge: [180, 96, 40, 14, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
  };

  function sum(arr, k) { return arr.reduce((a, t) => a + t[k], 0); }
  function lastTick(arr) { return arr[arr.length - 1]; }

  // Build each pass's public shape from its tick series + a summary spec fn.
  function pass(id, label, icon, blurb, ticks, summarize, extra) {
    const last = lastTick(ticks);
    const converged = last.audited === 0;
    return Object.assign({
      id, label, icon, blurb,
      ticks,
      auditedThisTick: last.audited,
      changedThisTick: last.changed,
      converged,
      summary: summarize(ticks),   // [[k, v], ...] the counts it upserts to job_health
    }, extra);
  }

  // Summary builders per pass. Proportions are illustrative but internally add up.
  function aliasSummary(ticks) {
    const audited = sum(ticks, "audited"), changed = sum(ticks, "changed");
    const repointed = Math.round(changed * 0.34), minted = Math.round(changed * 0.18),
      merged = Math.round(changed * 0.26), skipped = Math.round(audited * 0.03);
    const kept = audited - changed - skipped, self_stamped = kept;
    return [
      ["audited", audited], ["self_stamped", self_stamped], ["kept", kept],
      ["repointed", repointed], ["minted", minted], ["merged", merged], ["skipped", skipped],
    ];
  }
  function edgeSummary(ticks) {
    const audited = sum(ticks, "audited"), changed = sum(ticks, "changed");
    const self_loops = Math.round(changed * 0.4), cycles = Math.round(changed * 0.3);
    const dropped = self_loops + cycles, skipped = Math.round(audited * 0.02);
    const kept = audited - dropped - skipped;
    return [
      ["audited", audited], ["self_loops", self_loops], ["cycles", cycles],
      ["dropped", dropped], ["kept", kept], ["skipped", skipped],
    ];
  }
  function skuSummary(ticks) {
    const audited = sum(ticks, "audited"), changed = sum(ticks, "changed");
    const merged = Math.round(changed * 0.35), rekeyed = changed - merged;
    return [["audited", audited], ["rekeyed", rekeyed], ["merged", merged]];
  }

  function buildSnapshot(mode) {
    const T = mode === "converged" ? CONVERGED : CONVERGING;
    const B = BACKLOG[mode];
    const passes = [
      pass("alias", "alias audit", "link",
        "Re-reads every alias row and reconciles it with the current graph — stamping it audited, repointing wrong maps, minting missing ids, and merging duplicates.",
        T.alias, aliasSummary,
        mode === "converged"
          ? { lastRun: now - 3 * MIN, sinceClean: now - 2 * DAY - 5 * HR, lifetime: 41830 }
          : { lastRun: now - 3 * MIN, startedAt: now - 4 * DAY, lifetime: 38120 }),
      pass("edge", "edge audit", "gitMerge",
        "Re-reads every satisfies-edge and drops the unsound ones — self-loops and the edges that close a cycle — keeping the directed graph acyclic.",
        T.edge, edgeSummary,
        mode === "converged"
          ? { lastRun: now - 3 * MIN, sinceClean: now - 2 * DAY - 6 * HR, lifetime: 9640 }
          : { lastRun: now - 3 * MIN, startedAt: now - 4 * DAY, lifetime: 8210 }),
      pass("sku", "sku-cache re-key", "database",
        "Re-keys cached Kroger SKU rows onto their canonical ingredient id and collapses duplicate cache entries left behind by merges.",
        T.sku, skuSummary,
        mode === "converged"
          ? { lastRun: now - 3 * MIN, sinceClean: now - 3 * DAY, lifetime: 5120 }
          : { lastRun: now - 3 * MIN, startedAt: now - 4 * DAY, lifetime: 4460 }),
    ];
    const aliasBacklog = lastTick(B.alias), edgeBacklog = lastTick(B.edge);
    return {
      mode,
      passes,
      backlog: {
        alias: aliasBacklog,
        edge: edgeBacklog,
        total: aliasBacklog + edgeBacklog,
        aliasSeries: B.alias,
        edgeSeries: B.edge,
        converged: aliasBacklog === 0 && edgeBacklog === 0,
        clearedAt: mode === "converged" ? now - 2 * DAY - 5 * HR : null,
      },
      cadenceMin: 20,
      lastSweep: now - 3 * MIN,
    };
  }

  const SNAPSHOTS = { converging: buildSnapshot("converging"), converged: buildSnapshot("converged") };

  // ── Replay / restoration events (one-shot). A later, smarter audit pass
  //    revisits a past edge_drop and re-decides it. Each points back at the
  //    original decision id it revisits. Kinds:
  //      restored        — the drop was wrong; the edge is back.
  //      pair-re-decided — a co-resolution pair was re-run and settled.
  //      immune          — the drop was confirmed correct; marked immune so
  //                        future passes stop re-litigating it. ──
  let rseq = 0;
  function rst(o) {
    rseq += 1;
    return Object.assign({ id: "rpl_" + String(rseq).padStart(3, "0"), at: now - o.age }, o);
  }
  const restorations = [
    rst({ kind: "restored", from: "ground beef::fat-80-20", to: "ground beef", rel: "satisfies",
      origin: "nrm_002", was: "edge_drop", verdict: "specialization holds — drop was over-eager",
      age: 26 * MIN }),
    rst({ kind: "pair-re-decided", from: "green onion", to: "chives", rel: "co-resolve",
      origin: "nrm_006", was: "edge_drop", verdict: "kept distinct — chives is not a synonym",
      age: 2 * HR + 10 * MIN }),
    rst({ kind: "restored", from: "kosher salt::diamond-crystal", to: "kosher salt", rel: "satisfies",
      origin: "nrm_004", was: "edge_drop", verdict: "grain spec restored after cache re-key",
      age: 5 * HR }),
    rst({ kind: "immune", from: "baking powder", to: "baking soda", rel: "satisfies",
      origin: "nrm_008", was: "edge_drop", verdict: "confirmed distinct product — marked immune",
      age: 9 * HR }),
    rst({ kind: "pair-re-decided", from: "zucchini", to: "yellow squash", rel: "co-resolve",
      origin: "nrm_009", was: "edge_drop", verdict: "kept separate — different SKUs",
      age: 1 * DAY + 3 * HR }),
    rst({ kind: "restored", from: "ground turkey::fat-85-15", to: "ground turkey", rel: "satisfies",
      origin: "nrm_007", was: "edge_drop", verdict: "fat-ratio spec restored",
      age: 1 * DAY + 8 * HR }),
    rst({ kind: "immune", from: "gochujang", to: "doenjang", rel: "satisfies",
      origin: "nrm_005", was: "edge_drop", verdict: "distinct fermented pastes — immune",
      age: 2 * DAY }),
  ];
  const REPLAY_KINDS = {
    restored:          { label: "restored",         tone: "ok" },
    "pair-re-decided": { label: "pair re-decided",  tone: "info" },
    immune:            { label: "immune",           tone: "muted" },
  };

  // ── Merge-rejection memory: co-resolution pairs the classifier declined to
  //    merge, held under a 30-day backoff so the same pair isn't re-litigated
  //    every sweep. Small; occasionally worth inspecting. ──
  const BACKOFF_DAYS = 30;
  let mseq = 0;
  function rej(o) {
    mseq += 1;
    return Object.assign({
      id: "rej_" + String(mseq).padStart(3, "0"),
      rejectedAt: now - o.age,
      expiresAt: now - o.age + BACKOFF_DAYS * DAY,
    }, o);
  }
  const rejections = [
    rej({ a: "chives", b: "green onion", reason: "distinct alliums — different SKUs, no shared flyer", age: 3 * DAY }),
    rej({ a: "yellow squash", b: "zucchini", reason: "co-occur in recipes but resolve to distinct Kroger SKUs", age: 6 * DAY }),
    rej({ a: "doenjang", b: "gochujang", reason: "both Korean fermented pastes — not interchangeable", age: 8 * DAY }),
    rej({ a: "baking soda", b: "baking powder", reason: "leaveners, chemically distinct", age: 11 * DAY }),
    rej({ a: "table salt", b: "kosher salt", reason: "grain differs; volume-to-weight not equivalent", age: 19 * DAY }),
    rej({ a: "cornstarch", b: "all-purpose flour", reason: "both thickeners — different behaviour", age: 27 * DAY }),
  ];

  // ── Shared store so Normalize + Status read one review state. ──
  const store = {
    mode: "converging",
    _subs: new Set(),
    get() { return this.mode; },
    set(m) { this.mode = m; this._subs.forEach((f) => f(m)); },
    snapshot() { return SNAPSHOTS[this.mode]; },
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

  function relAge(ms) {
    const s = Math.max(0, Math.floor((now - ms) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }
  function relFuture(ms) {
    const s = Math.max(0, Math.floor((ms - now) / 1000));
    if (s < 86400) return `in ${Math.max(1, Math.floor(s / 3600))}h`;
    return `in ${Math.floor(s / 86400)}d`;
  }
  function fmtDate(ms) {
    return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  window.GA.audit = {
    store,
    snapshots: SNAPSHOTS,
    restorations,
    replayKinds: REPLAY_KINDS,
    rejections,
    backoffDays: BACKOFF_DAYS,
    sum,
    relAge,
    relFuture,
    fmtDate,
    presets: [
      { key: "converging", label: "Converging" },
      { key: "converged", label: "Converged" },
    ],
  };
})();
