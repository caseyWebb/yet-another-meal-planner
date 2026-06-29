import { describe, it, expect } from "vitest";
import { StatusPage, jobStateOf, gateStateOf, relAge } from "../src/admin/pages/status.js";
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

const render = (p: HealthPayload): string => (StatusPage({ payload: p }) as { toString(): string }).toString();

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
  it("renders a healthy headline, job rows, the D1 row, and the gate posture", () => {
    const html = render(payload());
    expect(html).toContain("Service health");
    expect(html).toContain("Healthy");
    expect(html).toContain("flyer-warm");
    expect(html).toContain("reachable");
    expect(html).toContain("gated");
  });

  it("renders the exposed warning and a degraded headline when the gate is exposed", () => {
    const html = render(
      payload({
        ok: false,
        admin: { access_configured: false, email_allowlist: false, dev_bypass_set: true, exposed: true },
      }),
    );
    expect(html).toContain("Admin gate exposed");
    expect(html).toContain("Degraded");
    expect(html).toContain("exposed");
  });

  it("renders the AI-quota warning when exhausted", () => {
    expect(render(payload({ ok: false, ai_quota_exhausted: true }))).toContain("Workers AI quota exhausted");
  });
});
