import { describe, it, expect } from "vitest";
import { StatusPage, STATUS_SPARKLINE_WINDOW, jobStateOf, gateStateOf, relAge } from "../src/admin/pages/status.js";
import type { HealthPayload, JobRun } from "../src/health.js";
import type { CorpusCounts } from "../src/admin-data.js";
import type { ReconcileObservability } from "../src/reconcile-admin.js";

/** A calm "never run" reconcile model — the Status row renders it as a positive idle state. */
function reconcile(over: Partial<ReconcileObservability> = {}): ReconcileObservability {
  return {
    state: "neverRun",
    grocery_rekeyed: 0,
    pantry_rekeyed: 0,
    truncated: false,
    ticks: [],
    lifetimeMerged: 0,
    lastTick: null,
    startedAt: null,
    lastMerge: null,
    convergedAt: null,
    cap: 500,
    cadenceMin: 5,
    ...over,
  };
}

function payload(over: Partial<HealthPayload> = {}): HealthPayload {
  return {
    ok: true,
    generated_at: 1_000_000,
    jobs: [{ name: "flyer-warm", ok: true, last_run_at: 999_000, summary: { errors: 0 } }],
    d1: { ok: true },
    admin: { access_configured: true, email_allowlist: true, dev_bypass_set: false, exposed: false },
    ai_quota_exhausted: false,
    ...over,
  };
}

function counts(over: Partial<CorpusCounts> = {}): CorpusCounts {
  return { recipes: 248, members: 12, feeds: 9, cached_skus: 4312, ...over };
}

function run(over: Partial<JobRun> = {}): JobRun {
  return { id: "flyer-warm-1", ok: true, ran_at: 900_000, duration_ms: 100, summary: {}, ...over };
}

const render = (p: HealthPayload, c: CorpusCounts = counts(), runsByJob: Record<string, JobRun[]> = {}): string =>
  (StatusPage({ payload: p, counts: c, runsByJob, reconcile: reconcile() }) as { toString(): string }).toString();

describe("Status helpers (the compiler-opaque logic worth pinning)", () => {
  it("collapses a job's ok/null wire shape to one state", () => {
    expect(jobStateOf({ name: "x", ok: true, last_run_at: 1 })).toBe("healthy");
    expect(jobStateOf({ name: "x", ok: false, last_run_at: 1 })).toBe("failing");
    expect(jobStateOf({ name: "x", ok: null, last_run_at: null, never_run: true })).toBe("neverRun");
  });

  it("derives the gate state by exposed > configured > dev-bypass > disabled precedence", () => {
    expect(gateStateOf({ access_configured: true, email_allowlist: false, dev_bypass_set: true, exposed: true })).toBe("exposed");
    expect(gateStateOf({ access_configured: true, email_allowlist: false, dev_bypass_set: false, exposed: false })).toBe("gated");
    expect(gateStateOf({ access_configured: false, email_allowlist: false, dev_bypass_set: true, exposed: false })).toBe("devBypass");
    expect(gateStateOf({ access_configured: false, email_allowlist: false, dev_bypass_set: false, exposed: false })).toBe("disabled");
  });

  it("formats coarse relative age", () => {
    expect(relAge(30_000)).toBe("just now");
    expect(relAge(120_000)).toBe("2m ago");
    expect(relAge(7_200_000)).toBe("2h ago");
    expect(relAge(172_800_000)).toBe("2d ago");
  });
});

describe("StatusPage SSR", () => {
  it("renders the job rows, the D1 row, and the gate posture", () => {
    const html = render(payload());
    expect(html).toContain("flyer-warm");
    expect(html).toContain("reachable");
    expect(html).toContain("gated");
  });

  it("does not render the 'Service health' area heading (health lives in the global corner indicator)", () => {
    const html = render(payload());
    expect(html).not.toContain("Service health");
  });

  it("shows a 'checked <relative age>' label next to the Refresh action, from generated_at", () => {
    const html = render(payload({ generated_at: Date.now() - 120_000 }));
    expect(html).toMatch(/Refresh · checked \d+m ago/);
  });

  it("does not carry the overall healthy/degraded rollup — that lives in the global health dock", () => {
    // The rollup relocated to the shell-injected health dock (admin-ui-redesign-foundation); the
    // Status page keeps only the detailed rows, so its own body shows neither headline word.
    const healthy = render(payload());
    const degraded = render(payload({ ok: false }));
    expect(healthy).not.toContain("Healthy");
    expect(degraded).not.toContain("Degraded");
  });

  it("still renders the exposed warning when the gate is exposed", () => {
    const html = render(
      payload({
        ok: false,
        admin: { access_configured: false, email_allowlist: false, dev_bypass_set: true, exposed: true },
      }),
    );
    expect(html).toContain("Admin gate exposed");
    expect(html).toContain("exposed");
  });

  it("renders the AI-quota warning when exhausted", () => {
    expect(render(payload({ ok: false, ai_quota_exhausted: true }))).toContain("Workers AI quota exhausted");
  });
});

