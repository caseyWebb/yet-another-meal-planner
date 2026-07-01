import { describe, it, expect } from "vitest";
import { buildHealthRollup, renderHealthDock } from "../src/admin/ui/health-dock.js";
import type { HealthPayload } from "../src/health.js";

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

describe("buildHealthRollup", () => {
  it("projects a healthy payload to ok with no failing jobs and the dep rows", () => {
    const r = buildHealthRollup(payload());
    expect(r.ok).toBe(true);
    expect(r.failingJobs).toEqual([]);
    expect(r.deps).toEqual([
      { name: "d1", state: "ok", word: "reachable" },
      { name: "admin gate", state: "ok", word: "gated" },
    ]);
  });

  it("lists only explicitly-failing jobs (a never-run job is not failing)", () => {
    const r = buildHealthRollup(
      payload({
        ok: false,
        jobs: [
          { name: "flyer-warm", ok: false, last_run_at: 1, summary: {} },
          { name: "recipe-embed", ok: null, last_run_at: null, never_run: true },
        ],
      }),
    );
    expect(r.failingJobs).toEqual(["flyer-warm"]);
  });

  it("surfaces an exposed gate as a failing dependency", () => {
    const r = buildHealthRollup(
      payload({
        ok: false,
        admin: { access_configured: false, email_allowlist: false, dev_bypass_set: true, exposed: true },
      }),
    );
    expect(r.deps).toContainEqual({ name: "admin gate", state: "fail", word: "exposed" });
  });

  it("marks an unreachable D1 dependency", () => {
    const r = buildHealthRollup(payload({ ok: false, d1: { ok: false } }));
    expect(r.deps).toContainEqual({ name: "d1", state: "fail", word: "unreachable" });
  });
});

describe("renderHealthDock", () => {
  it("emits the SSR pill, the JSON props block, and the island script", () => {
    const html = renderHealthDock(buildHealthRollup(payload()));
    expect(html).toContain('id="health-dock"');
    expect(html).toContain("Healthy");
    expect(html).toContain('id="health-props"');
    expect(html).toContain('src="/admin/islands/health.js"');
  });

  it("shows the failing-job count when degraded", () => {
    const html = renderHealthDock(
      buildHealthRollup(payload({ ok: false, jobs: [{ name: "flyer-warm", ok: false, last_run_at: 1, summary: {} }] })),
    );
    expect(html).toContain("Degraded");
    expect(html).toContain('class="hp-count"');
  });

  it("escapes < in the serialized props so the script can't close early", () => {
    // A job name with a '<' must be escaped to < in the embedded JSON.
    const html = renderHealthDock(
      buildHealthRollup(payload({ ok: false, jobs: [{ name: "a<script>", ok: false, last_run_at: 1, summary: {} }] })),
    );
    expect(html).not.toContain("a<script>");
    expect(html).toContain("a\\u003cscript>");
  });
});
