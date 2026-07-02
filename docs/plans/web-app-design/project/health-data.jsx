/* Shared service-health model for the grocery-agent admin.

   Single source of truth read by BOTH the global corner indicator (the overall
   rollup, on every page) and the Status screen (the per-job list + page stats).
   Mirrors the real `HealthPayload` the worker's `/health` returns — background
   cron jobs, the D1 probe, and the admin-gate posture — plus the per-job summary
   counts each job upserts to `job_health`, and a "since" timestamp (when the job
   last flipped into its current state). Values are illustrative. */
(function () {
  window.GA = window.GA || {};

  const now = Date.now();
  const MIN = 60_000, HR = 3_600_000, DAY = 86_400_000;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /** Coarse relative age, e.g. "just now" / "4m ago" / "2h ago" / "8d ago". */
  function relAge(ms) {
    const s = Math.max(0, Math.floor((now - ms) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  /** Compact absolute instant, e.g. "Jun 22, 09:14". */
  function fmtAt(ms) {
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${hh}:${mm}`;
  }

  // Build a run-outcome history (oldest → newest). `failAt` lists indexes that
  // failed; `failTail` marks the most recent N runs as failing (a current outage).
  function hist(n, failTail = 0, failAt = []) {
    const a = new Array(n).fill("ok");
    failAt.forEach((i) => { if (i >= 0 && i < n) a[i] = "fail"; });
    for (let i = 0; i < failTail; i++) a[n - 1 - i] = "fail";
    return a;
  }
  const RUNS = 44;

  // Cron jobs, in the order `/health` aggregates them. `state`: ok | fail | never.
  // `since` is when the job entered its current state (healthy/unhealthy since).
  // `history` is the recent run-outcome series rendered as the uptime sparkline.
  const jobs = [
    {
      name: "flyer-warm", icon: "image", state: "ok",
      lastRun: now - 4 * MIN, since: { state: "ok", at: now - 8 * DAY },
      stats: [["action", "warmed"], ["done", "true"], ["errors", "0"]],
      history: hist(RUNS, 0, [13]),
      errors: ["Kroger flyer fetch timed out (store 00622)"],
    },
    {
      name: "recipe-classify", icon: "sparkles", state: "ok",
      lastRun: now - 11 * MIN, since: { state: "ok", at: now - 5 * DAY },
      stats: [["classified", "18"], ["pending", "2"], ["parked", "0"], ["errored", "0"], ["pruned", "3"]],
      history: hist(RUNS, 0, [7, 8]),
      errors: ["Workers AI 4006 — daily neuron allocation exhausted", "classifier returned malformed facet JSON"],
    },
    {
      name: "recipe-index", icon: "layers", state: "ok",
      lastRun: now - 11 * MIN, since: { state: "ok", at: now - 8 * DAY },
      stats: [["projected", "24"], ["skipped", "1"], ["unresolved", "112"]],
      history: hist(RUNS, 0, []),
      errors: ["reconcile aborted — D1 storage_error"],
      // Recipe backfill convergence: distinct recipe ingredient terms not yet in
      // the identity graph. Falls from ~259 toward 0 over hours as normalization
      // catches up. `degraded` marks a tick where the resolver had an outage —
      // visible but calm (the backfill just resumes next tick).
      backfill: {
        unresolved: 112,
        start: 259,
        series: [259, 244, 228, 210, 196, 181, 168, 158, 149, 141, 134, 128, 122, 117, 112],
        degraded: true,
        degradedAt: now - 33 * MIN,
        degradedNote: "resolver outage for one tick — no rows resolved; backfill resumed next tick",
      },
    },
    {
      name: "recipe-embed", icon: "braces", state: "ok",
      lastRun: now - 11 * MIN, since: { state: "ok", at: now - 8 * DAY },
      stats: [["described", "12"], ["embedded", "12"], ["pending", "0"], ["pruned", "2"]],
      history: hist(RUNS, 0, [24]),
      errors: ["embedding model timeout (bge-base-en-v1.5)"],
    },
    {
      name: "email", icon: "mail", state: "ok",
      lastRun: now - 2 * HR, since: { state: "ok", at: now - 12 * DAY },
      stats: [["accepted", "true"], ["written", "true"]],
      history: hist(RUNS, 0, []),
      errors: ["inbound message rejected — unparseable MIME"],
    },
    {
      name: "discovery-sweep", icon: "search", state: "fail",
      lastRun: now - 6 * MIN, since: { state: "fail", at: now - 62 * MIN },
      stats: [
        ["processed", "40"], ["imported", "6"], ["duplicate", "9"],
        ["no_match", "12"], ["failed", "2"], ["failed_outstanding", "2"], ["deferred", "0"],
      ],
      history: hist(RUNS, 11, [4]),
      errors: [
        "2 candidates failed to import — Kroger SKU match timed out",
        "sender feed 503 (bonappetit.com)",
        "duplicate guard tripped on malformed GUID",
      ],
    },
  ];

  // Live dependencies (not crons): the D1 reachability probe and the admin-gate posture.
  const deps = [
    { name: "d1", icon: "database", state: "ok", word: "reachable", detail: "SELECT 1 probe ok" },
    { name: "admin gate", icon: "shield", state: "ok", word: "gated", detail: "Access configured · email allowlist on" },
  ];

  // Page-level corpus counts (the four new tiles). `members` reads the shared roster.
  const counts = { recipes: 248, members: (window.GA.members ? window.GA.members.length : 12), feeds: 9, skus: 4312 };

  // --- Per-run job logs ------------------------------------------------------
  // Each cron job's run history (the uptime sparkline) is expanded into full run
  // records, so a sparkline tick on Status and a row on the Logs page are the same
  // entity (linked by id). A run carries its outcome, duration, the summary counts
  // it upserts to job_health, and (on failure) the error.
  const CADENCE = { "flyer-warm": 15, "recipe-classify": 30, "recipe-index": 15, "recipe-embed": 30, "email": 140, "discovery-sweep": 60 };
  const BASE_MS = { "flyer-warm": 320, "recipe-classify": 1840, "recipe-index": 210, "recipe-embed": 1455, "email": 540, "discovery-sweep": 2210 };

  function summaryFor(job, n) {
    const o = {};
    job.stats.forEach(([k, v]) => {
      if (/^\d+$/.test(v)) {
        const base = parseInt(v, 10);
        const d = ((n * 37) % 7) - 3;
        o[k] = String(Math.max(0, base + (n === 1 ? 0 : d)));
      } else o[k] = v;
    });
    return o;
  }

  function buildRuns(job) {
    const cad = CADENCE[job.name] || 30;
    const base = BASE_MS[job.name] || 500;
    const h = job.history; // oldest → newest
    const runs = [];
    for (let i = h.length - 1; i >= 0; i--) {
      const n = h.length - i; // 1 = most recent
      const ok = h[i] === "ok";
      const at = job.lastRun - (n - 1) * cad * MIN;
      const jitter = ((n * 2654435761) % 1000) / 1000;
      const durationMs = ok ? Math.round(base * (0.8 + jitter * 0.5)) : Math.round(base * (0.3 + jitter * 0.4));
      const error = ok ? null : (job.errors[n % job.errors.length] || "run failed");
      runs.push({
        id: `${job.name}-r${n}`, job: job.name, icon: job.icon, n, at, ok, durationMs,
        summary: ok ? summaryFor(job, n) : { error },
        error,
      });
    }
    return runs; // newest first (n=1 … n=44)
  }

  jobs.forEach((job) => { job.runs = buildRuns(job); });
  const jobRuns = jobs.flatMap((j) => j.runs).sort((a, b) => b.at - a.at);
  const jobRunsById = {};
  jobRuns.forEach((r) => { jobRunsById[r.id] = r; });

  const anyFailing = jobs.some((j) => j.state === "fail") || deps.some((d) => d.state === "fail");

  window.GA.health = {
    generatedAt: now,
    jobs,
    deps,
    counts,
    overallOk: !anyFailing,
    failingCount: jobs.filter((j) => j.state === "fail").length,
    okCount: jobs.filter((j) => j.state === "ok").length,
    relAge,
    fmtAt,
    jobRuns,
    jobRunsById,
  };
})();