describe("StatusPage SSR — corpus stat tiles", () => {
  it("renders the four corpus stat tiles with their aggregate counts", () => {
    const html = render(payload(), counts({ recipes: 248, members: 12, feeds: 9, cached_skus: 4312 }));
    expect(html).toContain("Recipes");
    expect(html).toContain("248");
    expect(html).toContain("Members");
    expect(html).toContain("12");
    expect(html).toContain("RSS feeds");
    expect(html).toContain("9");
    expect(html).toContain("Cached SKUs");
    expect(html).toContain("4,312");
  });

  it("each corpus stat tile navigates to its area: Recipes → Data, Members → Members, RSS feeds → Config, Cached SKUs → Data > Stores", () => {
    const html = render(payload());
    expect(html).toMatch(/<a class="stat-card stat-card-link" href="\/admin\/data">[\s\S]*?Recipes/);
    expect(html).toMatch(/<a class="stat-card stat-card-link" href="\/admin\/members">[\s\S]*?Members/);
    expect(html).toMatch(/<a class="stat-card stat-card-link" href="\/admin\/config">[\s\S]*?RSS feeds/);
    expect(html).toMatch(/<a class="stat-card stat-card-link" href="\/admin\/data\/stores">[\s\S]*?Cached SKUs/);
  });

  it("renders an icon on each corpus stat tile", () => {
    const html = render(payload());
    const icoCount = (html.match(/class="stat-ico"/g) ?? []).length;
    expect(icoCount).toBe(4);
  });
});

