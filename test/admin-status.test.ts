import { describe, it, expect } from "vitest";
import { StatusPage, jobStateOf, gateStateOf, relAge } from "../src/admin/pages/status.js";
import type { HealthPayload, JobRun } from "../src/health.js";
import type { CorpusCounts } from "../src/admin-data.js";

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
  (StatusPage({ payload: p, counts: c, runsByJob }) as { toString(): string }).toString();

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
    expect(html).toContain("Service health");
    expect(html).toContain("flyer-warm");
    expect(html).toContain("reachable");
    expect(html).toContain("gated");
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

  it("the Recipes and Members tiles navigate to their areas; the others don't", () => {
    const html = render(payload());
    expect(html).toMatch(/<a class="stat-card stat-card-link" href="\/admin\/data">[\s\S]*?Recipes/);
    expect(html).toMatch(/<a class="stat-card stat-card-link" href="\/admin\/members">[\s\S]*?Members/);
    expect(html).not.toContain('href="/admin/data"><div class="stat-top"><span class="stat-label">RSS');
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
    expect(html).toContain("spark-bar ok");
    expect(html).toContain("spark-bar fail");
  });

  it("renders each sparkline bar as a link to its Logs deep-link, not a bare span", () => {
    const runs = [run({ id: "r2", ok: true, ran_at: 2000 }), run({ id: "r1", ok: false, ran_at: 1000 })];
    const html = render(payload(), counts(), { "flyer-warm": runs });
    expect(html).toContain('<a class="spark-bar ok"');
    expect(html).toContain('href="/admin/logs?run=r2"');
    expect(html).toContain('<a class="spark-bar fail"');
    expect(html).toContain('href="/admin/logs?run=r1"');
    expect(html).not.toMatch(/<span class="spark-bar/);
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