describe("StatusPage SSR — per-job uptime + since", () => {
  it("renders the uptime sparkline with a % uptime label when a job has run history", () => {
    const runs = [
      run({ id: "r4", ok: true, ran_at: 4000 }),
      run({ id: "r3", ok: true, ran_at: 3000 }),
      run({ id: "r2", ok: false, ran_at: 2000 }),
      run({ id: "r1", ok: true, ran_at: 1000 }),
    ];
    const html = render(payload(), counts(), { "flyer-warm": runs });
    expect(html).toContain("75% uptime");
    expect(html).toContain("4 runs");
    expect(html).toContain("spark-seg-tip ok");
    expect(html).toContain("spark-seg-tip fail");
  });

  it("renders each sparkline segment as a link to its Logs deep-link, carrying the hover-tip data attributes", () => {
    const runs = [run({ id: "r2", ok: true, ran_at: 2000 }), run({ id: "r1", ok: false, ran_at: 1000 })];
    const html = render(payload(), counts(), { "flyer-warm": runs });
    expect(html).toContain('<a class="spark-seg-link" href="/admin/logs?run=r2">');
    expect(html).toContain('<a class="spark-seg-link" href="/admin/logs?run=r1">');
    expect(html).toContain('data-tip-title="1 run ago"');
    expect(html).toMatch(/data-tip-body="completed ok/);
    expect(html).toMatch(/data-tip-body="failed/);
    expect(html).toContain('data-tip-variant="fail"');
  });

  it("pads an under-populated series to the full window with non-interactive ghost slots, keeping the newest run anchored right and an OLDER/NOW axis", () => {
    const runs = [run({ id: "r1", ok: true, ran_at: 1000 })];
    const html = render(payload(), counts(), { "flyer-warm": runs });
    expect(html).toContain('class="spark-track-wrap"');
    expect(html).toContain("OLDER");
    expect(html).toContain("NOW");
    // One real run fills the NOW (right) edge; the rest of the fixed window is ghost-padded on the
    // older (left) side so the track fills its container instead of a narrow right-pinned band.
    const ghosts = (html.match(/class="spark-seg-tip ghost"/g) ?? []).length;
    expect(ghosts).toBe(STATUS_SPARKLINE_WINDOW - 1);
    // Ghost slots are inert: aria-hidden, never wrapped in a Logs deep-link, no hover-tip data.
    expect(html).toContain('<span class="spark-seg-tip ghost" aria-hidden="true"></span>');
    expect((html.match(/class="spark-seg-link"/g) ?? []).length).toBe(1); // only the one real run links
    // Ghosts are not counted in the labels — one real ok run reads as 100% over 1 run.
    expect(html).toContain("100% uptime");
    expect(html).toContain("1 runs");
  });

  it("renders no ghost slots once the series fills the window", () => {
    const runs = Array.from({ length: STATUS_SPARKLINE_WINDOW }, (_, i) =>
      run({ id: `r${i}`, ok: true, ran_at: 1000 + i }),
    );
    const html = render(payload(), counts(), { "flyer-warm": runs });
    expect(html).not.toContain('class="spark-seg-tip ghost"');
    expect((html.match(/class="spark-seg-link"/g) ?? []).length).toBe(STATUS_SPARKLINE_WINDOW);
  });

  it("shows Healthy since with the current-streak start instant", () => {
    const runs = [
      run({ id: "r3", ok: true, ran_at: 3_000 }),
      run({ id: "r2", ok: true, ran_at: 2_000 }),
      run({ id: "r1", ok: false, ran_at: 1_000 }),
    ];
    const html = render(payload(), counts(), { "flyer-warm": runs });
    expect(html).toContain("Healthy since");
  });

  it("shows Unhealthy since when the job's current state is failing", () => {
    const failing = payload({ jobs: [{ name: "flyer-warm", ok: false, last_run_at: 999_000, summary: {} }] });
    const runs = [run({ id: "r2", ok: false, ran_at: 2_000 }), run({ id: "r1", ok: true, ran_at: 1_000 })];
    const html = render(failing, counts(), { "flyer-warm": runs });
    expect(html).toContain("Unhealthy since");
  });

  it("omits the sparkline entirely for a job with no run history", () => {
    const html = render(payload(), counts(), {});
    expect(html).not.toContain("uptime-pct");
    expect(html).not.toContain("Run history");
    expect(html).not.toContain("Healthy since");
    expect(html).not.toContain("Unhealthy since");
  });

  it("renders a job's summary counts as jstat pills, not plain summary text", () => {
    const html = render(
      payload({ jobs: [{ name: "flyer-warm", ok: true, last_run_at: 999_000, summary: { errors: 0, matched: 12 } }] }),
    );
    expect(html).toContain('class="jstats"');
    expect(html).toMatch(/<span class="jstat"><span class="jstat-k">errors<\/span><span class="jstat-v">0<\/span><\/span>/);
    expect(html).toMatch(/<span class="jstat"><span class="jstat-k">matched<\/span><span class="jstat-v">12<\/span><\/span>/);
    expect(html).not.toContain('class="summary"');
  });
});

describe("StatusPage SSR — failing job styling", () => {
  it("gives a failing job's row the job-item fail class for the red-tinted card treatment", () => {
    const healthy = render(payload({ jobs: [{ name: "flyer-warm", ok: true, last_run_at: 999_000, summary: {} }] }));
    const failing = render(payload({ jobs: [{ name: "flyer-warm", ok: false, last_run_at: 999_000, summary: {} }] }));
    expect(healthy).toContain('class="item item-outline job-item"');
    expect(healthy).not.toContain("job-item fail");
    expect(failing).toContain('class="item item-outline job-item fail"');
  });
});

describe("StatusPage SSR — Dependencies group", () => {
  it("renders the D1 probe and the admin gate as a distinct Dependencies group", () => {
    const html = render(payload());
    expect(html).toContain("Dependencies");
    expect(html).toContain("Background jobs");
    const depsIdx = html.indexOf("Dependencies");
    const jobsIdx = html.indexOf("Background jobs");
    expect(jobsIdx).toBeGreaterThan(-1);
    expect(depsIdx).toBeGreaterThan(jobsIdx);
    expect(html).toContain("reachable");
    expect(html).toContain("gated");
  });
});
